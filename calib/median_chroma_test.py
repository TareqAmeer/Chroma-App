"""
Isolated test (Gemini-review item 3): a tight 3x3 median filter on Cb/Cr ONLY (luma
untouched), independent of the wavelet/Wiener noise-model work in vst_denoise.py — testing
whether a median filter, which is specifically built to reject sparse strong outliers
("salt and pepper"/speckle), handles the __TM8159 water-highlight speckle better than
variance-based linear shrinkage (which is tuned for Gaussian-ish noise, not outliers).

Not a per-ISO-calibrated technique — no noise model needed here, deliberately, to isolate
whether the ARTIFACT SHAPE itself (sparse outlier vs. diffuse noise) is the reason wavelet
shrinkage under-cleans it, independent of any strength/variance tuning question.

Usage: python3 calib/median_chroma_test.py <input.RW2> [out_prefix] [size]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import median_filter

sys.path.insert(0, str(Path(__file__).parent))
from vst_denoise import (  # noqa: E402
    dump_cfa, subgrid_offsets, bilinear_upsample_to, merge_g,
    ycbcr, from_ycbcr, wb_gamma_preview,
)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    raw_path = Path(sys.argv[1])
    out_prefix = sys.argv[2] if len(sys.argv) > 2 else raw_path.stem
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 3

    tmp_bin = Path(f'/tmp/{raw_path.stem}_cfa.bin')
    plane, meta = dump_cfa(raw_path, tmp_bin)
    pattern = meta['cfa_pattern']
    offs = subgrid_offsets(pattern)
    (r0, c0) = offs[0][0]
    (b0, bc0) = offs[2][0]
    (gr0, gc0), (gr1, gc1) = offs[1]
    shape = plane.shape

    print(f'{raw_path.name}: ISO {meta["iso"]}, median size={size}x{size}')
    R = bilinear_upsample_to(plane[r0::2, c0::2], shape, r0, c0)
    B = bilinear_upsample_to(plane[b0::2, bc0::2], shape, b0, bc0)
    G = merge_g(plane[gr0::2, gc0::2], plane[gr1::2, gc1::2], offs, shape)
    rgb_noisy = np.stack([R, G, B], axis=-1)

    y_noisy, cb_noisy, cr_noisy = ycbcr(rgb_noisy)
    print('median filtering Cb/Cr...')
    cb_dn = median_filter(cb_noisy, size=size)
    cr_dn = median_filter(cr_noisy, size=size)

    rgb_final = from_ycbcr(y_noisy, cb_dn, cr_dn)  # luma untouched
    preview_dn = wb_gamma_preview(rgb_final)
    preview_noisy = wb_gamma_preview(rgb_noisy)

    out_dn = Path(f'calib/{out_prefix}_vst_denoised.png')
    out_noisy = Path(f'calib/{out_prefix}_vst_noisy.png')
    Image.fromarray((preview_dn * 255).astype(np.uint8)).save(out_dn)
    Image.fromarray((preview_noisy * 255).astype(np.uint8)).save(out_noisy)
    print(f'wrote {out_noisy}\nwrote {out_dn}')


if __name__ == '__main__':
    main()
