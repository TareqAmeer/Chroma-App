#!/usr/bin/env python3
"""Prototype edge-refiners for a coarse SAM mask, scored by test/mask_refinement_quality.mjs (CHR-297 fixtures).
Usage: mask_matting_eval.py <drafts_dir> <manifest-reviewed.json> <out_dir> [method ...]
Methods: gf (guided filter, radius 8), cf (closed-form matting on a band trimap), lkm (large-kernel matting).
Writes <out_dir>/<method>/<id>.png and <out_dir>/manifest-<method>.json (refinedMask = that method).
NOTE: labels come from BiRefNet drafts + prompts; never evaluate a BiRefNet-based refiner against them (circular)."""
import sys, os, json, time
import numpy as np
from PIL import Image, ImageFilter
from pymatting import estimate_alpha_cf, estimate_alpha_lkm
D, M, O = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]; methods = sys.argv[4:] or ['gf', 'cf', 'lkm']
def band(mask, r):
    m = Image.fromarray(mask)
    fg = np.asarray(m.filter(ImageFilter.MinFilter(2 * r + 1))) > 127; bg = np.asarray(m.filter(ImageFilter.MaxFilter(2 * r + 1))) <= 127
    t = np.full(mask.shape, .5); t[fg] = 1; t[bg] = 0; return t
def box(a, r):
    k = 2 * r + 1; p = np.pad(a, ((r + 1, r), (r + 1, r)), mode='edge'); c = p.cumsum(0).cumsum(1)
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
def gf(img, mask, r=8, eps=1e-3):
    g = img.mean(2); I = box(g, r); p = box(mask, r); cov = box(g * mask, r) - I * p; var = box(g * g, r) - I * I
    a = cov / (var + eps); b = p - a * I; return np.clip(box(a, r) * g + box(b, r), 0, 1)
for meth in methods:
    os.makedirs(f'{O}/{meth}', exist_ok=True); fx = []; t0 = time.time()
    for f in M['fixtures']:
        pid = f['id']; img = np.asarray(Image.open(f'{D}/{pid}/photo.png').convert('RGB'), dtype=np.float64) / 255
        sam = np.asarray(Image.open(f'{D}/{pid}/ai-mask.png'))
        if meth == 'gf': a = gf(img, sam / 255.0)
        else:
            fn = estimate_alpha_cf if meth == 'cf' else estimate_alpha_lkm; a = sam / 255.0   # fallback: keep the mask when it is too thin to trimap
            for r in (int(os.environ.get('BAND', 14)), 6, 2):
                tri = band(sam, r)
                if (tri >= .9).any() and (tri <= .1).any(): a = np.clip(fn(img, tri), 0, 1); break
        Image.fromarray((a * 255).astype(np.uint8)).save(f'{O}/{meth}/{pid}.png')
        fx.append(dict(f, refinedMask=os.path.abspath(f'{O}/{meth}/{pid}.png'), photo=os.path.join(os.path.abspath(D), f['photo']), groundTruth=os.path.join(os.path.abspath(D), f['groundTruth']), sourceMask=os.path.join(os.path.abspath(D), f['sourceMask'])))
    json.dump(dict(M, fixtures=fx), open(f'{O}/manifest-{meth}.json', 'w'))
    print(meth, f'{time.time()-t0:.0f}s', flush=True)
