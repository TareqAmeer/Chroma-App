"""
Main capture-session loop.

Finds the running Chromasmith process, starts the log/JS/freeze detectors,
polls process metrics, writes every event to events.jsonl, and prints a
live one-line status readout. See diagnostics/README.md for usage.
"""
import json
import os
import sys
import time

from find_process import find_chromasmith_pid, ProcessNotFound, REAL_APP_PATH
from process_metrics import sample as sample_process, prime_cpu_percent, ProcessGone
from freeze_detector import FreezeDetector
from log_capture import LogStreamCapture, RelaunchCapture
from js_relay import JsRelay, PASTE_SNIPPET
import sample_capture
import run_meta

BUNDLE_ID = 'com.tareq.chromasmith'
PROCESS_POLL_S = 1.0
FREEZE_POLL_S = 3.0

ACTIVE_RUN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reports', '.active_run')


class Session:
    def __init__(self, duration_s, relaunch=False, use_spindump=False, run_dir=None):
        self.duration_s = duration_s
        self.relaunch = relaunch
        self.use_spindump = use_spindump
        self.run_dir = run_dir
        self.samples_dir = os.path.join(run_dir, 'samples')
        self.events_path = os.path.join(run_dir, 'events.jsonl')
        self._events_file = None
        self._last_status = ''
        self.pid = None
        self.app_path = None

    def _write_event(self, ev):
        self._events_file.write(json.dumps(ev) + '\n')
        self._events_file.flush()
        kind = ev.get('kind', ev.get('category'))
        self._last_status = f"{ev['category']}:{kind}"

    def run(self):
        os.makedirs(self.run_dir, exist_ok=True)
        os.makedirs(self.samples_dir, exist_ok=True)
        self._events_file = open(self.events_path, 'a')

        meta = run_meta.capture()
        with open(os.path.join(self.run_dir, 'meta.json'), 'w') as f:
            json.dump(meta, f, indent=2)
        self._write_event({'ts': time.time(), 'category': 'meta', **meta})
        print(f"Repo: {meta['branch']}@{meta['commit_short']}"
              f"{' (dirty: ' + str(len(meta['dirty_files'])) + ' files)' if meta['dirty_files'] else ''}"
              f"  BUILD={meta['build_stamp']}")

        os.makedirs(os.path.dirname(ACTIVE_RUN_FILE), exist_ok=True)
        with open(ACTIVE_RUN_FILE, 'w') as f:
            f.write(self.run_dir)

        if self.relaunch:
            print("--relaunch: spawning the app binary directly for guaranteed stderr capture.")
            log_cap = RelaunchCapture(self._write_event)
            log_cap.start()
            time.sleep(2)  # let it boot before we try to find/ping it
            self.pid = log_cap.pid
            self.app_path = REAL_APP_PATH
        else:
            try:
                self.pid, self.app_path = find_chromasmith_pid()
            except ProcessNotFound as e:
                print(f"error: {e}", file=sys.stderr)
                return 1
            if self.app_path != REAL_APP_PATH:
                where = self.app_path or "an unknown location (not inside a .app bundle — likely a dev build)"
                print(f"warning: attached to '{where}', not {REAL_APP_PATH} "
                      f"(pid {self.pid})")
            log_cap = LogStreamCapture(self._write_event)
            log_cap.start()

        print(f"Watching pid {self.pid} ({self.app_path or 'unknown bundle'})")
        print(f"Run dir: {self.run_dir}")
        print()
        print("Paste this once into Safari's Web Inspector console")
        print("(Develop > Chromasmith > the page) to capture JS-side errors:")
        print()
        print(PASTE_SNIPPET)
        print()
        print("Tag a moment during this session from another terminal with:")
        print('  python3 diagnostics/cli.py mark "clicked Export"')
        print()

        relay = JsRelay(self._write_event)
        relay.start()

        freeze = FreezeDetector(BUNDLE_ID)

        try:
            prime_cpu_percent(self.pid)
        except ProcessGone:
            pass

        start = time.time()
        next_process_poll = start
        next_freeze_poll = start
        exit_reason = 'duration elapsed'

        try:
            while True:
                now = time.time()
                elapsed = now - start
                if self.duration_s and elapsed >= self.duration_s:
                    break

                if now >= next_process_poll:
                    next_process_poll = now + PROCESS_POLL_S
                    try:
                        ev = sample_process(self.pid)
                        self._write_event(ev)
                    except ProcessGone:
                        print("\nApp process exited — ending session early.")
                        exit_reason = 'process exited'
                        break

                if now >= next_freeze_poll:
                    next_freeze_poll = now + FREEZE_POLL_S
                    result = freeze.check()
                    if result and result[0] == 'freeze_start':
                        ts = result[1]
                        self._write_event({'ts': ts, 'category': 'freeze', 'kind': 'start'})
                        sample_path = os.path.join(
                            self.samples_dir, f"freeze_{int(ts)}.sample.txt")
                        ok = sample_capture.capture_sample(self.pid, sample_path)
                        if not ok and self.use_spindump:
                            ok = sample_capture.capture_spindump(self.pid, sample_path)
                        self._write_event({
                            'ts': time.time(), 'category': 'freeze', 'kind': 'sample_captured',
                            'path': sample_path if ok else None,
                        })
                    elif result and result[0] == 'freeze_end':
                        _, ts, duration = result
                        self._write_event({
                            'ts': ts, 'category': 'freeze', 'kind': 'end',
                            'duration_s': round(duration, 2),
                        })

                status = f"\relapsed {int(elapsed)}s  last: {self._last_status or '-'}   "
                sys.stdout.write(status)
                sys.stdout.flush()
                time.sleep(0.2)
        except KeyboardInterrupt:
            exit_reason = 'interrupted'

        print(f"\n\nSession ended ({exit_reason}).")
        relay.stop()
        log_cap.stop()
        self._events_file.close()
        try:
            if os.path.exists(ACTIVE_RUN_FILE):
                with open(ACTIVE_RUN_FILE) as f:
                    if f.read().strip() == self.run_dir:
                        os.remove(ACTIVE_RUN_FILE)
        except OSError:
            pass
        return 0
