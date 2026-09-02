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
import re
import subprocess
import threading
import time

EXE_NAME = 'chromasmith'
EXE_PATH = '/Applications/Chromasmith.app/Contents/MacOS/chromasmith'

GLSL_ERROR_RE = re.compile(r'GLSL (compile|link) error', re.IGNORECASE)
CORRUPT_DB_RE = re.compile(r'catalog\.corrupt-\d+\.db')


def _classify_line(text):
    if GLSL_ERROR_RE.search(text):
        return 'glsl_error'
    if CORRUPT_DB_RE.search(text):
        return 'corrupt_db'
    return None


class LogStreamCapture:
    """Background `log stream` reader. Calls on_event(dict) for matches."""

    def __init__(self, on_event):
        self.on_event = on_event
        self._proc = None
        self._thread = None
        self._stop = threading.Event()

    def start(self):
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
