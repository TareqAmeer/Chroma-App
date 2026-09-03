"""
Bundle every event within a short time window of a freeze or error into
one self-contained "incident" — so Claude reads one file per problem
instead of cross-referencing timestamps across the whole events.jsonl by
hand. Each incident pulls in: the anchor event(s), the nearest process
metrics (CPU/RSS context), any IPC calls in flight, the nearest UI state
snapshot, any known-bug pattern matches, and any user action markers.
"""
import bisect
import json
import os

import known_bugs
import source_context
import symbolicate
from child_watch import STALL_WINDOW_S

WINDOW_S = 5.0
ANCHOR_CATEGORIES = ('freeze', 'error', 'child_process')


def _is_anchor(e):
    if e.get('category') == 'error':
        return True
    if e.get('category') == 'freeze' and e.get('kind') == 'start':
        return True
    # A hung/deadlocked child (child_watch.py) is exactly as report-worthy as a freeze —
    # the main app's own AppleEvent responsiveness stays healthy the whole time, so this is
    # the only anchor that would ever catch it.
    if e.get('category') == 'child_process' and e.get('kind') == 'possible_stall':
        return True
    return False


def _merge_anchors(anchors, window_s=WINDOW_S):
    """Merge anchors within window_s of each other into one incident span."""
    anchors = sorted(anchors, key=lambda e: e['ts'])
    groups = []
    for a in anchors:
        if groups and a['ts'] - groups[-1][-1]['ts'] <= window_s:
            groups[-1].append(a)
        else:
            groups.append([a])
    return groups


def _nearest(sorted_events, ts):
    """Nearest-by-timestamp event to ts from a list sorted by ts, or None."""
    if not sorted_events:
        return None
    times = [e['ts'] for e in sorted_events]
    i = bisect.bisect_left(times, ts)
    candidates = [c for c in (i - 1, i) if 0 <= c < len(sorted_events)]
    if not candidates:
        return None
    return min((sorted_events[c] for c in candidates), key=lambda e: abs(e['ts'] - ts))


def _within(events, lo, hi):
    return [e for e in events if lo <= e['ts'] <= hi]


def build_incidents(events, samples_dir=None, window_s=WINDOW_S):
    anchors = [e for e in events if _is_anchor(e)]
    if not anchors:
        return []

    proc_events = sorted([e for e in events if e.get('category') == 'process'], key=lambda e: e['ts'])
    heartbeats = sorted(
        [e for e in events if e.get('category') == 'state_snapshot'], key=lambda e: e['ts'])
    ipc_events = sorted([e for e in events if e.get('category') == 'ipc'], key=lambda e: e['ts'])
    markers = sorted([e for e in events if e.get('category') == 'marker'], key=lambda e: e['ts'])
    freeze_events = [e for e in events if e.get('category') == 'freeze']

    groups = _merge_anchors(anchors, window_s)
    incidents = []
    for group in groups:
        lo = group[0]['ts'] - window_s
        hi = group[-1]['ts'] + window_s

        related_errors = [e for e in _within(events, lo, hi) if e.get('category') == 'error']
        related_ipc = _within(ipc_events, lo, hi)
        related_markers = _within(markers, lo, hi)
        nearest_proc = _nearest(proc_events, group[0]['ts'])
        nearest_state = _nearest(heartbeats, group[0]['ts'])

        # If this incident is anchored by a freeze, pull in its matching
        # end/sample_captured events (they land at a later ts, past `hi`).
        freeze_detail = None
        for a in group:
            if a.get('category') == 'freeze' and a.get('kind') == 'start':
                same_freeze = [f for f in freeze_events if f['ts'] >= a['ts']]
                same_freeze.sort(key=lambda e: e['ts'])
                end_ev = next((f for f in same_freeze if f.get('kind') == 'end'), None)
                sample_ev = next((f for f in same_freeze if f.get('kind') == 'sample_captured'), None)
                freeze_detail = {'start': a, 'end': end_ev, 'sample': sample_ev}
                break

        # group's anchors and related_errors overlap when an error event is
        # itself close enough to be merged into the freeze's group — dedupe
        # by identity before scanning, or bug_matches/source_hints double up.
        relevant_events = list({id(e): e for e in (group + related_errors)}.values())

        bug_matches = []
        for e in relevant_events:
            text = ' '.join(str(e.get(k, '')) for k in ('msg', 'cmd') if e.get(k))
            for bug_id, explanation in known_bugs.match_text(text):
                bug_matches.append({'bug_id': bug_id, 'explanation': explanation})

        sample_summary = None
        if freeze_detail and freeze_detail['sample'] and freeze_detail['sample'].get('path'):
            sample_summary = symbolicate.summarize(freeze_detail['sample']['path'])

        source_hints = []
        for e in relevant_events:
            if e.get('kind', '').startswith('js_') and e.get('src'):
                line_no = source_context.parse_location(e['src'])
                hit = source_context.enclosing_function(line_no) if line_no else None
                if hit:
                    source_hints.append({'src': e['src'], 'function': hit[0], 'def_line': hit[1]})

        incidents.append({
            'ts_start': group[0]['ts'],
            'ts_end': group[-1]['ts'],
            'anchors': group,
            'freeze_detail': freeze_detail,
            'related_errors': related_errors,
            'related_ipc': related_ipc,
            'related_markers': related_markers,
            'nearest_process': nearest_proc,
            'nearest_state_snapshot': nearest_state,
            'bug_matches': bug_matches,
            'sample_summary': sample_summary,
            'source_hints': source_hints,
        })
    return incidents


def _fmt_ts(ts):
    import datetime
    return datetime.datetime.fromtimestamp(ts).strftime('%H:%M:%S')


def severity_score(incident):
    score = 0.0
    if incident['freeze_detail']:
        end = incident['freeze_detail'].get('end')
        score += (end.get('duration_s', 1) if end else 1) * 10
    score += len(incident['related_errors']) * 2
    score += len(incident['bug_matches']) * 5
    for a in incident['anchors']:
        if a.get('category') == 'child_process' and a.get('kind') == 'possible_stall':
            score += 20 if a.get('looks_like_pipe_block') else 10
    return score


def render_incident_markdown(incident, idx):
    lines = [f"# Incident {idx}", ""]
    lines.append(f"Window: {_fmt_ts(incident['ts_start'])} – {_fmt_ts(incident['ts_end'])}\n")

    stall_anchors = [a for a in incident['anchors']
                      if a.get('category') == 'child_process' and a.get('kind') == 'possible_stall']
    for a in stall_anchors:
        pipe_note = " ⚠️ **looks like a blocked pipe write**" if a.get('looks_like_pipe_block') else ""
        lines.append(f"## Child process stall — {a.get('cmd')} (pid {a.get('pid')}){pipe_note}")
        lines.append(f"Idle for {STALL_WINDOW_S:.0f}s+, {a.get('pipe_fd_count')} open pipe fd(s)")
        if a.get('stack_summary'):
            lines.append(f"Stack: `{a['stack_summary']}`")
        if a.get('sample_path'):
            lines.append(f"Raw stack sample: `{a['sample_path']}`")
        lines.append("")

    if incident['freeze_detail']:
        fd = incident['freeze_detail']
        dur = fd['end'].get('duration_s', '?') if fd['end'] else 'still ongoing / unresolved'
        lines.append(f"## Freeze — {dur}s")
        if incident['sample_summary']:
            lines.append(f"Hung near: `{incident['sample_summary']}`")
        if fd['sample'] and fd['sample'].get('path'):
            lines.append(f"Raw stack sample: `{fd['sample']['path']}`")
        lines.append("")

    if incident['related_errors']:
        lines.append("## Errors in this window")
        for e in incident['related_errors']:
            msg = (e.get('msg') or '')[:300]
            lines.append(f"- `{_fmt_ts(e['ts'])}` [{e.get('kind', '?')}] {msg}")
        lines.append("")

    if incident['source_hints']:
        lines.append("## Source location")
        for h in incident['source_hints']:
            lines.append(f"- `{h['src']}` → inside `{h['function']}` (defined near line {h['def_line']})")
        lines.append("")

    if incident['bug_matches']:
        lines.append("## Possible known-bug-class matches")
        seen = set()
        for m in incident['bug_matches']:
            if m['bug_id'] in seen:
                continue
            seen.add(m['bug_id'])
            lines.append(f"- **{m['bug_id']}**: {m['explanation']}")
        lines.append("")

    if incident['nearest_process']:
        p = incident['nearest_process']
        lines.append("## Process context (nearest sample)")
        lines.append(f"- CPU {p.get('cpu_percent')}%  RSS {p.get('rss_mb')}MB  "
                      f"threads {p.get('threads')}  @ {_fmt_ts(p['ts'])}")
        lines.append("")

    if incident['related_ipc']:
        lines.append("## Tauri IPC calls in flight")
        for e in incident['related_ipc']:
            lines.append(f"- `{_fmt_ts(e['ts'])}` {e.get('cmd', '?')} — {e.get('ms', '?')}ms"
                          f"{' (error)' if e.get('kind') == 'invoke_err' else ''}")
        lines.append("")

    if incident['nearest_state_snapshot']:
        snap = incident['nearest_state_snapshot'].get('snap')
        if snap:
            lines.append("## Nearest UI state snapshot (getUISnapshot)")
            try:
                pretty = json.dumps(snap, indent=2)[:3000]
            except (TypeError, ValueError):
                pretty = str(snap)[:3000]
            lines.append("```json")
            lines.append(pretty)
            lines.append("```")
            lines.append("")

    if incident['related_markers']:
        lines.append("## User action markers nearby")
        for m in incident['related_markers']:
            lines.append(f"- `{_fmt_ts(m['ts'])}` {m.get('msg', '')}")
        lines.append("")

    return '\n'.join(lines)


def write_incidents(incidents, run_dir):
    out_dir = os.path.join(run_dir, 'incidents')
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    ranked = sorted(enumerate(incidents, 1), key=lambda t: severity_score(t[1]), reverse=True)
    for idx, incident in ranked:
        path = os.path.join(out_dir, f'incident_{idx}.md')
        with open(path, 'w') as f:
            f.write(render_incident_markdown(incident, idx))
        paths.append((idx, incident, path))
    return paths
