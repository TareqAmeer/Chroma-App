"""
Halation + bloom engine v4 — measurement-derived, linear-light.

Model derived directly from Dehancer target pixels:
  * Halo strength ordering large-area > compact-dot >> thin-line is
    reproduced by AREA-normalized (energy-conserving) blur of a strongly
    NON-LINEAR emission: emit = brightness_gate * lum^P * red_gate.
      - lum^P (high P): pure white (lum=1) stays full; dimmer reds (the
        thin line, lum~0.46) get crushed -> tiny halo. White dot halates,
        red line barely does, exactly like the target.
      - red_gate = clamp(R - kb*max(G,B)): passes white & red, kills
        cyan/blue (which show ~zero halation in the target).
  * Halo TINT is the fixed film backing colour (warm orange), not the
    source colour — a white dot produces an ORANGE halo in the target.
  * screen() composite in LINEAR light: bright cores stay unchanged
    (screen(white,x)=white) so large white bars don't blow out.

Bloom: neutral tint, its own threshold/power/sigma; subtle, large-area only.

Area-normalized blur => for halation/bloom sigmas (~8-13px) the 3-sigma
kernel fits in +/-48 taps, so the GLSL uses a dense 1:1 kernel (no pixel
stepping, no grid artefacts) and transplants 1:1.
"""
import numpy as np
from scipy.ndimage import gaussian_filter
from dataclasses import dataclass, asdict

LUM = np.array([0.2126, 0.7152, 0.0722])


@dataclass
class Params:
    thr: float = 0.30        # brightness gate (linear lum)
    knee: float = 0.20
    power: float = 4.0       # brightness nonlinearity
    bluesupp: float = 0.5    # red_gate: R - bluesupp*max(G,B)
    film_r: float = 1.00     # halo tint (warm backing)
    film_g: float = 0.40
    film_b: float = 0.15
    sigma: float = 10.0      # halo sigma px (native res)
    gain: float = 6.0        # reflectance (area-norm needs gain >> 1)

    def vec(self):
        return np.array([self.thr, self.knee, self.power, self.bluesupp,
                         self.film_r, self.film_g, self.film_b,
                         self.sigma, self.gain], float)

    @staticmethod
    def from_vec(v):
        return Params(*[float(x) for x in v])

    def dict(self):
        return asdict(self)


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
    redgate = np.clip((lin[..., 0] - p.bluesupp * np.maximum(lin[..., 1], lin[..., 2]))
                      / (1.0 - p.bluesupp + 1e-6), 0, 1)
    return bright * np.power(np.clip(lum, 0, 1), p.power) * redgate   # HxW scalar


def emit_bloom(lin, p):
    # LUMINANCE-gated (not max-channel): only bright *white* areas bloom,
    # saturated colours (lower luminance) do not -> matches target.
    lum = lin @ LUM
    bright = smoothstep(p.thr, p.thr + p.knee, lum)
    return bright * np.power(np.clip(lum, 0, 1), p.power)             # HxW scalar


def area_blur(scalar, sigma):
    if sigma < 0.3:
        return scalar.copy()
    return gaussian_filter(scalar, sigma, mode='constant')            # area-normalized


def apply_halation(src_srgb, p):
    lin = s2l(src_srgb)
    g = area_blur(emit_halation(lin, p), p.sigma) * p.gain
    tint = np.array([p.film_r, p.film_g, p.film_b])
    glow = g[..., None] * tint[None, None, :]
    return l2s(np.clip(screen(lin, glow), 0, 1))


def apply_bloom(src_srgb, p):
    lin = s2l(src_srgb)
    g = area_blur(emit_bloom(lin, p), p.sigma) * p.gain
    glow = g[..., None] * np.ones(3)[None, None, :]
    return l2s(np.clip(screen(lin, glow), 0, 1))


def apply_both(src_srgb, pblm, phal):
    lin = s2l(src_srgb)
    gb = area_blur(emit_bloom(lin, pblm), pblm.sigma) * pblm.gain
    lin = np.clip(screen(lin, gb[..., None] * np.ones(3)), 0, 1)
    gh = area_blur(emit_halation(lin, phal), phal.sigma) * phal.gain
    tint = np.array([phal.film_r, phal.film_g, phal.film_b])
    return l2s(np.clip(screen(lin, gh[..., None] * tint), 0, 1))
