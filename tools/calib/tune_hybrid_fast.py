"""
FAST offline tuning harness for the Wiener<->median hybrid gate (calib/vst_denoise.py's
hybrid_wiener_median). Avoids the two expensive parts of the normal validation loop:

  1. Runs the pipeline on a small CROP (~1/17th the pixel count of the full 6016x4016 frame)
     instead of the full image, so wavelet/median cost per parameter combo is ~15-20x cheaper.
  2. Replaces nr_validate.py's flat_patches() candidate-block grid search (the slow part —
     minutes per image, scanning gradient energy over hundreds of candidate blocks) with
     direct vectorized masks (Y>hi_thresh for highlights, Y<lo_thresh for shadow) computed
     once per crop, no nested Python loops.

The Lightroom/CS reference ratios are computed ONCE on a matching crop and reused as a fixed
comparison target for the whole parameter sweep — they don't need to be recomputed per combo.

Only after a promising (k_min, y_lo, y_hi) combo is found here should the full, slow
calib/nr_vst_compare.py (or the multi-set calib/step_a_gate.py-style loop) be run to confirm
on the full image and then across other ISO sets — this script exists to avoid burning that
cost on every tuning iteration.

Usage: python3 calib/tune_hybrid_fast.py
"""
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

sys.path.insert(0, str(Path(__file__).parent))
from vst_denoise import (  # noqa: E402
    dump_cfa, subgrid_offsets, bilinear_upsample_to, merge_g, ycbcr,
    load_profile, interp_ab, var_model, YCBCR_COEF,
    adaptive_wavelet_denoise, luma_detail_cascade, hybrid_wiener_median, LEVELS,
)

RAW = Path('__TM8159.RW2')
ISO = 5000
STRENGTH = 3.0
# Exact patch coordinates nr_validate.py's flat_patches() found on THIS image (set2/TM8159,
# full-res 6016x4016 CS-space grid) — reusing the authoritative method's own patches instead
# of an arbitrary crop, so this fast proxy measures exactly what the slow validator measures.
# (y0, x0, side) — from `flat_patches(y, N_PATCHES, PATCH_FRAC)` on /tmp/cs_dump/set2_cs_off.bin
SHADOW_PATCH = (201, 3618, 201)
MID_PATCH = (603, 2814, 201)
HIGH_PATCH = (1005, 1407, 201)
# The ACTUAL sparkle/speckle texture (visually confirmed — bright water sparkle dots with
# visible color fringing), found via the INVERSE of flat_patches: highest gradient energy
# among high-luma (>0.5) candidate blocks, since flat_patches deliberately avoids exactly
# this kind of textured region (see plan file's methodological-finding note).
TEXTURED_HIGH_PATCH = (2814, 1608, 201)
PAD = 96  # context padding around each patch so the wavelet/median cascade isn't edge-starved
# Bounding crop covering all patches + padding, in FULL-RES coords (y0,y1,x0,x1).
_ys = [SHADOW_PATCH[0], MID_PATCH[0], HIGH_PATCH[0], TEXTURED_HIGH_PATCH[0]]
_xs = [SHADOW_PATCH[1], MID_PATCH[1], HIGH_PATCH[1], TEXTURED_HIGH_PATCH[1]]
CROP = (
    min(_ys) - PAD, max(y + 201 for y in _ys) + PAD,
    min(_xs) - PAD, max(x + 201 for x in _xs) + PAD,
)
LR_TIF_OFF = 'LR-noNR2.tif'
LR_TIF_ON = 'LR-defaultNR2.tif'
LR_SHAPE = (4000, 6000)  # LR export resolution, slightly different from the 6016x4016 raw


def box_ratio(sl, off_plane, on_plane):
    """std(on)/std(off) over an exact patch box, mean-subtracted within the box."""
    o = off_plane[sl]
    n = on_plane[sl]
    so = (o - o.mean()).std()
    sn = (n - n.mean()).std()
    return float(sn / so) if so > 1e-6 else float('nan')


def box_sat_ratio(sl, cb_off, cr_off, cb_on, cr_on):
    mag_off = np.hypot(np.abs(cb_off[sl]).mean(), np.abs(cr_off[sl]).mean())
    mag_on = np.hypot(np.abs(cb_on[sl]).mean(), np.abs(cr_on[sl]).mean())
    return float(mag_on / max(mag_off, 1e-9))


def patch_slice_in_crop(patch, crop):
    """Map a (y0,x0,side) full-res patch to a slice relative to the crop's own origin."""
    py0, px0, side = patch
    cy0, _, cx0, _ = crop
    ly0, lx0 = py0 - cy0, px0 - cx0
    return np.s_[ly0:ly0 + side, lx0:lx0 + side]


def build_crop_rgb(crop):
    y0, y1, x0, x1 = crop
    tmp_bin = Path('/tmp/tm8159_tune.bin')
    if not tmp_bin.exists():
        plane, meta = dump_cfa(RAW, tmp_bin)
    else:
        import json
        meta = json.loads((tmp_bin.with_suffix(tmp_bin.suffix + '.json')).read_text())
        plane = np.fromfile(tmp_bin, dtype='<f4').reshape(meta['height'], meta['width'])
    # crop the mosaic FIRST (align to even boundaries so the CFA phase is preserved)
    y0 -= y0 % 2
    x0 -= x0 % 2
    sub = plane[y0:y1, x0:x1]
    pattern = meta['cfa_pattern']
    offs = subgrid_offsets(pattern)
    (r0, c0) = offs[0][0]
    (b0, bc0) = offs[2][0]
    (gr0, gc0), (gr1, gc1) = offs[1]
    shape = sub.shape
    R = bilinear_upsample_to(sub[r0::2, c0::2], shape, r0, c0)
    B = bilinear_upsample_to(sub[b0::2, bc0::2], shape, b0, bc0)
    G = merge_g(sub[gr0::2, gc0::2], sub[gr1::2, gc1::2], offs, shape)
    return np.stack([R, G, B], axis=-1)


def load_tif_patch(path, patch, full_shape=(4016, 6016), target_shape=LR_SHAPE):
    """Map a full-res (y0,x0,side) patch proportionally onto the (slightly different
    resolution) Lightroom export and load just that small region."""
    py0, px0, side = patch
    fh, fw = full_shape
    th, tw = target_shape
    ty0, ty1 = int(py0 / fh * th), int((py0 + side) / fh * th)
    tx0, tx1 = int(px0 / fw * tw), int((px0 + side) / fw * tw)
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float64) / 255.0
    return im[ty0:ty1, tx0:tx1]


def main():
    t0 = time.time()
    print('building noisy crop...')
    rgb_noisy = build_crop_rgb(CROP)
    print(f'  crop shape {rgb_noisy.shape}, {time.time()-t0:.1f}s')

    profile = load_profile()
    a_R, b_R = interp_ab(profile, ISO, 'R')
    a_G, b_G = interp_ab(profile, ISO, 'G')
    a_B, b_B = interp_ab(profile, ISO, 'B')
    R, G, B = rgb_noisy[..., 0], rgb_noisy[..., 1], rgb_noisy[..., 2]
    R_hat, G_hat, B_hat = uniform_filter(R, 5), uniform_filter(G, 5), uniform_filter(B, 5)
    var_R = var_model(R_hat, a_R, b_R)
    var_G = var_model(G_hat, a_G, b_G)
    var_B = var_model(B_hat, a_B, b_B)
    wcb, wcr = YCBCR_COEF['cb'], YCBCR_COEF['cr']
    var_cb0 = wcb[0] * var_R + wcb[1] * var_G + wcb[2] * var_B
    var_cr0 = wcr[0] * var_R + wcr[1] * var_G + wcr[2] * var_B

    y_noisy, cb_noisy, cr_noisy = ycbcr(rgb_noisy)
    print('computing luma-edge cascade + base Wiener (shared across sweep)...')
    luma_detail = luma_detail_cascade(y_noisy, LEVELS)
    cb_wiener = adaptive_wavelet_denoise(cb_noisy, var_cb0, LEVELS, STRENGTH, luma_detail)
    cr_wiener = adaptive_wavelet_denoise(cr_noisy, var_cr0, LEVELS, STRENGTH, luma_detail)
    print(f'  done, {time.time()-t0:.1f}s total so far')

    print('computing fixed LR/CS reference ratios on the EXACT nr_validate patches (once)...')
    lr_hi_off, lr_hi_on = load_tif_patch(LR_TIF_OFF, HIGH_PATCH), load_tif_patch(LR_TIF_ON, HIGH_PATCH)
    lr_mid_off, lr_mid_on = load_tif_patch(LR_TIF_OFF, MID_PATCH), load_tif_patch(LR_TIF_ON, MID_PATCH)
    lr_tex_off, lr_tex_on = load_tif_patch(LR_TIF_OFF, TEXTURED_HIGH_PATCH), load_tif_patch(LR_TIF_ON, TEXTURED_HIGH_PATCH)
    _, cb_h_off, cr_h_off = ycbcr(lr_hi_off)
    _, cb_h_on, cr_h_on = ycbcr(lr_hi_on)
    _, cb_m_off, _ = ycbcr(lr_mid_off)
    _, cb_m_on, _ = ycbcr(lr_mid_on)
    _, cb_t_off, cr_t_off = ycbcr(lr_tex_off)
    _, cb_t_on, cr_t_on = ycbcr(lr_tex_on)
    full_sl = np.s_[:, :]
    lr_hi_cb = box_ratio(full_sl, cb_h_off, cb_h_on)
    lr_hi_sat = box_sat_ratio(full_sl, cb_h_off, cr_h_off, cb_h_on, cr_h_on)
    lr_mid_cb = box_ratio(full_sl, cb_m_off, cb_m_on)
    lr_tex_cb = box_ratio(full_sl, cb_t_off, cb_t_on)
    lr_tex_sat = box_sat_ratio(full_sl, cb_t_off, cr_t_off, cb_t_on, cr_t_on)
    print(f'  LR reference (flat-patch):  hi_cb={lr_hi_cb:.3f} hi_sat={lr_hi_sat:.3f} mid_cb={lr_mid_cb:.3f}')
    print(f'  LR reference (TEXTURED speckle patch): cb={lr_tex_cb:.3f} sat={lr_tex_sat:.3f}')

    sl_hi = patch_slice_in_crop(HIGH_PATCH, CROP)
    sl_mid = patch_slice_in_crop(MID_PATCH, CROP)
    sl_shadow = patch_slice_in_crop(SHADOW_PATCH, CROP)
    sl_tex = patch_slice_in_crop(TEXTURED_HIGH_PATCH, CROP)

    print(f"\n{'k_min':>6}{'y_lo':>6}{'y_hi':>6}  {'flatHi_Cb':>9}{'flatHi_sat':>11}{'mid_Cb':>8}  |  {'TEX_Cb':>7}{'TEX_sat':>8}"
          f"  (targets: flatHi_cb<={lr_hi_cb:.2f} flatHi_sat~={lr_hi_sat:.2f} | TEX_cb<={lr_tex_cb:.2f} TEX_sat~={lr_tex_sat:.2f})")
    print('-' * 110)
    best = None
    for k_min in (0.3, 0.6, 0.8, 1.2, 1.6, 2.4):
        for y_lo_h, y_hi_h in ((0.30, 0.80), (0.45, 0.85), (0.55, 0.90)):
            cb_h = hybrid_wiener_median(cb_noisy, cb_wiener, var_cb0, y_noisy, k_min=k_min, y_lo=y_lo_h, y_hi=y_hi_h)
            cr_h = hybrid_wiener_median(cr_noisy, cr_wiener, var_cr0, y_noisy, k_min=k_min, y_lo=y_lo_h, y_hi=y_hi_h)
            hi_cb = box_ratio(sl_hi, cb_noisy, cb_h)
            hi_sat = box_sat_ratio(sl_hi, cb_noisy, cr_noisy, cb_h, cr_h)
            mid_cb = box_ratio(sl_mid, cb_noisy, cb_h)
            tex_cb = box_ratio(sl_tex, cb_noisy, cb_h)
            tex_sat = box_sat_ratio(sl_tex, cb_noisy, cr_noisy, cb_h, cr_h)
            # score now weighs the TEXTURED patch (the actual reported defect) alongside the
            # flat-patch regression check — don't let one dominate the other silently.
            score = (
                abs(hi_sat - lr_hi_sat) + max(0, hi_cb - lr_hi_cb)
                + abs(tex_sat - lr_tex_sat) + max(0, tex_cb - lr_tex_cb)
            )
            flag = ''
            if best is None or score < best[0]:
                best = (score, k_min, y_lo_h, y_hi_h)
                flag = '  <-- best so far'
            print(f"{k_min:>6.1f}{y_lo_h:>6.2f}{y_hi_h:>6.2f}  {hi_cb:>9.3f}{hi_sat:>11.3f}{mid_cb:>8.3f}  |  {tex_cb:>7.3f}{tex_sat:>8.3f}{flag}")

    print(f"\nBEST: k_min={best[1]} y_lo={best[2]} y_hi={best[3]} (score {best[0]:.3f})")
    print(f'total time: {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main()
