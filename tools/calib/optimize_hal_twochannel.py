#!/usr/bin/env python3
"""Two-channel halation calibration: warm "backing" red + HUE-GATED green (the yellow band).

The halation glow has two emission channels (see the `src` shader in chromasmith-22.html):
  .r = warm backing dye — fires for ALL bright sources (red/orange/purple included)
  .g = yellow driver = bright * lum^powLg * gate,  gate = smoothstep(gA,gB, G-R)  [linear]
The gate makes green fire only for G>=R sources (white/grey/yellow/green/cyan) and NOT
red/orange/purple, matching Dehancer's measured per-colour halo G/R (red 0.0, white 0.6, ...).
Because sigma_R >> sigma_G, a bright edge reads white->yellow->orange->red.

This script fits, analytically and exactly, the WHITE-EDGE profile of each reference (outside a
white edge the surround is black so screen() is a no-op and each channel is
l2s(src * gain * 0.5*erfc(d/(sigma*sqrt2)))), for BOTH the standard with-remjet reference and the
no-remjet reference, plus the no-remjet luminance exponent powL from the grey-row edges.

Standard RED params (gainR, sigmaR and emitR's kW/kC/aG/bP/bluesupp/powL) are kept UNCHANGED from
the committed model — only the green channel is added — so the existing red-based scorecard
requirements stay byte-identical. We fit: standard green (gainG, sigmaG), no-remjet per-channel
gains + sigma scales, and no-remjet powL/powLg.

Run from repo root (venv active):  python calib/optimize_hal_twochannel.py
"""
import os
import numpy as np
from PIL import Image
from scipy.special import erfc
from scipy.optimize import least_squares
import halmodel as HM

HERE = os.path.dirname(__file__)
kW = 1.0028
BASE_SIGR = 7.5233   # committed standard red sigma (1x) — kept fixed
gA, gB = -1.0, 0.15
g0 = float(HM.smoothstep(gA, gB, 0.0))   # gate at a neutral/white source


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c*12.92, 1.055*c**(1/2.4) - 0.055)


def prof(img, y, xe, ds):
    return np.array([img[y, xe - int(d)] for d in ds]) / 255.0


def fit_edge(ref, ds):
    p = prof(ref, 910, 2400, ds)
    R, G = p[:, 0], p[:, 1]

    def m(d, g, s, src):
        return l2s(np.clip(src * g * 0.5 * erfc(d / (s*np.sqrt(2))), 0, 1))
    rR = least_squares(lambda q: m(ds, q[0], q[1], kW) - R, [1.5, 15], bounds=([.1, 3], [12, 60]))
    rG = least_squares(lambda q: m(ds, q[0], q[1], g0) - G, [0.5, 9], bounds=([.01, 2], [12, 50]))
    return rR.x, rG.x   # (gainR,sigR), (gainG_eff,sigG)


def main():
    std = np.asarray(Image.open(os.path.join(HERE, "dehancer halation x2.png")).convert("RGB"), float)
    nr = np.asarray(Image.open(os.path.join(HERE, "dehancer no remjet x2.png")).convert("RGB"), float)

    (gRs, sRs), (gGes, sGs) = fit_edge(std, np.array([4, 8, 12, 16, 24, 32], float))
    (gRn, sRn), (gGen, sGn) = fit_edge(nr, np.array([8, 16, 24, 32, 40, 48, 56], float))
    gGs, gGn = gGes / g0, gGen / g0

    base_sigG = sGs / 2.0                 # standard green sigma (1x)
    sScaleR = sRn / (BASE_SIGR * 2)       # no-remjet sigma scales relative to base (kept-fixed) red
    sScaleG = sGn / (base_sigG * 2)

    # no-remjet luminance exponent from grey LEFT-edge halo R strengths
    greys = {'g80': (1020, 1166, 0.82), 'g60': (1200, 1346, 0.616),
             'g40': (1380, 1526, 0.40), 'g20': (1560, 1706, 0.20)}
    ds_g = np.array([8, 14, 20], float)
    Ll, hR = [], []
    for nm, (y0, y1, s) in greys.items():
        Ll.append(HM.s2l(np.array([s]))[0]); hR.append(prof(nr, (y0+y1)//2, 2400, ds_g)[:, 0])
    Ll, hR = np.array(Ll), np.array(hR)

    def gp(pw):
        return np.array([l2s(np.clip(kW * L**pw * gRn * 0.5*erfc(ds_g/(sRn*np.sqrt(2))), 0, 1))
                         for L in Ll])
    powL_n = float(least_squares(lambda q: (gp(q[0]) - hR).ravel(), [1.5], bounds=([.4], [4.0])).x[0])

    print("== FXR.CAL.halation (paste) ==")
    print(f" base green : gainG:{gGs:.4f}, sigmaG:{base_sigG:.4f}, powLg:3.9247, gA:{gA}, gB:{gB}")
    print(f"   (keep committed red: gainR:1.2380, sigmaR:{BASE_SIGR})")
    print(f" noRemjet   : gainR:{gRn:.4f}, gainG:{gGn:.4f}, gainB:0.0,")
    print(f"              sigmaScaleR:{sScaleR:.4f}, sigmaScaleG:{sScaleG:.4f},")
    print(f"              thr:0.05, hp:0.55, powL:{powL_n:.4f}, powLg:{powL_n:.4f}")


if __name__ == "__main__":
    main()
