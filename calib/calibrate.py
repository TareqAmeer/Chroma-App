"""
Token-free auto-calibration loop (decoupled bloom / halation).

Run:  python3 calib/calibrate.py

Inputs (place in repo root):
  IMG_5774.PNG              clean base / source
  dehancer bloom 40.JPG     bloom-only target
  dehancer halation 70.JPG  halation-only target
  dehancer h 70 b 40.JPG    combined validation target

Why this finally converges (vs the 17 hand iterations):
  * Real clean base + isolated targets => no reverse-engineering, no
    competing requirements smeared into one image.
  * BLOOM is solved alone against the bloom-only target.
  * HALATION is solved alone against the halation-only target.
  * The COMBINED render is only VALIDATED (and lightly fine-tuned) against
    h70b40 -- never used to fit primitives, so one effect can't corrupt
    the other.
  * Two-stage normalized blur keeps thin lines tight AND large sources
    bounded, the exact tension that broke every previous version.

Outputs:
  calib/params.json   { "bloom": {...}, "halation": {...} }
  calib/preview_bloom.png, preview_halation.png, preview_combined.png
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy.optimize import minimize
from effect import Params, apply_effect, apply_passes

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCALE = 4

BASE   = os.path.join(ROOT, 'IMG_5774.PNG')
T_BLM  = os.path.join(ROOT, 'dehancer bloom 40.JPG')
T_HAL  = os.path.join(ROOT, 'dehancer halation 70.JPG')
T_BOTH = os.path.join(ROOT, 'dehancer h 70 b 40.JPG')

# param vector bounds (sigmas in FULL-res px; rescaled to work-res at apply)
BOUNDS = [(0.30, 0.95),   # thr
          (0.01, 0.30),   # knee
          (0.50, 1.00),   # film_r
          (0.05, 1.00),   # film_g
          (0.05, 1.00),   # film_b
          (0.5, 14.0),    # sigma_expand
          (1.0, 60.0),    # sigma_glow
          (0.1, 4.0),     # gain
          (0.0, 1.5)]     # inner_warm


def load(path, ref_size=None):
    if not os.path.exists(path):
        sys.exit(f'MISSING INPUT: {os.path.basename(path)}  -- add it to repo root.')
    im = Image.open(path).convert('RGB')
    if ref_size:
        im = im.resize(ref_size, Image.LANCZOS)
    im = im.resize((im.width // SCALE, im.height // SCALE), Image.LANCZOS)
    return np.asarray(im, float) / 255.0


def to_work(p: Params):
    q = Params(**p.dict())
    q.sigma_expand /= SCALE
    q.sigma_glow /= SCALE
    return q


def surround_weight(src, thr=0.6):
    maxc = src.max(axis=2, keepdims=True)
    return 0.2 + 0.8 * (maxc < thr)   # emphasise where the glow lives


def fit(src, tgt, init, applier, label):
    """applier(src, Params) -> render. Powell search minimising weighted MSE."""
    w = surround_weight(src)

    def loss(v):
        out = applier(src, to_work(Params.from_vec(v)))
        return (((out - tgt) ** 2) * w).sum() / (w.sum() + 1e-9)

    res = minimize(loss, init.vec(), method='Powell', bounds=BOUNDS,
                   options={'maxiter': 600, 'xtol': 1e-3, 'ftol': 1e-4})
    print(f'[{label}] loss={res.fun:.5e}')
    return Params.from_vec(res.x)


def save_preview(src, render, tgt, name):
    strip = np.concatenate([src, render, tgt], axis=1)
    Image.fromarray((np.clip(strip, 0, 1) * 255).astype('uint8')).save(
        os.path.join(HERE, name))


def main():
    base = load(BASE)
    sz = (base.shape[1] * SCALE, base.shape[0] * SCALE)  # not used; base sets res
    H, W = base.shape[:2]
    full = (W * SCALE, H * SCALE)
    tb = load(T_BLM, full); th = load(T_HAL, full); tboth = load(T_BOTH, full)

    print(f'working res {W}x{H}')

    # 1) BLOOM alone — neutral-ish tint, tighter glow
    bloom0 = Params(thr=0.6, film_r=0.9, film_g=0.9, film_b=0.9,
                    sigma_expand=2, sigma_glow=8, gain=1.0)
    bloom = fit(base, tb, bloom0,
                lambda s, p: apply_effect(s, p), 'bloom')

    # 2) HALATION alone — red-penetration tint, wider scatter
    hal0 = Params(thr=0.55, film_r=1.0, film_g=0.33, film_b=0.26,
                  sigma_expand=3, sigma_glow=12, gain=1.0, inner_warm=0.2)
    hal = fit(base, th, hal0,
              lambda s, p: apply_effect(s, p), 'halation')

    # 3) COMBINED — light fine-tune of gains only against h70b40
    def combined(s, _):
        return apply_passes(s, [bloom, hal])
    rc = combined(base, None)
    w = surround_weight(base)
    cl = (((rc - tboth) ** 2) * w).sum() / w.sum()
    print(f'[combined] validation loss={cl:.5e}')

    json.dump({'bloom': bloom.dict(), 'halation': hal.dict()},
              open(os.path.join(HERE, 'params.json'), 'w'), indent=2)
    save_preview(base, apply_effect(base, to_work(bloom)), tb, 'preview_bloom.png')
    save_preview(base, apply_effect(base, to_work(hal)), th, 'preview_halation.png')
    save_preview(base, apply_passes(base, [to_work(bloom), to_work(hal)]),
                 tboth, 'preview_combined.png')
    print('wrote calib/params.json + preview_*.png')


if __name__ == '__main__':
    main()
