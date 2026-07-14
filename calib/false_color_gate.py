"""
Edge-gated false-color suppression — Python prototype matching what gets ported to
desktop/src-tauri/src/raw_decode.rs's suppress_false_color(). See the plan file's
"FINAL PLAN" section for the full diagnosis and rationale.

NOT a blanket median: a chroma pixel is only replaced by its local 3x3 median where
BOTH hold:
  (a) local luma contrast is high (the geometric condition under which PPG demosaic
      actually produces false color — a bright pixel immediately next to a dark one)
  (b) the pixel itself deviates strongly from that local chroma median (it's an outlier,
      not just part of a real smooth color region)
This is what protects a genuine isolated saturated pixel (fails gate (a): no hard edge
nearby) while still catching demosaic false color (satisfies both).

Usage: run directly to execute the synthetic pinpoint-color safety test (gate 1 in the
plan) plus a real-photo green-dot re-measurement (gate 2).
"""
import numpy as np
from scipy.ndimage import median_filter, uniform_filter, label


def ycbcr(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = -0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 0.5 * r - 0.418688 * g - 0.081312 * b
    return y, cb, cr


def from_ycbcr(y, cb, cr):
    r = y + 1.402 * cr
    g = y - 0.344136 * cb - 0.714136 * cr
    b = y + 1.772 * cb
    return np.stack([r, g, b], axis=-1)


def suppress_false_color(rgb, contrast_thresh=0.15, dev_thresh=0.012, steps=2, win=5, median_win=3):
    """Edge-gated conditional median on Cb/Cr, luma untouched. Mirrors the Rust port:
    contrast = local (max-min) luma RANGE over a `win`x`win` neighborhood (NOT a simple
    box-average diff — measured directly on real demosaic false-color pixels that a 3x3
    box-diff badly under-reports contrast near a hard edge, since demosaic itself already
    smooths the transition over a few pixels; a wider max-min range correctly flags
    "near a hard edge" a few pixels out, not just exactly on the edge line). A pixel is
    replaced by its `median_win`x`median_win` chroma median only where contrast >
    contrast_thresh AND |chroma - median| > dev_thresh. `median_win` (Gemini's "Fix B" —
    clump size): the shipped build used median_win=3, which only removes 1px-wide false
    color; a 2x2/3x2 demosaic-failure CLUMP survives a 3x3 window (the window mostly sees
    the clump itself). Widen this to see past clumps up to ~half the window's extent."""
    from scipy.ndimage import maximum_filter, minimum_filter
    y, cb, cr = ycbcr(rgb)
    local_max = maximum_filter(y, size=win)
    local_min = minimum_filter(y, size=win)
    contrast = local_max - local_min
    edge_mask = contrast > contrast_thresh

    for _ in range(steps):
        for plane in (cb, cr):
            med = median_filter(plane, size=median_win)
            dev = np.abs(plane - med)
            replace = edge_mask & (dev > dev_thresh)
            plane[replace] = med[replace]
    return np.clip(from_ycbcr(y, cb, cr), 0, 1)


def green_frac_clumps(rgb, thresh=0.06):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = (g - np.maximum(r, b)) > thresh
    lbl, n = label(green)
    return float(green.mean() * 100), n


# ── Gate 1: synthetic pinpoint-color safety test ────────────────────────────────────
def synthetic_isolated_dot_test():
    """A single saturated red dot on a smooth dark background — no hard luma edge nearby
    (the background itself is uniform, only the dot's own brightness differs). Must
    survive suppress_false_color untouched (or nearly so)."""
    img = np.zeros((40, 40, 3))
    img[..., 2] = 0.05  # faint uniform dark-blue background, deliberately not pure black
    # single 1px saturated red dot, moderate brightness (NOT at a hard contrast edge —
    # background is uniform, so local luma contrast around the dot is low)
    img[20, 20] = [0.35, 0.05, 0.05]
    out = suppress_false_color(img.copy())
    orig_dot = img[20, 20]
    new_dot = out[20, 20]
    err = np.abs(orig_dot - new_dot).max()
    print(f"[gate1a] isolated dot on smooth bg: max channel diff = {err:.4f} "
          f"(orig {orig_dot} -> {new_dot})  {'PASS' if err < 0.02 else 'FAIL'}")
    return err < 0.02


def synthetic_edge_false_color_test():
    """Reproduce the actual failure geometry: a hard bright/dark edge (sparkle boundary)
    with a false green pixel injected right at the edge, as PPG demosaic would produce.
    Must be cleaned (green removed) since it sits exactly on the gated condition."""
    img = np.zeros((40, 40, 3))
    img[:20, :] = 0.9   # bright half (sparkle)
    img[20:, :] = 0.05  # dark half (water)
    # inject a false-green pixel right at the boundary (row 19-20 edge)
    img[19, 20] = [0.85, 0.98, 0.80]  # green-skewed vs its neutral-bright neighbors
    out = suppress_false_color(img.copy())
    r, g, b = out[19, 20]
    still_green = (g - max(r, b)) > 0.06
    print(f"[gate1b] false-color pixel at hard edge: after={out[19,20]} "
          f"still-green={'FAIL (not cleaned)' if still_green else 'PASS (cleaned)'}")
    return not still_green


if __name__ == '__main__':
    print("=== Gate 1: synthetic pinpoint-color safety tests ===")
    ok1 = synthetic_isolated_dot_test()
    ok2 = synthetic_edge_false_color_test()
    print(f"\nGATE 1 OVERALL: {'PASS' if (ok1 and ok2) else 'FAIL — do not proceed to real photos'}")
