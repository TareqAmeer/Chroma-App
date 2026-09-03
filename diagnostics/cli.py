#!/usr/bin/env python3
"""
Entrypoint for Chromasmith's live diagnostic tool.

  python3 diagnostics/cli.py start [--duration 15m] [--relaunch] [--use-spindump]
  python3 diagnostics/cli.py report [--run <timestamp>] [--for-claude]
  python3 diagnostics/cli.py mark "clicked Export"
  python3 diagnostics/cli.py inspect                    # exact live process-tree snapshot
  python3 diagnostics/cli.py sample [--pid PID]          # stack sample right now
  python3 diagnostics/cli.py db pending-thumbs           # exact catalog.db row state
  python3 diagnostics/cli.py db --sql "SELECT ..."       # or --list for canned queries

inspect/sample/db work standalone (no `start` session needed) for the "give me
exact numbers now" deep-dive — `start`'s report.md is the aggregate-summary
triage layer on top of the same underlying data.

See diagnostics/README.md for the full walkthrough.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR = os.path.join(ROOT, 'reports')
ACTIVE_RUN_FILE = os.path.join(REPORTS_DIR, '.active_run')


def parse_duration(s):
    """Accepts '15m', '90s', '2h', or a bare number of seconds."""
    m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*([smh]?)', s.strip())
    if not m:
        raise argparse.ArgumentTypeError(f"invalid duration: {s!r} (use e.g. 15m, 90s, 2h)")
    value, unit = float(m.group(1)), m.group(2)
    return value * {'s': 1, 'm': 60, 'h': 3600, '': 1}[unit]


def cmd_start(args):
    from watcher import Session
    run_id = time.strftime('%Y%m%d-%H%M%S')
    run_dir = os.path.join(REPORTS_DIR, run_id)
    session = Session(
        duration_s=args.duration,
        relaunch=args.relaunch,
        use_spindump=args.use_spindump,
        use_dtrace=args.use_dtrace,
        run_dir=run_dir,
    )
    rc = session.run()
    if rc == 0 and os.path.exists(os.path.join(run_dir, 'events.jsonl')):
        import report
        report.run(run_dir)
    return rc


def cmd_report(args):
    import report
    if args.run:
        run_dir = os.path.join(REPORTS_DIR, args.run)
    else:
        run_dir = report.latest_run_dir(REPORTS_DIR)
        if run_dir is None:
            print(f"No runs found under {REPORTS_DIR}", file=sys.stderr)
            return 1
    return report.run(run_dir, for_claude=args.for_claude)


def cmd_mark(args):
    if not os.path.exists(ACTIVE_RUN_FILE):
        print("No active diagnostic session — start one with "
              "`python3 diagnostics/cli.py start` first.", file=sys.stderr)
        return 1
    with open(ACTIVE_RUN_FILE) as f:
        run_dir = f.read().strip()
    events_path = os.path.join(run_dir, 'events.jsonl')
    if not run_dir or not os.path.exists(events_path):
        print(f"Active run pointer is stale ({run_dir!r} has no events.jsonl) — "
              "the session may have already ended.", file=sys.stderr)
        return 1
    event = {'ts': time.time(), 'category': 'marker', 'msg': args.text}

    if not args.no_screenshot:
        import screenshot
        shot_path = os.path.join(run_dir, 'screenshots', f"mark_{int(event['ts'])}.png")
        try:
            if screenshot.capture_window(shot_path):
                event['screenshot'] = shot_path
            else:
                print("(no screenshot: app window not found, or `swift`/`screencapture` unavailable)",
                      file=sys.stderr)
        except screenshot.ScreenRecordingPermissionError as e:
            print(f"(no screenshot: {e})", file=sys.stderr)

    with open(events_path, 'a') as f:
        f.write(json.dumps(event) + '\n')
    shot_note = f" (screenshot: {event['screenshot']})" if 'screenshot' in event else ""
    print(f"Marked: \"{args.text}\" in {os.path.basename(run_dir)}{shot_note}")
    return 0


def _active_run_dir():
    if not os.path.exists(ACTIVE_RUN_FILE):
        return None
    with open(ACTIVE_RUN_FILE) as f:
        run_dir = f.read().strip()
    if run_dir and os.path.exists(os.path.join(run_dir, 'events.jsonl')):
        return run_dir
    return None


def cmd_inspect(args):
    """Exact live numbers right now — the deep-dive counterpart to `report`'s
    aggregate summary. Terse by default (one line per process, no padded
    table) since this output is meant to be read by an LLM as often as a
    human — a full table costs real context tokens for no extra signal
    over a compact line. `--full` prints the padded table; the full table
    is always ALSO written to a file either way, so nothing is lost."""
    import find_process
    import inspect as inspect_mod  # shadows stdlib inspect on purpose within this function only
    try:
        pid, app_path = find_process.find_chromasmith_pid()
    except find_process.ProcessNotFound as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    rows = inspect_mod.snapshot(pid)

    run_dir = _active_run_dir()
    out_dir = os.path.join(run_dir, 'snapshots') if run_dir else '/tmp'
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"inspect_{int(time.time())}.txt")
    with open(out_path, 'w') as f:
        f.write(inspect_mod.render_table(rows) + '\n')

    if args.full:
        print(f"pid {pid} ({app_path or 'unknown bundle'}) — main + every descendant\n")
        print(inspect_mod.render_table(rows))
    else:
        print(f"{len(rows)} process(es) — full table: {out_path}")
        for r in rows:
            cpu = f"{r['cpu_percent']:.0f}%" if r['cpu_percent'] is not None else '?'
            rss = f"{r['rss_mb']:.0f}MB" if r['rss_mb'] is not None else '?'
            cmd = (r['cmd'] or '?').rsplit('/', 1)[-1][:30]
            print(f"  {r['pid']} {r['role']:<5} {cmd:<30} cpu={cpu:<5} rss={rss:<8} threads={r['threads']}")

    if run_dir:
        events_path = os.path.join(run_dir, 'events.jsonl')
        with open(events_path, 'a') as f:
            for ev in inspect_mod.snapshot_events(rows):
                f.write(json.dumps(ev) + '\n')
    return 0


def cmd_sample(args):
    """Capture a stack sample of a pid RIGHT NOW — no waiting for the freeze
    detector to trip. Defaults to the app's own main pid."""
    import sample_capture
    import symbolicate
    import find_process

    pid = args.pid
    if pid is None:
        try:
            pid, _ = find_process.find_chromasmith_pid()
        except find_process.ProcessNotFound as e:
            print(f"error: {e}", file=sys.stderr)
            return 1

    run_dir = _active_run_dir()
    out_dir = os.path.join(run_dir, 'samples') if run_dir else '/tmp'
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"manual_sample_{pid}_{int(time.time())}.sample.txt")

    print(f"Sampling pid {pid} for {args.seconds}s...")
    ok = sample_capture.capture_sample(pid, out_path, seconds=args.seconds)
    if not ok:
        print("sample failed (process gone, or `sample` unavailable)", file=sys.stderr)
        return 1

    print(f"Raw sample: {out_path}")
    summary = symbolicate.summarize(out_path)
    if summary:
        print(f"Deepest frames: {summary}")

    if run_dir:
        event = {'ts': time.time(), 'category': 'manual_sample', 'pid': pid,
                  'path': out_path, 'stack_summary': summary}
        with open(os.path.join(run_dir, 'events.jsonl'), 'a') as f:
            f.write(json.dumps(event) + '\n')
        print(f"(also logged to {os.path.basename(run_dir)})")
    return 0


def _print_db_table(cols, rows, limit=None, out_path=None):
    if not rows:
        print("(no rows)")
        return
    if out_path:
        with open(out_path, 'w') as f:
            f.write('\t'.join(cols) + '\n')
            for r in rows:
                f.write('\t'.join(str(v) for v in r) + '\n')
    shown = rows if limit is None else rows[:limit]
    widths = [max(len(str(c)), *(len(str(r[i])) for r in shown)) for i, c in enumerate(cols)]
    print('  '.join(str(c).ljust(w) for c, w in zip(cols, widths)))
    print('  '.join('-' * w for w in widths))
    for r in shown:
        print('  '.join(str(v).ljust(w) for v, w in zip(r, widths)))
    if limit is not None and len(rows) > limit:
        print(f"... {len(rows) - limit} more row(s) — --full to show all, or see {out_path}")


def cmd_db(args):
    """Exact catalog.db row state, read-only — the sqlite3-one-liner
    replacement. `--list` shows the canned queries; `--sql` is the escape hatch."""
    import db as db_mod

    if args.list:
        for name, (desc, _) in db_mod.CANNED.items():
            print(f"{name:<20} {desc}")
        return 0

    try:
        if args.sql:
            cols, rows = db_mod.run_sql(args.sql)
        elif args.query:
            if args.query not in db_mod.CANNED:
                print(f"Unknown canned query '{args.query}'. --list to see options.", file=sys.stderr)
                return 1
            _, sql = db_mod.CANNED[args.query]
            cols, rows = db_mod.run_sql(sql)
        else:
            print("Pass a canned query name, --sql, or --list. See --help.", file=sys.stderr)
            return 1
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except (ValueError,) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # sqlite3.Error et al — surface it plainly, don't swallow
        print(f"query failed: {e}", file=sys.stderr)
        return 1

    run_dir = _active_run_dir()
    out_dir = os.path.join(run_dir, 'db_queries') if run_dir else '/tmp'
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"query_{int(time.time())}.tsv")
    limit = None if args.full else 10
    _print_db_table(cols, rows, limit=limit, out_path=out_path)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    p_start = sub.add_parser('start', help='Watch the running app for a fixed duration')
    p_start.add_argument('--duration', type=parse_duration, default=15 * 60,
                          help='Session length, e.g. 15m, 90s, 2h (default: 15m)')
    p_start.add_argument('--relaunch', action='store_true',
                          help='Spawn the app binary directly for guaranteed stderr capture '
                               '(changes launch conditions vs. a normal Finder/Dock launch)')
    p_start.add_argument('--use-spindump', action='store_true',
                          help='Escalate to spindump (may prompt for sudo) if `sample` fails to '
                               'capture a hung process')
    p_start.add_argument('--use-dtrace', action='store_true',
                          help='When a child process stall is suspected, confirm it instantly via '
                               'a short dtrace probe (needs sudo) instead of relying only on the '
                               'CPU-idle-then-stack-sample heuristic — see pipe_dtrace.py')
    p_start.set_defaults(func=cmd_start)

    p_report = sub.add_parser('report', help='Re-render a report from a saved run')
    p_report.add_argument('--run', help='Run timestamp under diagnostics/reports/ (default: latest)')
    p_report.add_argument('--for-claude', action='store_true',
                           help='Print the condensed Claude-ready digest to stdout')
    p_report.set_defaults(func=cmd_report)

    p_mark = sub.add_parser('mark', help='Tag the current moment in the active run, e.g. "clicked Export"')
    p_mark.add_argument('text')
    p_mark.add_argument('--no-screenshot', action='store_true',
                         help="Don't capture the app window (screenshot is automatic by default)")
    p_mark.set_defaults(func=cmd_mark)

    p_inspect = sub.add_parser('inspect', help='Exact live process-tree snapshot right now (CPU/RSS/threads/FDs)')
    p_inspect.add_argument('--full', action='store_true', help='Print the padded table (default: compact lines)')
    p_inspect.set_defaults(func=cmd_inspect)

    p_sample = sub.add_parser('sample', help='Capture a stack sample right now, no waiting for a freeze')
    p_sample.add_argument('--pid', type=int, default=None, help='Defaults to the app\'s own main pid')
    p_sample.add_argument('--seconds', type=int, default=3, help='Sample duration (default: 3)')
    p_sample.set_defaults(func=cmd_sample)

    p_db = sub.add_parser('db', help='Exact catalog.db row state, read-only')
    p_db.add_argument('query', nargs='?', help='A canned query name (see --list)')
    p_db.add_argument('--sql', help='Raw SELECT/WITH query against catalog.db')
    p_db.add_argument('--list', action='store_true', help='List canned query names')
    p_db.add_argument('--full', action='store_true', help='Print all rows (default: first 10)')
    p_db.set_defaults(func=cmd_db)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == '__main__':
    main()
