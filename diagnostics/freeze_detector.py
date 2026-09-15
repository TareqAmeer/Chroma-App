"""
UI freeze / unresponsiveness detection.

WKWebView main-thread hangs don't reliably show up as a CPU spike (the app
can be sitting blocked on a synchronous JS call while native CPU% reads
near zero — see CLAUDE.md's own notes on background-indexing contention
and camera-retry freezes). Instead we periodically ask the app to respond
to an AppleEvent via `osascript`; a hard timeout on that call is the
freeze signal.

Windows (2026-09-15): there's no AppleEvent equivalent. Research finding:
user32!IsHungAppWindow is the exact API Windows' own Task Manager uses to
mark a window "(Not Responding)" — true once its message pump hasn't
processed a message in roughly 5s. It needs the app's main HWND rather than
a bundle id, resolved once via win_helpers.find_main_window(pid) and cached
(the window doesn't change identity across the life of one process).
"""
import sys
import time

IS_WINDOWS = sys.platform == 'win32'

if not IS_WINDOWS:
    import subprocess

PING_TIMEOUT_S = 2.0
PING_INTERVAL_S = 3.0
CONSECUTIVE_MISSES_TO_FREEZE = 2


def ping(bundle_id):
    """Return True if the app responded within the timeout, False otherwise. macOS only."""
    try:
        result = subprocess.run(
            ['osascript', '-e', f'tell application id "{bundle_id}" to get name'],
            capture_output=True, text=True, timeout=PING_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return False
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return result.returncode == 0


class FreezeDetector:
    """
    macOS: pass a bundle id (e.g. 'com.tareq.chromasmith'), pinged via osascript.
    Windows: pass a pid (int); the main HWND is resolved lazily and IsHungAppWindow
    is polled directly — no bundle id concept applies.
    """
    def __init__(self, target):
        self.target = target
        self._hwnd = None  # Windows only, resolved lazily
        self._consecutive_misses = 0
        self._freeze_started_at = None

    def _responded(self):
        if IS_WINDOWS:
            import win_helpers
            if self._hwnd is None:
                self._hwnd = win_helpers.find_main_window(self.target)
            if self._hwnd is None:
                # No window yet (still booting) or it closed — don't manufacture a freeze
                # out of a lookup failure; try to re-resolve it next poll instead.
                return True
            if not win_helpers.user32.IsWindow(self._hwnd):
                self._hwnd = None
                return True
            return not win_helpers.is_hung(self._hwnd)
        return ping(self.target)

    def check(self):
        """
        Call this on the polling interval. Returns one of:
        None            - nothing to report
        ('freeze_start', ts) - just transitioned into a suspected freeze
        ('freeze_end', ts, duration_s) - responsiveness recovered
        """
        now = time.time()
        responded = self._responded()

        if responded:
            if self._freeze_started_at is not None:
                duration = now - self._freeze_started_at
                self._freeze_started_at = None
                self._consecutive_misses = 0
                return ('freeze_end', now, duration)
            self._consecutive_misses = 0
            return None

        self._consecutive_misses += 1
        if self._consecutive_misses >= CONSECUTIVE_MISSES_TO_FREEZE and self._freeze_started_at is None:
            # Best-effort: freeze likely began roughly one interval before we noticed.
            self._freeze_started_at = now - PING_INTERVAL_S
            return ('freeze_start', self._freeze_started_at)
        return None
