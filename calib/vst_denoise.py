"""
Variance Stabilizing Transform (VST) denoise prototype — validates that a SINGLE static
denoise strength, applied after a calibrated Generalized Anscombe Transform (GAT), can
replace the hand-tuned per-ISO wavelet strength/level table in
desktop/src-tauri/src/raw_decode.rs (`denoise_chroma_wavelet_rgb16`).

Pipeline (operates on the RAW CFA mosaic — the space calib/noise_fit.py calibrated in,
BEFORE white balance/demosaic, per the WB-trap constraint in CLAUDE.md's noise-model plan):

  1. Split the Bayer mosaic into 4 clean half-resolution rectangular subgrids (R, G1, G2, B)
     using the CFA pattern from dump_cfa's sidecar — each subgrid is a regular lattice, so
     the existing à-trous kernel applies directly with no mosaic-aware masking needed.
  2. Forward GAT each subgrid using calib/noise_profile.json's fitted (a, b) for that ISO/
     channel (log-linearly interpolated between calibrated ISOs) — after this, noise has
     ~unit variance everywhere regardless of original brightness or ISO.
  3. À-trous wavelet denoise (B3-spline [1,4,6,4,1]/16, ported from raw_decode.rs) with ONE
     fixed strength — no per-ISO table, no luma-gated protection hack. The whole point of the
     VST: because variance is already stabilized, the same static strength is correct at every
     brightness/ISO, unlike the current pipeline's hand-tuned per-bracket table.
  4. Inverse GAT (closed-form algebraic inverse — an approximation of the exact
     unbiased Makitalo-Foi inverse; adequate for this prototype's validation purpose).
  5. Reassemble the mosaic, do a quick bilinear demosaic + gray-world WB (for a VIEWABLE PNG
     only — not colorimetrically accurate; this script validates denoising, not color).

Usage:
    python3 calib/vst_denoise.py <input.RW2> [strength] [out_prefix]
Requires: calib/cfa_dump/*.bin(.json) already produced (for context) and the native
`dump_cfa` example built (desktop/src-tauri/examples/dump_cfa.rs).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).parent.parent
PROFILE_PATH = Path(__file__).parent / 'noise_profile.json'
DUMP_CFA_BIN = REPO / 'desktop/src-tauri/target/release/examples/dump_cfa'

K = np.array([1, 4, 6, 4, 1], dtype=np.float64) / 16.0


def atrous_smooth(plane: np.ndarray, step: int) -> np.ndarray:
    """Separable à-trous convolution, B3-spline kernel, edge-clamped — matches
    raw_decode.rs's atrous_smooth exactly (same kernel, same hole spacing 2^lvl)."""
    h, w = plane.shape
    tmp = np.zeros_like(plane)
    offs = [(-2 + k) * step for k in range(5)]
    for k, off in enumerate(offs):
        idx = np.clip(np.arange(w) + off, 0, w - 1)
        tmp += plane[:, idx] * K[k]
    out = np.zeros_like(plane)
    for k, off in enumerate(offs):
        idx = np.clip(np.arange(h) + off, 0, h - 1)
        out += tmp[idx, :] * K[k]
    return out


def wavelet_denoise(plane: np.ndarray, levels: int, strength: float) -> np.ndarray:
    """Single-strength à-trous wavelet attenuation — no per-level luma gating, no per-ISO
    table. Uniform `keep = 1 - strength` at every level/scale; the VST is what makes this
    correct everywhere instead of needing hand-tuned per-bracket values."""
    current = plane.copy()
    rebuilt = np.zeros_like(plane)
    keep = 1.0 - strength
    for lvl in range(levels):
        smooth = atrous_smooth(current, 1 << lvl)
        rebuilt += (current - smooth) * keep
        current = smooth
    rebuilt += current  # residual low-pass carries the true signal, untouched
    return rebuilt


def gat_forward(x, a, b):
    """Generalized Anscombe Transform for Poisson(scale a)+Gaussian(var b) noise:
    stabilizes variance to ~1 across all signal levels x."""
    a = max(a, 1e-8)
    return (2.0 / a) * np.sqrt(np.maximum(a * x + (3.0 / 8.0) * a * a + b, 0.0))


def gat_inverse(d, a, b):
    """Algebraic (biased) inverse of gat_forward — adequate for prototype validation.
    A production port should use the exact unbiased Makitalo-Foi closed-form inverse."""
    a = max(a, 1e-8)
    return ((d * a / 2.0) ** 2 - (3.0 / 8.0) * a * a - b) / a


def load_profile():
    return json.loads(PROFILE_PATH.read_text())['per_iso']


def interp_ab(profile, iso, channel):
    """Log-linear interpolation of (a,b) between the nearest calibrated ISOs (shot noise
    scales ~linearly with ISO gain, hence log-log interpolation on ISO)."""
    isos = sorted(int(k) for k in profile.keys())
    if iso <= isos[0]:
        p = profile[str(isos[0])][channel]
        return p['a'], p['b']
    if iso >= isos[-1]:
        p = profile[str(isos[-1])][channel]
        return p['a'], p['b']
    lo = max(i for i in isos if i <= iso)
    hi = min(i for i in isos if i >= iso)
    if lo == hi:
        p = profile[str(lo)][channel]
        return p['a'], p['b']
    t = (np.log(iso) - np.log(lo)) / (np.log(hi) - np.log(lo))
    plo, phi = profile[str(lo)][channel], profile[str(hi)][channel]
    a = np.exp(np.log(max(plo['a'], 1e-12)) * (1 - t) + np.log(max(phi['a'], 1e-12)) * t)
    b = plo['b'] * (1 - t) + phi['b'] * t
    return float(a), float(b)


def dump_cfa(raw_path: Path, out_bin: Path):
    subprocess.run([str(DUMP_CFA_BIN), str(raw_path), str(out_bin)], check=True)
    meta = json.loads((out_bin.with_suffix(out_bin.suffix + '.json')).read_text())
    w, h = meta['width'], meta['height']
    plane = np.fromfile(out_bin, dtype='<f4').reshape(h, w)
    return plane, meta


def subgrid_offsets(pattern):
    """pattern: 2x2 tile of color idx (0=R,1=G,2=B). Returns dict:
    'R' -> (r0,c0); 'B' -> (r0,c0); 'G' -> [(r0,c0),(r0,c0)] (the two G phases)."""
    offs = {0: [], 1: [], 2: []}
    for r in range(2):
        for c in range(2):
            offs[pattern[r][c]].append((r, c))
    return offs


def process_channel(plane, r0, c0, iso, ch_name, profile, levels, strength):
    sub = plane[r0::2, c0::2].astype(np.float64)
    a, b = interp_ab(profile, iso, ch_name)
    d = gat_forward(sub, a, b)
    d_dn = wavelet_denoise(d, levels, strength)
    out = gat_inverse(d_dn, a, b)
    return np.clip(out, 0.0, 1.0)


def bilinear_upsample_to(sub, full_shape, r0, c0):
    """Nearest+bilinear-ish placement of a half-res subgrid back to full resolution via
    simple 2x2 block replication + smoothing — good enough for a QC preview image."""
    h, w = full_shape
    out = np.zeros(full_shape)
    sh, sw = sub.shape
    # place samples at their true lattice positions, then fill gaps via a 3x3 box mean
    out[r0::2, c0::2][:sh, :sw] = sub
    filled = out.copy()
    # simple iterative gap-fill (a few passes of box blur restricted to zero cells is
    # overkill for a debug preview — do one clean pass: average of the 4 diagonal/adjacent
    # lattice samples using np.roll, edge-clamped by reflect padding)
    padded = np.pad(filled, 1, mode='edge')
    neighbors = (
        padded[0:-2, 0:-2] + padded[0:-2, 2:] + padded[2:, 0:-2] + padded[2:, 2:]
        + padded[0:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, 0:-2] + padded[1:-1, 2:]
    ) / 8.0
    mask = np.ones(full_shape, dtype=bool)
    mask[r0::2, c0::2] = False
    filled[mask] = neighbors[mask]
    return filled


def _merge_g(g1, g2, pattern_offsets, shape):
    """Merge the two G Bayer phases onto a full grid, gap-filled by nearest-neighbor mean."""
    (gr0, gc0), (gr1, gc1) = pattern_offsets[1]
    g_full = np.zeros(shape)
    g_full[gr0::2, gc0::2] = g1
    g_full[gr1::2, gc1::2] = g2
    mask = np.ones(shape, dtype=bool)
    mask[gr0::2, gc0::2] = False
    mask[gr1::2, gc1::2] = False
    padded = np.pad(g_full, 1, mode='edge')
    neighbors = (padded[0:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, 0:-2] + padded[1:-1, 2:]) / 4.0
    g_full[mask] = neighbors[mask]
    return g_full


def _ycbcr(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = -0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 0.5 * r - 0.418688 * g - 0.081312 * b
    return y, cb, cr


def _from_ycbcr(y, cb, cr):
    r = y + 1.402 * cr
    g = y - 0.344136 * cb - 0.714136 * cr
    b = y + 1.772 * cb
    return np.stack([r, g, b], axis=-1)


def _wb_gamma_preview(rgb):
    """Percentile ("white-patch") WB + sRGB gamma, for VISUAL QC only (not colorimetric).
    Matches each channel's near-white point to 1.0 so bright specular highlights map to full
    scale regardless of overall scene darkness — gray-world (mean-matching) under-exposed this
    dark scene badly enough that block-averaged highlight patches never crossed the bucket
    threshold used by nr_validate.py's flat_patches()."""
    p995 = np.percentile(rgb.reshape(-1, 3), 99.5, axis=0)
    out = np.clip(rgb / np.maximum(p995, 1e-6), 0, 1)
    srgb = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    return np.clip(srgb, 0, 1)


def demosaic_preview(planes, pattern_offsets, shape):
    """Cheap bilinear-ish demosaic + WB/gamma, for VISUAL QC only (not colorimetric)."""
    r0, c0 = pattern_offsets[0][0]
    b0, bc0 = pattern_offsets[2][0]
    R = bilinear_upsample_to(planes['R'], shape, r0, c0)
    B = bilinear_upsample_to(planes['B'], shape, b0, bc0)
    g_full = _merge_g(planes['G1'], planes['G2'], pattern_offsets, shape)
    rgb = np.stack([R, g_full, B], axis=-1)
    return _wb_gamma_preview(rgb)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    raw_path = Path(sys.argv[1])
    strength = float(sys.argv[2]) if len(sys.argv) > 2 else 0.8
    out_prefix = sys.argv[3] if len(sys.argv) > 3 else raw_path.stem
    levels = 5

    profile = load_profile()
    tmp_bin = Path(f'/tmp/{raw_path.stem}_cfa.bin')
    plane, meta = dump_cfa(raw_path, tmp_bin)
    iso = meta['iso']
    pattern = meta['cfa_pattern']
    offs = subgrid_offsets(pattern)
    print(f'{raw_path.name}: {meta["width"]}x{meta["height"]} ISO {iso}, strength={strength}')

    (r0, c0) = offs[0][0]
    (b0, bc0) = offs[2][0]
    (gr0, gc0), (gr1, gc1) = offs[1]

    print('denoising R...')
    R_dn = process_channel(plane, r0, c0, iso, 'R', profile, levels, strength)
    print('denoising G1...')
    G1_dn = process_channel(plane, gr0, gc0, iso, 'G', profile, levels, strength)
    print('denoising G2...')
    G2_dn = process_channel(plane, gr1, gc1, iso, 'G', profile, levels, strength)
    print('denoising B...')
    B_dn = process_channel(plane, b0, bc0, iso, 'B', profile, levels, strength)

    shape = plane.shape
    noisy_planes = {
        'R': plane[r0::2, c0::2],
        'G1': plane[gr0::2, gc0::2],
        'G2': plane[gr1::2, gc1::2],
        'B': plane[b0::2, bc0::2],
    }
    dn_planes = {'R': R_dn, 'G1': G1_dn, 'G2': G2_dn, 'B': B_dn}

    # CHROMA-ONLY reconstruction: denoising R/G/B independently smears LUMA too (measured:
    # over-smooths shadow/mid luma vs Lightroom, the exact "waxy" defect raw_decode.rs's own
    # chroma-only design avoids). Upsample both noisy and denoised RGB to full res, take Y from
    # the ORIGINAL noisy image and Cb/Cr from the denoised one — matches
    # denoise_chroma_wavelet_rgb16's luma-preserving reconstruction.
    rgb_noisy = np.stack([
        bilinear_upsample_to(noisy_planes['R'], shape, r0, c0),
        _merge_g(noisy_planes['G1'], noisy_planes['G2'], offs, shape),
        bilinear_upsample_to(noisy_planes['B'], shape, b0, bc0),
    ], axis=-1)
    rgb_dn = np.stack([
        bilinear_upsample_to(dn_planes['R'], shape, r0, c0),
        _merge_g(dn_planes['G1'], dn_planes['G2'], offs, shape),
        bilinear_upsample_to(dn_planes['B'], shape, b0, bc0),
    ], axis=-1)

    y_noisy, _, _ = _ycbcr(rgb_noisy)
    _, cb_dn, cr_dn = _ycbcr(rgb_dn)
    rgb_final = _from_ycbcr(y_noisy, cb_dn, cr_dn)

    preview_dn = _wb_gamma_preview(rgb_final)
    preview_noisy = _wb_gamma_preview(rgb_noisy)

    out_dn = Path(f'calib/{out_prefix}_vst_denoised.png')
    out_noisy = Path(f'calib/{out_prefix}_vst_noisy.png')
    Image.fromarray((preview_dn * 255).astype(np.uint8)).save(out_dn)
    Image.fromarray((preview_noisy * 255).astype(np.uint8)).save(out_noisy)
    print(f'wrote {out_noisy}\nwrote {out_dn}')


if __name__ == '__main__':
    main()
