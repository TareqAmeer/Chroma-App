"""Shared LUT-chart geometry + round-trip, matching chromasmith-22.html's makeLutChart()/
chartToLUT() exactly (const CHART, const SZ). Used by extract_print_luts.py and the
Dehancer film-LUT extraction tooling so there's one copy of the geometry.

Run standalone to (re)generate the source chart PNG:  python calib/chartlut.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw

SZ = 33
CELL, COLS, ROWS, MARGIN = 24, 231, 156, 48
CHART_W = COLS * CELL + 2 * MARGIN   # 5640
CHART_H = ROWS * CELL + 2 * MARGIN   # 3840

HERE = os.path.dirname(__file__)
DEFAULT_CHART_PATH = os.path.join(HERE, "dehancer", "chromasmith_lut_chart.png")


def make_lut_chart():
    """Replicates makeLutChart() in chromasmith-22.html: 33^3 colour patches + corner
    fiducials on a mid-grey background."""
    img = Image.new("RGB", (CHART_W, CHART_H), (0x80, 0x80, 0x80))
    draw = ImageDraw.Draw(img)
    for i in range(SZ * SZ * SZ):
        r = i % SZ
        g = (i // SZ) % SZ
        b = i // (SZ * SZ)
        col = i % COLS
        row = i // COLS
        x0 = MARGIN + col * CELL
        y0 = MARGIN + row * CELL
        color = (
            round(r * 255 / (SZ - 1)),
            round(g * 255 / (SZ - 1)),
            round(b * 255 / (SZ - 1)),
        )
        draw.rectangle([x0, y0, x0 + CELL - 1, y0 + CELL - 1], fill=color)
    w, h = CHART_W, CHART_H
    for fx, fy in [(8, 8), (w - 28, 8), (8, h - 28), (w - 28, h - 28)]:
        draw.rectangle([fx, fy, fx + 19, fy + 19], fill=(0, 0, 0))
    for fx, fy in [(13, 13), (w - 23, 13), (13, h - 23), (w - 23, h - 23)]:
        draw.rectangle([fx, fy, fx + 9, fy + 9], fill=(255, 255, 255))
    return img


def chart_to_lut(path):
    """Replicates chartToLUT(): inner-50% patch mean per cell (so grain/sharpen/NR in an
    export cancel out). Returns a (SZ^3, 3) array indexed by i = r + g*SZ + b*SZ*SZ."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    sx, sy = w / CHART_W, h / CHART_H  # tolerate resized exports
    d = np.asarray(im, dtype=np.float64)  # (h, w, 3)
    lut = np.zeros((SZ * SZ * SZ, 3), dtype=np.float64)
    for i in range(SZ * SZ * SZ):
        col = i % COLS
        row = i // COLS
        x0 = round((MARGIN + col * CELL + CELL * 0.25) * sx)
        x1 = max(x0 + 1, round((MARGIN + col * CELL + CELL * 0.75) * sx))
        y0 = round((MARGIN + row * CELL + CELL * 0.25) * sy)
        y1 = max(y0 + 1, round((MARGIN + row * CELL + CELL * 0.75) * sy))
        patch = d[y0:y1, x0:x1, :]
        lut[i] = patch.reshape(-1, 3).mean(axis=0) / 255.0
    return lut


def write_cube(path, lut, title):
    """Write a 33^3 .cube. lut is indexed by i = r + g*SZ + b*SZ*SZ (R-fastest, as built
    by chart_to_lut); .cube file order is also R-fastest within each line (for b, for g,
    for r), matching writeCube() in chromasmith-22.html."""
    with open(path, "w") as f:
        f.write('TITLE "%s"\n' % title)
        f.write("#LUMIXPHOTOSTYLE STD\n")
        f.write("LUT_3D_SIZE %d\n" % SZ)
        for b in range(SZ):
            for g in range(SZ):
                for r in range(SZ):
                    i = r + g * SZ + b * SZ * SZ
                    c = lut[i]
                    f.write("%.6f %.6f %.6f\n" % (c[0], c[1], c[2]))


def identity_error(lut):
    """Max abs error of `lut` against the true identity ramp — the expected residual for
    a clean round-trip is quantization only (~1/510 per CLAUDE.md)."""
    expect = np.zeros_like(lut)
    for i in range(len(lut)):
        r = i % SZ
        g = (i // SZ) % SZ
        b = i // (SZ * SZ)
        expect[i] = [r / (SZ - 1), g / (SZ - 1), b / (SZ - 1)]
    return np.abs(lut - expect).max()


if __name__ == "__main__":
    os.makedirs(os.path.dirname(DEFAULT_CHART_PATH), exist_ok=True)
    make_lut_chart().save(DEFAULT_CHART_PATH)
    print("wrote", DEFAULT_CHART_PATH, "(%dx%d)" % (CHART_W, CHART_H))
