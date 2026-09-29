"""
Generate the BLOOM calibration chart -> bloom-test-2x.png (repo root).

Purpose: isolate Dehancer's bloom (soft highlight glow above a luminance threshold)
from halation and grain. Hard-edged discs on PURE BLACK, well separated so halos
never overlap and there is zero baseline gradient to confound the measurement —
same discipline as gen_grain_chart.py (flat interiors) and the halation session's
"measure flat interiors, not edges" lesson (see CLAUDE.md §10).

Two rows:
  Row A — white discs of varying RADIUS (bloom should scale with source size/area).
  Row B — a fixed-radius white disc at varying BRIGHTNESS (bloom's own luminance
          threshold means only bright-enough sources should glow at all).
Plus one saturated-colour disc row to check bloom keeps or desaturates highlight colour.

Zone geometry is logged to calib/bloom_chart_geo.txt (mirrors gen_grain_chart.py's
own geo log) so measurement code has one source of truth instead of hardcoded
constants that can drift out of sync with the generator (the exact bug just found
in grainmodel.py's B_Y0).

Run: python calib/gen_bloom_chart.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw

W, H = 4800, 3600
img = Image.new('RGB', (W, H), (0, 0, 0))
draw = ImageDraw.Draw(img)

GEO = []
def geo(name, x0, y0, x1, y1, note=''):
    GEO.append((name, x0, y0, x1, y1, note))

# ── ROW A: white discs, varying radius, fixed max brightness ─────────────────
# Spacing >= 6x the largest radius so halos at high bloom amount can't overlap.
RADII = [10, 20, 40, 80, 160]
A_Y = 900
A_X0 = 500
A_GAP = 780
for i, r in enumerate(RADII):
    cx = A_X0 + i * A_GAP
    draw.ellipse([cx - r, A_Y - r, cx + r, A_Y + r], fill=(255, 255, 255))
    geo(f'rowA.r{r}', cx, A_Y, cx, A_Y, f'white disc r={r}px, center')

# ── ROW B: fixed radius (40px), varying brightness (tests the glow threshold) ─
B_Y = 1900
B_X0 = 500
B_GAP = 780
BRIGHTNESSES = [64, 128, 180, 220, 255]
for i, v in enumerate(BRIGHTNESSES):
    cx = B_X0 + i * B_GAP
    draw.ellipse([cx - 40, B_Y - 40, cx + 40, B_Y + 40], fill=(v, v, v))
    geo(f'rowB.v{v}', cx, B_Y, cx, B_Y, f'grey disc r=40px value={v}, center')

# ── ROW C: saturated colour discs, fixed radius 40px, full brightness channel ─
C_Y = 2900
C_X0 = 500
C_GAP = 780
COLORS = [('R', (255, 0, 0)), ('G', (0, 255, 0)), ('B', (0, 0, 255)),
          ('Y', (255, 255, 0)), ('W', (255, 255, 255))]
for i, (name, rgb) in enumerate(COLORS):
    cx = C_X0 + i * C_GAP
    draw.ellipse([cx - 40, C_Y - 40, cx + 40, C_Y + 40], fill=rgb)
    geo(f'rowC.{name}', cx, C_Y, cx, C_Y, f'{rgb} disc r=40px, center')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
out_png = os.path.join(ROOT, 'bloom-test-2x.png')
img.save(out_png)

geo_path = os.path.join(HERE, 'bloom_chart_geo.txt')
with open(geo_path, 'w') as f:
    f.write(f'# bloom-test-2x.png  ({W}, {H})\n')
    f.write('# name cx cy cy note\n')
    for name, x0, y0, x1, y1, note in GEO:
        f.write(f'{name}  {x0}  {y0}  {x1}  {y1}  {note}\n')

print(f'Saved {out_png}  {img.size}')
print(f'Geometry -> {geo_path}  ({len(GEO)} zones)')
