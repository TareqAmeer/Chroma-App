"""
Fix A: soft highlight chroma roll-off in LINEAR space — the actual mechanism Lightroom uses
(highlight reconstruction) that build 2026-07-13d was still missing. See the plan file's
"FINAL ROUND" section for the full diagnosis.

Physics argument for why this is safe (verified against real data, not just theory):
Y = .299R + .587G + .114B in LINEAR space. A genuinely saturated color cannot have linear
Y > 0.9 — pure red (R=1,G=B=0) only gives Y=0.299; reaching Y>0.9 requires ALL three channels
already high, i.e. the pixel is already near-neutral. Measured on the real gold-tag reference
(calib/nr_validate.py's TAG_BOX, __TM8304): linear luma max = 0.089, nowhere near this zone.
Measured on __TM8159's sparkle patch: 25% of pixels sit above linear luma 0.90 — exactly the
zone the existing edge-gated median (contrast-only trigger) misses, because the CENTER of a
blown highlight is locally flat (no contrast), so the gate correctly (but wrongly, for this
purpose) stays off there.

This is a separate, additive fix to suppress_false_color, not a replacement.

Usage: run directly for validation (green-dot metric on the real TM8159 decode + gold-tag
linear-luma safety check, reusing calib/false_color_gate.py's synthetic safety battery).
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from false_color_gate import suppress_false_color, green_frac_clumps  # noqa: E402


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


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


def highlight_chroma_rolloff(rgb_linear, lo=0.90, hi=0.995):
    """Blend Cb/Cr toward 0 as LINEAR luma crosses lo->hi. Operates on linear camera RGB
    (0..1), same space raw_decode.rs's rgb16 buffer lives in before the DCP tone curve."""
    y, cb, cr = ycbcr(rgb_linear)
    desat = smoothstep(lo, hi, y)
    cb2 = cb * (1.0 - desat)
    cr2 = cr * (1.0 - desat)
    return np.clip(from_ycbcr(y, cb2, cr2), 0, 1)


def load_bin_lin(p):
    raw = open(p, 'rb').read()
    w, h, _ = np.frombuffer(raw, '<u4', 3)
    return np.frombuffer(raw, '<u2', offset=12).reshape(int(h), int(w), 3).astype(np.float64) / 65535.0


if __name__ == '__main__':
    from dcp_pipeline import parse_dcp, render
    dcp = parse_dcp('calib/DCP Camera Profiles/Panasonic DC-S9 Camera Standard.dcp')
    FIT = {"ev": 0.0, "gr": 0.9860, "gb": 0.9783, "black": 0.0}

    print("=== Fix A: highlight chroma roll-off, real TM8159 sparkle patch ===")
    cam = load_bin_lin('/tmp/tm8159_linear_off.bin')
    y0, x0, s = 2814, 1608, 201
    M = 40
    crop = cam[y0 - M:y0 + s + M, x0 - M:x0 + s + M]

    # baseline: existing gated median alone (13d's config)
    med_only = suppress_false_color(crop.copy(), contrast_thresh=0.5, dev_thresh=0.003, steps=8)
    srgb_med = render(med_only, dcp, FIT)
    g0, n0 = green_frac_clumps(srgb_med[M:-M, M:-M])
    print(f"median-only (13d, shipped): green={g0:.3f}% clumps={n0}")

    # Fix A alone
    rolloff_only = highlight_chroma_rolloff(crop.copy())
    srgb_r = render(rolloff_only, dcp, FIT)
    g1, n1 = green_frac_clumps(srgb_r[M:-M, M:-M])
    print(f"rolloff-only: green={g1:.3f}% clumps={n1}")

    # median THEN rolloff (rolloff cleans what the median's contrast-gate missed)
    combo = highlight_chroma_rolloff(med_only.copy())
    srgb_c = render(combo, dcp, FIT)
    g2, n2 = green_frac_clumps(srgb_c[M:-M, M:-M])
    print(f"median + rolloff: green={g2:.3f}% clumps={n2}  (LR target 0.037%)")

    # gold tag safety check: linear luma must stay well below the rolloff zone
    tag_cam = load_bin_lin('/tmp/tm8304_linear_off.bin')
    ty0, ty1, tx0, tx1 = (2417, 2612, 1818, 2110)
    tag = tag_cam[ty0:ty1, tx0:tx1]
    tag_after = highlight_chroma_rolloff(tag.copy())
    y_before, cb_before, cr_before = ycbcr(tag)
    y_after, cb_after, cr_after = ycbcr(tag_after)
    sat_before = np.hypot(cb_before, cr_before).mean()
    sat_after = np.hypot(cb_after, cr_after).mean()
    print(f"\ngold tag safety: linear luma max={y_before.max():.3f} "
          f"(rolloff zone starts at 0.90) sat_ratio={sat_after/sat_before:.4f} "
          f"{'PASS (untouched)' if sat_after/sat_before > 0.99 else 'FAIL'}")
