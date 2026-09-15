"""
Capture native stderr/stdout from a GUI-launched Chromasmith via macOS
unified logging (`log stream`) — the only way to see eprintln!/println!
output from an app launched via Finder/Dock/Spotlight rather than a
terminal.

Also greps the stream for two known silent-failure signatures from
CLAUDE.md: a GLSL compile/link error (§3 — the "quiet shader bug" class
that doesn't crash the app, it just makes a whole shader program a no-op)
and a `catalog.corrupt-*.db` sighting (catalog.rs's own incident-trail
naming for a DB it had to set aside).

`--relaunch` mode instead spawns the executable directly under this
process, trading "real launch conditions" for guaranteed, simpler stderr
capture (some log-stream predicates can miss lines depending on OS
logging privacy/redaction settings).
"""
import json
import os
import re
import subprocess
import sys
import threading
import time

IS_WINDOWS = sys.platform == 'win32'

EXE_NAME = 'chromasmith.exe' if IS_WINDOWS else 'chromasmith'
# 2026-09-14: no installed copy is made — the app runs from the release build output in place.
if IS_WINDOWS:
    EXE_PATH = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'desktop', 'src-tauri', 'target', 'release', 'chromasmith.exe',
    )
else:
    EXE_PATH = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'desktop', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Chromasmith.app',
        'Contents', 'MacOS', 'chromasmith',
    )

GLSL_ERROR_RE = re.compile(r'GLSL (compile|link) error', re.IGNORECASE)
CORRUPT_DB_RE = re.compile(r'catalog\.corrupt-\d+\.db')


def _classify_line(text):
    if GLSL_ERROR_RE.search(text):
        return 'glsl_error'
    if CORRUPT_DB_RE.search(text):
        return 'corrupt_db'
    return None


class LogStreamCapture:
    """Background `log stream` reader. Calls on_event(dict) for matches.

    macOS only — `log stream` has no Windows equivalent. `start()` is a deliberate no-op on
    Windows (not an error): log_file.py's LogFileTailer already covers native stdout/stderr on
    every platform (see its own docstring on why it, not `log stream`, is the real fix even on
    macOS), so watcher.py's non-`--relaunch` path losing this specific capture on Windows loses
    nothing this app doesn't already get elsewhere — unlike leaving it wired up, which would
    crash Session.run() outright the first time watcher.py called log_cap.start() (Popen on a
    'log' binary that doesn't exist raises FileNotFoundError, uncaught, on Windows)."""

    def __init__(self, on_event):
        self.on_event = on_event
        self._proc = None
        self._thread = None
        self._stop = threading.Event()

    def start(self):
        if IS_WINDOWS:
            return
        self._proc = subprocess.Popen(
            ['log', 'stream',
             '--predicate', f'process == "{EXE_NAME}"',
             '--style', 'ndjson',
             '--level', 'debug'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def _read_loop(self):
        for line in iter(self._proc.stdout.readline, ''):
            if self._stop.is_set():
                break
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                text = rec.get('eventMessage', '')
            except (json.JSONDecodeError, ValueError):
                text = line
            kind = _classify_line(text)
            if kind:
                self.on_event({
                    'ts': time.time(),
                    'category': 'error',
                    'kind': kind,
                    'msg': text[:2000],
                })

    def stop(self):
        self._stop.set()
        if self._proc is not None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._proc.kill()


class RelaunchCapture:
    """Spawns the app binary directly, capturing stdout/stderr ourselves."""

    def __init__(self, on_event):
        self.on_event = on_event
        self._proc = None
        self._thread = None
        self._stop = threading.Event()

    def start(self):
        self._proc = subprocess.Popen(
            [EXE_PATH],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    @property
    def pid(self):
        return self._proc.pid if self._proc else None

    def _read_loop(self):
        for line in iter(self._proc.stdout.readline, ''):
            if self._stop.is_set():
                break
            line = line.rstrip('\n')
            if not line:
                continue
            kind = _classify_line(line)
            if kind:
                self.on_event({
                    'ts': time.time(),
                    'category': 'error',
                    'kind': kind,
                    'msg': line[:2000],
                })

    def stop(self):
        self._stop.set()
        if self._proc is not None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._proc.kill()
