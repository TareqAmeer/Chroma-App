"""
PASS/FAIL noise-reduction scorecard: Chromasmith vs a REAL Lightroom reference —
not a self-relative before/after (that only proves "less noise than before ourselves",
not "matches Lightroom"). Mirrors grain_scorecard.py's discipline (one legible table,
computed in seconds) but the ground truth here is an actual LR export, not a fitted model.

Inputs (4 images of the SAME RAW, same crop/orientation, no creative grading —
identity profile, no LUT/grain/borders, so the diff isolates noise, not color science):
  --lr-no-nr       Lightroom export, Luminance NR=0, Color NR=0   (LR's raw noise floor)
  --lr-default-nr  Lightroom export, your normal default NR       (the actual target)
  --cs-no-nr       Chromasmith export, RAW Noise Reduction OFF
  --cs-default-nr  Chromasmith export, RAW Noise Reduction ON

All four should be 16-bit TIFF (or PNG) at the SAME aspect ratio; different pixel
dimensions are fine (patches are picked in NORMALIZED 0..1 coordinates and scaled
per-image), but a resolution mismatch >2x will bias std measurements — export near
full res from both.

Method: auto-detect flat, texture-free patches (low local gradient energy) spread
across the tonal range, on the LR-no-nr image (least likely to have any app-specific
processing bias). For each patch, per image: whole-PATCH-mean subtraction (not a
local blur) for Y/Cb/Cr std — CLAUDE.md's own documented lesson from the grain model
work is that a local high-pass/blur can itself track and remove coarse noise
"packets", underestimating exactly the defect this is meant to catch. A single
scalar per-patch mean has no such blind spot.

Two checks, not one:
  1. CS-no-nr vs LR-no-nr   -> is our RAW DECODE's noise floor comparable to
                                Lightroom's before any correction? (validates the
                                base pipeline, independent of the NR fix)
  2. CS-default-nr vs LR-default-nr -> does OUR correction land in the same range
                                as Lightroom's actual default rendering?

Run: python calib/nr_scorecard.py --lr-no-nr a.tif --lr-default-nr b.tif \
                                   --cs-no-nr c.tif --cs-default-nr d.tif

Optional THIRD pair, --cs-high / --lr-denoise: validates the High tier (RawNIND neural
denoiser) against Lightroom's own AI Denoise checkbox, instead of against Manual NR — Denoise
is the actually-comparable tool (see nr_validate.py's module doc for the full reasoning: High
denoises luma at all brightness by design, so comparing it to Manual NR's classical, luma-
sparing behaviour would be the wrong bar). Reuses the exact same patch-detection and std-ratio
machinery as the Manual-NR check above (still anchored on --lr-no-nr's own flat patches — one
detection pass covers both comparisons), and prints as its own MATCH/MISS table with the same
TOL_RATIO tolerance — but does NOT affect this script's exit code, since (unlike the Manual-NR
comparison) there's no prior data to say what tolerance is actually right for a neural denoiser
vs Denoise. Read the numbers, don't gate on them yet.
"""
import argparse
import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

PATCH_FRAC = 0.06     # patch size as a fraction of the image's shorter side
N_PATCHES = 10         # how many flat patches to sample, spread across tones
GRID_STEP_FRAC = 0.03  # scan stride for candidate patches
TOL_RATIO = 1.5        # "comparable" = within 1.5x of the reference std (either direction)


def load(path):
    im = Image.open(path)
    if im.mode not in ('RGB',):
        im = im.convert('RGB')
    arr = np.asarray(im).astype(np.float64)
    if arr.max() <= 1.0001:
        pass
    elif im.mode == 'RGB' and np.asarray(Image.open(path)).dtype == np.uint16:
        arr = arr / 65535.0
    else:
        arr = arr / 255.0
    return arr


def to_ycbcr(rgb01):
    r, g, b = rgb01[..., 0], rgb01[..., 1], rgb01[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = -0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 0.5 * r - 0.418688 * g - 0.081312 * b
    return y, cb, cr


def gradient_energy(y):
    gx = np.abs(np.diff(y, axis=1, prepend=y[:, :1]))
    gy = np.abs(np.diff(y, axis=0, prepend=y[:1, :]))
    return gx + gy


def find_flat_patches(y, n_patches, patch_frac, grid_step_frac):
    """Scan a grid of candidate square patches, score by mean gradient energy
    (low = flat/texture-free), keep the N lowest-energy candidates spread across
    the luma range (bucketed into thirds: shadow/mid/highlight) so the scorecard
    covers more than one tone, not just whatever's flattest overall."""
    h, w = y.shape
    side = int(round(min(h, w) * patch_frac))
    step = max(4, int(round(min(h, w) * grid_step_frac)))
    ge = gradient_energy(y)
    cands = []
    for y0 in range(0, h - side, step):
        for x0 in range(0, w - side, step):
            patch_ge = ge[y0:y0 + side, x0:x0 + side].mean()
            patch_y = y[y0:y0 + side, x0:x0 + side].mean()
            cands.append((patch_ge, patch_y, y0, x0, side))
    cands.sort(key=lambda c: c[0])
    buckets = {'shadow': [], 'mid': [], 'highlight': []}
    for c in cands:
        _, py, *_ = c
        key = 'shadow' if py < 0.33 else ('highlight' if py > 0.66 else 'mid')
        if len(buckets[key]) < max(1, n_patches // 3):
            buckets[key].append(c)
    chosen = [c for b in buckets.values() for c in b]
    if len(chosen) < n_patches:
        seen = {(c[2], c[3]) for c in chosen}
        for c in cands:
            if len(chosen) >= n_patches:
                break
            if (c[2], c[3]) not in seen:
                chosen.append(c)
                seen.add((c[2], c[3]))
    return [(y0, x0, side) for _, _, y0, x0, side in chosen[:n_patches]]


def patch_std(plane, rect):
    y0, x0, side = rect
    p = plane[y0:y0 + side, x0:x0 + side]
    return float((p - p.mean()).std())  # whole-patch mean subtraction — see module docstring


def rect_norm(rect, shape):
    y0, x0, side = rect
    h, w = shape
    return (y0 / h, x0 / w, side / h, side / w)


def rect_denorm(rect_n, shape):
    ny0, nx0, nsh, nsw = rect_n
    h, w = shape
    side = int(round(nsh * h))
    return (int(round(ny0 * h)), int(round(nx0 * w)), side)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lr-no-nr', required=True)
    ap.add_argument('--lr-default-nr', required=True)
    ap.add_argument('--cs-no-nr', required=True)
    ap.add_argument('--cs-default-nr', required=True)
    ap.add_argument('--cs-high', default=None, help='Chromasmith export, High-tier (neural) noise reduction ON')
    ap.add_argument('--lr-denoise', default=None, help='Lightroom export, AI Denoise checkbox ON')
    ap.add_argument('--n-patches', type=int, default=N_PATCHES)
    args = ap.parse_args()
    if bool(args.cs_high) != bool(args.lr_denoise):
        ap.error('--cs-high and --lr-denoise must be given together (both or neither)')

    imgs = {
        'lr_no': load(args.lr_no_nr),
        'lr_def': load(args.lr_default_nr),
        'cs_no': load(args.cs_no_nr),
        'cs_def': load(args.cs_default_nr),
    }
    if args.cs_high:
        imgs['cs_high'] = load(args.cs_high)
        imgs['lr_denoise'] = load(args.lr_denoise)
    planes = {k: to_ycbcr(v) for k, v in imgs.items()}  # (y, cb, cr) per image

    ref_y = planes['lr_no'][0]
    rects = find_flat_patches(ref_y, args.n_patches, PATCH_FRAC, GRID_STEP_FRAC)
    rects_n = [rect_norm(r, ref_y.shape) for r in rects]

    print(f"{args.n_patches} flat patches auto-detected on {args.lr_no_nr} "
          f"({ref_y.shape[1]}x{ref_y.shape[0]})\n")

    header = f"{'patch (luma)':<16}{'ch':>3}{'LR noNR':>10}{'CS noNR':>10}{'Δ%':>7}  {'decode':<6}" \
             f"{'LR defNR':>10}{'CS defNR':>10}{'Δ%':>7}  {'nr-match':<8}"
    if args.cs_high:
        header += f"  {'LR denoise':>10}{'CS High':>10}{'Δ%':>7}  {'high-match':<8}"
    print(header)
    print('-' * len(header))

    n_pass_decode = n_fail_decode = 0
    n_pass_nr = n_fail_nr = 0
    n_pass_high = n_fail_high = 0
    decode_ratios, nr_ratios, high_ratios = [], [], []

    for i, rn in enumerate(rects_n):
        patch_luma = ref_y[rect_denorm(rn, ref_y.shape)[0]:rect_denorm(rn, ref_y.shape)[0] + rect_denorm(rn, ref_y.shape)[2],
                            rect_denorm(rn, ref_y.shape)[1]:rect_denorm(rn, ref_y.shape)[1] + rect_denorm(rn, ref_y.shape)[2]].mean()
        for ch_i, ch_name in enumerate(('Y', 'Cb', 'Cr')):
            row_label = f"#{i} (L={patch_luma:.2f})" if ch_i == 0 else f"#{i}"
            results = {}
            for k in imgs:
                shape = planes[k][0].shape
                rect = rect_denorm(rn, shape)
                results[k] = patch_std(planes[k][ch_i], rect)

            d_err = abs(results['cs_no'] - results['lr_no']) / max(results['lr_no'], 1e-6)
            d_ok = (1 / TOL_RATIO) <= (results['cs_no'] / max(results['lr_no'], 1e-9)) <= TOL_RATIO
            n_pass_decode += d_ok
            n_fail_decode += not d_ok
            decode_ratios.append(results['cs_no'] / max(results['lr_no'], 1e-9))

            n_err = abs(results['cs_def'] - results['lr_def']) / max(results['lr_def'], 1e-6)
            n_ok = (1 / TOL_RATIO) <= (results['cs_def'] / max(results['lr_def'], 1e-9)) <= TOL_RATIO
            n_pass_nr += n_ok
            n_fail_nr += not n_ok
            nr_ratios.append(results['cs_def'] / max(results['lr_def'], 1e-9))

            row = (f"{row_label:<16}{ch_name:>3}"
                   f"{results['lr_no']*1000:>10.2f}{results['cs_no']*1000:>10.2f}{d_err*100:>6.0f}%"
                   f"  {'OK' if d_ok else 'OFF':<6}"
                   f"{results['lr_def']*1000:>10.2f}{results['cs_def']*1000:>10.2f}{n_err*100:>6.0f}%"
                   f"  {'MATCH' if n_ok else 'MISS':<8}")
            if args.cs_high:
                h_err = abs(results['cs_high'] - results['lr_denoise']) / max(results['lr_denoise'], 1e-6)
                h_ok = (1 / TOL_RATIO) <= (results['cs_high'] / max(results['lr_denoise'], 1e-9)) <= TOL_RATIO
                n_pass_high += h_ok
                n_fail_high += not h_ok
                high_ratios.append(results['cs_high'] / max(results['lr_denoise'], 1e-9))
                row += (f"  {results['lr_denoise']*1000:>10.2f}{results['cs_high']*1000:>10.2f}"
                        f"{h_err*100:>6.0f}%  {'MATCH' if h_ok else 'MISS':<8}")
            print(row)

    print(f"\nstd values x1000, whole-patch mean-subtracted, linear-ish display-space (as loaded)")
    print(f"\nDecode-floor check (CS noNR vs LR noNR): {n_pass_decode} OK / {n_fail_decode} OFF "
          f"(tolerance: within {TOL_RATIO}x either direction)")
    print(f"  median ratio CS/LR = {np.median(decode_ratios):.2f}x "
          f"({'CS noisier' if np.median(decode_ratios) > 1 else 'LR noisier'} at baseline)")
    print(f"\nNR-match check (CS defaultNR vs LR defaultNR): {n_pass_nr} MATCH / {n_fail_nr} MISS")
    print(f"  median ratio CS/LR = {np.median(nr_ratios):.2f}x "
          f"({'CS under-reduces (still noisier than LR)' if np.median(nr_ratios) > 1.1 else ('CS over-smooths vs LR' if np.median(nr_ratios) < 0.9 else 'comparable to LR')})")

    if args.cs_high:
        print(f"\nHIGH-TIER check (CS High vs LR Denoise) — INFORMATIONAL, does NOT affect exit code:")
        print(f"  {n_pass_high} MATCH / {n_fail_high} MISS (tolerance: within {TOL_RATIO}x, same as above —")
        print(f"  not a validated threshold for this comparison yet, see module doc)")
        print(f"  median ratio CS/LR = {np.median(high_ratios):.2f}x "
              f"({'CS under-reduces vs LR Denoise' if np.median(high_ratios) > 1.1 else ('CS over-smooths vs LR Denoise' if np.median(high_ratios) < 0.9 else 'comparable to LR Denoise')})")

    # Own-pipeline reduction, for context (this is the number previously reported —
    # now shown alongside the real LR comparison instead of standing alone).
    own_y_no = np.mean([patch_std(planes['cs_no'][1], rect_denorm(rn, planes['cs_no'][1].shape)) for rn in rects_n])
    own_y_def = np.mean([patch_std(planes['cs_def'][1], rect_denorm(rn, planes['cs_def'][1].shape)) for rn in rects_n])
    if own_y_no > 1e-9:
        print(f"\n(for reference) CS self-relative Cb reduction: "
              f"{(1 - own_y_def / own_y_no) * 100:.1f}% — NOT a substitute for the LR-match check above")

    sys.exit(0 if (n_fail_nr == 0) else 1)


if __name__ == '__main__':
    main()
