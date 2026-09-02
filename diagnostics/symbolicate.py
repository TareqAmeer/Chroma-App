"""
Best-effort summary of a raw `sample`/`spindump` stack-trace file.

`sample` output is a large indented call tree; Claude (or a human) reading
the raw file has to visually find the main thread and its deepest frames.
This extracts a short "hung near: X" line instead — heuristic, not exact
symbolication, so callers should still link to the raw file for full detail.
"""
import re

FRAME_RE = re.compile(
    r'^(?P<indent>\s*)\d+\s+(?P<frame>.+?)(?:\s+\+\s+\d+)?(?:\s+\[0x[0-9a-fA-F]+\])?\s*$'
)
# Real `sample` thread headers look like "  2823 Thread_50331648   DispatchQueue: ..." —
# the frame count comes BEFORE the Thread_ token, not after.
THREAD_HEADER_RE = re.compile(r'^\s*\d+\s+Thread_\S+.*$', re.MULTILINE)


def _thread_blocks(text):
    """Split sample output into (header_line, block_text) per thread."""
    headers = list(THREAD_HEADER_RE.finditer(text))
    blocks = []
    for i, h in enumerate(headers):
        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        blocks.append((h.group(0), text[start:end]))
    return blocks


def _main_thread_block(blocks):
    for header, body in blocks:
        if 'main-thread' in header.lower() or 'main thread' in header.lower():
            return header, body
    return blocks[0] if blocks else (None, '')


def _deepest_frames(block_text, top_n=3):
    frames = []
    for line in block_text.splitlines():
        m = FRAME_RE.match(line)
        if not m:
            continue
        indent = len(m.group('indent'))
        frame = m.group('frame').strip()
        if not frame or frame.startswith('Binary Images'):
            continue
        frames.append((indent, frame))
    if not frames:
        return []
    max_indent = max(f[0] for f in frames)
    # Frames near max indent are the deepest/leaf calls — most likely where
    # time was actually spent, as opposed to the entry-point frames at the top.
    deepest = [f for f in frames if f[0] >= max_indent - 4]
    seen = set()
    out = []
    for _, frame in reversed(deepest):
        if frame in seen:
            continue
        seen.add(frame)
        out.append(frame)
        if len(out) >= top_n:
            break
    return list(reversed(out))


def summarize(sample_path):
    """
    Return a short human string like "hung near: bakeDcpLUT -> ... " or
    None if the file couldn't be parsed (still worth linking the raw file).
    """
    try:
        with open(sample_path, encoding='utf-8', errors='replace') as f:
            text = f.read()
    except OSError:
        return None

    blocks = _thread_blocks(text)
    if not blocks:
        return None
    header, body = _main_thread_block(blocks)
    frames = _deepest_frames(body)
    if not frames:
        return None
    return ' -> '.join(frames)
