#!/usr/bin/env python3
"""Calibrate the value-noise film-grain model + per-format table from Dehancer exports.

Inputs (repo root, grain ONLY through Dehancer at each film format, full-res sRGB):
    grain-test-2x.png                      the clean chart we generated
    dehancer-baseline-0.png                amount 0 (noise floor)
    dehancer-{8,16,35,65}mm-{60,100}.png   per format, two amounts

Method — measure the grain STATISTICALLY, and (crucially) extract it by subtracting the patch
MEAN, NOT a high-pass blur: a high-pass blur removes the COARSE grain and halves the measured σ
(that mistake is why the old grain_targets.json looked weak). Then:
  • per-channel σ vs value on the neutral LINEAR RAMP (y2630-2740) → fit kR,kG,kB,powG + the
    highlight rolloff gate (hiLo,hiHi). R≈1.2×G≈B; σ peaks ~v0.7 then rolls off.
  • amount 60 vs 100 → powA (σ ∝ amount^powA, ≈0.59).
  • channel correlation (mid grey) → the shared/independent mix (corr≈0.4 → wi=√0.6, ws=√0.4).
  • per-format clump size (2D autocorr half-width on the grey block) → cellPx; per-format strength
    (σ ratio to 35mm) → scale.  65mm = finest & weakest (0.52×), 35mm strongest.
The value-noise unit std (≈0.179, 2 octaves) is folded into k. Prints the FXR.CAL.grain block.

Run from repo root (venv active):  python calib/calibrate_grain_formats.py
"""
import os, sys
import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.optimize import least_squares
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, 'calib')
from grainmodel import load

FORMATS = ['8mm', '16mm', '35mm', '65mm']
RAMP_Y = (2650, 2720)            # linear grey ramp 0->255
G50 = (1428+30, 1960+30, 2067-30, 2190-30)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c*12.92, 1.055*c**(1/2.4) - 0.055)


def ramp_resid(img):
    s = img[RAMP_Y[0]:RAMP_Y[1]].astype(np.float64)
    return s, s - uniform_filter1d(s, 21, axis=1)     # remove horizontal ramp signal


def patch_resid(img, r):
    x0, y0, x1, y1 = r
    p = img[y0:y1, x0:x1].astype(np.float64)
    return p - p.mean(axis=(0, 1), keepdims=True)


def acf_hw(a, maxlag=18):
    a = a - a.mean(); f = np.fft.rfft2(a); ac = np.fft.irfft2(f*np.conj(f), s=a.shape); ac /= ac.flat[0]
    prof = (ac[0, :maxlag] + ac[:maxlag, 0]) / 2
    bel = np.where(prof < 0.5)[0]
    return float(bel[0]) if len(bel) else maxlag


def main():
    b0 = load('dehancer-baseline-0.png'); _, r0 = ramp_resid(b0)
    im100 = {f: load(f'dehancer-{f}-100.png') for f in FORMATS}

    # ---- neutral response from the ramp (35mm anchor) ----
    strip, r = ramp_resid(im100['35mm'])
    data = []
    for xc in range(200, 4750, 250):
        v = strip[:, xc-10:xc+10].mean(axis=(0, 1)) / 255.0
        s = r[:, xc-50:xc+50].reshape(-1, 3).std(0)
        s0 = r0[:, xc-50:xc+50].reshape(-1, 3).std(0)
        sg = np.sqrt(np.maximum(s**2 - s0**2, 0))
        if v.mean() > 0.02:
            data.append((v.mean(), sg))
    vs = np.array([d[0] for d in data]); sR = np.array([d[1][0] for d in data])

    def model(v, K, p, lo, hi):
        gate = 1 - np.clip((v-lo)/max(hi-lo, 1e-6), 0, 1)**2 * (3-2*np.clip((v-lo)/max(hi-lo, 1e-6), 0, 1))
        return K * v**p * gate
    res = least_squares(lambda q: model(vs, *q) - sR, [30, 0.7, 0.72, 0.95],
                        bounds=([5, 0.2, 0.5, 0.85], [60, 1.5, 0.85, 1.2]))
    K, powG, hiLo, hiHi = res.x
    # R:G:B from mean ratio across the ramp
    sAll = np.array([d[1] for d in data])
    rgb_ratio = sAll.mean(0) / sAll.mean(0)[0]      # ~ [1, 0.83, 0.83]

    UNIT = 0.179                                    # value-noise (2-octave) unit std
    # K is 8-bit σ at amount-100, value-noise std baked: k_c = (K/255)/UNIT * rgb_ratio_c
    kR = (K/255)/UNIT
    kG, kB = kR*rgb_ratio[1], kR*rgb_ratio[2]

    # ---- amount exponent powA ----
    ratios = []
    for f in FORMATS:
        i60 = load(f'dehancer-{f}-60.png')
        def sig(im):
            _, rr = ramp_resid(im); s = rr[:, 2300:2400].reshape(-1, 3).std(0)
            s0 = r0[:, 2300:2400].reshape(-1, 3).std(0); return np.sqrt(np.maximum(s**2-s0**2, 0))[0]
        ratios.append(sig(im100[f]) / sig(i60))
    powA = float(np.log(np.mean(ratios)) / np.log(100/60))

    # ---- correlation ----
    mp = r[:, 2300:2400].reshape(-1, 3)
    corr = np.mean([np.corrcoef(mp[:, 0], mp[:, 1])[0, 1], np.corrcoef(mp[:, 0], mp[:, 2])[0, 1]])

    # ---- per-format size + strength (correct grey block) ----
    fmt = {}
    s35 = np.sqrt(np.maximum(patch_resid(im100['35mm'], G50).reshape(-1, 3).std(0)[0]**2 -
                             patch_resid(b0, G50).reshape(-1, 3).std(0)[0]**2, 0))
    for f in FORMATS:
        rr = patch_resid(im100[f], G50)
        sg = np.sqrt(np.maximum(rr.reshape(-1, 3).std(0)[0]**2 -
                                patch_resid(b0, G50).reshape(-1, 3).std(0)[0]**2, 0))
        hw = acf_hw(rr.mean(2))
        fmt[f] = (round(2*hw-1, 1), round(float(sg/s35), 3))   # cellPx ≈ 2·HW-1, scale rel 35mm

    print("kR=%.2f kG=%.2f kB=%.2f powG=%.2f powA=%.2f hiLo=%.2f hiHi=%.2f corr=%.2f (wi=%.3f ws=%.3f)"
          % (kR, kG, kB, powG, powA, hiLo, hiHi, corr, np.sqrt(1-corr), np.sqrt(corr)))
    print("formats {cellPx, scale@35mm}:")
    for f in FORMATS:
        print(f"  {f}: cellPx≈{fmt[f][0]}  scale={fmt[f][1]}")
    print("NOTE: the shipped CAL trims k ~0.85× to anchor the 'faithful' amount point (slider ~70),")
    print("      since the slider has headroom past Dehancer's max (amountSpan>1).")


if __name__ == "__main__":
    main()
