"""
An immediate, exact snapshot of the app right now — process tree, per-pid
CPU/RSS/threads/FDs — for the deep-dive moment `ps`/`sample` get reached for
instead of waiting on a session's aggregate report.md. Prints straight to
stdout; if a diagnostic session is active, also logs one event per pid so
it lands in that run's events.jsonl/incidents for later reference.
"""
import time

import process_metrics
import child_watch

# Reuse child_watch's own process-cmd/pipe-fd lookups (already cross-platform: psutil on
# Windows, ps/lsof on macOS) instead of a second, macOS-only copy of the same subprocess calls.
_proc_cmd = child_watch._proc_cmd
_fd_count = child_watch.pipe_fd_count


def snapshot(main_pid):
    """Returns a list of row dicts: one for main_pid, one per descendant."""
    rows = []
    for pid, role, cmd in [(main_pid, 'main', 'chromasmith')] + [
        (p, 'child', _proc_cmd(p)) for p in child_watch.find_descendants(main_pid)
    ]:
        try:
            # A real interval, not the polling-loop's cheap interval=None — this is a
            # single-shot call with no prior baseline to diff against, so interval=None
            # would silently read 0.0% for every row. See process_metrics.sample's docstring.
            m = process_metrics.sample(pid, cpu_interval=0.1)
        except process_metrics.ProcessGone:
            continue
        rows.append({
            'pid': pid, 'role': role, 'cmd': cmd,
            'cpu_percent': m.get('cpu_percent'), 'rss_mb': m.get('rss_mb'),
            'threads': m.get('threads'), 'open_files': _fd_count(pid),
        })
    return rows


def render_table(rows):
    if not rows:
        return "(no processes found)"
    headers = ['PID', 'ROLE', 'CMD', 'CPU%', 'RSS(MB)', 'THREADS', 'FDS']
    lines = []
    widths = [6, 6, 40, 6, 8, 8, 5]
    lines.append('  '.join(h.ljust(w) for h, w in zip(headers, widths)))
    for r in rows:
        cmd = (r['cmd'] or '?').rsplit('/', 1)[-1][:40]
        vals = [str(r['pid']), r['role'], cmd,
                f"{r['cpu_percent']:.1f}" if r['cpu_percent'] is not None else '?',
                f"{r['rss_mb']:.1f}" if r['rss_mb'] is not None else '?',
                str(r['threads']) if r['threads'] is not None else '?',
                str(r['open_files']) if r['open_files'] is not None else '?']
        lines.append('  '.join(v.ljust(w) for v, w in zip(vals, widths)))
    return '\n'.join(lines)


def snapshot_events(rows):
    now = time.time()
    return [{'ts': now, 'category': 'inspect_snapshot', **r} for r in rows]
