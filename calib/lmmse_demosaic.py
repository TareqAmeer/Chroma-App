"""
LMMSE demosaic prototype — replaces PPG's directional pattern-grouping (which fails on the
extreme-contrast micro-edges of water sparkle, producing false-color green/magenta dots) with
a statistically-optimal reconstruction that can distinguish real chrominance detail from
interpolation noise using the calibrated sensor noise model (calib/noise_profile.json).

Why this is different from the post-demosaic median approach (calib/false_color_gate.py),
which was measured to fail: that approach operates on the FINAL RGB image, where a real bright
colored point and a demosaic false-color artifact are indistinguishable (both are local
chroma+luma outliers). LMMSE operates on the RAW BAYER DATA, using the actual same-channel
neighbor samples and the calibrated per-pixel noise variance to tell them apart BEFORE that
information is destroyed by the demosaic itself.

Algorithm (Hamilton-Adams green + LMMSE color-difference shrink):
  1. Fully populate G via directional (H vs V) 2nd-derivative-corrected interpolation at R/B
     sites, picking direction by local gradient magnitude (this fixes the PPG failure mode
     directly: HA reasons about EACH missing pixel's own local gradient, same core idea PPG
     uses, but combined with step 3 below which PPG has no equivalent of).
  2. Color-difference planes ΔR=R-G, ΔB=B-G at native R/B sites (chrominance is decorrelated
     from luminance this way — standard demosaic theory).
  3. LMMSE shrink: Δ̂ = μ + max(0, σ²-σₙ²)/σ² · (Δ_raw - μ), where μ,σ² are the LOCAL mean/
     variance of the (gap-filled) color-difference plane and σₙ² is the calibrated model's
     expected noise variance at that signal level. Where local variance is close to the
     expected NOISE variance (a false-color spike), the fraction -> 0 and the pixel is pulled
     to the local mean. Where variance greatly exceeds noise (a real, strong color edge), the
     fraction -> 1 and detail is preserved.
  4. R = G + Δ̂_R, B = G + Δ̂_B everywhere.

Usage: run directly to execute the validation ladder (synthetic safety tests -> real sparkle
patch green-dot metric) before any Rust port is considered.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import uniform_filter, label

sys.path.insert(0, str(Path(__file__).parent))
from vst_denoise import interp_ab, load_profile, var_model  # noqa: E402

REPO = Path(__file__).parent.parent
DUMP_CFA_BIN = REPO / 'desktop/src-tauri/target/release/examples/dump_cfa'


def shift(m, dy, dx, pad, h, w):
    return m[pad + dy:pad + dy + h, pad + dx:pad + dx + w]


def hamilton_adams_green(mosaic, r_mask, b_mask):
    """Directional green interpolation at R/B sites. mosaic: full 2D Bayer array."""
    h, w = mosaic.shape
    pad = 2
    m = np.pad(mosaic, pad, mode='edge')

    def s(dy, dx):
        return shift(m, dy, dx, pad, h, w)

    c = s(0, 0)
    g_h = (s(0, -1) + s(0, 1)) / 2.0 + (2 * c - s(0, -2) - s(0, 2)) / 4.0
    g_v = (s(-1, 0) + s(1, 0)) / 2.0 + (2 * c - s(-2, 0) - s(2, 0)) / 4.0
    delta_h = np.abs(s(0, -1) - s(0, 1)) + np.abs(c - s(0, -2) + c - s(0, 2))
    delta_v = np.abs(s(-1, 0) - s(1, 0)) + np.abs(c - s(-2, 0) + c - s(2, 0))

    g_est = np.where(delta_h < delta_v, g_h, np.where(delta_v < delta_h, g_v, (g_h + g_v) / 2.0))
    g_full = mosaic.copy()
    missing = r_mask | b_mask
    g_full[missing] = g_est[missing]
    return g_full


def gapfill_sparse(sparse, known_mask, shape):
    """Simple gap-fill: iterative 3x3-neighbor mean fill (chrominance is smooth, this is
    adequate — same spirit as vst_denoise.py's bilinear_upsample_to)."""
    out = sparse.copy()
    filled_mask = known_mask.copy()
    for _ in range(3):  # a few passes reach every position from a quarter-sparse grid
        padded = np.pad(out, 1, mode='edge')
        pmask = np.pad(filled_mask, 1, mode='constant', constant_values=False)
        neighbor_sum = (
            padded[0:-2, 0:-2] + padded[0:-2, 1:-1] + padded[0:-2, 2:]
            + padded[1:-1, 0:-2] + padded[1:-1, 2:]
            + padded[2:, 0:-2] + padded[2:, 1:-1] + padded[2:, 2:]
        )
        neighbor_cnt = (
            pmask[0:-2, 0:-2] + pmask[0:-2, 1:-1] + pmask[0:-2, 2:]
            + pmask[1:-1, 0:-2] + pmask[1:-1, 2:]
            + pmask[2:, 0:-2] + pmask[2:, 1:-1] + pmask[2:, 2:]
        ).astype(np.float64)
        need = ~filled_mask
        avg = np.divide(neighbor_sum, neighbor_cnt, out=np.zeros_like(out), where=neighbor_cnt > 0)
        update = need & (neighbor_cnt > 0)
        out[update] = avg[update]
        filled_mask |= update
    return out


def lmmse_shrink(delta_dense, var_noise, win=5):
    mu = uniform_filter(delta_dense, size=win)
    mean_sq = uniform_filter(delta_dense ** 2, size=win)
    var_local = np.maximum(mean_sq - mu ** 2, 0.0)
    gain = np.divide(np.maximum(var_local - var_noise, 0.0), np.maximum(var_local, 1e-12))
    return mu + gain * (delta_dense - mu)


def subgrid_masks(pattern, shape):
    h, w = shape
    tile = np.array(pattern)
    ph, pw = tile.shape
    full = np.tile(tile, (h // ph + 1, w // pw + 1))[:h, :w]
    return {c: (full == c) for c in (0, 1, 2)}  # 0=R,1=G,2=B


def lmmse_demosaic(mosaic, cfa_pattern, iso, profile):
    h, w = mosaic.shape
    masks = subgrid_masks(cfa_pattern, mosaic.shape)
    r_mask, g_mask, b_mask = masks[0], masks[1], masks[2]

    g_full = hamilton_adams_green(mosaic, r_mask, b_mask)

    delta_r_sparse = np.zeros((h, w))
    delta_b_sparse = np.zeros((h, w))
    delta_r_sparse[r_mask] = mosaic[r_mask] - g_full[r_mask]
    delta_b_sparse[b_mask] = mosaic[b_mask] - g_full[b_mask]

    delta_r_dense = gapfill_sparse(delta_r_sparse, r_mask, (h, w))
    delta_b_dense = gapfill_sparse(delta_b_sparse, b_mask, (h, w))

    a_r, b_r = interp_ab(profile, iso, 'R')
    a_g, b_g = interp_ab(profile, iso, 'G')
    a_b, b_b = interp_ab(profile, iso, 'B')
    # noise variance of a color-difference estimate ~ sum of the two channels' own variances
    # (R-G and B-G are each a difference of two roughly-independent noisy measurements)
    var_noise_r = var_model(g_full, a_g, b_g) + var_model(np.clip(g_full + delta_r_dense, 0, 1), a_r, b_r)
    var_noise_b = var_model(g_full, a_g, b_g) + var_model(np.clip(g_full + delta_b_dense, 0, 1), a_b, b_b)

    delta_r_hat = lmmse_shrink(delta_r_dense, var_noise_r)
    delta_b_hat = lmmse_shrink(delta_b_dense, var_noise_b)

    r_final = g_full + delta_r_hat
    b_final = g_full + delta_b_hat
    return np.clip(np.stack([r_final, g_full, b_final], axis=-1), 0, 1)


def dump_cfa(raw_path: Path, out_bin: Path):
    subprocess.run([str(DUMP_CFA_BIN), str(raw_path), str(out_bin)], check=True)
    meta = json.loads((out_bin.with_suffix(out_bin.suffix + '.json')).read_text())
    w, h = meta['width'], meta['height']
    plane = np.fromfile(out_bin, dtype='<f4').reshape(h, w)
    return plane, meta


def green_frac_clumps(rgb, thresh=0.06):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = (g - np.maximum(r, b)) > thresh
    lbl, n = label(green)
    return float(green.mean() * 100), n


# ── Synthetic safety tests (mirroring false_color_gate.py's, but on RAW CFA data this time) ──
RGGB = [[0, 1], [1, 2]]


def encode_bayer(rgb, pattern=RGGB):
    """Encode a synthetic RGB image into its Bayer mosaic (ground-truth sampling)."""
    h, w, _ = rgb.shape
    masks = subgrid_masks(pattern, (h, w))
    mosaic = np.zeros((h, w))
    mosaic[masks[0]] = rgb[..., 0][masks[0]]
    mosaic[masks[1]] = rgb[..., 1][masks[1]]
    mosaic[masks[2]] = rgb[..., 2][masks[2]]
    return mosaic


def flat_profile(iso=5000):
    """A representative calibrated profile point for testing (reuses real fitted values)."""
    return load_profile()


def test_isolated_dot(bright=0.6):
    """A single saturated red 'dot' — in Bayer terms, a small cluster of R/G/B sensor sites
    all reading a real elevated value (a genuine point light does illuminate a small patch of
    the sensor, not literally one physical pixel of one channel) on a flat dark background."""
    rgb = np.zeros((40, 40, 3))
    rgb[..., 2] = 0.05
    rgb[19:21, 19:21] = [bright, 0.05, 0.05]  # 2x2 real colored region -> hits R,G,G,B sites
    mosaic = encode_bayer(rgb)
    profile = flat_profile()
    out = lmmse_demosaic(mosaic, RGGB, 5000, profile)
    before = rgb[20, 20]
    after = out[20, 20]
    err = np.abs(before - after).max()
    print(f"[LMMSE safety] isolated {bright:.2f}-bright dot: max diff={err:.4f} "
          f"before={before} after={np.round(after,3)}  {'PASS' if err < 0.1 else 'FAIL'}")
    return err < 0.1


def test_false_color_edge():
    """A hard bright/dark edge (sparkle boundary) — demosaic false color at a Bayer-scale
    edge should be suppressed by the LMMSE shrink (local variance dominated by the
    interpolation spike vs the calibrated noise floor at a smooth region)."""
    rgb = np.zeros((40, 40, 3))
    rgb[:20, :] = 0.9
    rgb[20:, :] = 0.05
    mosaic = encode_bayer(rgb)
    # simulate a PPG-style false-color error directly IN THE MOSAIC near the edge (a green
    # site reading anomalously high right at the transition, as real sensor+interpolation
    # error would manifest before any demosaic runs)
    mosaic[19, 20] = 0.98  # this is a G site (row19 odd -> per RGGB pattern check)
    profile = flat_profile()
    out = lmmse_demosaic(mosaic, RGGB, 5000, profile)
    r, g, b = out[19, 20]
    is_green = (g - max(r, b)) > 0.06
    print(f"[LMMSE safety] false-color at hard edge: after={np.round(out[19,20],3)} "
          f"{'FAIL (still green)' if is_green else 'PASS (cleaned)'}")
    return not is_green


if __name__ == '__main__':
    print("=== LMMSE synthetic safety tests ===")
    ok1 = test_isolated_dot(0.35)
    ok2 = test_isolated_dot(0.6)
    ok3 = test_isolated_dot(0.9)
    ok4 = test_false_color_edge()
    print(f"\nGATE OVERALL: {'PASS' if all([ok1,ok2,ok3,ok4]) else 'FAIL'}")
