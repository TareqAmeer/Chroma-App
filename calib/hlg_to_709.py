"""
HLG (BT.2100) -> Rec.709 conversion — derive and validate the constants the shader uses.

WHY THIS EXISTS
Measured on IMG_8015.MOV (HEVC yuv420p10le, BT.2020 primaries, arib-std-b67/HLG, bt2020nc),
frame 0, identical 160x90 downsample:

    ffmpeg NAIVE (no conversion)      mean=137.2  meanSat=29.6  maxSat=108
    Apple ColorSync HLG->Rec.709      mean=124.1  meanSat=41.3  maxSat=141   <- TARGET
    WKWebView (the desktop app)       mean=137.5  meanSat=30.1  maxSat=118   <- matches NAIVE
    Chromium (the web build)          mean=122.9  meanSat=41.3  maxSat=147   <- matches TARGET

i.e. WKWebView decodes the HLG signal and tags the VideoFrame bt709/iec61966-2-1 WITHOUT
applying the conversion, so HLG footage renders flat and ~30% under-saturated in the desktop
app. Chromium does convert. The app therefore has to do the conversion itself when the engine
did not — see fxNeedsHlgTransform() in chromasmith-22.html.

This script fits/validates the one free parameter (the OOTF system gamma) against Apple's own
ColorSync output, so the shader constants are measured rather than assumed.

Run:  .calibvenv/bin/python3 calib/hlg_to_709.py
"""
import subprocess
import sys
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIP = os.path.join(ROOT, 'geneva', 'IMG_8015.MOV')
TMP = '/tmp'

# ── BT.2100 HLG inverse OETF ────────────────────────────────────────────────────────────────
# E' in [0,1] -> scene linear E in [0,1]. Constants from ITU-R BT.2100.
HLG_A = 0.17883277
HLG_B = 0.28466892          # = 1 - 4a
HLG_C = 0.55991073          # = 0.5 - a*ln(4a)


def hlg_inverse_oetf(e):
    lo = (e * e) / 3.0
    hi = (np.exp((e - HLG_C) / HLG_A) + HLG_B) / 12.0
    return np.where(e <= 0.5, lo, hi)


# BT.2020 luma coefficients (for the OOTF)
KR, KG, KB = 0.2627, 0.6780, 0.0593

# Linear BT.2020 -> linear BT.709 (both D65). Derived from the primaries; matches the widely
# published matrix.
M_2020_TO_709 = np.array([
    [1.660491, -0.587641, -0.072850],
    [-0.124550, 1.132900, -0.008349],
    [-0.018151, -0.100579, 1.118730],
])


def bt709_oetf(l):
    """Linear -> Rec.709 signal. Used for the display encoding."""
    l = np.clip(l, 0.0, 1.0)
    return np.where(l < 0.018, 4.5 * l, 1.099 * np.power(l, 0.45) - 0.099)


def srgb_oetf(l):
    l = np.clip(l, 0.0, 1.0)
    return np.where(l <= 0.0031308, 12.92 * l, 1.055 * np.power(l, 1 / 2.4) - 0.055)


# ── The canonical BT.2100/BT.2408 conversion ────────────────────────────────────────────────
# NOT a hand-rolled fit. This is the standard chain, with each piece cross-checked against the
# colour-science reference library (see validate_against_reference below):
#
#   1. HLG inverse OETF          -> scene linear            [BT.2100; matches colour-science to 2.6e-9]
#   2. OOTF, system gamma        -> display linear          [gamma from the BT.2408 formula, NOT fitted]
#   3. normalise to reference white                         [BT.2408: HLG reference white = 203 cd/m^2,
#                                                            which is exactly eotf_BT2100_HLG(0.75)]
#   4. BT.2020 -> BT.709 matrix  -> linear Rec.709
#   5. clip, then sRGB encode                               [the space this app's pipeline works in]
#
# The ONLY free parameter is the nominal display peak L_W, and even that is standardised:
# BT.2408 gives  gamma = 1.2 + 0.42 * log10(L_W / 1000).
HLG_REF_WHITE_NITS = 203.0      # BT.2408 HLG reference (diffuse) white
HLG_REF_WHITE_SIGNAL = 0.75     # ...which sits at 75% HLG signal


def bt2408_system_gamma(l_w):
    """ITU-R BT.2408 system gamma for a nominal peak luminance L_W."""
    return 1.2 + 0.42 * np.log10(l_w / 1000.0)


def hlg_eotf(e, l_w):
    """BT.2100 HLG EOTF: signal -> display luminance in cd/m^2 (inverse OETF then OOTF)."""
    lin = hlg_inverse_oetf(e)
    ys = KR * lin[..., 0] + KG * lin[..., 1] + KB * lin[..., 2]
    g = bt2408_system_gamma(l_w)
    return l_w * lin * np.power(np.maximum(ys, 1e-9), g - 1.0)[..., None]


def convert(rgb01, l_w, encode='srgb'):
    """HLG signal (0..1) -> Rec.709/sRGB display signal (0..1)."""
    disp = hlg_eotf(rgb01, l_w) / HLG_REF_WHITE_NITS   # reference white -> 1.0
    lin = disp @ M_2020_TO_709.T
    lin = np.clip(lin, 0.0, 1.0)
    return (bt709_oetf if encode == 'bt709' else srgb_oetf)(lin)


def validate_against_reference():
    """Cross-check the pieces above against colour-science, if it is available.

    ⚠️ colour-science requires numpy>=2, which is INCOMPATIBLE with the scipy pin in
    calib/requirements.txt — installing it into .calibvenv breaks every other calibration
    script. Keep it in its own venv:  python3 -m venv /tmp/colourvenv &&
    /tmp/colourvenv/bin/pip install colour-science
    """
    try:
        from colour.models import oetf_inverse_BT2100_HLG, eotf_BT2100_HLG
    except Exception as e:
        print(f"(colour-science not importable here: {e} — skipping cross-check)")
        return
    e = np.linspace(0, 1, 256)
    err = np.abs(hlg_inverse_oetf(e) - oetf_inverse_BT2100_HLG(e)).max()
    print(f"  inverse OETF vs colour-science:  max |delta| = {err:.3e}")
    grey = np.stack([e, e, e], axis=-1)
    ref = eotf_BT2100_HLG(grey, L_W=1000)
    ours = hlg_eotf(grey, 1000.0)
    print(f"  EOTF (L_W=1000) vs colour-science: max |delta| = {np.abs(ours - ref).max():.3e} cd/m^2")
    print(f"  eotf(0.75) = {eotf_BT2100_HLG(np.array([0.75,0.75,0.75]))[0]:.2f} cd/m^2 "
          f"(BT.2408 reference white = {HLG_REF_WHITE_NITS})")


def stats(a):
    sat = a.max(axis=2) - a.min(axis=2)
    return dict(max=float(a.max()), mean=float(a.mean()),
                meanSat=float(sat.mean()), maxSat=float(sat.max()))


def small(path):
    return np.asarray(Image.open(path).convert('RGB').resize((160, 90)), dtype=np.float64)


def main():
    if not os.path.isfile(CLIP):
        print(f"Test clip not found: {CLIP}")
        return 1
    # frame 0 as 16-bit RGB, still carrying the HLG signal (ColorSync tags it BT.2100 HLG)
    raw = os.path.join(TMP, 'hlg_f0_raw.png')
    subprocess.run(['ffmpeg', '-hide_banner', '-v', 'error', '-i', CLIP, '-vframes', '1',
                    '-pix_fmt', 'rgb48', '-y', raw], check=True)
    # Apple's own conversion — the TARGET
    tgt = os.path.join(TMP, 'hlg_f0_apple.png')
    subprocess.run(['cp', raw, tgt], check=True)
    subprocess.run(['sips', '--matchTo',
                    '/System/Library/ColorSync/Profiles/ITU-709.icc', tgt],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    src = small(raw) / 255.0        # HLG signal, normalised
    target = small(tgt)
    ts = stats(target)
    print(f"TARGET (Apple ColorSync)   max={ts['max']:.0f} mean={ts['mean']:.1f} "
          f"meanSat={ts['meanSat']:.1f} maxSat={ts['maxSat']:.0f}\n")

    print("cross-check of the transform against the colour-science reference:")
    validate_against_reference()
    print()
    print("nominal display peak L_W sweep (system gamma follows the BT.2408 formula):")
    best=None
    for l_w in [200,300,400,500,600,700,800,1000]:
        for enc in ('srgb','bt709'):
            out=convert(src,float(l_w),enc)*255.0
            err=float(np.abs(out-target).mean())
            st=stats(out)
            if best is None or err<best[0]: best=(err,l_w,enc,st)
            print(f"  L_W={l_w:4d}  gamma={bt2408_system_gamma(l_w):.4f}  {enc:6} "
                  f"meanAbsErr={err:6.2f}  mean={st['mean']:5.1f} meanSat={st['meanSat']:5.1f} maxSat={st['maxSat']:3.0f}")
    err,l_w,enc,st=best
    print(f"\nBEST: L_W={l_w} nits  gamma={bt2408_system_gamma(l_w):.4f}  encode={enc}  meanAbsErr={err:.2f}/255")
    print(f"      ours   max={st['max']:.0f} mean={st['mean']:.1f} "
          f"meanSat={st['meanSat']:.1f} maxSat={st['maxSat']:.0f}")
    print(f"      target max={ts['max']:.0f} mean={ts['mean']:.1f} "
          f"meanSat={ts['meanSat']:.1f} maxSat={ts['maxSat']:.0f}")
    # ⚠️ A hard clip after the matrix is the simple choice. BT.2407 recommends DESATURATING
    # out-of-gamut colours onto the BT.709 surface instead, which round-trips better. If the
    # error above is dominated by highly saturated pixels, that is the first thing to try.
    return 0


if __name__ == '__main__':
    sys.exit(main())
