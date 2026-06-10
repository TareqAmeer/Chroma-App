#!/usr/bin/env python3
"""Generate the LUT_PRESETS={...} JS block from calib/LUT LIBRARY/*.cube.

Each .cube is a 33^3 3D LUT in file order (R-fastest). We quantize every RGB
triple to Uint8 (round(v*255)) and concat in that exact order, then base64.
This matches lutFromBytes() in chromasmith-22.html, which reads the byte stream
in a for-b,for-g,for-r loop (== cube file order) into the li(r,g,b) layout.
Prior session verified a preset built this way renders pixel-identical to
uploading the original .cube.

Usage: python calib/gen_lut_presets.py > /tmp/lut_presets.js
"""
import base64, glob, os, sys

SRC = os.path.join(os.path.dirname(__file__), "LUT LIBRARY")

def parse_cube(path):
    size = None
    data = bytearray()
    n = 0
    with open(path, "r", errors="replace") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            up = s.upper()
            if up.startswith("LUT_3D_SIZE"):
                size = int(s.split()[-1]); continue
            if up.startswith("TITLE") or up.startswith("LUT_") or up.startswith("DOMAIN"):
                continue
            parts = s.split()
            if len(parts) < 3:
                continue
            try:
                r, g, b = float(parts[0]), float(parts[1]), float(parts[2])
            except ValueError:
                continue
            data.append(max(0, min(255, round(r * 255))))
            data.append(max(0, min(255, round(g * 255))))
            data.append(max(0, min(255, round(b * 255))))
            n += 1
    return size, n, bytes(data)

def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.cube")))
    if not files:
        sys.exit("no .cube files in %r" % SRC)
    entries = []
    for path in files:
        key = os.path.splitext(os.path.basename(path))[0]
        size, n, data = parse_cube(path)
        expect = (size or 0) ** 3
        if size != 33 or n != expect:
            sys.stderr.write("WARN %s: size=%s entries=%s expected=%s\n" % (key, size, n, expect))
        b64 = base64.b64encode(data).decode("ascii")
        # JS key: quote it (handles spaces); escape any quote/backslash defensively
        jskey = '"%s"' % key.replace("\\", "\\\\").replace('"', '\\"')
        entries.append("  %s:'%s'" % (jskey, b64))
        sys.stderr.write("ok   %s  (%d entries, %d bytes -> %d b64)\n" % (key, n, len(data), len(b64)))
    sys.stdout.write("const LUT_PRESETS={\n" + ",\n".join(entries) + "\n};\n")

if __name__ == "__main__":
    main()
