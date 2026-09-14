"""
Locate the real, running Chromasmith.app process — and only that one.

2026-09-14: the canonical app is the release build output itself, in place —
no installed copy is made anywhere. Bundle id com.tareq.chromasmith could
still be shared by another stray build, so PID lookup alone isn't enough;
this module also verifies the executable's containing .app via `lsof` and
prefers the one at REAL_APP_PATH.
"""
import os
import json
import subprocess

EXE_NAME = 'chromasmith'
NATIVE_STATE_PATH = '/tmp/chromasmith_diag_state.json'
REAL_APP_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'desktop', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Chromasmith.app',
)


class ProcessNotFound(RuntimeError):
    pass


def _pids_by_name(name):
    try:
        out = subprocess.run(['pgrep', '-x', name], capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return []
    if out.returncode != 0:
        return []
    return [int(p) for p in out.stdout.split() if p.strip()]


def _pids_by_executable_path(path):
    """Find an app even when macOS does not expose its executable basename to pgrep.

    The native diagnostics bridge is written only by the running desktop app and records its
    executable path.  Using it as a fallback keeps diagnostics attached to that exact binary
    instead of treating a current native bridge heartbeat as "no running app".
    """
    if not path:
        return []
    try:
        out = subprocess.run(['pgrep', '-f', path], capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return []
    if out.returncode != 0:
        return []
    return [int(p) for p in out.stdout.split() if p.strip()]


def _bridge_binary_path():
    try:
        with open(NATIVE_STATE_PATH) as f:
            payload = json.load(f)
        return payload.get('native', {}).get('binary_path')
    except (OSError, ValueError, TypeError):
        return None


def _app_bundle_for_pid(pid):
    """
    Return the .app path a PID's main executable lives under, if any.
    If the executable isn't inside a .app bundle at all (e.g. a `cargo
    build`/`tauri dev` binary run straight from target/release), return
    that raw executable path instead so callers can still report *where*
    they attached, even though it isn't the installed real app.
    """
    try:
        out = subprocess.run(['lsof', '-p', str(pid)], capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    exe_line = None
    for line in out.stdout.splitlines():
        if '.app/Contents/MacOS/' in line:
            idx = line.index('.app/Contents/MacOS/')
            start = line.rfind(' ', 0, idx)
            return line[start + 1:idx + 4]
        if " txt " in line and f"/{EXE_NAME}" in line and line.rstrip().endswith(EXE_NAME):
            exe_line = line
    if exe_line:
        return exe_line.split()[-1]
    return None


def find_chromasmith_pid(prefer_path=REAL_APP_PATH):
    """
    Return (pid, app_path) for the running Chromasmith process.
    Raises ProcessNotFound if nothing is running.
    Warns (via return app_path) when more than one candidate exists and
    picks the one under prefer_path if possible.
    """
    pids = _pids_by_name(EXE_NAME)
    if not pids:
        pids = _pids_by_executable_path(_bridge_binary_path())
    if not pids:
        raise ProcessNotFound(
            f"No running '{EXE_NAME}' process found. Launch {REAL_APP_PATH} normally first."
        )

    candidates = []
    for pid in pids:
        app_path = _app_bundle_for_pid(pid)
        candidates.append((pid, app_path))

    if len(candidates) == 1:
        return candidates[0]

    for pid, app_path in candidates:
        if app_path == prefer_path:
            return pid, app_path

    # No exact match under /Applications — return the first, but caller
    # should surface a warning since we couldn't disambiguate cleanly.
    return candidates[0]
