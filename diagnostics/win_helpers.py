"""
Shared Windows-only ctypes helpers — no new pip dependency (pywin32 was deliberately NOT
added; everything here is reachable through ctypes.windll, the same "small native helper"
spirit as native_helpers/find_window.swift on the macOS side, just without a second language).

Used by freeze_detector.py (IsHungAppWindow) and screenshot.py (PrintWindow capture) — both
need a top-level HWND for a given PID, so that lookup lives here once instead of twice.
"""
import ctypes
import ctypes.wintypes as wt

user32 = ctypes.windll.user32 if hasattr(ctypes, 'windll') else None

WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM) if user32 else None


def _is_visible_top_level(hwnd):
    if not user32.IsWindowVisible(hwnd):
        return False
    # Skip tool/owned windows with no titlebar text — not the app's main window.
    length = user32.GetWindowTextLengthW(hwnd)
    return length > 0


def find_main_window(pid):
    """
    Return the HWND of the largest visible top-level window owned by pid, or None.
    Chromasmith (a Tauri/WebView2 app) has exactly one real top-level window in the
    common case; "largest" breaks ties the same way macOS's find_window.swift does
    for the analogous "biggest on-screen window" heuristic.
    """
    if user32 is None:
        return None
    best_hwnd = None
    best_area = -1

    def callback(hwnd, _lparam):
        nonlocal best_hwnd, best_area
        owner_pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner_pid))
        if owner_pid.value != pid:
            return True
        if not _is_visible_top_level(hwnd):
            return True
        rect = wt.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        area = max(0, rect.right - rect.left) * max(0, rect.bottom - rect.top)
        if area > best_area:
            best_area = area
            best_hwnd = hwnd
        return True

    user32.EnumWindows(WNDENUMPROC(callback), 0)
    return best_hwnd


def is_hung(hwnd):
    """
    Wraps user32!IsHungAppWindow — the exact API Windows' own Task Manager uses to show
    a window as "(Not Responding)": true when the window's message pump hasn't processed
    a message in ~5s. Research finding used in place of macOS's osascript AppleEvent ping
    (there is no AppleEvent equivalent on Windows, and this is the OS-native, purpose-built
    signal rather than a home-grown timeout heuristic).
    """
    if user32 is None or not hwnd:
        return False
    return bool(user32.IsHungAppWindow(hwnd))
