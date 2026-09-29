"""
Fit the v2 per-channel signal-dependent grain model
(sigma_c = k_c * amount_norm^powA * value_c^powG) to calib/grain_targets.json
(measure_grain.py output) — entirely analytic, zero render cost per eval
(mirrors the halation optimizer's "zero Claude-token cost" discipline).

Fits {kR,kG,kB,powG,powA} against every (zone, channel, amount>0) sample from
the profile blocks AND the color matrix jointly — so the response curve across
the full 0-100 amount range is captured, not just one point.

grSz (grain size) is fit separately/afterward against the measured ~2px
autocorrelation half-width (size is amount/value independent).

Run: python calib/optimize_grain.py   (seconds — analytic, no images rendered)
"""
import json
import numpy as np
from scipy.optimize import minimize
from grainmodel import predict_sigma_v3, PROF, HUES, LUMA_STEPS

T = json.load(open('calib/grain_targets.json'))
AMOUNTS = T['amounts']

# ── build (value, amount_norm, observed_sigma) sample list ───────────────────
samples = []  # (value01 [r,g,b], amount_norm, observed_sigma [r,g,b])
for name, d in T['profile'].items():
    rgb01 = np.array(d['rgb']) / 255.0
    for ai, a in enumerate(AMOUNTS):
        if a == 0:
            continue
        samples.append((rgb01, a / 100.0, np.array(d['sigma_added'][ai])))

for hname in HUES:
    for L in LUMA_STEPS:
        cell = T['matrix'][hname][str(L)]
        base0 = np.array(cell['0'])
        # nominal cell color = hue anchor * L; recover approx value01 from data
        # (use the amount=0 cell's own RGB isn't stored — reconstruct from HUES)
        pass

# matrix nominal colors (mirror gen_grain_chart.py HUES anchors)
HUE_RGB = {
    'R': (255, 0, 0), 'G': (0, 255, 0), 'B': (0, 0, 255),
    'C': (0, 255, 255), 'M': (255, 0, 255), 'Y': (255, 255, 0),
    'SkinLt': (255, 214, 190), 'SkinMid': (224, 172, 138), 'SkinDk': (140, 96, 74),
    'Gray18': (118, 118, 118), 'Cine25': (143, 143, 143), 'Cine75': (221, 221, 221),
}
for hname in HUES:
    anchor = np.array(HUE_RGB[hname]) / 255.0
    for L in LUMA_STEPS:
        if L == 0:
            continue
        rgb01 = anchor * L
        cell = T['matrix'][hname][str(L)]
        base_sigma = np.array(cell['0'])
        for a in AMOUNTS:
            if a == 0:
                continue
            sig = np.array(cell[str(a)])
            added = np.sqrt(np.maximum(sig**2 - base_sigma**2, 0.0))
            samples.append((rgb01, a / 100.0, added))

print(f'Fitting against {len(samples)} (zone,amount) samples '
      f'({len(samples)*3} per-channel sigma points)')


def loss(x):
    kR, kG, kB, powG, powL, powA, wL = x
    if not (0.0 <= wL <= 1.0):
        return 1e6
    p = {'kR': kR, 'kG': kG, 'kB': kB, 'powG': powG, 'powL': powL,
         'powA': powA, 'wL': wL}
    err = 0.0
    n = 0
    for value01, a, observed in samples:
        pred = predict_sigma_v3(value01, a, p)
        # weight by observed magnitude so the (more visible) high-amount /
        # high-signal samples drive the fit, like halation's edge/gap weighting
        w = 1.0 + observed
        err += np.sum(w * (pred - observed) ** 2)
        n += 3
    return err / n


x0 = [0.30, 0.30, 0.20, 0.5, 1.5, 0.75, 0.4]
res = minimize(loss, x0, method='Nelder-Mead',
               options={'xatol': 1e-6, 'fatol': 1e-8, 'maxiter': 8000})
kR, kG, kB, powG, powL, powA, wL = res.x
print(f'\nFit result (loss={res.fun:.5f}):')
print(f'  kR={kR:.4f}  kG={kG:.4f}  kB={kB:.4f}  powG={powG:.4f}  powL={powL:.4f}'
      f'  powA={powA:.4f}  wL={wL:.4f}')

# ── grain size: fit grSz so v2's autocorr half-width matches ~2px target ─────
from grainmodel import apply_grain_v3, autocorr_halfwidth, synth_patch

target_hw = np.mean(T['size']['Gray50'][1:])  # amounts>0 (amount=0 has no grain)
print(f'\nTarget autocorr half-width (amount>0 mean): {target_hw:.2f}px')


def hw_loss(grSz):
    grSz = float(grSz[0])
    if grSz <= 0:
        return 1e6
    p = {'kR': kR, 'kG': kG, 'kB': kB, 'powG': powG, 'powL': powL,
         'powA': powA, 'wL': wL, 'grSz': grSz}
    patch = synth_patch([0.737, 0.737, 0.737], size=160)
    out = apply_grain_v3(patch, 0.6, p, seed=3.7)
    out8 = (out * 255).astype(np.uint8)
    hw = autocorr_halfwidth(out8, (0, 0, 160, 160), blur=9, max_lag=40)
    return (hw - target_hw) ** 2


sz_res = minimize(hw_loss, [0.01], method='Nelder-Mead',
                  options={'xatol': 1e-5, 'fatol': 1e-6, 'maxiter': 200})
grSz = float(sz_res.x[0])
print(f'Fitted grSz = {grSz:.5f}  (achieved hw_loss={sz_res.fun:.4f})')

params = {'kR': kR, 'kG': kG, 'kB': kB, 'powG': powG, 'powL': powL,
          'powA': powA, 'wL': wL, 'grSz': grSz,
          '_note': 'v3 two-component grain: sigma_c = k_c * amount_norm^powA * '
                   '(wL*lum^powL + (1-wL)*clamp(res,0,1)_c^powG); '
                   'grSz fit to ~2px autocorr half-width on Gray50 @ amount=60'}
with open('calib/grain_params.json', 'w') as f:
    json.dump(params, f, indent=1)
print('\nWrote calib/grain_params.json')
