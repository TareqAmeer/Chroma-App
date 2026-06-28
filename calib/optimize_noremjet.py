#!/usr/bin/env python3
"""Calibrate the 'no remjet' halation against Dehancer's reference.

No-remjet film (no anti-halation backing) halates much more strongly and, crucially, shows
a bright YELLOW band at a bright edge (strong R+G) fading through orange to red (R only). A
uniform/global fit can't reproduce this: balancing the whole chart pushes green DOWN (the
green that makes white edges yellow over-greens the coloured-bar edges), so the canonical
white-edge look is lost. The user inspects exactly the white-block edge, so we fit THAT
profile directly — and it has a clean analytic form, so the fit is exact and instant.

Outside a bright (white) edge the surround is black, so screen() is a no-op and each channel
of the glow is just the Gaussian of the emission step:

    result_c(d) = l2s( kW * 0.5*erfc(d / (sigma_c*sqrt2)) * gain_c )      (d = px outside edge)

`hp` (high-pass) and `thr` only affect INTERIOR flooding, not this outside band (e=0 outside),
so they're chosen for the overall look (kept mild — the reference keeps the block interior
clean). We fit gainR, gainG, sigmaR, sigmaG to the measured left-edge profile of the 100%
white bar in `dehancer no remjet x2.png`, then convert sigmas to the app's scale convention
(sigmaScaleR multiplies base sigmaR; sigmaScaleG multiplies base sigmaG).

Outputs calib/noremjet_params.json + a white-edge proof crop calib/cmp_noremjet.png.
Run from repo root (venv active):  python calib/optimize_noremjet.py
"""
import os, json
import numpy as np
from PIL import Image
from scipy.special import erfc
from scipy.optimize import least_squares
import halmodel as HM

HERE = os.path.dirname(__file__)
kW = 1.0028                      # emission of pure white = base kW (sat=0 -> colour term 0)
BASE_SIGR, BASE_SIGG, BASE_SIGB = 7.5233*2, 3.7617*2, 1.1285*2   # 1x ref *2 for the 4800px image
# overall-look knobs (don't affect the measured outside band): mild interior flood, low thr.
HP, THR = 0.85, 0.06


def measure_edge():
    ref = np.asarray(Image.open(os.path.join(HERE, "dehancer no remjet x2.png")).convert("RGB"),
                     dtype=np.float64)
    # left edge of the 100% white bar (x>=2400, y 840..986), profile going LEFT into black.
    y = 910
    d = np.arange(8, 72, 8)
    R = np.array([ref[y, 2400 - dd, 0] for dd in d]) / 255.0
    G = np.array([ref[y, 2400 - dd, 1] for dd in d]) / 255.0
    return d.astype(float), R, G


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c*12.92, 1.055*c**(1/2.4) - 0.055)


def prof(d, gain, sig):
    return l2s(np.clip(kW * 0.5 * erfc(d / (sig*np.sqrt(2))) * gain, 0, 1))


def main():
    d, R, G = measure_edge()

    def resid(p):
        gR, gG, sR, sG = p
        return np.concatenate([prof(d, gR, sR) - R, prof(d, gG, sG) - G])

    res = least_squares(resid, [2.5, 1.5, 12, 7],
                        bounds=([0.1, 0.05, 4, 2], [10, 10, 40, 30]))
    gR, gG, sR, sG = res.x
    out = {"gainR": round(float(gR), 4), "gainG": round(float(gG), 4), "gainB": 0.0,
           "sigmaScaleR": round(float(sR / BASE_SIGR), 4),
           "sigmaScaleG": round(float(sG / BASE_SIGG), 4),
           "thr": THR, "hp": HP,
           "edge_rms255": round(float(np.sqrt((resid(res.x)**2).mean()) * 255), 2)}
    print("fitted:", out)
    with open(os.path.join(HERE, "noremjet_params.json"), "w") as f:
        json.dump(out, f, indent=2)

    # full-res 2D proof crop (base | ours | dehancer) around the white-bar corner
    base = np.asarray(Image.open(os.path.join(HERE, "IMG_5774_2x.PNG")).convert("RGB"),
                      dtype=np.float32) / 255.0
    lin = HM.s2l(base)
    e = HM.emit_rule(lin, 3.9247, kW, 0.8860, 0.1972, 0.9691, 2.10, thr=THR)
    ec = np.clip(e, 0, 1)
    # app sigma convention: sigG = sigR*(baseG/baseR)*(sScaleG/sScaleR) == BASE_SIGG*sScaleG
    chan = lambda s, g: np.clip(HM.gauss_blur(e, s) - HP*ec, 0, None) * g
    glow = np.stack([chan(sR, gR), chan(sG, gG), chan(BASE_SIGB, 0.0)], -1)
    ours = HM.l2s(np.clip(HM.screen(lin, glow), 0, 1))
    ref = np.asarray(Image.open(os.path.join(HERE, "dehancer no remjet x2.png")).convert("RGB"),
                     dtype=np.float32) / 255.0
    y0, y1, x0, x1 = 760, 1080, 2180, 2520
    strip = np.concatenate([base[y0:y1, x0:x1], ours[y0:y1, x0:x1], ref[y0:y1, x0:x1]], 1)
    Image.fromarray((np.clip(strip, 0, 1)*255).astype(np.uint8)).save(
        os.path.join(HERE, "cmp_noremjet.png"))
    print("wrote noremjet_params.json + cmp_noremjet.png (base|ours|dehancer, white-edge crop)")


if __name__ == "__main__":
    main()
