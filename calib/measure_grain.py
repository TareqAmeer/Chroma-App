"""
Measure Dehancer's grain response from the 5 reference renders
(dehancer-{0,10,30,60,100} grain.JPG, grain Amount slider values) against the
clean grain-test-2x.png chart.

Produces calib/grain_targets.json — the ground-truth dataset optimize_grain.py
fits against — and prints a compact summary table.

Statistical only (grain is stochastic, never pixel-diff): per-zone, per-channel
high-pass residual stddev ("grain strength") + autocorrelation half-width
("grain size"), at each Dehancer amount. Samples flat interiors only.

Run: python calib/measure_grain.py
"""
import json
import numpy as np
from grainmodel import (HUES, LUMA_STEPS, PROF, CHECKER, matrix_cell,
                        profile_block, checker_block, noise_std,
                        autocorr_halfwidth, load)

AMOUNTS = [0, 10, 30, 60, 100]
REFS = {a: f'dehancer-{a} grain.JPG' for a in AMOUNTS}
BASE = 'grain-test-2x.png'

import os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    base = load(BASE)
    refs = {a: load(p) for a, p in REFS.items()}
    target = {'amounts': AMOUNTS, 'profile': {}, 'matrix': {}, 'checker': {},
              'size': {}}

    def degrain(sigma_a, sigma_0):
        """Quadrature-subtract the amount=0 baseline (JPEG/compression noise
        floor) so what remains is Dehancer's actual *added* grain contribution:
        independent noise sources add in variance, sigma_grain = sqrt(a^2-0^2)."""
        return np.sqrt(np.maximum(sigma_a**2 - sigma_0**2, 0.0))

    print(f"\n{'PROFILE BLOCK — Dehancer-ADDED grain σ (R,G,B), baseline-subtracted':<70}")
    print(f"{'zone':<10}" + ''.join(f'{a:>22}' for a in AMOUNTS))
    for name, rgb in PROF:
        rect = profile_block(name)
        sig = {a: noise_std(refs[a], rect) for a in AMOUNTS}
        row = [degrain(sig[a], sig[0]) for a in AMOUNTS]
        target['profile'][name] = {'rgb': rgb, 'sigma_raw': [sig[a].tolist() for a in AMOUNTS],
                                   'sigma_added': [r.tolist() for r in row]}
        print(f"{name:<10}" + ''.join(
            f"  {s[0]:5.3f}/{s[1]:5.3f}/{s[2]:5.3f}" for s in row))

    print(f"\n{'COLOR x LUMINANCE MATRIX — mean ADDED σ (luma-avg per hue, baseline-subtracted)':<70}")
    print(f"{'hue':<10}" + ''.join(f'{a:>22}' for a in AMOUNTS))
    for hname in HUES:
        target['matrix'][hname] = {}
        sig_by_amount = {a: [] for a in AMOUNTS}
        for L in LUMA_STEPS:
            rect = matrix_cell(hname, L)
            target['matrix'][hname][str(L)] = {}
            for a in AMOUNTS:
                s = noise_std(refs[a], rect)
                target['matrix'][hname][str(L)][str(a)] = s.tolist()
                sig_by_amount[a].append(s)
        base_mean = np.mean(sig_by_amount[0], axis=0)
        means_added = {a: degrain(np.mean(sig_by_amount[a], axis=0), base_mean)
                       for a in AMOUNTS}
        print(f"{hname:<10}" + ''.join(
            f"  {means_added[a][0]:5.3f}/{means_added[a][1]:5.3f}/{means_added[a][2]:5.3f}"
            for a in AMOUNTS))

    print(f"\n{'CHECKERBOARD/SPATIAL — diff-from-amount=0 σ luma (pattern-dominated; visual check too)':<70}")
    print(f"{'cell':<10}" + ''.join(f'{a:>14}' for a in AMOUNTS))
    base = load(BASE)
    for size in CHECKER:
        rect = checker_block(size)
        x0, y0, x1, y1 = rect
        row = []
        ref0 = refs[0][y0:y1, x0:x1].astype(np.float32)
        for a in AMOUNTS:
            d = refs[a][y0:y1, x0:x1].astype(np.float32) - ref0
            row.append(float(d.std()))
        target['checker'][size] = row
        print(f"{size:<10}" + ''.join(f'{v:14.3f}' for v in row))

    print(f"\n{'GRAIN SIZE (autocorr half-width, px) — Gray50 profile block':<70}")
    print(f"{'':<10}" + ''.join(f'{a:>10}' for a in AMOUNTS))
    rect = profile_block('Gray50')
    sizes = []
    for a in AMOUNTS:
        hw = autocorr_halfwidth(refs[a], rect)
        sizes.append(hw)
    target['size']['Gray50'] = sizes
    print(f"{'halfwidth':<10}" + ''.join(f'{hw:10.2f}' for hw in sizes))

    with open('calib/grain_targets.json', 'w') as f:
        json.dump(target, f, indent=1)
    print("\nWrote calib/grain_targets.json")


if __name__ == '__main__':
    main()
