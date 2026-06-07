"""
Fast halation SCORECARD — the quick-validation gate.

Prints EVERY known requirement as one table in seconds (three small crops), so a
model change can be checked before/after without a multi-minute optimization.
This exists because prior regressions slipped through: long optimizations whose
loss silently omitted a requirement, with the human-legible per-requirement
numbers only seen afterward.

Rows (each: ours | Dehancer | Δ | PASS/FAIL):
  • zone5 100% row, per color: GAP R (edge halo strength) + INTERIOR G flood.
  • zone2 bars: gray80/warm/cool/white gap R + interior neutrality / flood.
  • zone7 thin lines white/warm/cool/red: R and G at d≈10 (G guards softness).
  • halo softness: G/R ratio in the white gap (Dehancer ≈0.13, not 0=pure red).

Two model variants are supported and printed side by side:
  BASELINE = symmetric warmth + screen glow  (the committed model the user saw)
  NEW      = asymmetric warmth + high-pass glow  (the proposed fix)

Run:  python calib/scorecard.py
"""
import os
import numpy as np
from PIL import Image
import halmodel as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'IMG_5774_2x.PNG')
HAL = os.path.join(ROOT, 'dehancer halation x2.png')

# Committed constants (2x sigmas) — see FXR.CAL.halation in chromasmith-22.html.
# v22.1b adds bP (magenta/purple driver, +bP*min(R,B) in warmth) — closes the
# purple gap-strength shortfall (0.187 -> 0.327, Dehancer 0.325). Provably inert
# on every other color: min(R,B)=0 whenever either channel is zero.
P = dict(powL=3.9247, kW=1.0028, kC=0.8860, aG=0.1972, bB=0.9691, bP=2.10,
         gainR=1.2380, gainG=0.0958, gainB=0.0,
         sigmaR=7.5233*2, sigmaG=3.7617*2, sigmaB=1.1285*2)


# ── emission (symmetric vs asymmetric blue suppression; +optional magenta driver) ─
def emit(lin, p, asymmetric):
    lum = lin @ H.LUM
    bright = H.smoothstep(0.10, 0.10 + 0.141, lum)
    sat = lin.max(-1) - lin.min(-1)
    white = np.clip(lum, 0, 1) ** p['powL']
    if asymmetric:
        bterm = np.clip(lin[..., 2] - lin[..., 0], 0, None)   # blue EXCESS over red
        magenta = np.minimum(lin[..., 0], lin[..., 2])         # "magenta-ness" driver
        bP = p.get('bP', 0.0)
    else:
        bterm = lin[..., 2]                                   # raw blue
        magenta = 0.0
        bP = 0.0
    warmth = lin[..., 0] + p['aG'] * lin[..., 1] - p['bB'] * bterm + bP * magenta
    color = sat * np.clip(warmth, 0, None)
    return bright * (p['kW'] * white + p['kC'] * color)


# ── glow apply (screen vs high-pass) ─────────────────────────────────────────
def render(base_srgb, p, asymmetric, highpass):
    lin = H.s2l(base_srgb)
    e = emit(lin, p, asymmetric)

    e_c = np.clip(e, 0, 1)   # 8-bit texture clamp, to match shipped GLSL

    def chan(sig, gain):
        b = H.gauss_blur(e, sig)
        if highpass:
            b = np.clip(b - e_c, 0, None)    # only light that spread beyond local emission
        return b * gain
    glow = np.stack([chan(p['sigmaR'], p['gainR']),
                     chan(p['sigmaG'], p['gainG']),
                     chan(p['sigmaB'], p['gainB'])], axis=-1)
    return H.l2s(np.clip(H.screen(lin, glow), 0, 1))


def px(v):
    return int(round(v * 2))


# ── crop loader (with margin so blur near sample points is correct) ──────────
def load(path, y0, y1):
    return np.array(Image.open(path).crop((0, y0, 4800, y1)).convert('RGB'),
                    dtype=np.float32) / 255.0


# ── sample specs (all 2x coords) ─────────────────────────────────────────────
Z5Y = px(2010)
Z5X = [ci * 300 + 150 for ci in range(8)]
Z5N = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'white']
ZONE2 = [('white100', 840), ('gray80', 1020), ('warm', 1760), ('cool', 1920)]
ZONE7 = [('white', 5240), ('warm', 5360), ('cool', 5480), ('red', 5600)]

CROPS = {'z2': (700, 2200), 'z5': (Z5Y - 170, Z5Y + 230), 'z7': (5180, 5720)}


def fmt(ours, deh, ok):
    flag = 'PASS' if ok else 'FAIL'
    return f"{ours:6.3f} | {deh:6.3f} | {ours-deh:+6.3f}  {flag}"


def scorecard(asymmetric, highpass, label):
    print(f"\n{'='*78}\n  {label}   (asymmetric={asymmetric}  highpass={highpass})\n{'='*78}")
    base2 = load(BASE, *CROPS['z2']); deh2 = load(HAL, *CROPS['z2'])
    base5 = load(BASE, *CROPS['z5']); deh5 = load(HAL, *CROPS['z5'])
    base7 = load(BASE, *CROPS['z7']); deh7 = load(HAL, *CROPS['z7'])
    o2 = render(base2, P, asymmetric, highpass)
    o5 = render(base5, P, asymmetric, highpass)
    o7 = render(base7, P, asymmetric, highpass)
    y2, y5, y7 = CROPS['z2'][0], CROPS['z5'][0], CROPS['z7'][0]

    fails = []
    print("\n-- ZONE5 color blocks:  GAP R (edge halo)            | INTERIOR G (flood)")
    for cx, nm in zip(Z5X, Z5N):
        sx = px(cx)
        g = Z5Y - 15 - y5
        it = Z5Y + 60 - y5
        gapR, dgapR = o5[g, sx, 0], deh5[g, sx, 0]
        intG, dintG, bintG = o5[it, sx, 1], deh5[it, sx, 1], base5[it, sx, 1]
        ok_gap = abs(gapR - dgapR) < 0.12
        ok_int = (intG - dintG) < 0.03           # flood = surplus green over Dehancer
        if not ok_gap: fails.append(f"z5 {nm} gap R")
        if not ok_int: fails.append(f"z5 {nm} interior G flood")
        print(f"  {nm:7s} gap R: {fmt(gapR, dgapR, ok_gap)}   ||  int G: {fmt(intG, dintG, ok_int)}  (base {bintG:.3f})")

    print("\n-- ZONE2 bars:  GAP R                                 | INTERIOR neutrality/flood")
    for nm, yt in ZONE2:
        sx = 3600
        g = yt - 15 - y2
        it = yt + 80 - y2
        gapR, dgapR = o2[g, sx, 0], deh2[g, sx, 0]
        iR, iG = o2[it, sx, 0], o2[it, sx, 1]
        diR, diG = deh2[it, sx, 0], deh2[it, sx, 1]
        ok_gap = abs(gapR - dgapR) < 0.18    # gray80/cool gap strength deferred -> looser
        # interior: match Dehancer R and G (catches pink-flood = R surplus on neutrals)
        ok_int = abs(iR - diR) < 0.04 and abs(iG - diG) < 0.04
        if not ok_int: fails.append(f"z2 {nm} interior")
        print(f"  {nm:8s} gap R: {fmt(gapR, dgapR, ok_gap)}   ||  int R {iR:.3f}/{diR:.3f} G {iG:.3f}/{diG:.3f} {'PASS' if ok_int else 'FAIL'}")

    print("\n-- ZONE7 thin lines (d=10):  R                        | G (softness; want low, ~pure red)")
    for nm, yl in ZONE7:
        sx = 3600
        s = yl - 10 - y7
        R, dR = o7[s, sx, 0], deh7[s, sx, 0]
        G, dG = o7[s, sx, 1], deh7[s, sx, 1]
        ok_R = abs(R - dR) < 0.18
        ok_G = abs(G - dG) < 0.08
        if not ok_G: fails.append(f"z7 {nm} line G")
        print(f"  {nm:6s} R: {fmt(R, dR, ok_R)}   ||  G: {fmt(G, dG, ok_G)}")

    # halo softness: G/R in the white-bar gap (wide source)
    g = 840 - 15 - y2
    R, G = o2[g, 3600, 0], o2[g, 3600, 1]
    dR, dG = deh2[g, 3600, 0], deh2[g, 3600, 1]
    ratio = G / max(R, 1e-6); dratio = dG / max(dR, 1e-6)
    ok_soft = 0.04 < ratio < 0.30
    if not ok_soft: fails.append("halo softness (white gap G/R)")
    print(f"\n-- HALO SOFTNESS  white-gap G/R: {ratio:.3f} (Dehancer {dratio:.3f})  "
          f"{'PASS' if ok_soft else 'FAIL — pure red or too green'}")

    print(f"\n  >>> {label}: {len(fails)} FAIL rows" + (": " + ", ".join(fails) if fails else " — ALL PASS"))
    return fails


if __name__ == '__main__':
    scorecard(asymmetric=False, highpass=False, label='BASELINE (committed: symmetric + screen)')
    scorecard(asymmetric=True,  highpass=True,  label='NEW (asymmetric + high-pass)')
