"""
Auto-calibration v2 — full-fidelity, glow-focused, self-validating.

Fixes the two methodology bugs that made v18 fail:
  1. Works at HALF resolution (not 1/4) so the glow gradient survives and
     the optimizer can recover the true sigma.
  2. GLOW-FOCUSED loss: weight ~ |target-base|, so the optimizer fits the
     ADDED light (the halo) instead of being dominated by flat areas.
  3. PEAK-normalized model (effect.py v2) so thin lines/small dots actually
     glow and transplant 1:1 to the GLSL raw-sum blur.

Run:  python3 calib/calibrate.py
Outputs:
  calib/params.json
  calib/val_halation.png, val_bloom.png   (base | our render | dehancer)
    stacked crops of W100 dot, zone-2 bar edge, zone-7 warm line.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy.optimize import minimize
from effect import Params, apply_halation, apply_bloom

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCALE = 3

BASE  = os.path.join(ROOT, 'IMG_5774.PNG')
T_HAL = os.path.join(ROOT, 'dehancer halation 70.JPG')
T_BLM = os.path.join(ROOT, 'dehancer bloom 40.JPG')

# crop regions (y0,y1,x0,x1) as fractions, for validation strips
CROPS = {
    'W100_dot':   (0.015, 0.085, 0.02, 0.16),
    'zone2_edge': (0.12, 0.20, 0.48, 0.72),
    'zone7_line': (0.885, 0.965, 0.00, 0.55),
    'zone4_dots': (0.585, 0.66, 0.00, 0.45),
}

# vec order: thr,knee,power,bluesupp,film_r,film_g,film_b,sigma,gain
# sigma searched in FULL-res px; effect runs at work-res so /SCALE.
BOUNDS = [(0.05, 0.60),   # thr
          (0.02, 0.40),   # knee
          (1.0, 8.0),     # power
          (0.0, 1.0),     # bluesupp
          (0.60, 1.00),   # film_r
          (0.10, 0.70),   # film_g
          (0.00, 0.50),   # film_b
          (4.0, 30.0),    # sigma (full-res px)
          (0.5, 40.0)]    # gain (area-norm needs >>1)


def load(path, ref):
    im = Image.open(path).convert('RGB').resize(ref, Image.LANCZOS)
    return np.asarray(im, float) / 255.0


def to_work(p):
    q = Params(**p.dict()); q.sigma /= SCALE; return q


def zone_boost(shape):
    """Extra loss weight on priority zones (thin lines must NOT over-glow;
    colour dots must not over-glow) so they aren't drowned by pixel count."""
    H, W = shape[:2]
    m = np.ones((H, W))
    m[int(0.86*H):int(0.97*H), :] = 8.0     # zone7 single-pixel lines (priority)
    m[int(0.585*H):int(0.66*H), :] = 4.0    # zone4 colour dots
    return m


def fit(base, tgt, init, applier, label, bounds=None):
    """Loss lives ONLY where light changed — penalises missed glow AND spurious
    glow, with negligible weight on flat areas (no dilution -> no zeroing)."""
    bounds = bounds or BOUNDS
    dt = np.abs(tgt - base).max(axis=2)        # where the target changed
    boost = zone_boost(base.shape)

    def loss(v):
        out = applier(base, to_work(Params.from_vec(v)))
        do = np.abs(out - base).max(axis=2)    # where WE changed
        w = ((np.maximum(dt, do) + 0.01) * boost)[..., None]
        return (((out - tgt) ** 2) * w).sum() / w.sum()

    best = None
    for s0 in (8, 16):
        ip = Params.from_vec(init.vec()); ip.sigma = s0
        r = minimize(loss, ip.vec(), method='Powell', bounds=bounds,
                     options={'maxiter': 250, 'xtol': 2e-3, 'ftol': 1e-4})
        if best is None or r.fun < best.fun:
            best = r
    print(f'[{label}] loss={best.fun:.6e}', flush=True)
    return Params.from_vec(best.x)


def crop(img, frac):
    H, W = img.shape[:2]
    y0, y1, x0, x1 = frac
    return img[int(y0*H):int(y1*H), int(x0*W):int(x1*W)]


def save_validation(base, render, tgt, name):
    rows = []
    for fr in CROPS.values():
        b, r, t = crop(base, fr), crop(render, fr), crop(tgt, fr)
        h = min(b.shape[0], 220)
        b, r, t = b[:h], r[:h], t[:h]
        sep = np.ones((h, 6, 3)) * 0.15
        rows.append(np.concatenate([b, sep, r, sep, t], axis=1))
    wmax = max(x.shape[1] for x in rows)
    rows = [np.pad(x, ((0,0),(0,wmax-x.shape[1]),(0,0))) for x in rows]
    gap = np.ones((10, wmax, 3)) * 0.3
    out = rows[0]
    for x in rows[1:]:
        out = np.concatenate([out, gap, x], axis=0)
    Image.fromarray((np.clip(out,0,1)*255).astype('uint8')).save(os.path.join(HERE, name))


def report_zones(base, render, tgt, label):
    print(f'  per-crop mean|render-tgt| ({label}):')
    for nm, fr in CROPS.items():
        e = np.abs(crop(render, fr) - crop(tgt, fr)).mean()
        eb = np.abs(crop(base, fr) - crop(tgt, fr)).mean()
        print(f'    {nm:11s} render={e:.4f}  (base baseline={eb:.4f})')


# ground-truth points measured from full-res targets (R channel of glow, sRGB/255)
# (name, y, x, dx/dy offset, expected combined R at that offset)
GT = [
    ('W100 dot +8px',   110, 148, (0, 8),  63/255),
    ('zone7 line +3px', 2800, 1200, (3, 0),  7/255),
    ('zone2 bar -2px',  420, int(0.7*2400), (-2, 0), 216/255),
]


def point_report(render_full, label):
    print(f'  ground-truth point check ({label}), render R vs target R:')
    for nm, y, x, (dy, dx), tr in GT:
        rv = render_full[y+dy, x+dx, 0]
        print(f'    {nm:16s} render={rv:.3f}  target={tr:.3f}')


def main():
    b0 = Image.open(BASE).convert('RGB')
    ref = (b0.width // SCALE, b0.height // SCALE)
    base = np.asarray(b0.resize(ref, Image.LANCZOS), float)/255.0
    base_full = np.asarray(b0, float)/255.0
    thal = load(T_HAL, ref); tblm = load(T_BLM, ref)
    print(f'work res {ref[0]}x{ref[1]}')

    hal = fit(base, thal, Params(thr=0.30, power=4, bluesupp=0.5,
              film_r=1.0, film_g=0.4, film_b=0.12, sigma=10, gain=8),
              apply_halation, 'halation')
    rh = apply_halation(base, to_work(hal)); report_zones(base, rh, thal, 'halation')
    save_validation(base, rh, thal, 'val_halation.png')
    point_report(apply_halation(base_full, hal), 'halation full-res')

    blm = fit(base, tblm, Params(thr=0.35, power=4, bluesupp=0.0,
              film_r=1.0, film_g=1.0, film_b=1.0, sigma=12, gain=4),
              apply_bloom, 'bloom')
    rb = apply_bloom(base, to_work(blm)); report_zones(base, rb, tblm, 'bloom')
    save_validation(base, rb, tblm, 'val_bloom.png')

    json.dump({'halation': hal.dict(), 'bloom': blm.dict()},
              open(os.path.join(HERE, 'params.json'), 'w'), indent=2)
    print('\nHALATION', hal.dict())
    print('BLOOM   ', blm.dict())
    print('wrote params.json + val_*.png')


if __name__ == '__main__':
    main()
