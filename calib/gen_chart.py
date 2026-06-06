"""
Generate calibration chart at 2x scale (4800x6400) from measured structure of IMG_5774.PNG.
Reproduces all 8 zones with clean geometry for higher-quality Dehancer export.
Run: python3 calib/gen_chart.py
"""
import numpy as np
from PIL import Image, ImageDraw

S = 2  # scale factor (1x = 2400x3200, 2x = 4800x6400)
W = 2400 * S
H = 3200 * S

def p(v):
    return v * S

img = Image.new('RGB', (W, H), (0, 0, 0))
draw = ImageDraw.Draw(img)

# ── ZONE 1: Color dots (diamond shape, 5×3 at 1x) ───────────────────────────
# Centers: x=150,380,610,...,1990; y_center=110
DOT_CX = [150, 380, 610, 840, 1070, 1300, 1530, 1760, 1990]
DOT_COLORS = [
    (255, 255, 255),  # white
    (255, 200, 140),  # warm
    (140, 200, 255),  # cool
    (255,  80,  80),  # red
    ( 80, 255,  80),  # green
    ( 80,  80, 255),  # blue
    (255, 220,  80),  # yellow
    (200,  80, 255),  # purple
    (255, 160, 160),  # pink
]
for cx, color in zip(DOT_CX, DOT_COLORS):
    cx2, cy2 = p(cx), p(110)
    hw, hh = p(1), p(2)  # half-width, half-height of diamond
    draw.polygon([
        (cx2, cy2 - hh), (cx2 + hw, cy2),
        (cx2, cy2 + hh), (cx2 - hw, cy2),
    ], fill=color)

# ── ZONE 2: Brightness/color bars (x=1200-2399, right half) ─────────────────
# 7 bars, each 73px tall, 17px gap, starting y=420
BAR_COLORS = [
    (255, 255, 255),   # 100% white
    (204, 204, 204),   # 80%
    (153, 153, 153),   # 60%
    (102, 102, 102),   # 40%
    ( 51,  51,  51),   # 20%
    (255, 190, 110),   # warm
    (110, 180, 255),   # cool
]
BAR_Y0 = [420, 510, 600, 690, 780, 880, 960]
BAR_H  = 73
for y0, color in zip(BAR_Y0, BAR_COLORS):
    draw.rectangle([p(1200), p(y0), p(2400) - 1, p(y0 + BAR_H) - 1], fill=color)

# ── ZONE 3: Linear gradients (full width) ────────────────────────────────────
# Neutral gray y=1100-1200, warm y=1230-1300, cool y=1310-1380
arr = np.array(img, dtype=np.float32)

def fill_gradient(arr, y0, y1, c_left, c_right):
    xs = np.linspace(0, 1, W)
    for i in range(3):
        arr[p(y0):p(y1), :, i] = c_left[i] + xs * (c_right[i] - c_left[i])

fill_gradient(arr, 1100, 1200, (0, 0, 0), (255, 255, 255))
fill_gradient(arr, 1230, 1300, (0, 0, 0), (255, 190, 110))
fill_gradient(arr, 1310, 1380, (0, 0, 0), (110, 180, 255))

img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
draw = ImageDraw.Draw(img)

# ── ZONE 4: Circle rings (PSF radial measurement) ────────────────────────────
# Small inner rings, all centered at y=1530
INNER_CIRCLES = [
    (180,  1530,  3, (255, 255, 255)),
    (640,  1530,  6, (255, 255, 255)),
    (1100, 1530, 10, (255, 255, 255)),
    (1560, 1530, 15, (255, 255, 255)),
    (2020, 1530,  3, (180, 180, 180)),
]
# Large outer rings — same x-centers, large radii for outer PSF
OUTER_CIRCLES = [
    ( 180, 1530, 195, (180, 180, 180)),
    ( 640, 1530, 195, (180, 180, 180)),
    (1100, 1530, 200, (255, 255, 255)),
    (1560, 1530, 200, (255, 255, 255)),
]
# Colored circles centered at y=1860
COLORED_CIRCLES = [
    ( 174, 1860, 8, (255, 200, 100)),  # warm
    ( 554, 1860, 8, (100, 190, 255)),  # cool
    ( 934, 1860, 8, (255,  90,  90)),  # red
    (1314, 1860, 8, ( 90, 255, 180)),  # green
    (1694, 1860, 8, (255, 255,  80)),  # yellow
    (2074, 1860, 8, (200,  80, 255)),  # purple
]
for cx, cy, r, color in INNER_CIRCLES + OUTER_CIRCLES + COLORED_CIRCLES:
    cx2, cy2, r2 = p(cx), p(cy), p(r)
    draw.ellipse([cx2 - r2, cy2 - r2, cx2 + r2, cy2 + r2],
                 outline=color, width=max(1, S))

# ── ZONE 5: Color matrix (8 columns × 5 brightness rows) ─────────────────────
COL_COLORS_100 = [
    (255,   0,   0),  # red
    (255, 128,   0),  # orange
    (200, 200,   0),  # yellow
    (  0, 200,   0),  # green
    (  0, 200, 200),  # cyan
    (  0,   0, 255),  # blue
    (200,   0, 200),  # purple
    (255, 255, 255),  # white
]
# Brightness multipliers derived from pixel measurements
BRIGHT_MUL = [1.0, 191/255, 127/255, 100/255, 25/255]
ROW_Y0 = [2010, 2078, 2146, 2214, 2282]
ROW_H  = 59
COL_W  = 300  # 2400 / 8 columns

for ri, (ry, bm) in enumerate(zip(ROW_Y0, BRIGHT_MUL)):
    for ci, base in enumerate(COL_COLORS_100):
        color = tuple(round(c * bm) for c in base)
        x1, y1 = p(ci * COL_W), p(ry)
        x2, y2 = p((ci + 1) * COL_W) - 1, p(ry + ROW_H) - 1
        draw.rectangle([x1, y1, x2, y2], fill=color)

# ── ZONE 6: 15-step staircase gray strip (x=150-2399) ───────────────────────
# 15 steps of 150px width at 1x, values 17,34,51,...,255 (= 17*k for k=1..15)
arr = np.array(img, dtype=np.uint8)
for k in range(1, 16):
    x0 = p(150 + (k - 1) * 150)
    x1 = p(150 + k * 150)
    v = round(k * 255 / 15)  # 17, 34, 51, ..., 255
    arr[p(2420):p(2501), x0:x1, :] = v

img = Image.fromarray(arr)
draw = ImageDraw.Draw(img)

# ── ZONE 7: Thin lines + wider blocks ────────────────────────────────────────
# Each entry: (1px_y, block_y0, block_y1, color)
LINE_SPECS = [
    (2620, 2626, 2633, (255, 255, 255)),  # white
    (2680, 2688, 2693, (255, 160,  80)),  # warm
    (2740, 2746, 2753, ( 80, 160, 255)),  # cool
    (2800, 2806, 2813, (255,  80,  80)),  # thin red
]
for y_line, yb0, yb1, color in LINE_SPECS:
    draw.rectangle([0, p(y_line), W - 1, p(y_line) + S - 1], fill=color)
    draw.rectangle([0, p(yb0), W - 1, p(yb1 + 1) - 1], fill=color)

# ── ZONE 8: Gray box outline with vertical grid lines ────────────────────────
box_color = (40, 40, 40)
draw.rectangle([p(30), p(2910), p(2370), p(2980)],
               outline=box_color, width=S)
# 8 interior vertical dividers spaced 292px apart
for i in range(1, 9):
    gx = p(30 + 292 * i)
    if gx < p(2370):
        draw.line([(gx, p(2910)), (gx, p(2980))], fill=box_color, width=S)

# ══ EXTRA ANALYTICAL ZONES (new, below zone 8, only in 2x chart) ═════════════
# These aid channel-specific PSF measurement and brightness threshold testing.

# ── ZONE 9A: Isolated 1px spot row ───────────────────────────────────────────
# Single pixels for pristine PSF measurement (one pixel = impulse response).
Z9A_Y = p(2992)  # stays within H=6400
SPOT_SPECS = [
    ( 300, (255, 255, 255)),  # white
    ( 700, (255, 160,  80)),  # warm amber
    (1100, ( 80, 160, 255)),  # cool blue
    (1500, (255,   0,   0)),  # pure red
    (1900, (  0, 255,   0)),  # pure green
    (2300, (  0,   0, 255)),  # pure blue
    (2700, (255, 220,  80)),  # yellow
    (3100, (200,  80, 255)),  # purple
    (3500, (255, 160, 160)),  # pink
    (3900, (255, 128,   0)),  # orange
    (4300, (  0, 200, 200)),  # cyan
    (4700, (255, 255, 160)),  # pale yellow
]
for sx, color in SPOT_SPECS:
    draw.point((sx, Z9A_Y), fill=color)

# ── ZONE 9B: 9×9 px colored squares for higher-SNR PSF measurement ───────────
Z9B_Y = p(3020)  # center y
SQ = 9  # 9px side at 2x
for sx, color in SPOT_SPECS:
    draw.rectangle([sx - SQ//2, Z9B_Y - SQ//2, sx + SQ//2, Z9B_Y + SQ//2],
                   fill=color)

# ── ZONE 9C: Brightness threshold dots (white & warm) ────────────────────────
# Spaced squares at brightness 100%..10% to measure thr/knee onset.
Z9C_Y = p(3050)
BRIGHT_VALS = [255, 230, 204, 179, 153, 128, 102, 77, 51, 26]  # 100%..10%
for i, v in enumerate(BRIGHT_VALS):
    sx = p(240 + i * 230)  # spacing 230px → 10 dots span x=240-2310
    draw.rectangle([sx - 4, Z9C_Y - 4, sx + 4, Z9C_Y + 4], fill=(v, v, v))
# Warm amber version
Z9D_Y = p(3075)
for i, v in enumerate(BRIGHT_VALS):
    sx = p(240 + i * 230)
    c = (v, round(v * 160 / 255), round(v * 80 / 255))
    draw.rectangle([sx - 4, Z9D_Y - 4, sx + 4, Z9D_Y + 4], fill=c)

# ── ZONE 9E: Color-channel PSF rings ─────────────────────────────────────────
# 1px outline rings to measure channel-specific halation spread.
Z9E_CY = p(3130)       # center y; radius 20px at 1x → 40px at 2x
PSF_RING_R = p(20)
PSF_TARGETS = [
    ( 300, (255,   0,   0)),  # pure red
    ( 800, (  0, 200,   0)),  # green
    (1300, (  0,   0, 255)),  # pure blue
    (1800, (255, 160,  80)),  # warm amber
    (2300, ( 80, 160, 255)),  # cool blue
    (2800, (255, 255, 255)),  # white
    (3300, (255, 220,  80)),  # yellow (R+G)
    (3800, (  0, 200, 200)),  # cyan (G+B)
    (4300, (200,  80, 255)),  # purple (R+B)
]
for sx, color in PSF_TARGETS:
    draw.ellipse([sx - PSF_RING_R, Z9E_CY - PSF_RING_R,
                  sx + PSF_RING_R, Z9E_CY + PSF_RING_R],
                 outline=color, width=S)
    draw.point((sx, Z9E_CY), fill=color)

# ── ZONE 9F: 1px-stripe grating for blur-width measurement ───────────────────
# White/black alternating 1px columns; blur collapses contrast to ~0.
Z9F_Y0, Z9F_Y1 = p(3170), p(3190)
for sx in range(0, W, S * 2):
    draw.rectangle([sx, Z9F_Y0, sx + S - 1, Z9F_Y1], fill=(255, 255, 255))
# Same with warm color
Z9F2_Y0, Z9F2_Y1 = p(3193), p(3199)
for sx in range(0, W, S * 2):
    draw.rectangle([sx, Z9F2_Y0, sx + S - 1, Z9F2_Y1], fill=(255, 160, 80))

# ── Save ─────────────────────────────────────────────────────────────────────
HERE = __import__('os').path.dirname(__import__('os').path.abspath(__file__))
ROOT = __import__('os').path.dirname(HERE)
out = __import__('os').path.join(ROOT, 'IMG_5774_2x.PNG')
img.save(out)
print(f'Saved {out}  {img.size}')
