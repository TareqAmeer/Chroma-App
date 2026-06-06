"""
Halation + bloom engine v5 — warm-line-corrected, measurement-derived.

Key insight from v5 calibration:
  * emit = smoothstep(thr, thr+knee, lum) * max(R - bs*max(G,B), 0)^P
  * The UNNORMALIZED red surplus (NOT divided by 1-bs) is critical:
      - warm line (R=1, G=0.63, B=0.31): surplus=0.70 → emits ~4.5× white
      - white dot  (R=G=B=1):           surplus=0.15 → emits 1× reference
      - thin red   (R=1, G=0.31, B=0.31): lum=0.28 < thr=0.35 → suppressed
    This reproduces the empirically-measured 4.5× ratio of warm-line vs
    white-dot effective glow amplitude in the Dehancer targets.
  * power=1.0 on the surplus (no lum^P beyond the threshold gate)
  * thr=0.35 with knee=0.12: warm line (lum=0.47) passes, thin red (lum=0.28)
    is gated out, matching the near-zero glow on the thin red test line.

Bloom: lum-gated (no red-surplus), separate thr/power/sigma.
Area-normalized blur, dense 1:1 kernel for clean GLSL transplant.
"""
import numpy as np
from scipy.ndimage import gaussian_filter
from dataclasses import dataclass, asdict

LUM = np.array([0.2126, 0.7152, 0.0722])


@dataclass
class Params:
    thr: float = 0.35        # brightness gate (linear lum) — suppresses thin-red (lum=0.28)
    knee: float = 0.12
    power: float = 1.0       # power on red_surplus (1.0 = linear)
    bluesupp: float = 0.85   # unnorm surplus: R - bs*max(G,B); white→0.15, warm→0.70
    film_r: float = 1.00     # halo tint (warm backing)
    film_g: float = 0.25
    film_b: float = 0.05
    sigma: float = 7.0       # halo sigma px (native res)
    gain: float = 7.0        # gain on blurred surplus

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
    # Unnormalized red surplus: warm sources emit more than white (warm~0.70 vs white~0.15)
    red_surplus = np.clip(lin[..., 0] - p.bluesupp * np.maximum(lin[..., 1], lin[..., 2]), 0, None)
    return bright * np.power(red_surplus, p.power)                     # HxW scalar


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
