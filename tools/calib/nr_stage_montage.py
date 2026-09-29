"""
Phase-1 diagnosis montage for the sparkle-field NR regression (see the ACTIVE PLAN in the
plan file): crops the textured sparkle patch from native-decode variants of __TM8159
(both passes on / shadow-only / wavelet-only / both off / High-tier neural) plus Lightroom
references, and tiles them side-by-side (plus an 8x chroma-amplified row) so the destructive
stage can be attributed visually in one image.

Extended (see the denoiser design doc's §A6 step 4 — "not optional"): the whole reason this
montage exists is that a scalar metric previously said a change was fine while the eye caught
real waxy/plastic texture loss — exactly the failure mode a neural denoiser is MOST prone to.
Added: 'High (neural)' — the RawNIND UtNet2 pass — and 'LR Denoise' as its comparison target
(NOT 'LR default NR' — see nr_validate.py's module doc for why Manual NR is the wrong bar for
a neural denoiser). Both are optional (skipped with a note if their input file is missing) so
this still runs meaningfully on just the original 4-variant classical set.

Inputs (produce with desktop/src-tauri/examples/dump_rw2 + env toggles):
  /tmp/cs_dump/tm8159_both_on.bin        (no env)
  /tmp/cs_dump/tm8159_both_off.bin       (CS_NO_CHROMA_NR=1 — dump_rw2 maps it to native_nr=false)
  /tmp/cs_dump/tm8159_wavelet_only.bin   (CS_NO_SHADOW_NR=1)
  /tmp/cs_dump/tm8159_shadow_only.bin    (CS_NR_LEVELS=0 CS_NR_STRENGTH=0 — wavelet no-op)
  calib/nr_dump/set2_cs_high.bin         (CS_NR_TIER=high — set 2 is __TM8159, same source photo)
  LR-noNR2.tif / LR-defaultNR2.tif       (repo root)
  LR-denoise2.tif                        (repo root — LR AI Denoise checkbox export, optional)

Output: calib/nr_stage_montage.png (small — patch crops only, safe to keep)

Usage: python3 calib/nr_stage_montage.py
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
os.chdir(Path(__file__).parent.parent)

from nr_validate import load_bin_srgb, load_tif, ycbcr  # noqa: E402

PATCH = (2814, 1608, 201)  # textured sparkle patch, full-res 6016x4016 coords
SCALE = 3                  # upscale factor for visibility
LR_SHAPE = (4000, 6000)
CS_SHAPE = (4016, 6016)

VARIANTS = [
    ('both OFF', '/tmp/cs_dump/tm8159_both_off.bin', 'bin'),
    ('shadow only', '/tmp/cs_dump/tm8159_shadow_only.bin', 'bin'),
    ('wavelet only', '/tmp/cs_dump/tm8159_wavelet_only.bin', 'bin'),
    ('both ON (Fast, shipped)', '/tmp/cs_dump/tm8159_both_on.bin', 'bin'),
    ('High (neural)', 'calib/nr_dump/set2_cs_high.bin', 'bin'),
    ('LR no NR', 'LR-noNR2.tif', 'tif'),
    ('LR default NR', 'LR-defaultNR2.tif', 'tif'),
    ('LR Denoise', 'LR-denoise2.tif', 'tif'),
]


def crop_patch(img, shape):
    y0, x0, side = PATCH
    fh, fw = CS_SHAPE
    th, tw = shape
    ty0, ty1 = int(y0 / fh * th), int((y0 + side) / fh * th)
    tx0, tx1 = int(x0 / fw * tw), int((x0 + side) / fw * tw)
    return img[ty0:ty1, tx0:tx1]


def chroma_amp(crop, amp=8.0):
    """8x chroma-amplified false-color render (Cr->R, Y->G, Cb->B), same as the manual
    check used earlier in the session — makes chroma smear/casts pop."""
    y, cb, cr = ycbcr(crop)
    return np.stack([
        np.clip(cr * amp + 0.5, 0, 1),
        np.clip(y, 0, 1),
        np.clip(cb * amp + 0.5, 0, 1),
    ], axis=-1)


def main():
    tiles_rgb, tiles_amp, labels = [], [], []
    for label, path, kind in VARIANTS:
        if not os.path.exists(path):
            print(f'missing: {path} — skip')
            continue
        img = load_bin_srgb(path) if kind == 'bin' else load_tif(path)
        shape = CS_SHAPE if kind == 'bin' else LR_SHAPE
        crop = crop_patch(img, shape)
        tiles_rgb.append(crop)
        tiles_amp.append(chroma_amp(crop))
        labels.append(label)

    side = max(t.shape[0] for t in tiles_rgb)
    tile_px = side * SCALE
    pad, header = 6, 26
    W = len(tiles_rgb) * (tile_px + pad) + pad
    H = 2 * (tile_px + pad) + pad + 2 * header
    canvas = Image.new('RGB', (W, H), (24, 24, 24))
    draw = ImageDraw.Draw(canvas)
    for i, (rgb, amp, label) in enumerate(zip(tiles_rgb, tiles_amp, labels)):
        x = pad + i * (tile_px + pad)
        for row, arr in enumerate((rgb, amp)):
            im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
            im = im.resize((tile_px, tile_px), Image.NEAREST)
            y = header + row * (tile_px + pad + header)
            canvas.paste(im, (x, y))
        draw.text((x + 2, 6), label, fill=(255, 255, 160))
        draw.text((x + 2, header + tile_px + pad + 4), f'{label} (8x chroma)', fill=(160, 220, 255))

    out = 'calib/nr_stage_montage.png'
    canvas.save(out)
    print(f'wrote {out} ({W}x{H})')


if __name__ == '__main__':
    main()
