"""
Focused follow-up optimizer (round 2): fix the user-reported defects without
regressing what already worked.

Round 1 (optimize_hal.py, best_params.json v1) was visually good EXCEPT:
  1. purple got ~zero emission (symmetric bB formula bug -- now fixed in
     halmodel.emit_rule via asymmetric `R + aG*G - bB*max(B-R,0)`)
  2. saturated colors (esp. red) self-flood/bleed onto their own flat interiors
     (red -> orange via green channel), measured up to +0.30 delta
  3. gray80 / cool bar halation slightly under-strength

Round 1's full 8-param re-run with FLOOD_W=1.5 fixed (2) almost perfectly but
overshot: it drove gainG -> 0.0 (killing the soft red-orange halo character
entirely -- a regression) and weakened edge-halo strength broadly (red edge
0.449->0.332 vs Dehancer 0.478; powL pinned at its upper bound 6.0).

This round: keep the well-fit STRUCTURAL params (powL, aG, bB, sigmas) fixed at
the original committed values (which gave a good edge/profile match -- only the
formula asymmetry needed fixing, not these constants), and search only the
4 params that trade off halo strength/color vs flooding: kW, kC, gainR, gainG.
Loss = original dense "glance" loss + a MODERATELY weighted flood guard (down
from 1.5 to 0.6) so flood-reduction doesn't dominate and crush gainG to zero.
"""
import os, sys, json, time
import numpy as np
from scipy.optimize import minimize
import halmodel as H
import optimize_hal as OH

OUT = OH.OUT
with open(os.path.join(OUT, 'best_params.json')) as f:
    BP_V1 = json.load(f)   # NOTE: this is now the v2-collapsed params from the last run

# Start from the ORIGINAL committed values (good edge match, pre-flood-guard run).
# These were: powL=3.9247 kW=1.0028 kC=0.8860 aG=0.1972 bB=0.9691
#             gainR=1.2380 gainG=0.0958 sigmaR=15.0467 (2x)
FIXED = dict(powL=3.9247, aG=0.1972, bB=0.9691,
             sigmaR=15.0467, sigmaG=15.0467*0.5, sigmaB=15.0467*0.15, gainB=0.0)

PNAMES = ['kW', 'kC', 'gainR', 'gainG']
BOUNDS = {'kW': (0.3, 1.6), 'kC': (0.2, 1.4), 'gainR': (0.6, 2.5), 'gainG': (0.0, 0.20)}
X0 = [1.0028, 0.8860, 1.2380, 0.0958]   # original committed values

FLOOD_W = 0.6   # down from 1.5 -- balance flood-reduction against halo presence


def vec_to_p(x):
    d = dict(FIXED)
    for n, v in zip(PNAMES, x):
        lo, hi = BOUNDS[n]
        d[n] = float(np.clip(v, lo, hi))
    return d


def loss(x, verbose=False):
    p = vec_to_p(x)
    total, wsum, parts = 0.0, 0.0, {}
    flood, fn = 0.0, 0
    for b in OH._BANDS:
        ours = OH.render_band_rule(p, b)
        l1 = OH.wl1(OH.squint(ours), b)
        parts[b['name']] = l1
        total += b['w']*l1
        wsum += b['w']
        for (y, x_, name) in OH._GUARD.get(b['name'], []):
            key = (b['name'], name)
            if key in OH._GUARD_TARGETS:
                ry, rx, deh_val = OH._GUARD_TARGETS[key]
                flood += float(np.abs(ours[ry, rx] - deh_val).sum())
                fn += 1
    flood /= max(fn, 1)
    val = total/wsum + FLOOD_W*flood
    if verbose:
        print("  loss=%.5f  " % val +
              "  ".join(f"{k}={v:.4f}" for k, v in parts.items()) +
              f"  flood={flood:.4f}")
    return val


def main():
    t0 = time.time()
    print("Start X0 (= original committed params):")
    loss(X0, verbose=True)
    res = minimize(loss, X0, method='Nelder-Mead',
                   options=dict(xatol=1e-3, fatol=1e-5, maxiter=400))
    p = vec_to_p(res.x)
    print(f"\n=== BEST loss={res.fun:.5f}  ({time.time()-t0:.1f}s) ===")
    loss(res.x, verbose=True)
    full = dict(FIXED)
    full.update(p)
    for n in ['powL','kW','kC','aG','bB','gainR','gainG','sigmaR','sigmaG','sigmaB','gainB']:
        print(f"    {n:7s}= {full[n]:.4f}")
    with open(os.path.join(OUT, 'best_params_r2.json'), 'w') as f:
        json.dump(full, f, indent=2)
    import render_chart as RC
    RC.make_comparison(lambda src: H.render_rule(src, full), 'rule_r2')
    print("Saved best_params_r2.json + cmp_rule_r2_*.png")


if __name__ == '__main__':
    main()
