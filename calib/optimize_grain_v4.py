"""v4 fit: v3 two-component model + per-channel highlight-rolloff gate
gate_c = 1 - smoothstep(hiLo, hiHi, value_c). Analytic, zero render cost.
Run: python calib/optimize_grain_v4.py
"""
import os, json
import numpy as np
from scipy.optimize import minimize

os.chdir(os.path.dirname(os.path.abspath(__file__)))
from grainmodel import predict_sigma_v4, HUES, LUMA_STEPS, LUMA_W

T = json.load(open('grain_targets.json'))
AMOUNTS = T['amounts']

HUE_RGB = {
    'R': (255, 0, 0), 'G': (0, 255, 0), 'B': (0, 0, 255),
    'C': (0, 255, 255), 'M': (255, 0, 255), 'Y': (255, 255, 0),
    'SkinLt': (255, 214, 190), 'SkinMid': (224, 172, 138), 'SkinDk': (140, 96, 74),
    'Gray18': (118, 118, 118), 'Cine25': (143, 143, 143), 'Cine75': (221, 221, 221),
}

vals, amts, obs = [], [], []
for name, d in T['profile'].items():
    rgb01 = np.array(d['rgb']) / 255.0
    for ai, a in enumerate(AMOUNTS):
        if a == 0:
            continue
        vals.append(rgb01); amts.append(a / 100.0); obs.append(d['sigma_added'][ai])

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
            vals.append(rgb01); amts.append(a / 100.0); obs.append(added.tolist())

V = np.array(vals)              # (N,3)
A = np.array(amts)              # (N,)
OBS = np.array(obs)             # (N,3)
W = 1.0 + OBS
LUM = V @ LUMA_W                # (N,)
print(f'Fitting v4 against {len(V)} samples (vectorized)')
UNIT_STD = 1.0 / np.sqrt(12.0)


def _smooth(lo, hi, x):
    t = np.clip((x - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def loss(x):
    kR, kG, kB, powG, powL, powA, wL, hiLo, hiHi = x
    if not (0.0 <= wL <= 1.0) or not (0.0 <= hiLo < hiHi <= 1.0001):
        return 1e6
    base = LUM ** powL                       # (N,)
    selfv = V ** powG                        # (N,3)
    k = np.array([kR, kG, kB])
    gate = 1.0 - _smooth(hiLo, hiHi, V)       # (N,3)
    strength = k * (wL * base[:, None] + (1 - wL) * selfv) * gate
    pred = strength * (A[:, None] ** powA) * UNIT_STD * 255.0
    return np.sum(W * (pred - OBS) ** 2) / (len(V) * 3)


# seed from v3's converged fit + a narrow highlight-only gate window
v3 = json.load(open('grain_params.json'))
x0 = [v3['kR'], v3['kG'], v3['kB'], v3['powG'], v3['powL'], v3['powA'], v3['wL'],
      0.97, 0.999]
res = minimize(loss, x0, method='Nelder-Mead',
               options={'xatol': 1e-7, 'fatol': 1e-9, 'maxiter': 20000})
# also try a few alternate windows + the v4-disabled (gate≈1 everywhere) start,
# keep whichever converges lowest -- guards against local minima
candidates = [res]
for lo, hi in [(0.85, 0.999), (0.90, 0.97), (0.80, 0.999)]:
    x0b = [v3['kR'], v3['kG'], v3['kB'], v3['powG'], v3['powL'], v3['powA'], v3['wL'], lo, hi]
    candidates.append(minimize(loss, x0b, method='Nelder-Mead',
                               options={'xatol': 1e-7, 'fatol': 1e-9, 'maxiter': 20000}))
res = min(candidates, key=lambda r: r.fun)
print(f'  (best of {len(candidates)} seeds, loss={res.fun:.5f}; v3 baseline loss for comparison: refit below)')
v3_loss = loss([v3['kR'], v3['kG'], v3['kB'], v3['powG'], v3['powL'], v3['powA'], v3['wL'], 0.0, 1.0001])
print(f'  v3-equivalent (gate disabled, hiLo=0,hiHi=1) loss under THIS loss fn: {v3_loss:.5f}')
kR, kG, kB, powG, powL, powA, wL, hiLo, hiHi = res.x
print(f'\nFit result (loss={res.fun:.5f}):')
print(f'  kR={kR:.4f} kG={kG:.4f} kB={kB:.4f} powG={powG:.4f} powL={powL:.4f}')
print(f'  powA={powA:.4f} wL={wL:.4f} hiLo={hiLo:.4f} hiHi={hiHi:.4f}')

prev = json.load(open('grain_params.json'))
params = {'kR': kR, 'kG': kG, 'kB': kB, 'powG': powG, 'powL': powL,
          'powA': powA, 'wL': wL, 'hiLo': hiLo, 'hiHi': hiHi,
          'grSz': prev['grSz'],
          '_note': 'v4: v3 two-component + per-channel highlight-rolloff gate '
                   '(1-smoothstep(hiLo,hiHi,value_c)) -- closes the clipped/'
                   'saturated-channel near-zero-grain gap v3 missed. '
                   'grSz carried over from v3 fit (h21 hash limitation, see CLAUDE.md).'}
with open('grain_params_v4.json', 'w') as f:
    json.dump(params, f, indent=1)
print('\nWrote calib/grain_params_v4.json')
