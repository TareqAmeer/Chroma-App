"""
Tails the real log file `tauri-plugin-log` writes (see main.rs's
`.plugin(tauri_plugin_log::Builder...)` and diag.rs's module doc) — this is
the fix for `log stream` never capturing this app's own output, confirmed
live against a real running instance (README.md). Both native (`log::`
macros, including diag::log()) and, via attachConsole() in
chromasmith-22.html, the frontend's own console.log/warn/error land in the
same file.

Default macOS LogDir resolves to ~/Library/Logs/<bundle identifier>/. The
file is named after the app's product name ("Chromasmith.log") regardless
of the `file_name` builder option passed in main.rs — verified empirically
against a real running instance; whatever caused that mismatch, this is the
actual path, so it's what's used here rather than the configured value.

⚠️ Verified live that this global logger captures every dependency crate's
own log:: output too, not just this app's — a single 45s session produced
1383 lines of `rawler` (the RAW decoder) logging "No lens data available"
at WARN for every RAW file touched. Real, but not actionable noise; without
target-aware filtering it drowned out everything else in the report's error
count. main.rs also applies `.level_for("rawler", Error)` to quiet it at
the source, but this parser stays target-aware regardless, since any other
dependency could be equally chatty in the future.
"""
import os
import re
import time

LOG_DIR = os.path.expanduser('~/Library/Logs/com.tareq.chromasmith')
LOG_PATH = os.path.join(LOG_DIR, 'Chromasmith.log')

OWN_CRATE_PREFIX = 'chromasmith'

# [2026-09-02][20:38:42][rawler::decoders::rw2][WARN] No lens data available
LINE_RE = re.compile(r'^\[[^\]]*\]\[[^\]]*\]\[(?P<target>[^\]]*)\]\[(?P<level>\w+)\]\s?(?P<msg>.*)$')


def _parse_line(line):
    line = line.rstrip('\n')
    if not line.strip():
        return None
    m = LINE_RE.match(line)
    if not m:
        return {'level': 'info', 'target': '', 'msg': line}
    return {'level': m.group('level').lower(), 'target': m.group('target'), 'msg': line}


def _category_for(level, target):
    if level == 'error':
        return 'error'
    if level == 'warn':
        # Our own crate's warnings are worth surfacing as errors; a noisy
        # dependency's (rawler et al.) are real but routine, not a problem
        # report.md's "Errors" section should be dominated by.
        return 'error' if target.startswith(OWN_CRATE_PREFIX) else 'native_log'
    return 'native_log'


class LogFileTailer:
    """Call poll() on an interval; emits one event per new line since the last call."""

    def __init__(self, on_event, path=LOG_PATH):
        self.on_event = on_event
        self.path = path
        self._offset = 0
        self._inode = None
        self.seen_any = False

    def poll(self):
        try:
            st = os.stat(self.path)
        except OSError:
            return
        # A rotated/replaced log file (new inode) restarts from the top.
        if self._inode is not None and st.st_ino != self._inode:
            self._offset = 0
        self._inode = st.st_ino
        if st.st_size < self._offset:
            self._offset = 0  # truncated
        if st.st_size == self._offset:
            return
        try:
            with open(self.path, 'r', errors='replace') as f:
                f.seek(self._offset)
                new_text = f.read()
                self._offset = f.tell()
        except OSError:
            return
        if not new_text:
            return
        self.seen_any = True
        now = time.time()
        for raw_line in new_text.splitlines():
            parsed = _parse_line(raw_line)
            if not parsed:
                continue
            category = _category_for(parsed['level'], parsed['target'])
            self.on_event({
                'ts': now,
                'category': category,
                'kind': f"logfile_{parsed['level']}",
                'msg': parsed['msg'],
            })
