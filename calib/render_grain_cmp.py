"""Render grain-test-2x.png through the v3 model at Dehancer's amounts and
build side-by-side (ours | Dehancer) strips for a glance comparison —
the halation session's "render and look FIRST" discipline, applied to grain.

Usage: python calib/render_grain_cmp.py
"""
import os, json
import numpy as np
from PIL import Image

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sys; sys.path.insert(0, 'calib')
from grainmodel import apply_grain_v3

P = json.load(open('calib/grain_params.json'))
AMOUNTS = [10, 30, 60, 100]

# crop bands taken straight from calib/grain_chart_geo.txt (actual chart geometry)
BANDS = [
    ('matrix_top',     100, 110,  4290, 770),    # matrix rows R,G,B,C (luma cols 0-1)
    ('profile_blocks', 100, 1950, 4700, 2200),   # Shadow10..PureB flat blocks
    ('chroma_ramps',     0, 2220, 4800, 2600),   # R/G/B exposure gradients
]
MARGIN = 60  # context for grain-field continuity (grain is per-pixel, not blurred, but keep consistent w/ halation pattern)


def side_by_side(ours, deh, scale=0.5):
    h = ours.shape[0]
    sep = np.ones((h, 10, 3), dtype=np.float32)
    combo = np.concatenate([ours, sep, deh], axis=1)
    img = Image.fromarray((np.clip(combo, 0, 1) * 255).astype(np.uint8))
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img


def load_crop(path, x0, y0, x1, y1):
    return np.array(Image.open(path).crop((x0, y0, x1, y1)).convert('RGB'), dtype=np.float32) / 255.0


CHART_PATH = 'grain-test-2x.png'
for name, x0, y0, x1, y1 in BANDS:
    src = load_crop(CHART_PATH, x0, y0, x1, y1)   # only the crop -- cheap
    for a in AMOUNTS:
        ours = apply_grain_v3(src.copy(), a / 100.0, P, seed=7.0)
        deh = load_crop(f'dehancer-{a} grain.JPG', x0, y0, x1, y1)
        img = side_by_side(ours, deh)
        out = f'calib/cmp_grain_{name}_a{a}.png'
        img.save(out)
        print(f'wrote {out}  ({img.width}x{img.height})')
