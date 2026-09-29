"""
Validates the High-tier neural denoiser (RawNIND UtNet2) against DxO PureRAW — the ACTUAL
tool this feature exists to be a fast alternative to (DxO: up to an hour/photo on this
machine; High tier: 25-90s — see the denoiser design doc). Uses 5 real ISO 12800 photos the
user actually shoots at (their stated real-world use case for the denoiser), each supplied as
an RW2 + the matching DxO PureRAW-denoised DNG.

Unlike the Lightroom comparisons in nr_validate.py/nr_scorecard.py, DxO has no separate
"off" export of its own — PureRAW always denoises. So this uses ONE shared baseline
(Chromasmith's own NR-off decode, `cs_off`) and measures how far EACH method's output moved
away from it: CS-Fast, CS-High, and DxO are all compared against the SAME starting point,
which is actually cleaner than the LR case (no "which app's own baseline" ambiguity).

Resolution mismatch: Chromasmith's native decode is the FULL sensor active area (6016x4016 for
the DC-S9); DxO's DNG output is cropped slightly differently (6000x4000 — confirmed by probing
a real file, not assumed) — about 0.3% different per axis, not pixel-aligned. Patches are
detected ONCE on cs_off's own luma, then remapped via NORMALIZED coordinates (fraction of
cs_off's shape) into each other image's own shape — the exact technique nr_scorecard.py
already uses for LR-vs-CS resolution mismatches (rect_norm/rect_denorm), reused here rather
than re-derived.

No PASS/FAIL gates — informational only, same reasoning as nr_validate.py's LR-Denoise
section: there's no prior data to say what tolerance is right for CS-High vs DxO PureRAW.
Read the ratios, look at a real crop, then decide what "good enough" means.

Inputs (produce with dump_rw2 / dump_dng — see calib/nr_dump/ generation), per set N (1-5):
  calib/nr_dump/dxo{N}_cs_off.bin    (dump_rw2, CS_NO_CHROMA_NR=1)
  calib/nr_dump/dxo{N}_cs_fast.bin   (dump_rw2, default = Fast tier)
  calib/nr_dump/dxo{N}_cs_high.bin   (dump_rw2, CS_NR_TIER=high)
  calib/nr_dump/dxo{N}_dxo.bin       (dump_dng, the DxO PureRAW DNG)

Usage: python3 calib/nr_validate_dxo.py
"""
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
os.chdir(Path(__file__).parent.parent)

from nr_validate import load_bin_srgb, ycbcr, grad_energy  # noqa: E402

DUMP_DIR = os.environ.get("CS_DUMP_DIR", "calib/nr_dump")

# Real-photo mapping (RW2 <-> matching DxO PureRAW DNG), all ISO 12800 — the user's actual
# real-world use case for the denoiser (not a synthetic/staged test chart).
SETS = {
    1: "__TM3682",
    2: "__TM3716",
    3: "__TM3719",
    4: "__TM3725",
    5: "__TM3740",
}

PATCH_FRAC = 0.05
N_PATCHES = 24
COLOR_CHROMA_MIN = 0.03


def flat_patches_norm(y, n, frac):
    """Same detection as nr_validate.py's flat_patches, but returns NORMALIZED (fraction-of-
    shape) rects instead of pixel ones, so they can be remapped onto a DIFFERENTLY-SIZED image
    of the same scene (see module doc — cs_off vs dxo aren't pixel-aligned)."""
    h, w = y.shape
    side = int(round(min(h, w) * frac))
    step = side
    ge = grad_energy(y)
    cands = []
    for y0 in range(0, h - side, step):
        for x0 in range(0, w - side, step):
            g = ge[y0:y0 + side, x0:x0 + side].mean()
            l = y[y0:y0 + side, x0:x0 + side].mean()
            cands.append((g, l, y0, x0))
    cands.sort(key=lambda c: c[0])
    buckets = {"shadow": [], "mid": [], "high": []}
    for g, l, y0, x0 in cands:
        k = "shadow" if l < 0.33 else ("high" if l > 0.66 else "mid")
        if len(buckets[k]) < n // 3:
            buckets[k].append((y0 / h, x0 / w, side / h, side / w))
    return buckets


def denorm(rect_n, shape):
    ny0, nx0, nsh, nsw = rect_n
    h, w = shape
    side = int(round(nsh * h))
    return (int(round(ny0 * h)), int(round(nx0 * w)), side)


def measure_against_shared_off(off_y, off_cb, off_cr, buckets_n, img, off_shape):
    """Ratios of `img` vs the SHARED off baseline (off_y/off_cb/off_cr, at off_shape), with
    patch rects normalized against off_shape and remapped into img's own (possibly different)
    shape — see module doc."""
    y, cb, cr = ycbcr(img)
    out = {}
    for name, rects_n in buckets_n.items():
        yr, cbr, crr, satr = [], [], [], []
        for rn in rects_n:
            oy0, ox0, oside = denorm(rn, off_shape)
            osl = np.s_[oy0:oy0 + oside, ox0:ox0 + oside]
            iy0, ix0, iside = denorm(rn, y.shape)
            isl = np.s_[iy0:iy0 + iside, ix0:ix0 + iside]

            def std0(p, sl):
                return float((p[sl] - p[sl].mean()).std())

            so_y = std0(off_y, osl)
            sn_y = std0(y, isl)
            so_cb = std0(off_cb, osl)
            sn_cb = std0(cb, isl)
            so_cr = std0(off_cr, osl)
            sn_cr = std0(cr, isl)
            if so_y > 1e-6:
                yr.append(sn_y / so_y)
            if so_cb > 1e-6:
                cbr.append(sn_cb / so_cb)
            if so_cr > 1e-6:
                crr.append(sn_cr / so_cr)
            mag_off = np.hypot(np.abs(off_cb[osl]).mean(), np.abs(off_cr[osl]).mean())
            mag_on = np.hypot(np.abs(cb[isl]).mean(), np.abs(cr[isl]).mean())
            if mag_off > COLOR_CHROMA_MIN:
                satr.append(mag_on / max(mag_off, 1e-9))
        out[name] = dict(
            y=float(np.median(yr)) if yr else float("nan"),
            cb=float(np.median(cbr)) if cbr else float("nan"),
            cr=float(np.median(crr)) if crr else float("nan"),
            sat=float(np.median(satr)) if satr else float("nan"),
        )
    return out


def fmt(v):
    return f"{v:.2f}" if not np.isnan(v) else "  - "


def main():
    print("High-tier (RawNIND neural) vs DxO PureRAW — real ISO 12800 photos, the user's own")
    print("actual denoiser use case. All ratios are on/off-NR std (LOWER = more noise removed),")
    print("measured against the SAME shared cs_off baseline for all three methods.")
    print("Informational only — no PASS/FAIL gates yet, see module doc.\n")

    missing = []
    for s, name in SETS.items():
        for suffix in ("cs_off", "cs_fast", "cs_high", "dxo"):
            p = f"{DUMP_DIR}/dxo{s}_{suffix}.bin"
            if not os.path.exists(p):
                missing.append(p)
    if missing:
        print(f"Missing {len(missing)} dump(s), skipping those sets' comparisons:")
        for m in missing:
            print(f"  {m}")
        print()

    header = f"{'set':<6}{'bucket':<8}{'Y: Fast|High|DxO':>22}{'Cb: Fast|High|DxO':>22}{'sat: Fast|High|DxO':>22}"
    print(header)
    print("-" * len(header))

    for s, name in SETS.items():
        paths = {k: f"{DUMP_DIR}/dxo{s}_{k}.bin" for k in ("cs_off", "cs_fast", "cs_high", "dxo")}
        if any(not os.path.exists(p) for p in paths.values()):
            continue
        cs_off = load_bin_srgb(paths["cs_off"])
        cs_fast = load_bin_srgb(paths["cs_fast"])
        cs_high = load_bin_srgb(paths["cs_high"])
        dxo = load_bin_srgb(paths["dxo"])

        off_y, off_cb, off_cr = ycbcr(cs_off)
        buckets_n = flat_patches_norm(off_y, N_PATCHES, PATCH_FRAC)

        fast_m = measure_against_shared_off(off_y, off_cb, off_cr, buckets_n, cs_fast, cs_off.shape[:2])
        high_m = measure_against_shared_off(off_y, off_cb, off_cr, buckets_n, cs_high, cs_off.shape[:2])
        dxo_m = measure_against_shared_off(off_y, off_cb, off_cr, buckets_n, dxo, cs_off.shape[:2])

        for b in ("shadow", "mid", "high"):
            f_, h_, d_ = fast_m[b], high_m[b], dxo_m[b]
            print(f"{f'{s}/{name}':<6}{b:<8}"
                  f"{fmt(f_['y']) + '|' + fmt(h_['y']) + '|' + fmt(d_['y']):>22}"
                  f"{fmt(f_['cb']) + '|' + fmt(h_['cb']) + '|' + fmt(d_['cb']):>22}"
                  f"{fmt(f_['sat']) + '|' + fmt(h_['sat']) + '|' + fmt(d_['sat']):>22}")
        print()

    print("Read as: how much of each colour channel's noise survives, and how much real colour")
    print("(saturation) survives, relative to the untouched decode. High should reduce Y noise")
    print("well past what Fast can (Fast barely touches luma above 15% brightness by design) —")
    print("compare High's numbers to DxO's directly: closer to DxO = more comparable denoising.")
    print("sat should stay near 1.0 for all three; well below it means real colour is being")
    print("drained, not just noise.")


if __name__ == "__main__":
    main()
