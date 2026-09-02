"""
Polls the diag_state.json file chromasmith-22.html's own native diagnostics
bridge writes (gated on window.__TAURI__, active automatically for every
native session — see the comment above that block in chromasmith-22.html,
near native_build_tag). This is what removes the manual Web Inspector paste
as a requirement: JS errors, IPC timing, and UI/config state arrive through
one file this way.

Native LOG lines are no longer part of this payload — that's log_file.py's
job now, tailing the real file tauri-plugin-log writes to disk (see that
module's docstring). `diag_native_state` (still polled here) only answers
what genuinely isn't a log line: catalog progress counters and the running
binary's own path/mtime.

The JS side clears its own error/IPC buffers after each write, so every
successful read here is inherently "new since the last write" — no dedup
needed beyond the mtime check.
"""
import json
import os

DIAG_PATH = '/tmp/chromasmith_diag_state.json'


class NativeBridgePoller:
    def __init__(self, on_event):
        self.on_event = on_event
        self._last_mtime = None
        self.seen_any = False

    def poll(self):
        """Call on an interval; a no-op unless the file has changed since the last call."""
        try:
            mtime = os.path.getmtime(DIAG_PATH)
        except OSError:
            return
        if self._last_mtime is not None and mtime <= self._last_mtime:
            return
        self._last_mtime = mtime
        try:
            with open(DIAG_PATH) as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError, ValueError):
            return
        self.seen_any = True

        base_ts = (payload.get('t') or 0) / 1000.0

        for e in payload.get('errors', []):
            self.on_event({
                'ts': (e.get('t') or payload.get('t') or 0) / 1000.0,
                'category': 'error',
                'kind': f"native_bridge_js_{e.get('k', 'unknown')}",
                'msg': e.get('msg'),
                'src': e.get('src'),
                'snap': e.get('snap'),
            })

        for e in payload.get('ipc', []):
            self.on_event({
                'ts': (e.get('t') or payload.get('t') or 0) / 1000.0,
                'category': 'ipc',
                'kind': 'invoke_err' if 'err' in e else 'invoke',
                'cmd': e.get('cmd'),
                'ms': e.get('ms'),
            })

        state = payload.get('state')
        if state is not None:
            self.on_event({'ts': base_ts, 'category': 'state_snapshot', 'kind': 'heartbeat', 'snap': state})

        config = payload.get('config')
        if config is not None:
            self.on_event({'ts': base_ts, 'category': 'config_snapshot', 'config': config})

        native = payload.get('native')
        if not native:
            return

        self.on_event({
            'ts': base_ts,
            'category': 'progress',
            'kind': 'catalog_thumbnails',
            'generated_session': native.get('thumb_generated_session'),
            'remaining': native.get('thumb_remaining'),
        })

        self.on_event({
            'ts': base_ts,
            'category': 'binary_info',
            'binary_path': native.get('binary_path'),
            'binary_mtime': native.get('binary_mtime'),
        })
