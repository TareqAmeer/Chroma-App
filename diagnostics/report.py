"""
Render report.md + a stdout summary from a run's events.jsonl.

Reads events written by watcher.py and groups them into the four pain
categories the user cares about: freezes, slow operations, errors
(including silent-wrong-behavior signatures), and memory growth.
"""
import glob
import json
import os
import sys

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
    import datetime
    return datetime.datetime.fromtimestamp(ts).strftime('%H:%M:%S')


def build_summary(events):
    proc = [e for e in events if e.get('category') == 'process']
    freezes = [e for e in events if e.get('category') == 'freeze']
    errors = [e for e in events if e.get('category') == 'error']

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

    return {
        'process_samples': len(proc),
        'freezes': freeze_pairs,
        'errors': errors,
        'memory': memory,
    }


def render_markdown(summary, events_path):
    lines = []
    lines.append(f"# Diagnostic report\n")
    lines.append(f"Source: `{events_path}`\n")

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

    lines.append(f"## Process samples\n")
    lines.append(f"{summary['process_samples']} samples captured.\n")

    return '\n'.join(lines)


def render_stdout_summary(summary):
    print(f"Freezes: {len(summary['freezes'])}")
    for start_ev, end_ev in summary['freezes']:
        print(f"  - {_fmt_ts(start_ev['ts'])}  {end_ev.get('duration_s', '?')}s")
    mem = summary['memory']
    if mem:
        flag = " (FLAGGED: sustained growth)" if mem['flagged'] else ""
        print(f"Memory: {mem['start_mb']}MB -> {mem['peak_mb']}MB peak -> {mem['end_mb']}MB "
              f"({mem['slope_mb_per_min']} MB/min){flag}")
    else:
        print("Memory: not enough samples")
    print(f"Errors: {len(summary['errors'])}")
    for e in summary['errors'][:20]:
        print(f"  - {_fmt_ts(e['ts'])}  {e.get('kind', '?')}: {(e.get('msg') or '')[:120]}")
    if len(summary['errors']) > 20:
        print(f"  ... and {len(summary['errors']) - 20} more (see report.md)")


def run(run_dir):
    events_path = os.path.join(run_dir, 'events.jsonl')
    if not os.path.exists(events_path):
        print(f"error: no events.jsonl in {run_dir}", file=sys.stderr)
        return 1
    events = load_events(events_path)
    summary = build_summary(events)
    md = render_markdown(summary, events_path)
    report_path = os.path.join(run_dir, 'report.md')
    with open(report_path, 'w') as f:
        f.write(md)
    print(f"Report written to {report_path}\n")
    render_stdout_summary(summary)
    return 0
