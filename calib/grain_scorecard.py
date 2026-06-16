"""
Fast PASS/FAIL gate for the fitted grain model vs Dehancer (calib/grain_targets.json).
Mirrors halation's scorecard.py discipline: one human-legible table, computed in
seconds, run BEFORE committing any shader change.

Renders the v2 model on synthetic flat patches at each zone's nominal color (valid
for statistics — grain only depends on local value + amount + noise field, not on
surrounding context) at each Dehancer amount, measures with the identical
noise_std() used on the references, and compares.

Run: python calib/grain_scorecard.py
"""
import json
import os
import numpy as np
from grainmodel import (apply_grain_v3, synth_patch, noise_std, PROF, HUES,
                        LUMA_STEPS)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open('grain_targets.json'))
P = json.load(open('grain_params.json'))
AMOUNTS = [a for a in T['amounts'] if a > 0]
TOL = 0.20  # +/-20% of Dehancer's added-sigma magnitude

HUE_RGB = {
    'R': (255, 0, 0), 'G': (0, 255, 0), 'B': (0, 0, 255),
    'C': (0, 255, 255), 'M': (255, 0, 255), 'Y': (255, 255, 0),
    'SkinLt': (255, 214, 190), 'SkinMid': (224, 172, 138), 'SkinDk': (140, 96, 74),
    'Gray18': (118, 118, 118), 'Cine25': (143, 143, 143), 'Cine75': (221, 221, 221),
}


def ours_sigma(rgb01, amount_pct, seed=11.0):
    patch = synth_patch(rgb01, size=96)
    out = apply_grain_v3(patch, amount_pct / 100.0, P, seed=seed)
    out8 = (out * 255).astype(np.uint8)
    return noise_std(out8, (8, 8, 88, 88), blur=9)


rows = []  # (label, dehancer_sigma[3], ours_sigma[3])

for name, d in T['profile'].items():
    rgb01 = np.array(d['rgb']) / 255.0
    for ai, a in enumerate(T['amounts']):
        if a == 0:
            continue
        deh = np.array(d['sigma_added'][ai])
        ours = ours_sigma(rgb01, a)
        rows.append((f'profile.{name}@{a}', deh, ours))

for hname in ('R', 'G', 'B', 'Gray18', 'SkinMid', 'Cine75'):  # representative subset
    anchor = np.array(HUE_RGB[hname]) / 255.0
    for L in (0.40, 0.70, 1.00):
        rgb01 = anchor * L
        cell = T['matrix'][hname][str(L)]
        base_sigma = np.array(cell['0'])
        for a in AMOUNTS:
            sig = np.array(cell[str(a)])
            deh = np.sqrt(np.maximum(sig**2 - base_sigma**2, 0.0))
            ours = ours_sigma(rgb01, a)
            rows.append((f'matrix.{hname}@L{L:.2f}@{a}', deh, ours))

print(f"{'zone':<26}{'Dehancer σ R/G/B':>22}{'Ours σ R/G/B':>22}{'Δ%':>8}  PASS/FAIL")
n_pass = n_fail = 0
for label, deh, ours in rows:
    mag = max(np.linalg.norm(deh), 1e-6)
    err = np.linalg.norm(ours - deh) / mag
    ok = err <= TOL
    n_pass += ok
    n_fail += not ok
    tag = 'PASS' if ok else 'FAIL'
    print(f"{label:<26}"
          f"  {deh[0]:5.2f}/{deh[1]:5.2f}/{deh[2]:5.2f}"
          f"  {ours[0]:5.2f}/{ours[1]:5.2f}/{ours[2]:5.2f}"
          f"  {err*100:6.1f}%  {tag}")

print(f"\n{n_pass} PASS / {n_fail} FAIL  (tolerance ±{TOL*100:.0f}% of Dehancer Δσ magnitude)")
print(f"Fitted params: kR={P['kR']:.3f} kG={P['kG']:.3f} kB={P['kB']:.3f} "
      f"powG={P['powG']:.3f} powL={P['powL']:.3f} powA={P['powA']:.3f} "
      f"wL={P['wL']:.3f} grSz={P['grSz']:.4f}")
