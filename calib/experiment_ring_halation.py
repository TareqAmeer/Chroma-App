"""
Feasibility experiment: does an ANNULAR (ring) halation PSF — inspired by
ComfyUI-Darkroom's Fresnel/TIR halation model — close the gray80-gap-vs-
white-edge inversion that CLAUDE.md §5 "Two-sigma investigation" found no
Gaussian-only architecture could close?

Dehancer ground truth (CLAUDE.md §5): gray80 gap 0.60 > white edge halo 0.46 —
an inversion a brightness-driven GAUSSIAN emission can't produce (white is
both brighter and the same distance from its own gap as gray80 is from its
gap, so Gaussian gap-strength should track source brightness, not invert it).
Our committed model: gray80 gap ~0.43 (weaker than Dehancer, PASSES only on
the >0.18 looseness of that specific check).

This script builds only the RED-channel PSF as an annulus:
    r_c        = ring radius (px, 2x-image scale)
    P_TIR(r)  ~ smoothstep(r_c-w, r_c+w, r) / (1 + (r/(2*d))**2)**2
    T(r)       = exp(-r/L) / (2*pi*L*(r+eps))            (diffuse tail)
    PSF(r)     = a*P_TIR(r) + (1-a)*T(r)                  (a = ring/tail balance)
normalized to sum=1 (so `gain` stays comparable to the Gaussian model's gain),
convolved via scipy.signal.fftconvolve (matches the repo's approach — this is
offline Python, no shader/perf constraint).

Only the RED channel is swapped to a ring kernel; green/blue keep the existing
Gaussian glow from halmodel.apply_halation, since the question here is purely
"can red's own gap-vs-edge ratio invert with a ring kernel" — the hue-gate
(green channel) machinery is orthogonal to this test and untouched.

Not a full re-optimization: r_c/d/L/a are hand-scanned over a small grid, not
fit end-to-end. This is a go/no-go check per CLAUDE.md §10 ("validate the
mechanism on read-only point computations first"), not a final parameter fit.
"""
import os
import numpy as np
from PIL import Image
from scipy.signal import fftconvolve
import halmodel as H
import scorecard as SC

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(ROOT, 'IMG_5774_2x.PNG')
HAL = os.path.join(ROOT, 'dehancer halation x2.png')

P = SC.P  # committed emission/gain constants


def ring_kernel(r_c, d, L, a, w=None, eps=1e-3, half=None):
    """Build a normalized 2D radial PSF: a*P_TIR(r) + (1-a)*T(r)."""
    if w is None:
        w = max(1.0, d * 0.5)
    if half is None:
        half = int(np.ceil(max(r_c + 4 * w, 4 * L))) + 2
    ax = np.arange(-half, half + 1)
    X, Y = np.meshgrid(ax, ax)
    r = np.sqrt(X * X + Y * Y).astype(np.float32)

    fresnel_jump = H.smoothstep(r_c - w, r_c + w, r)
    p_tir = fresnel_jump / (1 + (r / (2 * d)) ** 2) ** 2
    tail = np.exp(-r / L) / (2 * np.pi * L * (r + eps))

    k = a * p_tir + (1 - a) * tail
    s = k.sum()
    return k / s if s > 1e-9 else k


def apply_halation_ring_red(src_srgb, emit, ring_p, gainR, gainG, gainB, sigmaG, sigmaB,
                             highpass=True):
    """Same as H.apply_halation but the RED channel uses the ring kernel."""
    lin = H.s2l(src_srgb)
    emit_c = np.clip(emit, 0, 1)

    kernel = ring_kernel(ring_p['r_c'], ring_p['d'], ring_p['L'], ring_p['a'])
    blurred_r = fftconvolve(emit, kernel, mode='same')
    if highpass:
        blurred_r = np.clip(blurred_r - emit_c, 0, None)
    chan_r = blurred_r * gainR

    def chan(sig, gain):
        b = H.gauss_blur(emit, sig)
        if highpass:
            b = np.clip(b - emit_c, 0, None)
        return b * gain

    glow = np.stack([chan_r, chan(sigmaG, gainG), chan(sigmaB, gainB)], axis=-1)
    return H.l2s(np.clip(H.screen(lin, glow), 0, 1))


def load(path, y0, y1):
    return np.array(Image.open(path).crop((0, y0, 4800, y1)).convert('RGB'),
                    dtype=np.float32) / 255.0


def measure(o, deh, y_crop, yt_gap, yt_int, sx=3600):
    g = yt_gap - 15 - y_crop
    return o[g, sx, 0], deh[g, sx, 0]


def run_one(ring_p, label):
    y0, y1 = 700, 2200
    base2 = load(BASE, y0, y1)
    deh2 = load(HAL, y0, y1)
    lin = H.s2l(base2)
    e = SC.emit(lin, P, asymmetric=True)

    o2 = apply_halation_ring_red(base2, e, ring_p, P['gainR'], P['gainG'], P['gainB'],
                                  P['sigmaG'], P['sigmaB'])

    gray80_R, gray80_dR = measure(o2, deh2, y0, 1020, None)
    white_R, white_dR = measure(o2, deh2, y0, 840, None)

    ratio_ours = gray80_R / max(white_R, 1e-6)
    ratio_deh = gray80_dR / max(white_dR, 1e-6)

    print(f"{label:28s}  gray80 R {gray80_R:.3f} (Dehancer {gray80_dR:.3f})  |  "
          f"white R {white_R:.3f} (Dehancer {white_dR:.3f})  |  "
          f"gray80/white {ratio_ours:.3f} (Dehancer {ratio_deh:.3f}, target INVERTED >1)")
    return ratio_ours, ratio_deh


if __name__ == '__main__':
    print("Baseline (current Gaussian red channel, for reference):")
    y0, y1 = 700, 2200
    base2 = load(BASE, y0, y1)
    deh2 = load(HAL, y0, y1)
    o2_gauss = SC.render(base2, P, asymmetric=True, highpass=True)
    g80 = o2_gauss[1020 - 15 - y0, 3600, 0]
    wht = o2_gauss[840 - 15 - y0, 3600, 0]
    dg80 = deh2[1020 - 15 - y0, 3600, 0]
    dwht = deh2[840 - 15 - y0, 3600, 0]
    print(f"{'GAUSSIAN (committed)':28s}  gray80 R {g80:.3f} (Dehancer {dg80:.3f})  |  "
          f"white R {wht:.3f} (Dehancer {dwht:.3f})  |  "
          f"gray80/white {g80/max(wht,1e-6):.3f} (Dehancer {dg80/max(dwht,1e-6):.3f}, target INVERTED >1)")

    print("\nRing-kernel sweep (r_c, d, L, a):")
    sigmaR_gauss = P['sigmaR']
    for r_c in [sigmaR_gauss * 0.5, sigmaR_gauss * 1.0, sigmaR_gauss * 1.5, sigmaR_gauss * 2.0]:
        for a in [0.3, 0.65, 0.9]:
            ring_p = dict(r_c=r_c, d=sigmaR_gauss * 0.5, L=sigmaR_gauss * 1.5, a=a)
            run_one(ring_p, f"r_c={r_c:.1f} a={a}")
