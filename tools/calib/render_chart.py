"""
Render the halation model on the real chart and build side-by-side comparison
strips against the Dehancer reference.  Left = our render, Right = Dehancer.

Usage:
  python calib/render_chart.py            # current committed model
  (optimize_hal.py imports render_band for the rule-based model)
"""
import os
import numpy as np
from PIL import Image
import halmodel as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'IMG_5774_2x.PNG')
HAL = os.path.join(ROOT, 'dehancer halation x2.png')
OUT = os.path.dirname(os.path.abspath(__file__))

# (name, y0, y1) bands at 2x — the zones where halation is visible
BANDS = [
    ('zone2_bars',   800, 2100),
    ('zone5_colors', 3960, 4760),
    ('zone7_lines',  5180, 5720),
]
MARGIN = 80  # extra rows loaded around each band so blur has context


def load_crop(path, y0, y1):
    return np.array(Image.open(path).crop((0, y0, 4800, y1)).convert('RGB'),
                    dtype=np.float32)/255.0


def render_band(render_fn, y0, y1):
    """Render one band with margins to avoid blur edge artifacts, then trim."""
    ya, yb = max(0, y0-MARGIN), min(6400, y1+MARGIN)
    src = load_crop(BASE, ya, yb)
    out = render_fn(src)
    top = y0-ya
    return out[top:top+(y1-y0)]


def side_by_side(ours, deh, scale=0.5):
    """Stack ours|deh horizontally, downscaled for a glance view."""
    h = ours.shape[0]
    sep = np.ones((h, 12, 3), dtype=np.float32)
    combo = np.concatenate([ours, sep, deh], axis=1)
    img = Image.fromarray((np.clip(combo, 0, 1)*255).astype(np.uint8))
    if scale != 1.0:
        img = img.resize((int(img.width*scale), int(img.height*scale)),
                         Image.LANCZOS)
    return img


def make_comparison(render_fn, tag='current'):
    strips = []
    for name, y0, y1 in BANDS:
        ours = render_band(render_fn, y0, y1)
        deh = load_crop(HAL, y0, y1)
        img = side_by_side(ours, deh)
        path = os.path.join(OUT, f'cmp_{tag}_{name}.png')
        img.save(path)
        strips.append((name, img))
        print(f"  wrote {path}  ({img.width}x{img.height})")
    # Stacked overview
    w = max(s.width for _, s in strips)
    gap = 16
    total_h = sum(s.height for _, s in strips) + gap*(len(strips)-1)
    canvas = Image.new('RGB', (w, total_h), (40, 40, 40))
    y = 0
    for _, s in strips:
        canvas.paste(s, (0, y))
        y += s.height + gap
    overview = os.path.join(OUT, f'cmp_{tag}_OVERVIEW.png')
    canvas.save(overview)
    print(f"  wrote {overview}  (LEFT=ours  RIGHT=Dehancer)")
    return overview


if __name__ == '__main__':
    print("Rendering CURRENT committed model vs Dehancer...")
    make_comparison(H.render_current, 'current')
