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

from chartlut import chart_to_lut, write_cube

HERE = os.path.dirname(__file__)
# Print profiles live in their own folder (NOT LUT LIBRARY, which is the 11 film looks
# that gen_lut_presets.py bakes into LUT_PRESETS). Print cubes are embedded separately as
# PRINT_PRESETS in chromasmith-22.html — see calib/gen_print_presets.py.
OUT = os.path.join(HERE, "PRINT PROFILES")
os.makedirs(OUT, exist_ok=True)

SRCS = {
    "kodak_print": "dehancer kodak lut print x2.png",
    "fuji_print":  "dehancer fuji lut print x2.png",
}


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
