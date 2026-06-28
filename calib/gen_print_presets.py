#!/usr/bin/env python3
"""Generate the PRINT_PRESETS={...} JS block from calib/PRINT PROFILES/*.cube.

Print profiles (Kodak/Fuji print) are a SEPARATE stage from the 11 film looks: they are
applied AFTER the film LUT + halation in chromasmith-22.html's comp pass. Same quantize+
base64 method as gen_lut_presets.py (R-fastest cube file order -> Uint8 -> base64), read
back by lutFromBytes() into the li(r,g,b) layout.

Usage: python calib/gen_print_presets.py > /tmp/print_presets.js
"""
import base64, glob, os, sys

SRC = os.path.join(os.path.dirname(__file__), "PRINT PROFILES")


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
        if size != 33 or n != size ** 3:
            sys.stderr.write("WARN %s: size=%s entries=%s\n" % (key, size, n))
        b64 = base64.b64encode(data).decode("ascii")
        entries.append('  "%s":\'%s\'' % (key, b64))
        sys.stderr.write("ok   %s  (%d entries -> %d b64)\n" % (key, n, len(b64)))
    sys.stdout.write("const PRINT_PRESETS={\n" + ",\n".join(entries) + "\n};\n")


if __name__ == "__main__":
    main()
