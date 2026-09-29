"""
Proper Nelder-Mead fit of the ring-kernel RED channel (see experiment_ring_halation.py
for the feasibility check that motivated this). Green/blue stay on the committed
Gaussian model — only red's PSF shape is swapped from Gaussian to the annular
Fresnel/TIR-inspired kernel.

Loss covers what scorecard.py checks so a "closes gray80" win can't come at the
cost of regressing everything else:
  * zone2 gap R: white100, gray80, warm, cool  (want each close to Dehancer)
  * zone5 gap R: all 8 colour blocks
  * zone7 thin-line R at d=10: white, warm, cool, red
Free params: r_c, d, L, a, gain_mult (multiplies the committed gainR).//
"""
import os
import numpy as np
from PIL import Image
from scipy.optimize import minimize
import halmodel as H
import scorecard as SC
from experiment_ring_halation import ring_kernel, apply_halation_ring_red, BASE, HAL, load

ROOT = os.path.dirname(os.path.abspath(__file__))
P = dict(SC.P)

Z2 = [('white100', 840), ('gray80', 1020), ('warm', 1760), ('cool', 1920)]
Z5X = [ci * 300 + 150 for ci in range(8)]  # already 2x coords
Z5N = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'white']
Z5Y = 2010 * 2  # 2x coord, matches scorecard.py's px(2010)
Z7 = [('white', 5240), ('warm', 5360), ('cool', 5480), ('red', 5600)]

CROPS = {'z2': (700, 2200), 'z5': (Z5Y - 170, Z5Y + 230), 'z7': (5180, 5720)}


# Speed: z2/z7 only ever sample sx=3600, so crop the x-range down to a window
# around it (with margin for the convolution kernel radius) instead of the full
# 4800px width. z5 samples span most of the width, so it stays full-width but is
# already a short (400-row) crop.
XWIN = (3200, 4000)
XOFF = XWIN[0]


def load_all():
    d = {}
    for k, (y0, y1) in CROPS.items():
        base = load(BASE, y0, y1)
        deh = load(HAL, y0, y1)
        if k in ('z2', 'z7'):
            base = base[:, XWIN[0]:XWIN[1]]
            deh = deh[:, XWIN[0]:XWIN[1]]
        d[k] = (base, deh, y0)
    return d


DATA = load_all()


def render_ring(base, ring_p, gain_mult):
    lin = H.s2l(base)
    e = SC.emit(lin, P, asymmetric=True)
    return apply_halation_ring_red(base, e, ring_p, P['gainR'] * gain_mult,
                                    P['gainG'], P['gainB'], P['sigmaG'], P['sigmaB'])


def loss(x):
    r_c, d, L, a, gain_mult = x
    if r_c <= 1 or d <= 0.5 or L <= 0.5 or not (0 <= a <= 1) or gain_mult <= 0:
        return 1e6
    ring_p = dict(r_c=r_c, d=d, L=L, a=a)

    base2, deh2, y2 = DATA['z2']
    base5, deh5, y5 = DATA['z5']
    base7, deh7, y7 = DATA['z7']
    o2 = render_ring(base2, ring_p, gain_mult)
    o5 = render_ring(base5, ring_p, gain_mult)
    o7 = render_ring(base7, ring_p, gain_mult)

    sx_local = 3600 - XOFF
    err = 0.0
    for nm, yt in Z2:
        g = yt - 15 - y2
        err += (o2[g, sx_local, 0] - deh2[g, sx_local, 0]) ** 2
    for cx, nm in zip(Z5X, Z5N):
        sx = int(round(cx * 2))
        g = Z5Y - 15 - y5
        err += (o5[g, sx, 0] - deh5[g, sx, 0]) ** 2
    for nm, yl in Z7:
        s = yl - 10 - y7
        err += 0.5 * (o7[s, sx_local, 0] - deh7[s, sx_local, 0]) ** 2
    return err


if __name__ == '__main__':
    sigmaR = P['sigmaR']
    x0 = np.array([sigmaR * 3.0, sigmaR * 0.5, sigmaR * 1.5, 0.65, 0.6])
    print(f"start loss={loss(x0):.5f}  x0={x0}")
    res = minimize(loss, x0, method='Nelder-Mead',
                    options=dict(maxiter=150, xatol=1e-2, fatol=1e-5, adaptive=True))
    r_c, d, L, a, gain_mult = res.x
    print(f"\nfit loss={res.fun:.5f}  r_c={r_c:.3f} d={d:.3f} L={L:.3f} a={a:.3f} gain_mult={gain_mult:.3f}")
    print(f"(sigmaR reference = {sigmaR:.3f})")

    import json
    with open(os.path.join(ROOT, 'ring_halation_fit.json'), 'w') as f:
        json.dump(dict(r_c=r_c, d=d, L=L, a=a, gain_mult=gain_mult, loss=res.fun), f, indent=2)
    print("saved calib/ring_halation_fit.json")
