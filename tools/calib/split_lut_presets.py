#!/usr/bin/env python3
"""Move the non-core LUT presets out of chromasmith-22.html into vendor/luts/<key>.bin.

WHY
---
`LUT_PRESETS` grew from the original 11 looks to 113. As base64 string literals inside the
single HTML file that was **16.3 MB of the file's 17.7 MB** (10.2 MB gzipped) — parsed in full
on every web cold load, every iOS launch and every desktop dist/ read, for data that is only
ever needed one look at a time.

This script keeps the `User Looks` category inline (so a bare copy of the HTML opened over
file://, where fetch() is blocked, still has the core looks) and writes every other preset to
`vendor/luts/<key>.bin` as RAW bytes — the same 33³×3 = 107,811-byte payload the base64 held,
without the 4/3 base64 tax. `vendor/` is already copied wholesale by build-ios.sh and
build-desktop.sh, so no build change is needed; the app fetches + caches them (see presetBytes
in chromasmith-22.html).

The bytes are taken from the HTML's own base64, NOT re-derived from calib/LUT LIBRARY/*.cube —
so the split is provably byte-identical to what ships today. (Every key does have a .cube
source in the repo, so this is reversible either way.)

USAGE
-----
    python3 calib/split_lut_presets.py            # split (idempotent — safe to re-run)
    python3 calib/split_lut_presets.py --check    # verify only, write nothing, exit 1 on drift

Storage format is unchanged from the base64 it replaces: Uint8, 3 bytes/entry, .cube FILE
ORDER (R fastest) — exactly what lutFromBytes() reads.
"""
import argparse
import base64
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "chromasmith-22.html")
OUT_DIR = os.path.join(ROOT, "vendor", "luts")

SZ = 33
LUT_BYTES = SZ * SZ * SZ * 3  # 107811
INLINE_CATEGORY = "User Looks"

# The block header rewritten in place of the old one. Kept here (rather than left to a hand
# edit) so re-running the script can never drift from what it actually did.
HEADER = (
    "// Core looks ONLY — inline as base64, quantized to Uint8 in .cube file order (R fastest).\n"
    "// The other {n_ext} presets live in vendor/luts/<key>.bin as the SAME raw bytes without the\n"
    "// base64 tax, fetched and cached on demand (presetBytes) — see calib/split_lut_presets.py.\n"
    "// LUT_META, not this object, is the authoritative list of every built-in preset key.\n"
)


def read_html():
    with open(HTML, encoding="utf-8") as f:
        return f.read()


def find_block(html, name):
    """Return (start, end, body) for a `const NAME={ ... \\n};` block."""
    start = html.find("const %s={" % name)
    if start < 0:
        sys.exit("could not find const %s={ in chromasmith-22.html" % name)
    end = html.find("\n};", start)
    if end < 0:
        sys.exit("unterminated const %s={ block" % name)
    return start, end + len("\n};"), html[start:end]


def parse_presets(body):
    """key -> base64 string, in source order."""
    return re.findall(r'^\s*"([a-z0-9_]+)":\s*\'([A-Za-z0-9+/=]+)\'', body, re.M)


def parse_meta(body):
    return dict(re.findall(r'"([a-z0-9_]+)":"([^"]+)"', body))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only; write nothing")
    args = ap.parse_args()

    html = read_html()
    p_start, p_end, p_body = find_block(html, "LUT_PRESETS")
    _, _, m_body = find_block(html, "LUT_META")

    presets = parse_presets(p_body)
    meta = parse_meta(m_body)

    if not presets:
        sys.exit("LUT_PRESETS parsed to zero entries — refusing to touch the file")

    inline, external = [], []
    for key, b64 in presets:
        cat = meta.get(key)
        if cat is None:
            sys.exit("preset %r has no LUT_META category — refusing to guess" % key)
        (inline if cat == INLINE_CATEGORY else external).append((key, b64))

    # Every key must decode to exactly one 33³ LUT, inline or not. A short/oversized payload
    # here would show up in the app as a silently wrong look, so fail loudly instead.
    for key, b64 in presets:
        n = len(base64.b64decode(b64))
        if n != LUT_BYTES:
            sys.exit("preset %r decodes to %d bytes, expected %d" % (key, n, LUT_BYTES))

    print("%d presets: %d inline (%s), %d external"
          % (len(presets), len(inline), INLINE_CATEGORY, len(external)))

    if args.check:
        missing, wrong = [], []
        for key, b64 in external:
            path = os.path.join(OUT_DIR, key + ".bin")
            if not os.path.exists(path):
                missing.append(key)
                continue
            with open(path, "rb") as f:
                if f.read() != base64.b64decode(b64):
                    wrong.append(key)
        # An already-split file has no external keys left inline, which is the healthy steady
        # state — report it as such rather than as "nothing to check".
        if not external:
            have = sorted(f[:-4] for f in os.listdir(OUT_DIR)) if os.path.isdir(OUT_DIR) else []
            expected = sorted(k for k, c in meta.items() if c != INLINE_CATEGORY)
            if have != expected:
                print("FAIL: vendor/luts/ holds %d files, LUT_META expects %d"
                      % (len(have), len(expected)))
                return 1
            print("OK: already split — %d .bin files match LUT_META" % len(have))
            return 0
        if missing or wrong:
            print("FAIL: %d missing, %d byte-mismatched" % (len(missing), len(wrong)))
            for k in (missing + wrong)[:10]:
                print("  ", k)
            return 1
        print("OK: all %d external presets match their .bin" % len(external))
        return 0

    if not external:
        print("nothing to split — LUT_PRESETS already holds only the core looks")
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    written = 0
    for key, b64 in external:
        with open(os.path.join(OUT_DIR, key + ".bin"), "wb") as f:
            f.write(base64.b64decode(b64))
        written += 1

    body = HEADER.format(n_ext=len(external)) + "const LUT_PRESETS={\n" + ",\n".join(
        '  "%s":\'%s\'' % (key, b64) for key, b64 in inline
    ) + "\n};"
    html = html[:p_start] + body + html[p_end:]
    with open(HTML, "w", encoding="utf-8") as f:
        f.write(html)

    before = p_end - p_start
    after = len(body)
    print("wrote %d .bin files to vendor/luts/ (%.1f MB)"
          % (written, written * LUT_BYTES / 1e6))
    print("LUT_PRESETS block: %.2f MB -> %.2f MB" % (before / 1e6, after / 1e6))
    print("chromasmith-22.html: %.2f MB" % (len(html) / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
