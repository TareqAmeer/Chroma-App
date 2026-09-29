"""
Halation + bloom engine v6 — channel-split halation, source-coloured bloom.

Key changes from v5:
  Halation:
    * Replace single-sigma blur + tint with THREE independent channel blurs.
      σ_R=6.14 >> σ_G=2.62 >> σ_B=1.0 px (at 2400px reference width).
      The warm backing colour emerges from physics: red spreads wider than
      green which spreads wider than blue — no tint constant needed.
    * gain_R=6.89, gain_G=0.109, gain_B=0.0 — measured from Dehancer 2× PNG
      halation render via linear-domain Gaussian fit on warm/white line tails.

  Bloom:
    * Emit is now source-coloured: gate × lin.rgb (not gate × scalar).
      Confirmed by: white bar → neutral bloom, warm bar → warm-tinted bloom.
    * σ=12.42px, gain=0.111 from erfc fit on 100% white bar horizontal edge.

  Emission (halation, unnormalized red surplus):
    emit = smoothstep(thr, thr+knee, lum) × max(R − bs·max(G,B), 0)^power
    warm line: emit≈0.717, white line: emit≈0.194 → ratio ≈3.7×  (≈Dehancer)
"""
import numpy as np
from scipy.ndimage import gaussian_filter
from dataclasses import dataclass, asdict

LUM = np.array([0.2126, 0.7152, 0.0722])


@dataclass
class HalParams:
    thr: float = 0.330
    knee: float = 0.141
    power: float = 1.0
    bluesupp: float = 0.806
    sigma_r: float = 6.14   # px at 2400px reference
    sigma_g: float = 2.62
    sigma_b: float = 1.0
    gain_r: float = 6.89
    gain_g: float = 0.109
    gain_b: float = 0.0

    def dict(self): return asdict(self)


@dataclass
class BlmParams:
    thr: float = 0.10
    knee: float = 0.15
    power: float = 5.0
    sigma: float = 12.42
    gain: float = 0.111

    def dict(self): return asdict(self)


def s2l(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c/12.92, ((c+0.055)/1.055)**2.4)

def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c*12.92, 1.055*c**(1/2.4)-0.055)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

def screen(a, b):
    return 1 - (1 - a) * (1 - b)


def emit_halation(lin, p):
    lum = lin @ LUM
    bright = smoothstep(p.thr, p.thr + p.knee, lum)
    red_surplus = np.clip(lin[..., 0] - p.bluesupp * np.maximum(lin[..., 1], lin[..., 2]), 0, None)
    return bright * np.power(red_surplus, p.power)   # HxW scalar


def emit_bloom(lin, p):
    lum = lin @ LUM
    bright = smoothstep(p.thr, p.thr + p.knee, lum)
    gate = bright * np.power(np.clip(lum, 0, 1), p.power)
    return gate[..., None] * lin                     # HxW×3 source-coloured


def area_blur(arr, sigma):
    if sigma < 0.3:
        return arr.copy()
    return gaussian_filter(arr, sigma, mode='constant')


def apply_halation(src_srgb, p, amount=1.0):
    lin = s2l(src_srgb)
    e = emit_halation(lin, p)
    # Per-channel blur at independent sigmas → warm backing emerges from physics
    glow = np.stack([
        area_blur(e, p.sigma_r) * p.gain_r * amount,
        area_blur(e, p.sigma_g) * p.gain_g * amount,
        area_blur(e, p.sigma_b) * p.gain_b * amount,
    ], axis=-1)
    return l2s(np.clip(screen(lin, glow), 0, 1))


def apply_bloom(src_srgb, p, amount=1.0):
    lin = s2l(src_srgb)
    e_rgb = emit_bloom(lin, p)   # HxW×3 source-coloured
    # Same sigma for all channels (bloom is symmetric / achromatic spreading)
    glow = np.stack([
        area_blur(e_rgb[..., i], p.sigma) for i in range(3)
    ], axis=-1) * p.gain * amount
    return l2s(np.clip(screen(lin, glow), 0, 1))


def apply_both(src_srgb, bp, hp, amount_bloom=1.0, amount_hal=1.0):
    lin = s2l(src_srgb)
    # Bloom first
    e_bloom = emit_bloom(lin, bp)
    g_bloom = np.stack([
        area_blur(e_bloom[..., i], bp.sigma) for i in range(3)
    ], axis=-1) * bp.gain * amount_bloom
    lin = np.clip(screen(lin, g_bloom), 0, 1)
    # Halation on top
    e_hal = emit_halation(lin, hp)
    g_hal = np.stack([
        area_blur(e_hal, hp.sigma_r) * hp.gain_r * amount_hal,
        area_blur(e_hal, hp.sigma_g) * hp.gain_g * amount_hal,
        area_blur(e_hal, hp.sigma_b) * hp.gain_b * amount_hal,
    ], axis=-1)
    return l2s(np.clip(screen(lin, g_hal), 0, 1))
