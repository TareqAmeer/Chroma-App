#!/usr/bin/env python3
"""Extract Dehancer 'print profile' LUTs from processed Chromasmith LUT-chart PNGs.

Dehancer applies a *print* stage on top of the film negative. The user processed the
Chromasmith LUT chart (5640x3840, every 33^3 colour) through Dehancer's Kodak-print and
Fuji-print profiles. This script replicates chartToLUT() from chromasmith-22.html exactly
(same CHART geometry, same inner-50% patch mean, same li(r,g,b) ordering) to recover an
exact 33^3 .cube for each, written to calib/LUT LIBRARY/ as kodak_print.cube / fuji_print.cube.

Run from repo root (venv active):  python calib/extract_print_luts.py
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
# Print profiles live in their own folder (NOT LUT LIBRARY, which is the 11 film looks
# that gen_lut_presets.py bakes into LUT_PRESETS). Print cubes are embedded separately as
# PRINT_PRESETS in chromasmith-22.html — see calib/gen_print_presets.py.
OUT = os.path.join(HERE, "PRINT PROFILES")
os.makedirs(OUT, exist_ok=True)

SZ = 33
# CHART geometry — must match chromasmith-22.html const CHART
CELL, COLS, ROWS, MARGIN = 24, 231, 156, 48
CHART_W = COLS * CELL + 2 * MARGIN   # 5640
CHART_H = ROWS * CELL + 2 * MARGIN   # 3840

SRCS = {
    "kodak_print": "dehancer kodak lut print x2.png",
    "fuji_print":  "dehancer fuji lut print x2.png",
}


def chart_to_lut(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    sx, sy = w / CHART_W, h / CHART_H   # tolerate resized exports
    d = np.asarray(im, dtype=np.float64)  # (h, w, 3)
    # lut[r,g,b] in cube file order is built below; we store as flat list R-fastest.
    lut = np.zeros((SZ * SZ * SZ, 3), dtype=np.float64)
    for i in range(SZ * SZ * SZ):
        r = i % SZ
        g = (i // SZ) % SZ
        b = i // (SZ * SZ)
        col = i % COLS
        row = i // COLS
        x0 = round((MARGIN + col * CELL + CELL * 0.25) * sx)
        x1 = max(x0 + 1, round((MARGIN + col * CELL + CELL * 0.75) * sx))
        y0 = round((MARGIN + row * CELL + CELL * 0.25) * sy)
        y1 = max(y0 + 1, round((MARGIN + row * CELL + CELL * 0.75) * sy))
        patch = d[y0:y1, x0:x1, :]
        mean = patch.reshape(-1, 3).mean(axis=0) / 255.0
        # store at li(r,g,b) layout == flat index r*SZ*SZ + g*SZ + b (cube file order is
        # b-fastest line order; writeCube below iterates b,g,r so we index by (r,g,b)).
        lut[i] = mean  # i already == r + g*SZ + b*SZ*SZ ... but cube file order differs
    return lut


def write_cube(path, lut, title):
    """Write a 33^3 .cube. lut is indexed by i = r + g*SZ + b*SZ*SZ (R-fastest, as built).
    .cube file order is R-fastest within each line as well (standard), so we re-emit in
    standard order: for b, for g, for r."""
    with open(path, "w") as f:
        f.write("TITLE \"%s\"\n" % title)
        f.write("#LUMIXPHOTOSTYLE STD\n")
        f.write("LUT_3D_SIZE %d\n" % SZ)
        for b in range(SZ):
            for g in range(SZ):
                for r in range(SZ):
                    i = r + g * SZ + b * SZ * SZ
                    c = lut[i]
                    f.write("%.6f %.6f %.6f\n" % (c[0], c[1], c[2]))


def main():
    for key, fn in SRCS.items():
        src = os.path.join(HERE, fn)
        lut = chart_to_lut(src)
        out = os.path.join(OUT, key + ".cube")
        write_cube(out, lut, key)
        print("ok  %-12s -> %s  (range %.3f..%.3f)" % (
            key, out, lut.min(), lut.max()))


if __name__ == "__main__":
    main()
