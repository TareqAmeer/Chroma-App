#!/usr/bin/env python3
"""Calibrate the 'no remjet' halation boost against Dehancer's reference.

No-remjet film (no anti-halation backing) halates much more strongly. Rather than
re-fit the whole v22.1b emission model, we fit a small MULTIPLICATIVE boost on top of
the committed model: gainScale (all channels), sigmaScale (all sigmas) and a lowered
emission threshold thr. Glance ("squint") loss vs `dehancer no remjet x2.png`.

Outputs calib/noremjet_params.json (the {gainScale,sigmaScale,thr} to paste into
FXR.CAL.halation.noRemjet in chromasmith-22.html).

Run from repo root (venv active):  python calib/optimize_noremjet.py
"""
import os, json
import numpy as np
from PIL import Image, ImageFilter
from scipy.optimize import minimize
import halmodel as HM

HERE = os.path.dirname(__file__)

# Committed v22.1b model (sigmas at 1x ref -> *2 for the 4800px calibration images).
BASE = dict(powL=3.9247, kW=1.0028, kC=0.8860, aG=0.1972, bB=0.9691, bP=2.10,
            gainR=1.2380, gainG=0.0958, gainB=0.0,
            sigmaR=7.5233*2, sigmaG=3.7617*2, sigmaB=1.1285*2)
THR0 = 0.10


# Fit at quarter resolution for speed: downsample the chart 4x and divide all sigmas
# by the same factor (halation radius scales with pixel count). The squint loss already
# downsamples, so this barely changes the optimum but is ~16x faster per render.
DS = 4


def load(path):
    im = Image.open(os.path.join(HERE, path)).convert("RGB")
    im = im.resize((im.width // DS, im.height // DS), Image.BOX)
    return np.asarray(im, dtype=np.float32) / 255.0


def render(src, gainScale, sigmaScale, thr, hp=1.0):
    """hp = high-pass strength: glow = max(blur(emit) - hp*emit, 0). hp<1 lets the wide
    blur flood interiors (real no-remjet has no anti-halation backing), matching the bold
    bright reference rings/bars that a pure high-pass (hp=1) multiplicative boost can't reach."""
    lin = HM.s2l(src)
    e = HM.emit_rule(lin, BASE['powL'], BASE['kW'], BASE['kC'], BASE['aG'],
                     BASE['bB'], BASE['bP'], thr=thr)
    emit_c = np.clip(e, 0, 1)
    gains = (BASE['gainR']*gainScale, BASE['gainG']*gainScale, BASE['gainB']*gainScale)
    sigs = (BASE['sigmaR']*sigmaScale/DS, BASE['sigmaG']*sigmaScale/DS, BASE['sigmaB']*sigmaScale/DS)
    glow = np.stack([np.clip(HM.gauss_blur(e, s) - hp*emit_c, 0, None)*g
                     for s, g in zip(sigs, gains)], axis=-1)
    return HM.l2s(np.clip(HM.screen(HM.s2l(src), glow), 0, 1))


def squint(img, sig=2, step=1):
    # downsample + blur: models "can't tell apart at a glance"
    b = Image.fromarray((np.clip(img, 0, 1)*255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(sig))
    return np.asarray(b, dtype=np.float32)[::step, ::step] / 255.0


def main():
    base = load("IMG_5774_2x.PNG")
    ref = load("dehancer no remjet x2.png")
    if ref.shape != base.shape:
        ref = np.asarray(Image.fromarray((ref*255).astype(np.uint8)).resize(
            (base.shape[1], base.shape[0])), dtype=np.float32)/255.0
    refS = squint(ref)
    # The whole point of "no remjet" is the EXTRA glow it adds over standard halation. A plain
    # brightness loss is dominated by regions standard already matches, so it barely boosts.
    # Weight by how much the reference exceeds a STANDARD-strength render → the fit is rewarded
    # specifically for reproducing the no-remjet surplus (bright rings, bleeding bars).
    stdS = squint(render(base, 1.0, 1.0, THR0, 1.0))
    surplus = np.clip(refS - stdS, 0, None).max(-1, keepdims=True)
    w = (surplus * 6.0 + refS.max(-1, keepdims=True) ** 2 + 0.02)

    def loss(x):
        gS, sS, thr, hp = x
        if gS <= 0 or sS <= 0 or thr < 0 or hp < 0 or hp > 1:
            return 1e3
        out = render(base, gS, sS, thr, hp)
        d = np.abs(squint(out) - refS) * w
        return float(d.mean())

    # baseline (standard halation, no boost) for reference
    print("standard-halation glance loss:", round(loss([1.0, 1.0, THR0, 1.0]), 5), flush=True)
    best = None
    for x0 in ([3.0, 1.5, 0.07, 0.6], [5.0, 2.0, 0.06, 0.4], [8.0, 2.5, 0.05, 0.2]):
        r = minimize(loss, x0, method="Nelder-Mead",
                     options=dict(xatol=1e-3, fatol=1e-6, maxiter=700))
        print("  start", x0, "->", [round(v, 3) for v in r.x], "loss", round(r.fun, 5), flush=True)
        if best is None or r.fun < best.fun:
            best = r
    res = best
    gS, sS, thr, hp = res.x
    out = {"gainScale": round(float(gS), 4),
           "sigmaScale": round(float(sS), 4),
           "thr": round(float(thr), 4),
           "hp": round(float(hp), 4),
           "loss": round(float(res.fun), 5)}
    print("fitted:", out)
    with open(os.path.join(HERE, "noremjet_params.json"), "w") as f:
        json.dump(out, f, indent=2)
    # save a side-by-side proof strip
    proof = np.concatenate([base, render(base, gS, sS, thr, hp), ref], axis=1)
    Image.fromarray((np.clip(proof, 0, 1)*255).astype(np.uint8)).save(
        os.path.join(HERE, "cmp_noremjet.png"))
    print("wrote noremjet_params.json + cmp_noremjet.png")


if __name__ == "__main__":
    main()
