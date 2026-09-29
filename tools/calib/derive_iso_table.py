"""
Step A (low-risk incremental swap): replace `denoise_chroma_wavelet_rgb16`'s hand-picked
per-ISO-bracket (levels, strength) table (raw_decode.rs:281-302) with values computed from
the calibrated Poisson-Gaussian noise model (calib/noise_profile.json), WITHOUT touching the
wavelet algorithm itself.

Method: evaluate the fitted `var(S) = a*S + b` at a fixed reference signal level (mid-grey,
S=0.18 linear) per ISO, using the G channel (chroma noise is what this pass targets, and G is
the best-sampled/lowest-variance channel — also close to the luma-dominant channel). This
gives a continuous noise-magnitude curve sigma(ISO) instead of 5 discrete brackets.

`strength` is derived by linearly scaling sigma against the ISO-12800 anchor, which the
CURRENT hand-tuned table already treats as its reference point (raw_decode.rs's own comments:
"strength normalized to the 12800 reference of 0.78" and "Keep the proven strength (0.85, same
as 5000...)" — 0.78 at ISO 12800 is the one number in the existing table that was most
carefully validated against Lightroom, so anchoring to it (rather than re-deriving a free
scale constant) keeps this a low-risk swap: the ALREADY-validated ISO 12800 behavior is
reproduced by construction, and the physical model interpolates/extrapolates everywhere else.

`levels` has no equivalent physical derivation in a pure variance model (it governs the
noise's spatial decorrelation length via wavelet reach, not its variance) — kept as a coarse
step function of the same sigma-ratio metric, at the same relative breakpoints the current
table uses. This is a known limitation, documented rather than hidden (see CLAUDE.md's process
lessons on transparent validation).

Usage: python3 calib/derive_iso_table.py
Prints the derived (levels, strength) per ISO next to the current hardcoded table for
comparison, plus the full ISO sweep from the calibration (100-25600) to show it's now a
continuous curve rather than 5 brackets.
"""
import json
from pathlib import Path

PROFILE = json.loads((Path(__file__).parent / 'noise_profile.json').read_text())['per_iso']
REF_SIGNAL = 0.18  # mid-grey, linear 0..1
ANCHOR_ISO = 12800
ANCHOR_STRENGTH = 0.78  # the current table's most-validated value (see docstring)

# Current hand-tuned table (raw_decode.rs:281-302), for side-by-side comparison only.
CURRENT_TABLE = {
    100: (0, 0.0), 200: (0, 0.0), 400: (0, 0.0), 800: (0, 0.0), 1600: (3, 0.6), 3200: (5, 0.70),
    6400: (8, 0.78), 12800: (8, 0.78), 25600: (9, 0.78),
}


def sigma_at(iso, channel='G'):
    """sqrt(var) of the calibrated model at REF_SIGNAL, log-interpolating between calibrated
    ISOs (same interpolation calib/vst_denoise.py's interp_ab uses)."""
    import numpy as np
    isos = sorted(int(k) for k in PROFILE.keys())
    if iso <= isos[0]:
        p = PROFILE[str(isos[0])][channel]
    elif iso >= isos[-1]:
        p = PROFILE[str(isos[-1])][channel]
    else:
        lo = max(i for i in isos if i <= iso)
        hi = min(i for i in isos if i >= iso)
        if lo == hi:
            p = PROFILE[str(lo)][channel]
        else:
            t = (np.log(iso) - np.log(lo)) / (np.log(hi) - np.log(lo))
            plo, phi = PROFILE[str(lo)][channel], PROFILE[str(hi)][channel]
            a = np.exp(np.log(max(plo['a'], 1e-12)) * (1 - t) + np.log(max(phi['a'], 1e-12)) * t)
            b = plo['b'] * (1 - t) + phi['b'] * t
            return float(np.sqrt(max(a * REF_SIGNAL + b, 0.0)))
    return (p['a'] * REF_SIGNAL + p['b']) ** 0.5


def derive_strength(iso):
    if iso < 1600:
        return 0.0  # below this the current design intentionally skips chroma NR (low SNR loss
        # from noise is negligible relative to real detail at native ISOs; the model doesn't
        # currently override this design choice, only the >=1600 magnitude)
    sig = sigma_at(iso)
    sig_anchor = sigma_at(ANCHOR_ISO)
    strength = ANCHOR_STRENGTH * (sig / sig_anchor)
    return round(min(strength, 0.85), 3)  # 0.85 cap matches the highest value ever validated
    # in the codebase's own history (raw_decode.rs comments reference testing 0.85 and finding
    # it over-cleaned at ISO 5000 specifically at OLD levels — levels now scale too, so keep
    # the historical ceiling as a conservative bound rather than letting it run unbounded)


def derive_levels(iso):
    """Coarse step function on the same sigma-ratio metric (see docstring: levels has no
    direct variance-model derivation). Breakpoints chosen to match the current table's
    relative spacing (roughly log2 steps) rather than re-litigating level count from scratch."""
    if iso < 1600:
        return 0
    ratio = sigma_at(iso) / sigma_at(ANCHOR_ISO)
    if ratio < 0.5:
        return 3
    if ratio < 0.75:
        return 5
    if ratio < 1.15:
        return 8
    return 9


def main():
    print(f"{'ISO':<7}{'levels(cur)':>12}{'strength(cur)':>15}   |  {'levels(new)':>12}{'strength(new)':>15}")
    print('-' * 68)
    for iso in sorted(CURRENT_TABLE):
        cl, cs = CURRENT_TABLE[iso]
        nl, ns = derive_levels(iso), derive_strength(iso)
        flag = '' if (nl == cl or iso < 1600) and abs(ns - cs) < 0.05 else '  <-- differs'
        print(f"{iso:<7}{cl:>12}{cs:>15.3f}   |  {nl:>12}{ns:>15.3f}{flag}")

    print("\nFull continuous sweep (this is the point — arbitrary ISOs, not just the 5 brackets):")
    for iso in [100, 500, 1000, 1600, 2000, 3200, 4000, 5000, 6400, 9000, 12800, 18000, 25600, 32000]:
        print(f"  ISO {iso:<6} -> levels={derive_levels(iso)} strength={derive_strength(iso):.3f}")


if __name__ == '__main__':
    main()
