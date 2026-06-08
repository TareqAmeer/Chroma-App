"""
Generate the GRAIN calibration chart -> grain-test-2x.png (repo root).

Purpose: isolate film-grain behaviour per hue x luminance x channel x spatial
frequency, with LARGE flat sample areas so noise-to-signal is read without edge
interference (the halation lesson: measure flat interiors, not edges).

Upload grain-test-2x.png to Dehancer, export at grain Amount 30 / 60 / 100, and
save the three outputs in the repo root as:
    grain-deh-30.png  grain-deh-60.png  grain-deh-100.png
calib/grainmodel.py samples zones by the coordinates printed below.

Run: python calib/gen_grain_chart.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── canvas ───────────────────────────────────────────────────────────────────
W, H = 4800, 3600
arr = np.zeros((H, W, 3), dtype=np.float32)

# zone-geometry log (printed at end so measurement code/CLAUDE.md can reference)
GEO = []
def geo(name, x0, y0, x1, y1, note=''):
    GEO.append((name, x0, y0, x1, y1, note))

def fill(x0, y0, x1, y1, rgb):
    arr[y0:y1, x0:x1] = rgb

def lin_ramp(y0, y1, c0, c1, log=False, axis='x'):
    n = W if axis == 'x' else (y1 - y0)
    t = np.linspace(0, 1, n)
    if log:                       # perceptual/log spacing (film is logarithmic)
        t = (np.power(10.0, t * 2) - 1) / 99.0     # 0..1, compressed toe
    for i in range(3):
        col = c0[i] + t * (c1[i] - c0[i])
        if axis == 'x':
            arr[y0:y1, :, i] = col[None, :]
        else:
            arr[y0:y1, :, i] = col[:, None]

# named color anchors (sRGB 8-bit, full-strength hue)
HUES = {
    'R': (255, 0, 0), 'G': (0, 255, 0), 'B': (0, 0, 255),
    'C': (0, 255, 255), 'M': (255, 0, 255), 'Y': (255, 255, 0),
    'SkinLt': (255, 214, 190), 'SkinMid': (224, 172, 138), 'SkinDk': (140, 96, 74),
    'Gray18': (118, 118, 118), 'Cine25': (143, 143, 143), 'Cine75': (221, 221, 221),
}
LUMA_STEPS = [0.0, 0.10, 0.25, 0.40, 0.55, 0.70, 0.85, 1.00]  # exposure scale

# ══ ZONE A: Color x Luminance matrix ══════════════════════════════════════════
# rows = hues (12), cols = luma steps (8). Each cell large & flat.
A_X0, A_Y0 = 120, 120
CELL_W, CELL_H, GAP = 520, 150, 8
geo('matrix.origin', A_X0, A_Y0, A_X0 + len(LUMA_STEPS) * CELL_W,
    A_Y0 + len(HUES) * CELL_H,
    f'rows={list(HUES)} cols(luma)={LUMA_STEPS} cell={CELL_W}x{CELL_H} gap={GAP}')
for ri, (hname, hue) in enumerate(HUES.items()):
    for ci, L in enumerate(LUMA_STEPS):
        col = tuple(round(c * L) for c in hue)
        x0 = A_X0 + ci * CELL_W
        y0 = A_Y0 + ri * CELL_H
        fill(x0 + GAP, y0 + GAP, x0 + CELL_W - GAP, y0 + CELL_H - GAP, col)

A_Y_END = A_Y0 + len(HUES) * CELL_H

# ══ ZONE B: Massive profiling blocks (uniform, high-SNR sampling) ═════════════
B_Y0 = A_Y_END + 40
B_H = 230
PROF = [
    ('Shadow10', (26, 26, 26)), ('Gray18', (118, 118, 118)),
    ('Gray50', (188, 188, 188)), ('SkinMid', (224, 172, 138)),
    ('PureR', (255, 0, 0)), ('PureG', (0, 255, 0)), ('PureB', (0, 0, 255)),
]
BW = (W - 240) // len(PROF)
for i, (nm, col) in enumerate(PROF):
    x0 = 120 + i * BW
    fill(x0 + 6, B_Y0, x0 + BW - 6, B_Y0 + B_H, col)
    geo(f'profile.{nm}', x0 + 6, B_Y0, x0 + BW - 6, B_Y0 + B_H, str(col))
B_Y_END = B_Y0 + B_H

# ══ ZONE C: Chrominance separation — simultaneous R/G/B gradients ═════════════
C_Y0 = B_Y_END + 40
C_H = 120
lin_ramp(C_Y0, C_Y0 + C_H, (0, 0, 0), (255, 0, 0))
geo('chroma.R', 0, C_Y0, W, C_Y0 + C_H, '0->255 R, sample any x for that exposure')
lin_ramp(C_Y0 + C_H, C_Y0 + 2 * C_H, (0, 0, 0), (0, 255, 0))
geo('chroma.G', 0, C_Y0 + C_H, W, C_Y0 + 2 * C_H, '0->255 G')
lin_ramp(C_Y0 + 2 * C_H, C_Y0 + 3 * C_H, (0, 0, 0), (0, 0, 255))
geo('chroma.B', 0, C_Y0 + 2 * C_H, W, C_Y0 + 3 * C_H, '0->255 B')
C_Y_END = C_Y0 + 3 * C_H

# ══ ZONE D: Linear vs Logarithmic / CineWedge gray ramps ══════════════════════
D_Y0 = C_Y_END + 40
D_H = 110
lin_ramp(D_Y0, D_Y0 + D_H, (0, 0, 0), (255, 255, 255), log=False)
geo('ramp.linear', 0, D_Y0, W, D_Y0 + D_H, 'gray 0->255 linear')
lin_ramp(D_Y0 + D_H, D_Y0 + 2 * D_H, (0, 0, 0), (255, 255, 255), log=True)
geo('ramp.log', 0, D_Y0 + D_H, W, D_Y0 + 2 * D_H, 'gray 0->255 log (toe/shoulder)')
D_Y_END = D_Y0 + 2 * D_H

# ══ ZONE E: Spatial frequency — checkerboards (fine vs coarse) ════════════════
E_Y0 = D_Y_END + 40
E_H = 280
# three checker cell sizes on a mid-gray (128) field
mid = 128
for blk, (cell, x0, x1) in enumerate([(4, 120, 1640), (16, 1700, 3220),
                                       (64, 3280, 4680)]):
    fill(x0, E_Y0, x1, E_Y0 + E_H, (mid, mid, mid))
    yy = np.arange(E_Y0, E_Y0 + E_H)
    xx = np.arange(x0, x1)
    cb = (((xx[None, :] // cell) + (yy[:, None] // cell)) % 2)
    sub = arr[E_Y0:E_Y0 + E_H, x0:x1]
    sub[cb == 1] = 200
    sub[cb == 0] = 56
    geo(f'checker.{cell}px', x0, E_Y0, x1, E_Y0 + E_H, f'cell={cell}px hi=200 lo=56')
E_Y_END = E_Y0 + E_H

# ══ ZONE F: Siemens stars (acutance / aliasing under grain) ═══════════════════
F_Y0 = E_Y_END + 40
F_R = 170
F_CY = F_Y0 + F_R
SPOKES = 48
for k, cx in enumerate([400, 1200, 2000, 2800]):
    g = [255, 128, 188, 188][k]   # white star + a few gray-level stars
    for s in range(SPOKES * 2):
        a0 = (s / (SPOKES * 2)) * 2 * np.pi
        a1 = ((s + 1) / (SPOKES * 2)) * 2 * np.pi
        if s % 2 == 0:
            # draw wedge as a polygon (PIL needs an image; do it after np->img)
            pass
    geo(f'siemens.{cx}', cx - F_R, F_Y0, cx + F_R, F_Y0 + 2 * F_R, f'gray={g} spokes={SPOKES}')
F_Y_END = F_Y0 + 2 * F_R

# convert to PIL for the star wedges + labels
img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
draw = ImageDraw.Draw(img)
for k, cx in enumerate([400, 1200, 2000, 2800]):
    g = [255, 128, 188, 188][k]
    for s in range(0, SPOKES * 2, 2):
        a0 = (s / (SPOKES * 2)) * 2 * np.pi
        a1 = ((s + 1) / (SPOKES * 2)) * 2 * np.pi
        pts = [(cx, F_CY),
               (cx + F_R * np.cos(a0), F_CY + F_R * np.sin(a0)),
               (cx + F_R * np.cos(a1), F_CY + F_R * np.sin(a1))]
        draw.polygon(pts, fill=(g, g, g))

# ── labels (small, low-contrast; placed in gaps so they don't pollute samples) ─
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 22)
except Exception:
    font = ImageFont.load_default()
lab = (90, 90, 90)
draw.text((A_X0, A_Y0 - 30), 'A: COLOR x LUMINANCE MATRIX (rows=hue, cols=exposure)', fill=lab, font=font)
draw.text((120, B_Y0 - 30), 'B: PROFILING BLOCKS', fill=lab, font=font)
draw.text((10, C_Y0 - 30), 'C: CHROMA SEPARATION R/G/B', fill=lab, font=font)
draw.text((10, D_Y0 - 30), 'D: LINEAR vs LOG RAMP', fill=lab, font=font)
draw.text((120, E_Y0 - 30), 'E: CHECKERBOARDS 4/16/64px', fill=lab, font=font)
draw.text((120, F_Y0 - 30), 'F: SIEMENS STARS', fill=lab, font=font)
# matrix row labels
for ri, hname in enumerate(HUES):
    draw.text((20, A_Y0 + ri * CELL_H + 4), hname, fill=lab, font=font)

# ── save + geometry table ─────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
out = os.path.join(ROOT, 'grain-test-2x.png')
img.save(out)

geo_path = os.path.join(HERE, 'grain_chart_geo.txt')
with open(geo_path, 'w') as f:
    f.write(f'# grain-test-2x.png  {img.size}\n')
    f.write('# name x0 y0 x1 y1 note\n')
    for row in GEO:
        f.write('  '.join(str(v) for v in row) + '\n')

print(f'Saved {out}  {img.size}')
print(f'Geometry -> {geo_path}  ({len(GEO)} zones)')
