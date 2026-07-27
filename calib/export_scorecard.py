"""
Export-gate SCORECARD — the CI validation gate for test/export_harness.mjs.

Diffs every PNG in test/output/ against its matching golden in test/golden/
(same basename: "<fixture>__<recipe>.png") and prints one human-legible
PASS/FAIL table, styled like calib/scorecard.py.

PASS threshold: max per-pixel abs channel diff <= MAX_DIFF_TOL (default 2/255).
This is deliberately tight — the harness pins WebGL backend (SwiftShader) and
grain/artifact seed (fxState.artSeed=7.7) specifically so exports are
byte-reproducible; a real regression should show as a large, not marginal, diff.

Run:  python calib/export_scorecard.py
Exit code: 0 if every pair PASSes, 1 otherwise (for CI).
"""
import os
import sys
import glob
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
OUT_DIR = os.path.join(REPO, 'test', 'output')
GOLDEN_DIR = os.path.join(REPO, 'test', 'golden')

MAX_DIFF_TOL = 2.0   # per-channel, 0-255 scale


def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)


def main():
    if not os.path.isdir(GOLDEN_DIR) or not glob.glob(os.path.join(GOLDEN_DIR, '*.png')):
        print(f"No goldens found in {GOLDEN_DIR} — run `npm run export:golden` first.")
        return 1
    if not os.path.isdir(OUT_DIR) or not glob.glob(os.path.join(OUT_DIR, '*.png')):
        print(f"No output found in {OUT_DIR} — run `npm run export:test` first.")
        return 1

    golden_files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(GOLDEN_DIR, '*.png')))
    output_files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(OUT_DIR, '*.png')))
    extra_in_output = sorted(set(output_files) - set(golden_files))

    rows = []
    all_pass = True
    for name in golden_files:
        if name not in output_files:
            rows.append((name, None, None, 'MISSING'))
            all_pass = False
            continue
        g = load_rgb(os.path.join(GOLDEN_DIR, name))
        o = load_rgb(os.path.join(OUT_DIR, name))
        if g.shape != o.shape:
            rows.append((name, None, None, f'FAIL (shape {o.shape} != golden {g.shape})'))
            all_pass = False
            continue
        diff = np.abs(g - o)
        max_diff = float(diff.max())
        mean_diff = float(diff.mean())
        status = 'PASS' if max_diff <= MAX_DIFF_TOL else 'FAIL'
        if status == 'FAIL':
            all_pass = False
        rows.append((name, max_diff, mean_diff, status))

    name_w = max([len(r[0]) for r in rows] + [20])
    header = f"{'file'.ljust(name_w)}  {'max|Δ|':>8}  {'mean|Δ|':>8}  status"
    print(header)
    print('-' * len(header))
    for name, max_diff, mean_diff, status in rows:
        if max_diff is None:
            print(f"{name.ljust(name_w)}  {'--':>8}  {'--':>8}  {status}")
        else:
            print(f"{name.ljust(name_w)}  {max_diff:8.2f}  {mean_diff:8.3f}  {status}")

    if extra_in_output:
        print(f"\nNote: {len(extra_in_output)} output file(s) have no matching golden (new recipe/fixture?): "
              + ', '.join(extra_in_output))

    n_pass = sum(1 for r in rows if r[3] == 'PASS')
    print(f"\n{n_pass}/{len(rows)} PASS (tolerance: max|Delta| <= {MAX_DIFF_TOL}/255)")

    if not all_pass:
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == '__main__':
    sys.exit(main())
