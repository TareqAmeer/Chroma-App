"""
Captures a real screenshot of the running app's own window, for `cli.py mark` —
a before/after pair from the ACTUAL app, not a synthetic Playwright render of the
mocked test harness. Uses `screencapture -l <windowID>` (a composited capture from
the window server's own buffer, unaffected by focus or overlap) rather than
`-R <region>` (grabs whatever's on screen at those coordinates) or full computer-use
screen sharing (a separate consent path this deliberately avoids).

There is no CGWindowID API reachable from AppleScript or a Python 3.8 stdlib (pyobjc's
Quartz bindings need 3.9+) — native_helpers/find_window.swift is a small interpreted
script run via the `swift` command, which Xcode command line tools already provide.
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
FIND_WINDOW_SCRIPT = os.path.join(ROOT, 'native_helpers', 'find_window.swift')

OWNER_NAME = 'Chromasmith'


def find_window_id(owner_name=OWNER_NAME):
    """Return the CGWindowID of the app's largest on-screen window, or None."""
    try:
        out = subprocess.run(
            ['swift', FIND_WINDOW_SCRIPT, owner_name],
            capture_output=True, text=True, timeout=15,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    if out.returncode != 0:
        return None
    try:
        return int(out.stdout.strip())
    except ValueError:
        return None


class ScreenRecordingPermissionError(RuntimeError):
    pass


def capture_window(out_path, owner_name=OWNER_NAME):
    """
    Capture the app's window to out_path. Returns True on success; raises
    ScreenRecordingPermissionError if screencapture reports "could not create
    image from window" — verified live that this is macOS's Screen Recording
    TCC permission, not a bad window ID (the same failure reproduced against
    an unrelated app's window that had captured successfully minutes earlier
    in the same session). Grant it to whatever process runs this tool's shell
    (System Settings > Privacy & Security > Screen Recording) — not something
    this tool can request or bypass itself.
    """
    window_id = find_window_id(owner_name)
    if window_id is None:
        return False
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        result = subprocess.run(
            ['screencapture', '-l', str(window_id), '-x', '-o', out_path],
            capture_output=True, text=True, timeout=15,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    if 'could not create image from window' in (result.stdout + result.stderr):
        raise ScreenRecordingPermissionError(
            "screencapture reports 'could not create image from window' — this is macOS's "
            "Screen Recording permission (System Settings > Privacy & Security > Screen "
            "Recording), not a bad window ID. Grant it to whatever process runs this shell."
        )
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0
