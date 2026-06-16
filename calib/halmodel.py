"""
Shared halation model + image helpers for calibration.

Two emission models:
  * `emit_current`  — the committed v22 red-channel model (for baseline rendering).
  * `emit_rule`     — the new rule-based model:
        sat  = max(rgb) - min(rgb)
        emit = bright * ( kW*lum^powL + kC*sat*clamp(R + aG*G - bB*B, 0) )
    glow is channel-split blurred and tinted red-orange (gainG/gainR small).

All blurs use PIL GaussianBlur to match the HTML/validate_v22 pipeline.
Sigmas are given at 1x (2400px ref); images here are 2x (4800px) so multiply by 2.
"""
import numpy as np
from PIL import Image, ImageFilter

LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def s2l(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c/12.92, ((c+0.055)/1.055)**2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c*12.92, 1.055*c**(1/2.4)-0.055)


def smoothstep(a, b, x):
    t = np.clip((x-a)/(b-a+1e-9), 0, 1)
    return t*t*(3-2*t)


def screen(a, b):
    return 1-(1-a)*(1-b)


def gauss_blur(arr2d, sigma):
    if sigma < 0.3:
        return arr2d.copy()
    img8 = Image.fromarray((np.clip(arr2d, 0, 1)*255).astype(np.uint8))
    return np.array(img8.filter(ImageFilter.GaussianBlur(radius=sigma)),
                    dtype=np.float32)/255.0


# ── Emission models ──────────────────────────────────────────────────────────
def emit_current(lin, thr=0.10, knee=0.141, bluesupp=0.5):
    """Committed v22: red-channel surplus, blue-suppressed."""
    lum = lin @ LUM
    bright = smoothstep(thr, thr+knee, lum)
    return bright * np.clip(lin[..., 0] - bluesupp*lin[..., 2], 0, 1)


def emit_rule(lin, powL, kW, kC, aG, bB, bP=0.0, thr=0.10, knee=0.141):
    """Rule-based: bright-neutral (lum^powL) + saturation/warm color term.

    warmth = R + aG*G - bB*max(B-R, 0) + bP*min(R, B)

    Two purple-specific terms (both needed -- see CLAUDE.md v22.1b):
    1. ASYMMETRIC blue suppression `-bB*max(B-R, 0)`: suppression only kicks in
       for the blue EXCESS over red. Decouples bB's effect -- red/orange/yellow/
       green/purple/warm (B<=R) are untouched, blue/cyan/cool (B>R) suppressed
       in proportion to excess blue. Fixes the old symmetric `R - bB*B` form,
       where purple (R==B, e.g. (200,0,200)) collapsed to ~0 emission (R and B
       nearly cancelled) -- even though Dehancer clearly halates purple.
    2. MAGENTA/PURPLE DRIVER `+bP*min(R, B)`: even after fix #1, this chart's
       purple swatch (200,0,200) has R==B exactly, so `max(B-R,0)=0` and bB has
       NO EFFECT on it (purely an excess-suppressor, not a booster) -- purple
       still under-halated (0.187 vs Dehancer's 0.325). min(R,B) is a clean
       "magenta-ness" detector: PROVABLY zero whenever either channel is zero
       (red/orange/yellow/green have B=0; cyan/blue have R=0), so it only
       activates where R and B are both present together. Validated: bP=2.10
       moves ONLY the purple gap (0.187->0.327) with every other color's gap-R
       and interior-flood value bit-identical (calib/scorecard.py: 1 FAIL->0).
    """
    lum = lin @ LUM
    bright = smoothstep(thr, thr+knee, lum)
    sat = lin.max(-1) - lin.min(-1)
    white = lum**powL
    blue_excess = np.clip(lin[..., 2] - lin[..., 0], 0, None)
    magenta = np.minimum(lin[..., 0], lin[..., 2])
    warmth = lin[..., 0] + aG*lin[..., 1] - bB*blue_excess + bP*magenta
    color = sat * np.clip(warmth, 0, None)
    return bright * (kW*white + kC*color)


# ── Full halation apply (channel-split blur + screen) ─────────────────────────
def apply_halation(src_srgb, emit, gainR, gainG, gainB, sigmaR, sigmaG, sigmaB,
                   highpass=True):
    """src_srgb: HxWx3 in [0,1]. emit: HxW scalar emission map.

    highpass=True (HIGH-PASS GLOW): the glow is the part of the blur that spread
    BEYOND the local emission — max(blur(emit) - emit, 0). In a uniform flat
    field blur(emit) ~= emit so the glow ~= 0 (no interior flooding); at gaps/
    edges blur(emit) > local emit so the halo is full. This decouples gap-halo
    strength from interior flooding: gainG can stay nonzero (soft red-orange)
    without screening green back onto a flat colored block (the red->orange bug).
    Verified: identical gap R, interior G flood eliminated for every color.

    highpass=False: legacy screen-the-blur (kept for baseline comparisons).
    """
    lin = s2l(src_srgb)

    # emit is stored in an 8-bit texture in the HTML pipeline (clamped to [0,1]);
    # subtract the SAME clamped emit so this matches the shipped GLSL exactly.
    emit_c = np.clip(emit, 0, 1)

    def chan(sig, gain):
        b = gauss_blur(emit, sig)
        if highpass:
            b = np.clip(b - emit_c, 0, None)
        return b*gain
    glow = np.stack([chan(sigmaR, gainR), chan(sigmaG, gainG), chan(sigmaB, gainB)],
                    axis=-1)
    return l2s(np.clip(screen(lin, glow), 0, 1))


# Default parameter packs (sigmas already at 2x)
CURRENT = dict(gainR=1.50, gainG=0.05, gainB=0.0,
               sigmaR=6.14*2, sigmaG=2.62*2, sigmaB=1.0*2)


def render_current(src_srgb):
    lin = s2l(src_srgb)
    e = emit_current(lin)
    return apply_halation(src_srgb, e, **CURRENT)


def render_rule(src_srgb, p):
    """p: dict with powL,kW,kC,aG,bB,bP(optional,default 0),gainR,gainG,gainB,sigmaR,sigmaG,sigmaB."""
    lin = s2l(src_srgb)
    e = emit_rule(lin, p['powL'], p['kW'], p['kC'], p['aG'], p['bB'], p.get('bP', 0.0))
    return apply_halation(src_srgb, e, p['gainR'], p['gainG'], p['gainB'],
                          p['sigmaR'], p['sigmaG'], p['sigmaB'])


# ── Two-component glow: wide red-orange halo + narrow warm "inner glow" ──────
# Measured in Dehancer: right at a bright edge the halo is amber (G/R~0.7-0.8),
# fading to deep red further out (G/R~0.15-0.2). A single profile can't do both;
# we add a second, narrower, more-saturated-amber component on top of the
# existing wide red halo — this is the "tiny inner glow at bright edges" cue.
def apply_halation_2c(src_srgb, emit, p):
    """p adds: sigmaIn, gainRIn, gainGIn (narrow warm inner-glow component)."""
    lin = s2l(src_srgb)
    g_outer = np.stack([
        gauss_blur(emit, p['sigmaR'])*p['gainR'],
        gauss_blur(emit, p['sigmaG'])*p['gainG'],
        gauss_blur(emit, p['sigmaB'])*p['gainB'],
    ], axis=-1)
    g_inner = np.stack([
        gauss_blur(emit, p['sigmaIn'])*p['gainRIn'],
        gauss_blur(emit, p['sigmaIn']*0.9)*p['gainGIn'],
        np.zeros_like(emit),
    ], axis=-1)
    glow = g_outer + g_inner
    return l2s(np.clip(screen(lin, glow), 0, 1))


def render_rule2(src_srgb, p):
    """Like render_rule but with the extra narrow warm inner-glow component."""
    lin = s2l(src_srgb)
    e = emit_rule(lin, p['powL'], p['kW'], p['kC'], p['aG'], p['bB'])
    return apply_halation_2c(src_srgb, e, p)
