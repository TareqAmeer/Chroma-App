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
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FIND_WINDOW_SCRIPT = os.path.join(ROOT, 'native_helpers', 'find_window.swift')

OWNER_NAME = 'Chromasmith'

IS_WINDOWS = sys.platform == 'win32'


def _capture_window_windows(out_path, pid=None):
    """
    GDI-based capture: PrintWindow into a memory DC, then save via ctypes' own bitmap-header
    writer — no new pip dependency (mirrors this file's own "no Xcode required" spirit; the
    macOS side uses a small interpreted Swift helper for the equivalent "no pyobjc" reason).
    PrintWindow (not BitBlt off the screen DC) captures the window's own buffer directly, so
    it works even if another window is on top — the same "unaffected by focus/overlap"
    property screencapture -l gets from the window server's compositor on macOS.
    """
    import ctypes
    import ctypes.wintypes as wt
    import struct
    import win_helpers

    if pid is None:
        import find_process
        try:
            pid, _ = find_process.find_chromasmith_pid()
        except find_process.ProcessNotFound:
            return False

    hwnd = win_helpers.find_main_window(pid)
    if hwnd is None:
        return False

    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32

    rect = wt.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return False
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0:
        return False

    hwnd_dc = user32.GetWindowDC(hwnd)
    mem_dc = gdi32.CreateCompatibleDC(hwnd_dc)
    bitmap = gdi32.CreateCompatibleBitmap(hwnd_dc, width, height)
    gdi32.SelectObject(mem_dc, bitmap)
    # PW_RENDERFULLCONTENT (2): required for modern DirectComposition-backed windows
    # (WebView2 included) — plain PrintWindow (flags=0) reliably produces a blank/black
    # capture for exactly this class of window.
    PW_RENDERFULLCONTENT = 2
    ok = user32.PrintWindow(hwnd, mem_dc, PW_RENDERFULLCONTENT)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG),
            ('biPlanes', wt.WORD), ('biBitCount', wt.WORD), ('biCompression', wt.DWORD),
            ('biSizeImage', wt.DWORD), ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG),
            ('biClrUsed', wt.DWORD), ('biClrImportant', wt.DWORD),
        ]

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = width
    bmi.biHeight = -height  # negative: top-down DIB, matches PrintWindow's row order
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0  # BI_RGB

    buf_size = width * height * 4
    buf = ctypes.create_string_buffer(buf_size)
    got = gdi32.GetDIBits(mem_dc, bitmap, 0, height, buf, ctypes.byref(bmi), 0)  # DIB_RGB_COLORS

    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(hwnd, hwnd_dc)

    if not ok or not got:
        return False

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    _write_png(out_path, buf.raw, width, height)
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0


def _write_png(out_path, bgra_bytes, width, height):
    """
    Write a real PNG — no Pillow/other imaging dependency needed, since Python's stdlib
    `zlib` is the only piece a minimal (uncompressed-filter, zlib-compressed) PNG encoder
    actually needs. Callers (cli.py's `mark`) pass a `.png` path, and screenshot readers
    (including this session's own file-reading tool) sniff the file's magic bytes rather
    than trusting the extension — an initial version of this wrote a plain BMP body to that
    `.png` path, which round-tripped through this tool's own capture step but failed the
    first real read-back, caught live during this port's own smoke test.
    """
    import struct
    import zlib

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    # GetDIBits already returned rows top-down (negative biHeight) — PNG scanlines are also
    # top-down, so no row-order flip needed here (unlike the BMP file format, which wants
    # bottom-up and was the reason this function used to reverse rows).
    row_bytes = width * 4
    raw = bytearray()
    for row in range(height):
        raw.append(0)  # filter type 0 (None) for every scanline — simplest correct encoding
        bgra_row = bgra_bytes[row * row_bytes:(row + 1) * row_bytes]
        # BGRA (what GetDIBits produced) -> RGBA (what PNG's colour type 6 expects).
        rgba_row = bytearray(len(bgra_row))
        rgba_row[0::4] = bgra_row[2::4]
        rgba_row[1::4] = bgra_row[1::4]
        rgba_row[2::4] = bgra_row[0::4]
        rgba_row[3::4] = bgra_row[3::4]
        raw += rgba_row

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit, colour type 6 (RGBA)
    idat = zlib.compress(bytes(raw), level=6)

    with open(out_path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', idat))
        f.write(chunk(b'IEND', b''))


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
    if IS_WINDOWS:
        return _capture_window_windows(out_path)
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
