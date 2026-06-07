"""
Autonomous halation optimizer.

Because IMG_5774_2x.PNG == dehancer base x2.PNG (verified pixel-identical), we can
optimize our render DIRECTLY against `dehancer halation x2.png`.

Objective = region-weighted, "squinted" (downsampled) L1 between our render and the
Dehancer halation reference, summed over representative zone bands (neutrals, colors,
thin lines).  Everything runs in one process with scipy — no Claude tokens per eval.

Run:
  python calib/optimize_hal.py            # full optimize, writes cmp_rule_*.png + best params
  python calib/optimize_hal.py --eval     # just evaluate the current best guess + render
"""
import os, sys, json, time
import numpy as np
from PIL import Image
from scipy.optimize import minimize
import halmodel as H
import render_chart as RC

ROOT = RC.ROOT
BASE = RC.BASE
HAL = RC.HAL
OUT = RC.OUT
MARGIN = 80

# Bands to optimize over (2x coords): (name, y0, y1, band_weight, x0, x1).
# x-range crops to the CONTENT so the large black background doesn't dilute the loss.
BANDS = [
    ('zone2_bars',   800, 2100, 1.0, 2300, 4800),   # bars are right half
    ('zone5_colors', 3960, 4760, 1.3,  250, 4550),   # color matrix columns
    ('zone7_lines',  5180, 5720, 1.0,    0, 4800),   # full-width thin lines
]

SQUINT = 4   # downsample factor for the "glance" loss
HALO_W = 8.0  # upweight pixels where Dehancer actually has halation (vs base)


def load_crop(path, y0, y1, x0=0, x1=4800):
    return np.array(Image.open(path).crop((x0, y0, x1, y1)).convert('RGB'),
                    dtype=np.float32)/255.0


def px(v): return int(round(v*2))

# ── Anti-flood / presence guard ─────────────────────────────────────────────
# Sample BLOCK/BAR INTERIORS (40+px from any edge) and penalize deviation from
# Dehancer. This is the same class of guard that caught the gray pink-flooding
# defect, generalized to saturated-color blocks: it catches BOTH under-emission
# (e.g. purple/cool measured far too weak -- the model's old symmetric blue-
# suppression nearly zeroed purple's emission) AND over-emission/self-flooding
# (e.g. a large flat saturated-red block glowing onto itself, shifting its hue
# toward orange via the green-tinted glow -- invisible to the dense "glance" loss
# because its squint+wmap weighting emphasizes edges/gradients, not flat fields).
ZONE5_ROW_Y = px(2010)                         # 100% brightness row, top edge (2x)
ZONE5_COL_X = [ci*300+150 for ci in range(8)]  # 1x cell centers
ZONE5_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'white']
GUARD_IX = 3600
_GUARD = {
    'zone2_bars': [(1093, GUARD_IX, 'gray80'), (1833, GUARD_IX, 'warm'),
                   (1993, GUARD_IX, 'cool'), (900, GUARD_IX, 'white100')],
    'zone5_colors': [(ZONE5_ROW_Y+60, px(cx), name)
                     for cx, name in zip(ZONE5_COL_X, ZONE5_NAMES)],
}
FLOOD_W = 1.5


def squint(img):
    """Downsample in sRGB to model 'can't tell at a glance' (low-freq match)."""
    im = Image.fromarray((np.clip(img, 0, 1)*255).astype(np.uint8))
    im = im.resize((max(1, im.width//SQUINT), max(1, im.height//SQUINT)),
                   Image.BOX)
    return np.asarray(im, dtype=np.float32)/255.0


# Preload band data once (base-with-margin, dehancer target squinted, weight map)
_BANDS = []
for name, y0, y1, w, x0, x1 in BANDS:
    ya, yb = max(0, y0-MARGIN), min(6400, y1+MARGIN)
    base_m = load_crop(BASE, ya, yb, x0, x1)
    base = load_crop(BASE, y0, y1, x0, x1)
    deh = load_crop(HAL, y0, y1, x0, x1)
    deh_sq = squint(deh)
    base_sq = squint(base)
    # weight: 1 everywhere (catches flooding) + extra where Dehancer halates
    wmap = 1.0 + HALO_W*np.abs(deh_sq - base_sq).mean(-1, keepdims=True)
    _BANDS.append(dict(name=name, y0=y0, y1=y1, x0=x0, x1=x1, w=w, top=y0-ya,
                       base_m=base_m, deh_sq=deh_sq, wmap=wmap, deh_full=deh))

# Precompute Dehancer guard targets (full-res) at each interior sample point,
# in band-relative coords (so we can read off the already-rendered band output).
_GUARD_TARGETS = {}
for b in _BANDS:
    for (y, x, name) in _GUARD.get(b['name'], []):
        ry, rx = y - b['y0'], x - b['x0']
        if 0 <= ry < b['deh_full'].shape[0] and 0 <= rx < b['deh_full'].shape[1]:
            _GUARD_TARGETS[(b['name'], name)] = (ry, rx, b['deh_full'][ry, rx].copy())


# Parameter vector <-> dict.  x = [powL,kW,kC,aG,bB,gainR,gainG,sigmaR]
PNAMES = ['powL', 'kW', 'kC', 'aG', 'bB', 'gainR', 'gainG', 'sigmaR']
BOUNDS = {
    'powL': (1.0, 6.0), 'kW': (0.0, 2.0), 'kC': (0.0, 4.0), 'aG': (0.0, 1.5),
    'bB': (0.0, 1.2), 'gainR': (0.2, 4.0), 'gainG': (0.0, 1.5), 'sigmaR': (6.0, 45.0),
}


def vec_to_p(x):
    d = {}
    for n, v in zip(PNAMES, x):
        lo, hi = BOUNDS[n]
        d[n] = float(np.clip(v, lo, hi))
    # derived
    d['gainB'] = 0.0
    d['sigmaG'] = d['sigmaR']*0.5
    d['sigmaB'] = d['sigmaR']*0.15
    return d


def render_band_rule(p, b):
    lin = H.s2l(b['base_m'])
    e = H.emit_rule(lin, p['powL'], p['kW'], p['kC'], p['aG'], p['bB'])
    out = H.apply_halation(b['base_m'], e, p['gainR'], p['gainG'], p['gainB'],
                           p['sigmaR'], p['sigmaG'], p['sigmaB'])
    return out[b['top']:b['top']+(b['y1']-b['y0'])]


def wl1(ours_sq, b):
    err = np.abs(ours_sq - b['deh_sq']).mean(-1, keepdims=True)
    return float((b['wmap']*err).sum() / b['wmap'].sum())


def loss(x, verbose=False):
    p = vec_to_p(x)
    total, wsum, parts = 0.0, 0.0, {}
    flood, fn = 0.0, 0
    for b in _BANDS:
        ours = render_band_rule(p, b)
        l1 = wl1(squint(ours), b)
        parts[b['name']] = l1
        total += b['w']*l1
        wsum += b['w']
        for (y, x_, name) in _GUARD.get(b['name'], []):
            key = (b['name'], name)
            if key in _GUARD_TARGETS:
                ry, rx, deh_val = _GUARD_TARGETS[key]
                flood += float(np.abs(ours[ry, rx] - deh_val).sum())
                fn += 1
    flood /= max(fn, 1)
    val = total/wsum + FLOOD_W*flood
    if verbose:
        print("  loss=%.5f  " % val +
              "  ".join(f"{k}={v:.4f}" for k, v in parts.items()) +
              f"  flood={flood:.4f}")
    return val


# Reasonable starting point from manual tests (red-orange halo, pow curve).
X0 = [3.0, 0.6, 1.4, 0.5, 0.6, 1.4, 0.3, 16.0]


def baseline_current_loss():
    """Loss of the current committed model, for reference."""
    total, wsum = 0.0, 0.0
    for b in _BANDS:
        lin = H.s2l(b['base_m'])
        e = H.emit_current(lin)
        out = H.apply_halation(b['base_m'], e, **H.CURRENT)
        out = out[b['top']:b['top']+(b['y1']-b['y0'])]
        l1 = wl1(squint(out), b)
        total += b['w']*l1
        wsum += b['w']
    return total/wsum


def main():
    t0 = time.time()
    print("Baseline (current committed) loss = %.5f" % baseline_current_loss())
    print("Start X0 loss:")
    loss(X0, verbose=True)

    best = None
    starts = [X0,
              [4.0, 0.4, 2.0, 0.4, 0.5, 1.2, 0.25, 22.0],
              [2.5, 0.8, 1.0, 0.6, 0.7, 1.8, 0.4, 12.0]]
    for i, s in enumerate(starts):
        res = minimize(loss, s, method='Nelder-Mead',
                       options=dict(xatol=1e-3, fatol=1e-5, maxiter=1200))
        print(f"  start {i}: loss={res.fun:.5f}")
        if best is None or res.fun < best.fun:
            best = res
    p = vec_to_p(best.x)
    print("\n=== BEST loss=%.5f  (%.1fs) ===" % (best.fun, time.time()-t0))
    print("  final loss breakdown:")
    loss(best.x, verbose=True)
    for n in PNAMES:
        print(f"    {n:7s}= {p[n]:.4f}")
    print(f"    (derived) gainG/gainR={p['gainG']/p['gainR']:.3f}  "
          f"sigmaG={p['sigmaG']:.2f} sigmaB={p['sigmaB']:.2f}")

    # Save params + render comparison strips
    with open(os.path.join(OUT, 'best_params.json'), 'w') as f:
        json.dump(p, f, indent=2)
    RC.make_comparison(lambda src: H.render_rule(src, p), 'rule')
    print("Saved best_params.json + cmp_rule_*.png")


if __name__ == '__main__':
    if '--eval' in sys.argv:
        print("baseline current loss=%.5f" % baseline_current_loss())
        loss(X0, verbose=True)
        RC.make_comparison(lambda src: H.render_rule(src, vec_to_p(X0)), 'rule')
    else:
        main()
