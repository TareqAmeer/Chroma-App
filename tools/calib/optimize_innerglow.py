"""
Focused, fast optimizer for the inner-glow component (3 params only).

Base halation params are FIXED at the previously-optimized best_params.json
(loss 0.02393, validated visually). We only search sigmaIn, gainRIn, gainGIn
to add the narrow warm "inner glow" cue Dehancer shows at bright edges
(amber near the edge -> deep red further out; see CLAUDE.md / plan notes).

Objective: match the G/R color-ratio PROFILE across the white-bar bottom edge
(the cleanest, highest-contrast edge in the chart) to the Dehancer reference,
plus the existing dense zone loss (so we don't regress the rest of the chart).

Runs entirely in one process via scipy -- no Claude tokens per evaluation.
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

with open(os.path.join(OUT, 'best_params.json')) as f:
    BP = json.load(f)

def load_crop(path, y0, y1, x0=0, x1=4800):
    return np.array(Image.open(path).crop((x0, y0, x1, y1)).convert('RGB'),
                    dtype=np.float32)/255.0

# Edge-profile crop: white bar bottom edge (2x: bar ends ~y=986), x=3600
EY0, EY1, EX = 900, 1040, 3600
edge_base = load_crop(BASE, EY0, EY1)
edge_deh = load_crop(HAL, EY0, EY1)
PROFILE_YS = list(range(86, 140, 2))  # relative rows spanning the edge+halo

deh_profile = edge_deh[PROFILE_YS, EX]          # Nx3
deh_gr = deh_profile[:, 1] / np.clip(deh_profile[:, 0], 1e-3, None)

# Also reuse the dense zone bands from optimize_hal for a regression guard
import optimize_hal as OH

PNAMES = ['sigmaIn', 'gainRIn', 'gainGIn']
# Tightened: a "tiny" inner glow must stay narrower than the ~34px bar gaps,
# else it bleeds green onto adjacent bar interiors (measured regression: warm
# bar G 0.77->0.88, visibly yellow). Cap sigma well below the gap width.
BOUNDS = {'sigmaIn': (1.0, 4.0), 'gainRIn': (0.05, 1.0), 'gainGIn': (0.02, 0.8)}

# Anti-bleed guard: sample bar INTERIORS (white100, gray80, warm, cool) in the
# 2x chart and penalize any color shift vs Dehancer -- this is what "tiny" means:
# present at the edge, invisible 40+px into a flat region.
INTERIOR_PTS = [(900, 'white100'), (1093, 'gray80'), (1833, 'warm'), (1993, 'cool')]
IX = 3600
_int_base = {name: load_crop(BASE, y, y+1)[0, IX] for y, name in INTERIOR_PTS}
_int_deh = {name: load_crop(HAL, y, y+1)[0, IX] for y, name in INTERIOR_PTS}


def vec_to_p(x):
    d = dict(BP)
    for n, v in zip(PNAMES, x):
        lo, hi = BOUNDS[n]
        d[n] = float(np.clip(v, lo, hi))
    return d


def render_edge(p):
    lin = H.s2l(edge_base)
    e = H.emit_rule(lin, p['powL'], p['kW'], p['kC'], p['aG'], p['bB'])
    return H.apply_halation_2c(edge_base, e, p)


_zone2_band = OH._BANDS[0]   # zone2_bars: covers y in [ya,yb] = [720,2180], x in [2300,4800]
assert _zone2_band['name'] == 'zone2_bars'
_Z2_YA = _zone2_band['y0'] - _zone2_band['top']
_Z2_X0 = _zone2_band['x0']


def bleed_penalty(p):
    """How much does the inner glow shift flat bar-interior colors vs Dehancer?
    'Tiny inner glow' means: visible at edges, ~invisible 40+px into a flat
    region. Render the full zone2_bars band (which contains all 4 interior
    points: white100, gray80, warm, cool) and sample far from any edge."""
    lin = H.s2l(_zone2_band['base_m'])
    e = H.emit_rule(lin, p['powL'], p['kW'], p['kC'], p['aG'], p['bB'])
    out = H.apply_halation_2c(_zone2_band['base_m'], e, p)
    pen = 0.0
    n = 0
    for y, name in INTERIOR_PTS:
        ry, rx = y - _Z2_YA, IX - _Z2_X0
        if not (0 <= ry < out.shape[0] and 0 <= rx < out.shape[1]):
            continue
        ours = out[ry, rx]
        pen += float(np.abs(ours - _int_deh[name]).sum())
        n += 1
    return pen / max(n, 1)


def loss(x, verbose=False):
    p = vec_to_p(x)
    out = render_edge(p)
    prof = out[PROFILE_YS, EX]
    gr = prof[:, 1] / np.clip(prof[:, 0], 1e-3, None)
    profile_err = float(np.abs(gr - deh_gr).mean())
    r_err = float(np.abs(prof[:, 0] - deh_profile[:, 0]).mean())
    bleed = bleed_penalty(p)

    # Regression guard: re-render the 3 dense zone bands with the 2-component model
    dense = 0.0
    for b in OH._BANDS:
        lin = H.s2l(b['base_m'])
        e = H.emit_rule(lin, p['powL'], p['kW'], p['kC'], p['aG'], p['bB'])
        out2 = H.apply_halation_2c(b['base_m'], e, p)
        out2 = out2[b['top']:b['top']+(b['y1']-b['y0'])]
        dense += b['w']*OH.wl1(OH.squint(out2), b)
    dense /= sum(b['w'] for b in OH._BANDS)

    val = 1.0*profile_err + 0.3*r_err + 3.0*bleed + 2.0*dense
    if verbose:
        print(f"  profile_err={profile_err:.4f}  r_err={r_err:.4f}  bleed={bleed:.4f}  dense={dense:.5f}  -> {val:.5f}")
    return val


X0 = [4.0, 0.5, 0.45]


def main():
    t0 = time.time()
    print("Dehancer G/R profile (edge->out):", np.round(deh_gr, 2))
    print("Start X0:"); loss(X0, verbose=True)
    res = minimize(loss, X0, method='Nelder-Mead',
                   options=dict(xatol=1e-3, fatol=1e-5, maxiter=300))
    p = vec_to_p(res.x)
    print(f"\n=== BEST loss={res.fun:.5f} ({time.time()-t0:.1f}s) ===")
    loss(res.x, verbose=True)
    for n in PNAMES:
        print(f"  {n:8s}= {p[n]:.4f}")
    out = render_edge(p)
    prof = out[PROFILE_YS, EX]
    print("Ours G/R profile (tuned):       ", np.round(prof[:, 1]/np.clip(prof[:, 0], 1e-3, None), 2))

    with open(os.path.join(OUT, 'best_params_2c.json'), 'w') as f:
        json.dump(p, f, indent=2)
    RC.make_comparison(lambda src: H.render_rule2(src, p), 'rule2c')
    print("Saved best_params_2c.json + cmp_rule2c_*.png")


if __name__ == '__main__':
    main()
