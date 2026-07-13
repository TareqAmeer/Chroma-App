"""
Chroma-space, variance-adaptive denoise prototype (Step B) — replaces the earlier
per-RGB-channel GAT approach, which was found to DECORRELATE the channels and increase
chroma noise in highlights rather than reduce it (see calib/nr_vst_compare.py's __TM8159
results and the plan file's Step 3/Step B writeup for the full diagnosis).

Pipeline:
  1. Demosaic the raw CFA mosaic (bilinear, debug-preview quality) to get R,G,B planes.
  2. Estimate a LOCAL (smoothed) signal per channel — using the raw noisy pixel as its own
     signal estimate would bias the variance model high (classic empirical-Bayes pitfall).
  3. Evaluate the calibrated per-channel Poisson-Gaussian model var_c(S) = a_c*S + b_c at that
     local signal, per channel, then error-propagate through the YCbCr matrix to get a
     PER-PIXEL local chroma variance:
       var_cb(p) = 0.1687^2*var_R(R_hat) + 0.3313^2*var_G(G_hat) + 0.5^2*var_B(B_hat)
       var_cr(p) = 0.5^2*var_R(R_hat)   + 0.4187^2*var_G(G_hat)  + 0.0813^2*var_B(B_hat)
  4. À-trous wavelet decompose Cb/Cr (same B3-spline kernel as raw_decode.rs). At each level,
     Wiener-style adaptive shrink the detail coefficient using the per-pixel expected noise
     variance AT THAT LEVEL, obtained by propagating var_cb/var_cr through the same linear
     smoothing filter (noise variance through a linear filter with independent per-pixel
     input noise: var_smooth = var_in * S, var_detail = var_in * (1 - 2*Kc + S), where S is
     the kernel's sum-of-squares and Kc its center weight — both closed-form constants of the
     FIXED B3-spline kernel, cascaded level to level exactly like the pixel values are).
  5. No per-ISO lookup table anywhere — the per-pixel local variance IS the per-ISO/
     per-brightness adaptation, automatically, everywhere in the image, at every level.
  6. Reconstruct with luma taken from the ORIGINAL (noisy) image, chroma from the shrunk
     planes — same luma-preserving design as denoise_chroma_wavelet_rgb16.

`strength` follows the DNG NoiseProfile convention: 1.0 = shrink using the model's literal
variance prediction ("physically ideal"); >1 assumes more noise than measured (more
aggressive); <1 assumes less (gentler).

⚠️ Known caveat (documented, not yet resolved — see the plan file): the calibration was fit
on the RAW CFA (pre-demosaic) mosaic, but this operates on DEMOSAICED values. Bilinear/PPG
interpolation itself reduces variance at interpolated pixel positions relative to a true
native-channel sample, so var_R/var_G/var_B evaluated directly on demosaiced values likely
OVERESTIMATES true local noise at interpolated positions. If results look inconsistent/patchy
rather than uniformly off, suspect this first (see the plan's suggested empirical-correction-
factor fix).

Usage:
    python3 calib/vst_denoise.py <input.RW2> [strength] [out_prefix]
Requires: the native `dump_cfa` example built (desktop/src-tauri/examples/dump_cfa.rs) and
calib/noise_profile.json (from calib/noise_fit.py).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

REPO = Path(__file__).parent.parent
PROFILE_PATH = Path(__file__).parent / 'noise_profile.json'
DUMP_CFA_BIN = REPO / 'desktop/src-tauri/target/release/examples/dump_cfa'

K1D = np.array([1, 4, 6, 4, 1], dtype=np.float64) / 16.0
K_CENTER_2D = (K1D[2]) ** 2                     # separable 2D kernel's center-tap weight
K_SUMSQ_2D = (np.sum(K1D ** 2)) ** 2             # separable 2D kernel's sum-of-squares (S)
LEVELS = 6                                       # fixed; no per-ISO table (see docstring)

YCBCR_COEF = {
    'cb': (0.168736 ** 2, 0.331264 ** 2, 0.5 ** 2),
    'cr': (0.5 ** 2, 0.418688 ** 2, 0.081312 ** 2),
}


def atrous_smooth(plane: np.ndarray, step: int) -> np.ndarray:
    """Separable à-trous convolution, B3-spline kernel, edge-clamped — matches
    raw_decode.rs's atrous_smooth exactly (same kernel, same hole spacing 2^lvl)."""
    h, w = plane.shape
    tmp = np.zeros_like(plane)
    offs = [(-2 + k) * step for k in range(5)]
    for k, off in enumerate(offs):
        idx = np.clip(np.arange(w) + off, 0, w - 1)
        tmp += plane[:, idx] * K1D[k]
    out = np.zeros_like(plane)
    for k, off in enumerate(offs):
        idx = np.clip(np.arange(h) + off, 0, h - 1)
        out += tmp[idx, :] * K1D[k]
    return out


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def luma_detail_cascade(y: np.ndarray, levels: int):
    """Per-level |current - smooth| luma-edge magnitude, TRUE dyadic à-trous spacing
    (step=2^level, matching raw_decode.rs's `1usize << lvl` exactly) — same cascade shape as
    the Cb/Cr denoise below, so levels line up 1:1. mirrors raw_decode.rs's `luma_detail`."""
    current = y.copy()
    details = []
    for lvl in range(levels):
        smooth = atrous_smooth(current, 1 << lvl)
        details.append(np.abs(current - smooth))
        current = smooth
    return details


def adaptive_wavelet_denoise(
    plane: np.ndarray, var0: np.ndarray, levels: int, strength: float,
    luma_detail=None, coarse_boost: float = 0.0,
    gate_lo: float = 0.0021, gate_hi: float = 0.0046,
    coarse_lo: float = 0.30, coarse_hi: float = 0.55, keep_protect: float = 0.98,
) -> np.ndarray:
    """À-trous decomposition with per-pixel, per-level Wiener-style adaptive shrinkage,
    driven by the calibrated noise model's per-pixel variance (propagated level-to-level
    through the same linear smoothing filter — see module docstring for the derivation).

    Test 1 (luma_detail passed): ports raw_decode.rs's luma-edge-gated coarse-level
    protection (`raw_decode.rs:357-431`) — a real luma edge at a coarse scale pulls `keep`
    toward `keep_protect` regardless of what the Wiener formula alone would do, so real
    color-carrying structure at luminance edges isn't smoothed away as if it were noise.
    Test 2 (coarse_boost>0): additionally ramps the ASSUMED noise level up at coarse levels
    only (RawTherapee's approach — chroma mottling lives at coarse scales; fine scales carry
    real luma-correlated color texture and should stay gentle)."""
    current = plane.copy()
    var_current = var0.copy()
    rebuilt = np.zeros_like(plane)
    ldiv = max(levels - 1, 1)
    for lvl in range(levels):
        smooth = atrous_smooth(current, 1 << lvl)  # true dyadic spacing (was step=1 always —
        # a bug: real edges collapsed to near-zero detail at coarse levels since the signal
        # was already fully pre-blurred by prior fine-level passes, which silently defeated
        # the luma-edge gate below at exactly the levels it's meant to protect. Fixed.)
        detail = current - smooth
        var_detail = var_current * (1.0 - 2.0 * K_CENTER_2D + K_SUMSQ_2D)
        var_smooth = var_current * K_SUMSQ_2D

        lvl_frac = lvl / ldiv
        level_strength = strength * (1.0 + coarse_boost * lvl_frac)
        noise_energy = np.maximum(level_strength * var_detail, 1e-12)
        signal_energy = detail ** 2
        keep = signal_energy / (signal_energy + noise_energy)  # Wiener-style local shrink

        if luma_detail is not None:
            coarse_gate = smoothstep(coarse_lo, coarse_hi, lvl_frac)
            edge_gate = smoothstep(gate_lo, gate_hi, luma_detail[lvl])
            keep = keep + coarse_gate * edge_gate * (keep_protect - keep)

        rebuilt += detail * keep
        current = smooth
        var_current = var_smooth
    rebuilt += current  # residual low-pass carries the true (very low variance) signal
    return rebuilt


def var_model(signal, a, b):
    return np.maximum(a * signal + b, 0.0)


def load_profile():
    return json.loads(PROFILE_PATH.read_text())['per_iso']


def interp_ab(profile, iso, channel):
    """Log-linear interpolation of (a,b) between the nearest calibrated ISOs."""
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
    offs = {0: [], 1: [], 2: []}
    for r in range(2):
        for c in range(2):
            offs[pattern[r][c]].append((r, c))
    return offs


def bilinear_upsample_to(sub, full_shape, r0, c0):
    h, w = full_shape
    out = np.zeros(full_shape)
    sh, sw = sub.shape
    out[r0::2, c0::2][:sh, :sw] = sub
    filled = out.copy()
    padded = np.pad(filled, 1, mode='edge')
    neighbors = (
        padded[0:-2, 0:-2] + padded[0:-2, 2:] + padded[2:, 0:-2] + padded[2:, 2:]
        + padded[0:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, 0:-2] + padded[1:-1, 2:]
    ) / 8.0
    mask = np.ones(full_shape, dtype=bool)
    mask[r0::2, c0::2] = False
    filled[mask] = neighbors[mask]
    return filled


def merge_g(g1, g2, pattern_offsets, shape):
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


def wb_gamma_preview(rgb):
    """Percentile ("white-patch") WB + sRGB gamma, VISUAL QC only (not colorimetric)."""
    p995 = np.percentile(rgb.reshape(-1, 3), 99.5, axis=0)
    out = np.clip(rgb / np.maximum(p995, 1e-6), 0, 1)
    srgb = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    return np.clip(srgb, 0, 1)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    raw_path = Path(sys.argv[1])
    strength = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    out_prefix = sys.argv[3] if len(sys.argv) > 3 else raw_path.stem
    # variant: baseline | luma_gate | luma_gate+coarse  (Gemini-review test 1 / test 1+2)
    variant = sys.argv[4] if len(sys.argv) > 4 else 'baseline'
    coarse_boost = float(sys.argv[5]) if len(sys.argv) > 5 else 1.5

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
    shape = plane.shape

    print('demosaicing...')
    R = bilinear_upsample_to(plane[r0::2, c0::2], shape, r0, c0)
    B = bilinear_upsample_to(plane[b0::2, bc0::2], shape, b0, bc0)
    G = merge_g(plane[gr0::2, gc0::2], plane[gr1::2, gc1::2], offs, shape)
    rgb_noisy = np.stack([R, G, B], axis=-1)

    print('estimating local signal + chroma variance...')
    a_R, b_R = interp_ab(profile, iso, 'R')
    a_G, b_G = interp_ab(profile, iso, 'G')
    a_B, b_B = interp_ab(profile, iso, 'B')
    # Local (smoothed) signal estimate — avoids the empirical-Bayes bias of using the raw
    # noisy pixel as its own signal estimate (see module docstring, point 2).
    R_hat = uniform_filter(R, size=5)
    G_hat = uniform_filter(G, size=5)
    B_hat = uniform_filter(B, size=5)
    var_R = var_model(R_hat, a_R, b_R)
    var_G = var_model(G_hat, a_G, b_G)
    var_B = var_model(B_hat, a_B, b_B)

    wcb = YCBCR_COEF['cb']
    wcr = YCBCR_COEF['cr']
    var_cb0 = wcb[0] * var_R + wcb[1] * var_G + wcb[2] * var_B
    var_cr0 = wcr[0] * var_R + wcr[1] * var_G + wcr[2] * var_B

    y_noisy, cb_noisy, cr_noisy = ycbcr(rgb_noisy)

    luma_detail = None
    cboost = 0.0
    if variant in ('luma_gate', 'luma_gate+coarse'):
        print('computing luma-edge cascade...')
        luma_detail = luma_detail_cascade(y_noisy, LEVELS)
    if variant == 'luma_gate+coarse':
        cboost = coarse_boost
    print(f'variant={variant} coarse_boost={cboost}')

    print('denoising Cb (variance-adaptive)...')
    cb_dn = adaptive_wavelet_denoise(cb_noisy, var_cb0, LEVELS, strength, luma_detail, cboost)
    print('denoising Cr (variance-adaptive)...')
    cr_dn = adaptive_wavelet_denoise(cr_noisy, var_cr0, LEVELS, strength, luma_detail, cboost)

    rgb_final = from_ycbcr(y_noisy, cb_dn, cr_dn)  # luma preserved from the noisy original
    preview_dn = wb_gamma_preview(rgb_final)
    preview_noisy = wb_gamma_preview(rgb_noisy)

    out_dn = Path(f'calib/{out_prefix}_vst_denoised.png')
    out_noisy = Path(f'calib/{out_prefix}_vst_noisy.png')
    Image.fromarray((preview_dn * 255).astype(np.uint8)).save(out_dn)
    Image.fromarray((preview_noisy * 255).astype(np.uint8)).save(out_noisy)
    print(f'wrote {out_noisy}\nwrote {out_dn}')


if __name__ == '__main__':
    main()
