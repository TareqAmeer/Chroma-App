#!/usr/bin/env python3
"""
Entrypoint for Chromasmith's live diagnostic tool.

  python3 diagnostics/cli.py start [--duration 15m] [--relaunch] [--use-spindump]
  python3 diagnostics/cli.py report [--run <timestamp>] [--for-claude]
  python3 diagnostics/cli.py mark "clicked Export"

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

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == '__main__':
    main()
