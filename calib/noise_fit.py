"""
Poisson-Gaussian sensor noise calibration for the Panasonic DC-S9, fit via the two-frame
difference method (no grey card / uniform illumination needed — see CLAUDE.md's noise-model
plan). For each ISO, two back-to-back identical RAW frames were captured
(calib/noise_captures/*.RW2) of a static, defocused scene with a brightness ramp, and dumped
to raw (pre-white-balance, pre-demosaic) CFA planes via the native `dump_cfa` example
(desktop/src-tauri/examples/dump_cfa.rs) into calib/cfa_dump/*.bin (+ .bin.json sidecar).

Method: pixel-wise diff of the two frames cancels the (static) scene and any fixed-pattern
non-uniformity, leaving pure temporal noise: var(diff) = 2*var(true noise). The scene's own
brightness ramp supplies many signal levels from a single ISO/exposure, so we bin pixels by
their mean signal and fit, per CFA channel (R, G pooled over G1+G2, B):

    var_true(signal) = a * signal + b

`a` is the shot-noise/gain term (grows with ISO), `b` is the fixed read-noise floor.

⚠️ Must run on the RAW CFA plane BEFORE white balance — WB is a per-channel gain that would
scale (and invalidate) the fitted variance curve. dump_cfa.rs stops right after
apply_scaling() for exactly this reason (raw_decode.rs's decode goes further: WB, demosaic,
NR — none of that is safe to fit a physical noise model on).

Usage:
    python3 calib/noise_fit.py
Outputs:
    calib/noise_profile.json   — {iso: {R:{a,b,r2}, G:{a,b,r2}, B:{a,b,r2}}}
    calib/noise_fit_check.png  — QC scatter + fitted line per channel/ISO (go/no-go visual)
"""
import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

DUMP_DIR = Path(__file__).parent / 'cfa_dump'
OUT_JSON = Path(__file__).parent / 'noise_profile.json'
OUT_PNG = Path(__file__).parent / 'noise_fit_check.png'

CHANNEL_NAMES = {0: 'R', 1: 'G', 2: 'B'}
N_BINS = 64


def load_cfa(stem: str):
    """Load one dump_cfa .bin + its .bin.json sidecar → (plane f32 HxW, meta dict)."""
    bin_path = DUMP_DIR / f'{stem}.bin'
    meta = json.loads((DUMP_DIR / f'{stem}.bin.json').read_text())
    w, h = meta['width'], meta['height']
    plane = np.fromfile(bin_path, dtype='<f4').reshape(h, w)
    return plane, meta


def channel_masks(pattern, h, w):
    """pattern is a 2x2 tile of color indices (0=R,1=G,2=B). Return {channel: bool mask}."""
    ph, pw = len(pattern), len(pattern[0])
    tile = np.array(pattern)
    full = np.tile(tile, (h // ph + 1, w // pw + 1))[:h, :w]
    return {c: (full == c) for c in (0, 1, 2)}


def find_pairs():
    """Group calib/noise_captures stems by ISO (read from the dump_cfa sidecar), pairing the
    two frames captured at each ISO."""
    by_iso = defaultdict(list)
    for j in sorted(DUMP_DIR.glob('*.bin.json')):
        stem = j.name[: -len('.bin.json')]
        meta = json.loads(j.read_text())
        by_iso[meta['iso']].append(stem)
    pairs = {}
    for iso, stems in by_iso.items():
        if len(stems) != 2:
            print(f'  ! ISO {iso}: expected 2 frames, found {len(stems)} ({stems}) — skipping')
            continue
        pairs[iso] = tuple(sorted(stems))
    return dict(sorted(pairs.items()))


def fit_channel(signal, var, label):
    """Robust linear fit var = a*signal + b with one round of outlier rejection."""
    A = np.stack([signal, np.ones_like(signal)], axis=1)
    coef, *_ = np.linalg.lstsq(A, var, rcond=None)
    pred = A @ coef
    resid = var - pred
    sd = resid.std()
    keep = np.abs(resid) < 3 * sd if sd > 0 else np.ones_like(resid, dtype=bool)
    if keep.sum() >= 4 and keep.sum() < len(signal):
        coef, *_ = np.linalg.lstsq(A[keep], var[keep], rcond=None)
        pred = A @ coef
    a, b = coef
    ss_res = np.sum((var - pred) ** 2)
    ss_tot = np.sum((var - var.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float('nan')
    if a < 0:
        print(f'  ! {label}: negative shot-noise term a={a:.4g} — clamping to 0 (check exposure/clipping)')
        a = max(a, 0.0)
    if b < 0:
        b = max(b, 0.0)
    return float(a), float(b), float(r2)


def main():
    pairs = find_pairs()
    print(f'Found {len(pairs)} ISO pairs: {list(pairs.keys())}')

    profile = {}
    fig, axes = plt.subplots(3, len(pairs), figsize=(4 * len(pairs), 11), squeeze=False)

    for col, (iso, (stem_a, stem_b)) in enumerate(pairs.items()):
        plane_a, meta = load_cfa(stem_a)
        plane_b, _ = load_cfa(stem_b)
        h, w = plane_a.shape
        masks = channel_masks(meta['cfa_pattern'], h, w)

        diff = plane_a - plane_b
        mean = (plane_a + plane_b) / 2.0

        profile[iso] = {}
        for c, name in CHANNEL_NAMES.items():
            m = masks[c]
            sig_px = mean[m]
            diff_px = diff[m]

            # bin by signal level, drop bins touching the sensor ceiling (clipped -> var collapses)
            edges = np.linspace(0.0, min(sig_px.max(), 0.97), N_BINS + 1)
            idx = np.digitize(sig_px, edges) - 1
            sig_bin, var_bin = [], []
            for b_i in range(N_BINS):
                sel = idx == b_i
                if sel.sum() < 200:
                    continue
                sig_bin.append(sig_px[sel].mean())
                var_bin.append(diff_px[sel].var() / 2.0)  # var(diff)=2*var_true
            sig_bin = np.array(sig_bin)
            var_bin = np.array(var_bin)

            a, b, r2 = fit_channel(sig_bin, var_bin, f'ISO{iso}/{name}')
            profile[iso][name] = {'a': a, 'b': b, 'r2': r2, 'n_bins': int(len(sig_bin))}

            ax = axes[c][col]
            ax.scatter(sig_bin, var_bin, s=10, c={'R': 'r', 'G': 'g', 'B': 'b'}[name], alpha=0.7)
            xs = np.linspace(0, sig_bin.max() if len(sig_bin) else 1, 50)
            ax.plot(xs, a * xs + b, 'k--', lw=1)
            ax.set_title(f'ISO {iso} — {name}\na={a:.4g} b={b:.4g} R²={r2:.3f}', fontsize=9)
            if col == 0:
                ax.set_ylabel('variance (linear 0..1²)')
            if c == 2:
                ax.set_xlabel('signal (linear 0..1)')

    fig.tight_layout()
    fig.savefig(OUT_PNG, dpi=110)
    print(f'wrote {OUT_PNG}')

    OUT_JSON.write_text(json.dumps({'per_iso': profile}, indent=2))
    print(f'wrote {OUT_JSON}')

    # Sanity trend check across ISO
    print('\nISO   a(R)      a(G)      a(B)      b(R)      b(G)      b(B)')
    for iso in profile:
        p = profile[iso]
        print(f'{iso:<5} ' + '  '.join(f'{p[c]["a"]:.2e}' for c in "RGB") + '  ' +
              '  '.join(f'{p[c]["b"]:.2e}' for c in "RGB"))


if __name__ == '__main__':
    main()
