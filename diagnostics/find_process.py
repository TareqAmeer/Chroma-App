"""
Locate the real, running Chromasmith.app process — and only that one.

There is a second, stray "Chromasmith copy.app" on this machine (a build
artifact, not the app the user actually launches — Lightroom launches it,
per project memory, but it is never what a live-diagnostic run should
attach to). Bundle id com.tareq.chromasmith is shared by both, so PID
lookup alone isn't enough; this module also verifies the executable's
containing .app via `lsof` and prefers the one under /Applications.
"""
import subprocess

EXE_NAME = 'chromasmith'
REAL_APP_PATH = '/Applications/Chromasmith.app'


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
        if f" txt " in line and f"/{EXE_NAME}" in line and line.rstrip().endswith(EXE_NAME):
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
