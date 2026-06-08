#!/usr/bin/env python3
"""Fit a 33^3 STD->look 3D LUT from montage (Camera Standard -> preset) pixel pairs.

Scattered-data fit with regularization:
  - gather all CamStd->preset pixel pairs across montages (subsampled)
  - per lattice node: Gaussian-weighted mean of nearby output samples
  - blend toward identity where data is sparse (lambda)
  - confidence-weighted 3D Laplacian smoothing to denoise / fill gaps
"""
import os
import numpy as np
from numpy.fft import fft2, ifft2
from scipy.spatial import cKDTree
import cube_io as C
import extract_panels as E

SIZE = 33


def _align(ref, mov):
    """Integer (dy,dx) to shift `mov` onto `ref` via phase correlation (grayscale)."""
    a = ref.mean(2) - ref.mean(); b = mov.mean(2) - mov.mean()
    R = fft2(a) * np.conj(fft2(b)); R /= np.abs(R) + 1e-8
    c = np.abs(ifft2(R))
    dy, dx = np.unravel_index(np.argmax(c), c.shape)
    if dy > a.shape[0] // 2: dy -= a.shape[0]
    if dx > a.shape[1] // 2: dx -= a.shape[1]
    return dy, dx


def _scene_panels(exclude_scene=None):
    """Yield (scene_id, panels-dict) per unique montage scene."""
    seen = set()
    for p in E.list_montages():
        scene = os.path.basename(p).split("_")[0]
        if scene in seen:
            continue
        seen.add(scene)
        if exclude_scene is not None and scene == exclude_scene:
            continue
        yield scene, E.crop_panels(p)


def aligned_pair(panels, preset, edge_drop=8):
    """Return aligned (cs, target) float images cropped to a safe interior."""
    cs = panels["Camera Standard"].astype(np.float64) / 255.0
    tg = panels[preset].astype(np.float64) / 255.0
    h = min(cs.shape[0], tg.shape[0]); w = min(cs.shape[1], tg.shape[1])
    cs = cs[:h, :w]; tg = tg[:h, :w]
    dy, dx = _align(cs, tg)
    tg = np.roll(tg, (-dy, -dx), axis=(0, 1))
    e = edge_drop
    return cs[e:-e, e:-e], tg[e:-e, e:-e]


def collect_pairs(preset, max_per_montage=60000, seed=0, exclude_scene=None):
    """Return (inN x3, outN x3) aligned pixel pairs in [0,1] for one preset."""
    rng = np.random.RandomState(seed)
    ins, outs = [], []
    for scene, panels in _scene_panels(exclude_scene):
        cs, tg = aligned_pair(panels, preset)
        a = cs.reshape(-1, 3); b = tg.reshape(-1, 3)
        if len(a) > max_per_montage:
            idx = rng.choice(len(a), max_per_montage, replace=False)
            a, b = a[idx], b[idx]
        ins.append(a); outs.append(b)
    return np.concatenate(ins), np.concatenate(outs)


def fit_lut(ins, outs, size=SIZE, radius=0.06, lam=2.0, smooth_iters=20):
    lat = C.lattice(size).reshape(-1, 3)
    tree = cKDTree(ins)
    val = np.zeros((size ** 3, 3))
    conf = np.zeros(size ** 3)
    sig2 = (radius * 0.6) ** 2
    for i, node in enumerate(lat):
        idx = tree.query_ball_point(node, radius)
        if idx:
            d2 = np.sum((ins[idx] - node) ** 2, axis=1)
            w = np.exp(-d2 / (2 * sig2))
            sw = w.sum()
            val[i] = (w[:, None] * outs[idx]).sum(0) / sw
            conf[i] = sw
        else:
            val[i] = node           # identity fallback
            conf[i] = 0.0
    # blend toward identity by confidence
    a = conf / (conf + lam)
    val = a[:, None] * val + (1 - a)[:, None] * lat
    # confidence-weighted Laplacian smoothing (more smoothing where low confidence)
    V = val.reshape(size, size, size, 3)
    Cf = conf.reshape(size, size, size)
    for _ in range(smooth_iters):
        nb = np.zeros_like(V); cnt = np.zeros((size, size, size, 1))
        for ax in range(3):
            for sh in (1, -1):
                nb += np.roll(V, sh, axis=ax); cnt += 1
        avg = nb / cnt
        beta = (1.0 / (1.0 + Cf))[..., None]   # 0..1; high where low confidence
        V = (1 - beta) * V + beta * avg
    return np.clip(V, 0.0, 1.0)


def _polyfeat(x):
    """Degree-3 RGB polynomial features (20 terms)."""
    r, g, b = x[:, 0], x[:, 1], x[:, 2]
    o = np.ones_like(r)
    return np.stack([o, r, g, b, r*r, g*g, b*b, r*g, r*b, g*b,
                     r*r*r, g*g*g, b*b*b, r*g*b, r*r*g, r*r*b,
                     g*g*r, g*g*b, b*b*r, b*b*g], axis=1)


def fit_poly(ins, outs):
    """Smooth global degree-3 color transform. Robust to noisy correspondence
    (averages out per-pixel misalignment/compression scatter) and preserves
    contrast/saturation, unlike a noise-sensitive scattered 3D-LUT fit."""
    coef, *_ = np.linalg.lstsq(_polyfeat(ins), outs, rcond=None)
    return coef


def apply_poly(coef, rgb):
    shp = rgb.shape
    y = _polyfeat(np.clip(rgb.reshape(-1, 3), 0, 1)) @ coef
    return np.clip(y, 0.0, 1.0).reshape(shp)


def poly_to_lut(coef, size=SIZE):
    """Bake a polynomial color transform into a size^3 3D LUT array."""
    lat = C.lattice(size)
    return apply_poly(coef, lat)


def fit_preset(preset, method="poly", exclude_scene=None, **kw):
    ins, outs = collect_pairs(preset, exclude_scene=exclude_scene)
    if method == "poly":
        return poly_to_lut(fit_poly(ins, outs)), len(ins)
    return fit_lut(ins, outs, **kw), len(ins)


if __name__ == "__main__":
    import sys
    preset = sys.argv[1] if len(sys.argv) > 1 else "Velvia"
    lut, n = fit_preset(preset)
    print(f"fit {preset} from {n} pairs -> LUT {lut.shape}")
