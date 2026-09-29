"""
Renders side-by-side comparison strips (ours-Gaussian | ours-Ring | Dehancer) for
zone2 (gap bars) and zone5 (colour blocks), plus a scorecard-style table for both
models, using the fitted ring params from calib/ring_halation_fit.json.

Run AFTER optimize_ring_halation.py has produced ring_halation_fit.json.
"""
import os
import json
import numpy as np
from PIL import Image
import halmodel as H
import scorecard as SC
from experiment_ring_halation import apply_halation_ring_red, BASE, HAL, load

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'ring_comparison')
os.makedirs(OUT, exist_ok=True)

P = dict(SC.P)
with open(os.path.join(ROOT, 'ring_halation_fit.json')) as f:
    FIT = json.load(f)
RING_P = dict(r_c=FIT['r_c'], d=FIT['d'], L=FIT['L'], a=FIT['a'])
GAIN_MULT = FIT['gain_mult']


def render_gauss(base):
    return SC.render(base, P, asymmetric=True, highpass=True)


def render_ring(base):
    lin = H.s2l(base)
    e = SC.emit(lin, P, asymmetric=True)
    return apply_halation_ring_red(base, e, RING_P, P['gainR'] * GAIN_MULT,
                                    P['gainG'], P['gainB'], P['sigmaG'], P['sigmaB'])


def to_img(arr):
    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))


def strip(base, deh, gauss, ring, y0, y1, label):
    """Stack [base | Dehancer | Gaussian(ours) | Ring(ours)] vertically-labeled crops."""
    imgs = [to_img(x) for x in (base, deh, gauss, ring)]
    w, h = imgs[0].size
    pad = 40
    canvas = Image.new('RGB', (w, h * 4 + pad * 3), (20, 20, 20))
    y = 0
    for im in imgs:
        canvas.paste(im, (0, y))
        y += h + pad
    canvas.save(os.path.join(OUT, f'{label}.png'))
    print(f"wrote {label}.png  ({canvas.size})")


def run_crop(y0, y1, label):
    base = load(BASE, y0, y1)
    deh = load(HAL, y0, y1)
    gauss = render_gauss(base)
    ring = render_ring(base)
    strip(base, deh, gauss, ring, y0, y1, label)
    return base, deh, gauss, ring, y0


def score_row(name, o, deh, y_crop, yt, sx=3600):
    g = yt - 15 - y_crop
    return o[g, sx, 0], deh[g, sx, 0]


if __name__ == '__main__':
    print(f"Using fitted ring params: {RING_P}  gain_mult={GAIN_MULT:.3f}\n")

    Z5Y_2x = 2010 * 2
    b2, d2, g2, r2, y2 = run_crop(700, 2200, 'zone2_bars')
    b5, d5, g5, r5, y5 = run_crop(Z5Y_2x - 170, Z5Y_2x + 230, 'zone5_colors')
    b7, d7, g7, r7, y7 = run_crop(5180, 5720, 'zone7_lines')

    print("\n== ZONE2 gap R:  ours-Gaussian | ours-Ring | Dehancer ==")
    for nm, yt in [('white100', 840), ('gray80', 1020), ('warm', 1760), ('cool', 1920)]:
        gG, dG = score_row(nm, g2, d2, y2, yt)
        gR, _ = score_row(nm, r2, d2, y2, yt)
        print(f"  {nm:9s}  gauss {gG:.3f}  ring {gR:.3f}  dehancer {dG:.3f}")

    print("\n== ZONE5 gap R per colour: ours-Gaussian | ours-Ring | Dehancer ==")
    Z5X = [ci * 300 + 150 for ci in range(8)]
    Z5N = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'white']
    for cx, nm in zip(Z5X, Z5N):
        sx = int(round(cx * 2))
        g = Z5Y_2x - 15 - y5
        gG, dG = g5[g, sx, 0], d5[g, sx, 0]
        gR = r5[g, sx, 0]
        print(f"  {nm:7s}  gauss {gG:.3f}  ring {gR:.3f}  dehancer {dG:.3f}")

    print(f"\nWrote comparison strips to calib/ring_comparison/")
