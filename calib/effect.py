"""
Halation + bloom effect engine — numpy reimplementation of the GLSL math.

This is intentionally the SAME pipeline as the shader so converged
parameters transplant directly into chromasmith's GLSL:

  1. source detect : max-channel threshold -> film-color tint
  2. two-stage blur: small normalized "expand" gaussian (turns 1px lines
     into a few-px band) THEN wide normalized "glow" gaussian.
     Both normalized => energy-conserving => large sources never blow up,
     thin lines survive because the expand pass gives them width first.
  3. composite     : screen() into dark surround + subtractive inner warm.

All tunables live in Params so the optimizer can search them.
"""
import numpy as np
from dataclasses import dataclass, asdict


@dataclass
class Params:
    # --- source detection ---
    thr: float = 0.55        # max-channel threshold (0..1)
    knee: float = 0.06       # smoothstep width above thr
    # film penetration tint (R deep, G mid, B shallow)
    film_r: float = 1.00
    film_g: float = 0.33
    film_b: float = 0.26
    # --- blur (in pixels, at native chart resolution) ---
    sigma_expand: float = 3.0
    sigma_glow: float = 7.0
    # --- composite gains ---
    gain: float = 1.0        # overall glow strength into surround
    inner_warm: float = 0.0  # subtractive warming of near-white interiors

    def vec(self):
        return np.array([self.thr, self.knee, self.film_r, self.film_g,
                         self.film_b, self.sigma_expand, self.sigma_glow,
                         self.gain, self.inner_warm], float)

    @staticmethod
    def from_vec(v):
        return Params(*[float(x) for x in v])

    def dict(self):
        return asdict(self)


def _gauss1d(sigma):
    if sigma < 0.3:
        return np.array([1.0])
    r = max(1, int(round(sigma * 3)))
    x = np.arange(-r, r + 1)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    return k / k.sum()


def _sep_blur(img, sigma):
    """Separable normalized gaussian. img: HxWxC float."""
    k = _gauss1d(sigma)
    if k.size == 1:
        return img.copy()
    out = img
    # horizontal then vertical, reflect padding
    out = _conv_axis(out, k, axis=1)
    out = _conv_axis(out, k, axis=0)
    return out


def _conv_axis(img, k, axis):
    r = k.size // 2
    pad = [(0, 0), (0, 0), (0, 0)]
    pad[axis] = (r, r)
    p = np.pad(img, pad, mode='reflect')
    acc = np.zeros_like(img)
    for i, w in enumerate(k):
        sl = [slice(None)] * 3
        sl[axis] = slice(i, i + img.shape[axis])
        acc += w * p[tuple(sl)]
    return acc


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def screen(a, b):
    return 1 - (1 - a) * (1 - b)


def apply_effect(src, p: Params):
    """
    src: HxWx3 float in 0..1 (clean / no-effect image).
    returns HxWx3 float 0..1 with halation+bloom applied.
    """
    src = np.clip(src, 0, 1)
    maxc = src.max(axis=2, keepdims=True)
    hi = smoothstep(p.thr, p.thr + p.knee, maxc)          # HxWx1 weight
    film = np.array([p.film_r, p.film_g, p.film_b])[None, None, :]
    # energy injected at the source, tinted by film penetration
    emit = src * hi * film
    # two-stage normalized blur
    emit = _sep_blur(emit, p.sigma_expand)
    glow = _sep_blur(emit, p.sigma_glow) * p.gain
    # composite: screen glow into the surround (cannot brighten white)
    res = screen(src, glow)
    if p.inner_warm > 0:
        # subtractive amber shift on near-white interiors only
        nearwhite = smoothstep(0.75, 0.95, maxc) * (1 - hi * 0)
        w = glow[:, :, 0:1] * p.inner_warm * nearwhite
        res = res + w * np.array([0.0, -0.18, -0.30])[None, None, :]
    return np.clip(res, 0, 1)


def apply_passes(src, passes):
    """Apply a sequence of effect passes (e.g. [bloom, halation]).

    Each pass reads the running composite as its source, so bloom feeds
    halation exactly like Dehancer's non-linear interaction.
    """
    res = np.clip(src, 0, 1)
    for p in passes:
        res = apply_effect(res, p)
    return res
