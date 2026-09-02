"""
Render report.md + a stdout summary from a run's events.jsonl.

Reads events written by watcher.py and groups them into the four pain
categories the user cares about: freezes, slow operations, errors
(including silent-wrong-behavior signatures), and memory growth — plus
correlated incident bundles, known-bug-class matches, and a run-over-run
baseline comparison, so Claude can start from a diagnosis instead of a
pile of timestamps.
"""
import datetime
import glob
import json
import os
import sys

import baseline
import incidents as incidents_mod
import known_bugs

MEM_GROWTH_FLAG_MB_PER_MIN = 5.0


def load_events(events_path):
    events = []
    with open(events_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except (json.JSONDecodeError, ValueError):
                continue
    events.sort(key=lambda e: e.get('ts', 0))
    return events


def latest_run_dir(reports_dir):
    runs = sorted(glob.glob(os.path.join(reports_dir, '*')))
    runs = [r for r in runs if os.path.isdir(r) and os.path.exists(os.path.join(r, 'events.jsonl'))]
    if not runs:
        return None
    return runs[-1]


def _fmt_ts(ts):
    return datetime.datetime.fromtimestamp(ts).strftime('%H:%M:%S')


def load_meta(run_dir):
    path = os.path.join(run_dir, 'meta.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, ValueError):
        return {}


def build_summary(events):
    proc = [e for e in events if e.get('category') == 'process']
    freezes = [e for e in events if e.get('category') == 'freeze']
    errors = [e for e in events if e.get('category') == 'error']
    native_log_count = len([e for e in events if e.get('category') == 'native_log'])
    ipc = [e for e in events if e.get('category') == 'ipc']
    markers = [e for e in events if e.get('category') == 'marker']

    freeze_pairs = []
    pending_start = None
    for e in freezes:
        if e.get('kind') == 'start':
            pending_start = e
        elif e.get('kind') == 'end' and pending_start:
            freeze_pairs.append((pending_start, e))
            pending_start = None

    memory = None
    if proc:
        rss = [e['rss_mb'] for e in proc if e.get('rss_mb') is not None]
        if len(rss) >= 2:
            span_min = (proc[-1]['ts'] - proc[0]['ts']) / 60.0
            slope = (rss[-1] - rss[0]) / span_min if span_min > 0 else 0
            memory = {
                'start_mb': rss[0], 'end_mb': rss[-1], 'peak_mb': max(rss),
                'slope_mb_per_min': round(slope, 2),
                'flagged': slope >= MEM_GROWTH_FLAG_MB_PER_MIN,
            }

    slow_ipc = sorted([e for e in ipc if e.get('kind') == 'ipc' and (e.get('ms') or 0) > 500],
                       key=lambda e: -(e.get('ms') or 0))

    config = _build_config_summary(events)
    progress = _build_progress_summary(events)

    return {
        'process_samples': len(proc),
        'freezes': freeze_pairs,
        'errors': errors,
        'native_log_count': native_log_count,
        'ipc': ipc,
        'slow_ipc': slow_ipc,
        'markers': markers,
        'memory': memory,
        'config': config,
        'progress': progress,
    }


def _build_config_summary(events):
    """
    Latest known library-config state (root path, current folder, pause
    flag), plus a "wipe" flag if a previously-nonempty value ever went
    empty mid-session — the exact shape of the "cleared WebKit's data
    store and lost chromasmith_lib_root" incident this exists to catch.
    """
    snaps = [e for e in events if e.get('category') == 'config_snapshot' and e.get('config')]
    if not snaps:
        return None
    latest = snaps[-1]['config']
    wiped_keys = []
    prev = None
    for e in snaps:
        cfg = e['config']
        if prev:
            for key in ('libRoot', 'libLastFolder'):
                if prev.get(key) and not cfg.get(key) and key not in wiped_keys:
                    wiped_keys.append(key)
        prev = cfg
    return {'latest': latest, 'latest_ts': snaps[-1]['ts'], 'wiped_keys': wiped_keys, 'reading_count': len(snaps)}


def _build_progress_summary(events):
    """First/last catalog-thumbnail-backlog readings, so "is the indexer
    really moving" is a report line instead of a manual sqlite3 polling loop."""
    readings = [e for e in events if e.get('category') == 'progress' and e.get('kind') == 'catalog_thumbnails']
    readings = [e for e in readings if e.get('remaining') is not None]
    if not readings:
        return None
    first, last = readings[0], readings[-1]
    delta_remaining = None
    if first.get('remaining') is not None and last.get('remaining') is not None:
        delta_remaining = first['remaining'] - last['remaining']
    return {
        'first_remaining': first.get('remaining'),
        'last_remaining': last.get('remaining'),
        'delta_remaining': delta_remaining,
        'generated_session': last.get('generated_session'),
        'reading_count': len(readings),
        'moving': bool(delta_remaining and delta_remaining > 0),
    }


def render_markdown(summary, events_path, meta, incident_files, repeat_loops, comparison, bug_matches):
    lines = []
    lines.append("# Diagnostic report\n")
    lines.append(f"Source: `{events_path}`\n")
    if meta:
        dirty = f", {len(meta.get('dirty_files', []))} dirty files" if meta.get('dirty_files') else ""
        lines.append(f"Repo: `{meta.get('branch')}@{meta.get('commit_short')}`{dirty}  "
                      f"BUILD=`{meta.get('build_stamp')}`\n")
        if meta.get('binary_path'):
            stale = " ⚠️ **OLDER than HEAD's commit — rebuild + full relaunch needed**" if meta.get('binary_stale') else " (not older than HEAD)"
            lines.append(f"Running binary: `{meta['binary_path']}`{stale}\n")

    lines.append("## Top suspects\n")
    if incident_files:
        for idx, incident, path in incident_files[:3]:
            rel = os.path.relpath(path, os.path.dirname(events_path))
            what = []
            if incident['freeze_detail']:
                end = incident['freeze_detail'].get('end')
                dur = end.get('duration_s') if end else None
                what.append(f"freeze ({dur}s)" if dur else "freeze (unresolved)")
                if incident['sample_summary']:
                    what.append(f"hung near `{incident['sample_summary']}`")
            if incident['related_errors']:
                what.append(f"{len(incident['related_errors'])} error(s)")
            for m in incident['bug_matches'][:1]:
                what.append(f"possible **{m['bug_id']}**")
            lines.append(f"{idx}. `{_fmt_ts(incident['ts_start'])}` — {', '.join(what) or 'see incident file'} "
                          f"→ [{rel}]({rel})")
        lines.append("")
    else:
        lines.append("No freeze/error incidents this run.\n")

    if repeat_loops:
        lines.append("## Possible retry loops\n")
        for loop in repeat_loops:
            lines.append(f"- `{loop['kind']}` \"{loop['msg_prefix']}\" repeated {loop['count']}x "
                          f"within {loop['window_s']}s, starting {_fmt_ts(loop['first_ts'])} "
                          f"— pattern matches the 'stuck retry' bug class (e.g. hq_offline).")
        lines.append("")

    lines.append("## Freezes / unresponsiveness\n")
    if not summary['freezes']:
        lines.append("None detected.\n")
    else:
        lines.append("| start | duration (s) | sample |")
        lines.append("|---|---|---|")
        for start_ev, end_ev in summary['freezes']:
            lines.append(f"| {_fmt_ts(start_ev['ts'])} | {end_ev.get('duration_s', '?')} | see samples/ |")
        lines.append("")

    lines.append("## Memory\n")
    mem = summary['memory']
    if not mem:
        lines.append("Not enough process samples captured.\n")
    else:
        flag = " ⚠️ sustained growth" if mem['flagged'] else ""
        lines.append(f"- start: {mem['start_mb']} MB")
        lines.append(f"- peak: {mem['peak_mb']} MB")
        lines.append(f"- end: {mem['end_mb']} MB")
        lines.append(f"- slope: {mem['slope_mb_per_min']} MB/min{flag}\n")

    if summary['config']:
        cfg = summary['config']
        lines.append("## Library config state\n")
        latest = cfg['latest']
        lines.append(f"- `chromasmith_lib_root`: `{latest.get('libRoot') or '(empty)'}`")
        lines.append(f"- current folder: `{latest.get('libLastFolder') or '(empty)'}`")
        lines.append(f"- background paused: {latest.get('bgPaused')}")
        lines.append(f"- last reading: `{_fmt_ts(cfg['latest_ts'])}` ({cfg['reading_count']} readings this run)")
        if cfg['wiped_keys']:
            lines.append(f"- ⚠️ **{', '.join(cfg['wiped_keys'])} went from a real value to empty mid-run** "
                          f"— likely cause: WebKit data store / localStorage cleared.")
        lines.append("")

    if summary['progress']:
        prog = summary['progress']
        lines.append("## Catalog indexing progress\n")
        lines.append(f"- backlog (thumbnails remaining): {prog['first_remaining']} → {prog['last_remaining']}"
                      + (f" ({prog['delta_remaining']:+d})" if prog['delta_remaining'] is not None else ""))
        lines.append(f"- generated this session: {prog['generated_session']}")
        stuck_note = ""
        if prog['reading_count'] > 1 and not prog['moving']:
            stuck_note = " — ⚠️ backlog did not shrink across readings, indexer may be stuck"
        lines.append(f"- {prog['reading_count']} readings this run{stuck_note}")
        lines.append("")

    if summary['slow_ipc']:
        lines.append("## Slow Tauri IPC calls (>500ms)\n")
        lines.append("| time | command | ms |")
        lines.append("|---|---|---|")
        for e in summary['slow_ipc'][:15]:
            lines.append(f"| {_fmt_ts(e['ts'])} | {e.get('cmd', '?')} | {e.get('ms')} |")
        lines.append("")

    lines.append("## Errors (incl. silent-wrong-behavior signatures)\n")
    if not summary['errors']:
        lines.append("None captured.\n")
    else:
        lines.append("| time | kind | message |")
        lines.append("|---|---|---|")
        for e in summary['errors']:
            msg = (e.get('msg') or '').replace('|', '\\|').replace('\n', ' ')[:200]
            lines.append(f"| {_fmt_ts(e['ts'])} | {e.get('kind', '?')} | {msg} |")
        lines.append("")

    if bug_matches:
        lines.append("## Known-bug-class matches\n")
        seen = set()
        for m in bug_matches:
            if m['bug_id'] in seen:
                continue
            seen.add(m['bug_id'])
            lines.append(f"- **{m['bug_id']}**: {m['explanation']}")
        lines.append("")

    if summary['markers']:
        lines.append("## User action markers\n")
        for m in summary['markers']:
            lines.append(f"- `{_fmt_ts(m['ts'])}` {m.get('msg', '')}")
        lines.append("")

    lines.append("## Run-over-run comparison\n")
    lines.append(comparison + "\n")

    lines.append("## Process samples\n")
    native_log_note = (f", {summary['native_log_count']} routine native-log lines also captured "
                        f"(info level, not shown as errors)") if summary['native_log_count'] else ""
    lines.append(f"{summary['process_samples']} samples captured{native_log_note}.\n")

    if incident_files:
        lines.append("## All incidents\n")
        for idx, incident, path in incident_files:
            rel = os.path.relpath(path, os.path.dirname(events_path))
            lines.append(f"- [{rel}]({rel})")
        lines.append("")

    return '\n'.join(lines)


def render_stdout_summary(summary, incident_files, comparison):
    print(f"Freezes: {len(summary['freezes'])}   Errors: {len(summary['errors'])}   "
          f"Incidents: {len(incident_files)}")
    mem = summary['memory']
    if mem:
        flag = " (FLAGGED: sustained growth)" if mem['flagged'] else ""
        print(f"Memory: {mem['start_mb']}MB -> {mem['peak_mb']}MB peak -> {mem['end_mb']}MB "
              f"({mem['slope_mb_per_min']} MB/min){flag}")
    else:
        print("Memory: not enough samples")
    if incident_files:
        print("\nTop suspects:")
        for idx, incident, path in incident_files[:3]:
            print(f"  {idx}. {os.path.basename(path)} @ {_fmt_ts(incident['ts_start'])}")
    print(f"\n{comparison}")


def build_claude_digest(run_dir, summary, meta, incident_files, repeat_loops, comparison, bug_matches):
    lines = ["# Diagnostic digest (for Claude)\n"]
    if meta:
        dirty = f", {len(meta.get('dirty_files', []))} dirty files" if meta.get('dirty_files') else ""
        lines.append(f"Repo: `{meta.get('branch')}@{meta.get('commit_short')}`{dirty}  "
                      f"BUILD=`{meta.get('build_stamp')}`\n")
        if meta.get('binary_stale'):
            lines.append(f"⚠️ Running binary (`{meta.get('binary_path')}`) is OLDER than HEAD's "
                          f"commit — a native fix may not be in the running process yet.\n")

    lines.append(f"Freezes: {len(summary['freezes'])} · Errors: {len(summary['errors'])} · "
                  f"Incidents: {len(incident_files)}\n")

    if summary['config']:
        cfg = summary['config']
        latest = cfg['latest']
        wipe = f" ⚠️ WIPED mid-run: {', '.join(cfg['wiped_keys'])}" if cfg['wiped_keys'] else ""
        lines.append(f"Library config — root: `{latest.get('libRoot') or '(empty)'}`, "
                      f"folder: `{latest.get('libLastFolder') or '(empty)'}`, "
                      f"paused: {latest.get('bgPaused')}{wipe}\n")

    if summary['progress']:
        prog = summary['progress']
        stuck = " ⚠️ STUCK (backlog not shrinking)" if prog['reading_count'] > 1 and not prog['moving'] else ""
        lines.append(f"Catalog backlog: {prog['first_remaining']}→{prog['last_remaining']}, "
                      f"generated {prog['generated_session']} this session{stuck}\n")

    mem = summary['memory']
    if mem:
        flag = " ⚠️ FLAGGED" if mem['flagged'] else ""
        lines.append(f"Memory: {mem['start_mb']}→{mem['peak_mb']} peak→{mem['end_mb']} MB, "
                      f"slope {mem['slope_mb_per_min']} MB/min{flag}\n")

    lines.append(f"Baseline: {comparison}\n")

    if incident_files:
        lines.append("## Incidents, ranked by severity\n")
        for idx, incident, path in incident_files:
            what = []
            if incident['freeze_detail']:
                end = incident['freeze_detail'].get('end')
                what.append(f"freeze {end.get('duration_s')}s" if end else "freeze (unresolved)")
                if incident['sample_summary']:
                    what.append(f"hung in `{incident['sample_summary']}`")
            if incident['related_errors']:
                what.append(f"{len(incident['related_errors'])} error(s): " +
                             '; '.join((e.get('msg') or '')[:100] for e in incident['related_errors'][:2]))
            if incident['source_hints']:
                h = incident['source_hints'][0]
                what.append(f"source: `{h['function']}` (~line {h['def_line']})")
            for m in incident['bug_matches'][:2]:
                what.append(f"known class: {m['bug_id']} — {m['explanation']}")
            lines.append(f"**{idx}.** `{_fmt_ts(incident['ts_start'])}` — " + '; '.join(what))
        lines.append("")

    if repeat_loops:
        lines.append("## Retry-loop suspects\n")
        for loop in repeat_loops:
            lines.append(f"- \"{loop['msg_prefix']}\" x{loop['count']} in {loop['window_s']}s "
                          f"from {_fmt_ts(loop['first_ts'])}")
        lines.append("")

    if bug_matches:
        lines.append("## Known bug classes worth checking\n")
        seen = set()
        for m in bug_matches:
            if m['bug_id'] in seen:
                continue
            seen.add(m['bug_id'])
            lines.append(f"- **{m['bug_id']}**: {m['explanation']}")
        lines.append("")

    lines.append(f"Full report: `{os.path.join(run_dir, 'report.md')}`")
    lines.append(f"Per-incident detail (state snapshots, IPC timeline, stack samples): "
                  f"`{os.path.join(run_dir, 'incidents/')}`")
    return '\n'.join(lines)


def run(run_dir, for_claude=False):
    events_path = os.path.join(run_dir, 'events.jsonl')
    if not os.path.exists(events_path):
        print(f"error: no events.jsonl in {run_dir}", file=sys.stderr)
        return 1
    events = load_events(events_path)
    meta = load_meta(run_dir)
    summary = build_summary(events)

    all_incidents = incidents_mod.build_incidents(events)
    incident_files = incidents_mod.write_incidents(all_incidents, run_dir)

    repeat_loops = known_bugs.detect_repeat_loops(events)
    bug_matches = known_bugs.match_events(events)

    run_id = os.path.basename(run_dir.rstrip('/'))
    comparison_data = baseline.compare_and_record(run_id, summary)
    comparison = baseline.render_comparison(comparison_data)

    md = render_markdown(summary, events_path, meta, incident_files, repeat_loops, comparison, bug_matches)
    report_path = os.path.join(run_dir, 'report.md')
    with open(report_path, 'w') as f:
        f.write(md)
    print(f"Report written to {report_path}\n")
    render_stdout_summary(summary, incident_files, comparison)

    digest = build_claude_digest(run_dir, summary, meta, incident_files, repeat_loops, comparison, bug_matches)
    digest_path = os.path.join(run_dir, 'for_claude.md')
    with open(digest_path, 'w') as f:
        f.write(digest)
    if for_claude:
        print(f"\n{'=' * 60}\n")
        print(digest)
    else:
        print(f"\nClaude-ready digest: {digest_path}  (--for-claude to print it)")

    return 0
