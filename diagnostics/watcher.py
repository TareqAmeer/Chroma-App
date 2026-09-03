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
from native_bridge import NativeBridgePoller, DIAG_PATH
from log_file import LogFileTailer, LOG_PATH
from child_watch import ChildProcessWatcher
import sample_capture
import run_meta

BUNDLE_ID = 'com.tareq.chromasmith'
PROCESS_POLL_S = 1.0
FREEZE_POLL_S = 3.0
NATIVE_BRIDGE_POLL_S = 2.0
LOG_FILE_POLL_S = 2.0
CHILD_POLL_S = 3.0

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

        # app_path may be the .app BUNDLE directory (from find_chromasmith_pid's real-app
        # check) whose own mtime does not track the executable inside it — resolve to the
        # actual binary file for a meaningful staleness comparison.
        if self.app_path and self.app_path.endswith('.app'):
            binary_path = os.path.join(self.app_path, 'Contents', 'MacOS', 'chromasmith')
        else:
            binary_path = self.app_path
        meta = run_meta.capture(binary_path=binary_path)
        with open(os.path.join(self.run_dir, 'meta.json'), 'w') as f:
            json.dump(meta, f, indent=2)
        self._write_event({'ts': time.time(), 'category': 'meta', **meta})
        print(f"Repo: {meta['branch']}@{meta['commit_short']}"
              f"{' (dirty: ' + str(len(meta['dirty_files'])) + ' files)' if meta['dirty_files'] else ''}"
              f"  BUILD={meta['build_stamp']}")
        if meta['binary_stale']:
            print("⚠️  Running binary looks OLDER than HEAD's commit — "
                  "a full quit (⌘Q) + rebuild + relaunch may be needed before a native fix applies.")

        os.makedirs(os.path.dirname(ACTIVE_RUN_FILE), exist_ok=True)
        with open(ACTIVE_RUN_FILE, 'w') as f:
            f.write(self.run_dir)

        print(f"Watching pid {self.pid} ({self.app_path or 'unknown bundle'})")
        print(f"Run dir: {self.run_dir}")
        print()
        print("Native sessions (window.__TAURI__) now capture JS errors, IPC timing, and "
              "config state AUTOMATICALLY — no paste needed. Native + attachConsole()'d frontend "
              f"logs are tailed straight from {LOG_PATH}.")
        print("Fallback for a browser/Pages session, or a binary predating these features —")
        print("paste once into Safari's Web Inspector console (Develop > Chromasmith > the page):")
        print()
        print(PASTE_SNIPPET)
        print()
        print("Tag a moment during this session from another terminal with:")
        print('  python3 diagnostics/cli.py mark "clicked Export"')
        print()

        relay = JsRelay(self._write_event)
        relay.start()

        native_bridge = NativeBridgePoller(self._write_event)
        log_file_tail = LogFileTailer(self._write_event)
        child_watch = ChildProcessWatcher(self._write_event, self.samples_dir)

        freeze = FreezeDetector(BUNDLE_ID)

        try:
            prime_cpu_percent(self.pid)
        except ProcessGone:
            pass

        start = time.time()
        next_process_poll = start
        next_freeze_poll = start
        next_native_poll = start
        next_logfile_poll = start
        next_child_poll = start
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

                if now >= next_native_poll:
                    next_native_poll = now + NATIVE_BRIDGE_POLL_S
                    native_bridge.poll()

                if now >= next_logfile_poll:
                    next_logfile_poll = now + LOG_FILE_POLL_S
                    log_file_tail.poll()

                if now >= next_child_poll:
                    next_child_poll = now + CHILD_POLL_S
                    child_watch.poll(self.pid)

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
        if not native_bridge.seen_any:
            print(f"Note: never saw the native diagnostics bridge write {DIAG_PATH} — either "
                  "the app is running a binary older than this feature, or window.__TAURI__ "
                  "wasn't present (a browser/Pages session). JS-error/IPC visibility for this "
                  "run relies on the manual Web Inspector paste, if you did it.")
        if not log_file_tail.seen_any:
            print(f"Note: never saw {LOG_PATH} change — either the app hasn't logged anything "
                  "yet this run, or it's running a binary predating tauri-plugin-log.")
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
