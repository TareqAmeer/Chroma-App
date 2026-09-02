"""
Map a JS error's "file:line" location back to the enclosing function name
in chromasmith-22.html, since the file is one ~17MB single-file app and a
bare line number ("error at line 8412") is not actionable on its own.
"""
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(REPO, 'chromasmith-22.html')

LOC_RE = re.compile(r'(?::(\d+):\d+)\s*$|(?::(\d+))\s*$')

FUNC_PATTERNS = [
    re.compile(r'^\s*(?:async\s+)?function\s+(\w+)\s*\('),
    re.compile(r'^\s*const\s+(\w+)\s*=\s*(?:async\s*)?\('),
    re.compile(r'^\s*const\s+(\w+)\s*=\s*(?:async\s+)?function'),
    re.compile(r'^\s*(\w+)\s*\([^()]*\)\s*\{'),  # object-method shorthand
]

MAX_SCAN_LINES = 400


def parse_location(src):
    """Extract a 1-based line number from a 'file:line[:col]' string."""
    if not src:
        return None
    m = LOC_RE.search(src.strip())
    if not m:
        return None
    line_str = m.group(1) or m.group(2)
    try:
        return int(line_str)
    except (TypeError, ValueError):
        return None


def enclosing_function(line_no, html_path=HTML_PATH):
    """
    Return (function_name, def_line) for the nearest enclosing function
    definition found by scanning backward from line_no, or None.
    """
    if not line_no or not os.path.exists(html_path):
        return None
    start = max(1, line_no - MAX_SCAN_LINES)
    # Stream just the needed window rather than holding the whole 17MB file.
    try:
        with open(html_path, encoding='utf-8', errors='replace') as f:
            lines = []
            for i, line in enumerate(f, 1):
                if i < start:
                    continue
                if i > line_no:
                    break
                lines.append(line)
    except OSError:
        return None

    for offset in range(len(lines) - 1, -1, -1):
        line = lines[offset]
        for pat in FUNC_PATTERNS:
            m = pat.match(line)
            if m:
                return m.group(1), start + offset
    return None
