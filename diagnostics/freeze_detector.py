"""
UI freeze / unresponsiveness detection.

WKWebView main-thread hangs don't reliably show up as a CPU spike (the app
can be sitting blocked on a synchronous JS call while native CPU% reads
near zero — see CLAUDE.md's own notes on background-indexing contention
and camera-retry freezes). Instead we periodically ask the app to respond
to an AppleEvent via `osascript`; a hard timeout on that call is the
freeze signal.
"""
import subprocess
import time

PING_TIMEOUT_S = 2.0
PING_INTERVAL_S = 3.0
CONSECUTIVE_MISSES_TO_FREEZE = 2


def ping(bundle_id):
    """Return True if the app responded within the timeout, False otherwise."""
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
    def __init__(self, bundle_id):
        self.bundle_id = bundle_id
        self._consecutive_misses = 0
        self._freeze_started_at = None

    def check(self):
        """
        Call this on the polling interval. Returns one of:
        None            - nothing to report
        ('freeze_start', ts) - just transitioned into a suspected freeze
        ('freeze_end', ts, duration_s) - responsiveness recovered
        """
        now = time.time()
        responded = ping(self.bundle_id)

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
