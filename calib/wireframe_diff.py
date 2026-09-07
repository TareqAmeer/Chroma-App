#!/usr/bin/env python3
"""Pixel-level half of the Library-view wireframe check (see the plan at
.claude/plans/use-the-claude-design-mcp-memoized-abelson.md and test/wireframe_diff.mjs, which
generates the PNGs this reads). test/wireframe_diff.mjs's computed-style table catches the named,
fixable CSS mismatches; this catches structural drift a style table can't — a missing element,
a shifted layout region, a wrong colour band — the same "render and look" gate scorecard.py uses
for halation (CLAUDE.md 6.1/6.2), applied to a UI screenshot instead of a calibration chart.

Usage: python3 calib/wireframe_diff.py [--theme dark|light|both]
Requires: numpy, Pillow (already in calib/requirements.txt).
"""
import sys
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "output"

# Named regions as (label, x0, y0, x1, y1) fractions of the shared 1440x900 viewport
# test/wireframe_diff.mjs captures at — matches the plan's named element groups.
REGIONS = [
    ("topbar",    0.00, 0.00, 1.00, 0.07),
    ("sidebar",   0.00, 0.07, 0.16, 1.00),
    ("grid",      0.16, 0.07, 1.00, 0.95),
    ("statusbar", 0.00, 0.95, 1.00, 1.00),
]


def load(path):
    if not path.exists():
        return None
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)


def region_match(a, b, x0, y0, x1, y1):
    h, w = a.shape[:2]
    ax0, ax1 = int(x0 * w), int(x1 * w)
    ay0, ay1 = int(y0 * h), int(y1 * h)
    bh, bw = b.shape[:2]
    bx0, bx1 = int(x0 * bw), int(x1 * bw)
    by0, by1 = int(y0 * bh), int(y1 * bh)
    ra, rb = a[ay0:ay1, ax0:ax1], b[by0:by1, bx0:bx1]
    # resize the smaller crop up to the larger's shape so a few px of viewport rounding
    # never fails the whole region.
    th, tw = max(ra.shape[0], rb.shape[0]), max(ra.shape[1], rb.shape[1])
    def resize(x):
        img = Image.fromarray(x.astype(np.uint8))
        return np.asarray(img.resize((tw, th), Image.BILINEAR), dtype=np.float64)
    ra, rb = resize(ra), resize(rb)
    diff = np.abs(ra - rb)
    match_pct = 100.0 * (1.0 - diff.mean() / 255.0)
    return match_pct, diff


def heatmap(diff, path):
    d = diff.mean(axis=2)
    d = np.clip(d / max(d.max(), 1e-6) * 255, 0, 255).astype(np.uint8)
    heat = np.zeros((*d.shape, 3), dtype=np.uint8)
    heat[..., 0] = d       # red channel = magnitude of mismatch
    heat[..., 1] = 0
    heat[..., 2] = 255 - d  # blue where they agree
    Image.fromarray(heat).save(path)


def run(theme):
    wf = load(OUT / f"wireframe_{theme}.png")
    app = load(OUT / f"app_{theme}.png")
    if wf is None or app is None:
        print(f"[{theme}] missing screenshots — run `node test/wireframe_diff.mjs` first")
        return False
    print(f"\n[{theme}] region        match%   size(wf->app)")
    print("-" * 50)
    ok = True
    full_pct, full_diff = region_match(wf, app, 0, 0, 1, 1)
    heatmap(full_diff, OUT / f"heatmap_{theme}.png")
    for label, x0, y0, x1, y1 in REGIONS:
        pct, diff = region_match(wf, app, x0, y0, x1, y1)
        flag = "ok" if pct >= 70 else "LOW"
        if pct < 70:
            ok = False
        print(f"  {label:<12} {pct:5.1f}%   {flag}")
    print(f"  {'overall':<12} {full_pct:5.1f}%   (heatmap: test/output/heatmap_{theme}.png)")
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", default="both", choices=["dark", "light", "both"])
    args = ap.parse_args()
    themes = ["dark", "light"] if args.theme == "both" else [args.theme]
    results = [run(t) for t in themes]
    print("\nRESULT:", "PASS" if all(results) else "SEE ABOVE")
    sys.exit(0 if all(results) else 1)
