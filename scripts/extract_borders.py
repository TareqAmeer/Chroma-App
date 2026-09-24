#!/usr/bin/env python3
"""Extract reusable film-border textures from local scans.

Input : "local borders/" (gitignored, personal-use scans)
Output: "local borders/_out/<name>.png"  RGBA, RGB = grey edge texture (black-level
        normalised, so the app tints it), A = frame coverage. Photo, outer paper,
        sprocket holes and edge text are removed.
        "local borders/_out/report.json" per-file sides/thickness/flags
        "local borders/_out/_sheet.jpg"  one review sheet on magenta
Run   : .calibvenv/bin/python scripts/extract_borders.py [name-substring ...]
"""
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), '..', 'local borders')
OUT = os.path.join(ROOT, '_out')
LONG = 2400                      # working resolution (long side)
SKIP = ('Pack-Cover', 'KODAK-GOLD', 'KODAK-PORTRA-400---', 'KODAK-PORTRA-800---', 'rawpixel-id-13960581')

def load(path):
    im = Image.open(path)
    alpha = None
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); a = np.asarray(im)[..., 3] / 255.0
        alpha = a
    rgb = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    s = LONG / max(rgb.shape[:2])
    if s < 1:
        size = (round(rgb.shape[1] * s), round(rgb.shape[0] * s))
        rgb = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).resize(size, Image.LANCZOS)).astype(np.float32) / 255
        if alpha is not None:
            alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).resize(size, Image.LANCZOS)) / 255.0
    return rgb, alpha

def side_view(a, side):
    # rotate so that "depth" runs down rows from the given side: 0 top,1 right,2 bottom,3 left
    return np.rot90(a, {0: 0, 1: 1, 2: 2, 3: 3}[side])

def unview(a, side):
    return np.rot90(a, -{0: 0, 1: 1, 2: 2, 3: 3}[side])

def fit_line(u, v, tol):
    """Robust straight-line fit (iterative trimmed least squares)."""
    keep = np.ones(len(u), bool)
    for _ in range(4):
        c = np.polyfit(u[keep], v[keep], 1)
        r = v - np.polyval(c, u)
        keep = np.abs(r) < max(tol, 2.5 * np.median(np.abs(r[keep])))
    return c, keep

def analyse_side(Y, maxd, mline=None):
    """Y is a side view (depth = axis 0). Raw per-column detection is noisy (dark photo
    content, grain), so the frame is modelled as straight lines: the inner edge line plus a
    solid band of fixed width outward from it. Real edge roughness comes back later through
    luminance, inside a margin around the line, never from the per-column guesses."""
    band = Y[:maxd]
    dark = band < THR
    dark = ndi.binary_closing(ndi.binary_opening(dark, np.ones((3, 1))), np.ones((3, 1)))
    n = band.shape[1]
    outer = np.full(n, -1.0); inner = np.full(n, -1.0)
    run = ndi.uniform_filter1d(dark.astype(float), 4, axis=0) > 0.99
    if mline is not None:   # hand-marked photo edge: never look past it (+ small roughness margin)
        lim = (mline + 0.012 * maxd / 0.16).astype(int)
        run &= np.arange(maxd)[:, None] < lim[None, :]
    for u in range(n):
        idx = np.flatnonzero(run[:, u])
        if not len(idx): continue
        i = idx[-1] + 2
        lit = np.flatnonzero(~dark[:i, u])
        outer[u], inner[u] = (lit[-1] + 1 if len(lit) else 0), min(i, maxd)
    ok = (outer >= 0) & (inner < maxd - 2) & (inner - outer > 2)
    if ok.mean() < 0.5:
        return None
    u = np.arange(n, dtype=float)
    if mline is not None:
        line = mline.astype(float); keep = np.ones(ok.sum(), bool)
    else:
        c, keep = fit_line(u[ok], inner[ok], 0.004 * maxd / 0.16)
        line = np.polyval(c, u)
    width = (line - outer)[ok][keep]
    T = float(np.percentile(width, 12))           # solid band that clears holes/text
    dirty = np.zeros(n, bool)
    dirty[ok] = (line - outer)[ok] < T * 0.85
    dirty[~ok] = True
    return dict(line=line, T=T, dirty=dirty, okfrac=float(ok.mean()))

MARKS = {}

def process(path):
    name = os.path.splitext(os.path.basename(path))[0]
    rgb, alpha = load(path)
    mk = MARKS.get(os.path.basename(path))
    photo = None
    if mk:
        if mk.get('skip'): return dict(file=os.path.basename(path), sides={}, flags=['skipped by hand'], skipped=True)
        pm = Image.new('L', (rgb.shape[1], rgb.shape[0]), 0)
        ImageDraw.Draw(pm).polygon([(x * rgb.shape[1], y * rgb.shape[0]) for x, y in mk['pts']], fill=255)
        photo = np.asarray(pm) > 0
    Y = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    if alpha is not None:
        Y = np.where(alpha > 0.5, Y, 1.0)          # transparent = photo/outside
    Y = ndi.median_filter(Y, 3)
    H, W = Y.shape; S = min(H, W)
    blk = np.percentile(Y, 2)
    THR = blk + 0.16
    globals()['THR'] = THR
    sat = rgb.max(-1) - rgb.min(-1)
    bright = ((Y > blk + 0.28) | (sat > 0.25)) & (Y < 0.999)
    maxd = int(0.16 * S)
    cover = np.zeros((H, W), np.float32)
    rep = dict(file=os.path.basename(path), sides={}, flags=[])
    for side in range(4):
        Yv = side_view(Y, side)
        mline = None
        if photo is not None:
            if mk['none'][side]:
                rep['flags'].append(f'side{side}: marked no frame'); continue
            pv = side_view(photo, side)[:int(0.45 * S)]
            has = pv.any(0)
            if has.mean() < 0.5: rep['flags'].append(f'side{side}: mark outside search band'); continue
            first = np.where(has, pv.argmax(0), 0).astype(float)
            mline = np.interp(np.arange(len(first)), np.flatnonzero(has), first[has])
        md = maxd
        if mline is not None:
            md = int(min(0.45 * S, mline.max() + 0.03 * S))
            # local frame black: a strip just outside the marked edge is known frame
            dd = np.arange(md)[:, None]
            strip = (dd < mline[None, :] - 0.004 * S) & (dd > mline[None, :] - 0.02 * S)
            vals = Yv[:md][strip]
            if vals.size: THR = float(np.percentile(vals, 50)) + 0.12
        globals()['THR'] = THR
        r = analyse_side(Yv, md, mline)
        THR = blk + 0.16
        if r is None:
            rep['flags'].append(f'side{side}: no frame found'); continue
        line, T, dirty = r['line'], r['T'], r['dirty']
        if T < 0.006 * S:
            rep['flags'].append(f'side{side}: solid band too thin after removing holes/text'); continue
        d = np.arange(Yv.shape[0])[:, None].astype(float)
        margin = max(3.0, 0.35 * T)
        lo, hi = line - T, line + margin
        # band membership with soft ends; the inner roughness is decided by darkness below
        m = np.clip(d - lo[None, :] + 1, 0, 1) * np.clip(hi[None, :] - d, 0, 1)
        Yv = Yv.copy()
        npatch = 0
        if dirty.any():
            lab, nlab = ndi.label(ndi.binary_dilation(dirty, iterations=8))
            for k in range(1, nlab + 1):
                span = np.flatnonzero(lab == k); L = len(span)
                if L > 0.3 * len(dirty):
                    rep['flags'].append(f'side{side}: dirty span too long ({L}px)'); continue
                src = next((s0 for s0 in range(0, len(dirty) - L, 5) if not (lab[s0:s0 + L] > 0).any()), None)
                if src is None: rep['flags'].append(f'side{side}: no clean patch source'); continue
                f = max(1, min(16, L // 3)); wgt = np.ones(L); wgt[:f] = np.linspace(0, 1, f); wgt[-f:] = np.linspace(1, 0, f)
                # shift source columns so its edge line lines up with the target line
                for j, (t, s0) in enumerate(zip(span, range(src, src + L))):
                    sh = int(round(line[t] - line[s0]))
                    col = np.roll(Yv[:, s0], sh)
                    Yv[:, t] = Yv[:, t] * (1 - wgt[j]) + col * wgt[j]
                npatch += 1
        dk = np.clip((THR + 0.06 - Yv) / 0.14, 0, 1)
        core = (d < line[None, :] - 2).astype(np.float32)   # the solid band is always opaque
        a = m * np.maximum(dk, core)
        fillb = (core * m > 0) & (dk < 0.5)
        Yv[fillb] = blk + np.random.default_rng(side).normal(0, 0.012, fillb.sum())
        cover = np.maximum(cover, unview(a, side))
        Y = np.where(unview(m, side) > 0, unview(Yv, side), Y)
        rep['sides'][side] = dict(thick=round(T / S, 4), patched=npatch, okfrac=round(r['okfrac'], 2))
        # Straightened edge strip for the app: rows = depth from outer (line - T) to inner
        # (line + margin), so the photo edge is horizontal. Columns span photo corner to
        # photo corner plus T at each end, so the real corners come with the strip.
        if photo is not None:
            hv = side_view(photo, side).any(0); cols = np.flatnonzero(hv)
        else:
            cols = np.flatnonzero(~r['dirty']) if (~r['dirty']).any() else np.arange(len(line))
        u0, u1 = int(max(0, cols[0] - T)), int(min(len(line) - 1, cols[-1] + T))
        h = int(round(T + margin)); uu = np.arange(u0, u1 + 1)
        rows = (line[uu][None, :] - T) + np.arange(h)[:, None]
        cc = np.broadcast_to(uu[None, :], rows.shape)
        tv = np.clip((Yv - blk) / 0.35, 0, 1)
        st_t = ndi.map_coordinates(tv, [rows, cc], order=1, mode='nearest')
        st_a = ndi.map_coordinates(a, [rows, cc], order=1, mode='constant')
        os.makedirs(os.path.join(OUT, 'pieces'), exist_ok=True)
        pn = f'{name}__s{side}.png'
        Ti = int(round(T))
        solid = float(st_a[:max(1, Ti - 1)].mean()) if Ti > 1 else 0
        if solid < 0.97:   # holes/gaps left inside the black band -> unusable strip
            rep['flags'].append(f'side{side}: strip has gaps in the black ({solid:.2f})'); rep['sides'][side]['bad'] = True
        Image.fromarray((np.dstack([st_t, st_t, st_t, st_a]) * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'pieces', pn))
        rep['sides'][side].update(piece=pn, T=int(round(T)), h=h, corner=int(round(min(T, cols[0] - u0))))
    tex = np.clip((Y - blk) / 0.35, 0, 1)
    out = np.dstack([tex, tex, tex, cover])
    Image.fromarray((out * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name + '.png'))
    if len(rep['sides']) < 4: rep['flags'].append(f'only {len(rep["sides"])}/4 sides usable')
    return rep

def sheet(reps):
    T = 300; cols = 6; rows = (len(reps) + cols - 1) // cols
    sh = Image.new('RGB', (cols * T, rows * (T + 16)), (40, 40, 40)); dr = ImageDraw.Draw(sh)
    for i, r in enumerate(reps):
        p = os.path.join(OUT, os.path.splitext(r['file'])[0] + '.png')
        if not os.path.exists(p): continue
        im = Image.open(p); a = np.asarray(im)[..., 3:4] / 255; t = np.asarray(im)[..., :1] / 255
        px = (1 - a) * np.array([255, 0, 255]) + a * (t * 0.5 * 255 + 8)
        th = Image.fromarray(px.astype(np.uint8)); th.thumbnail((T - 8, T - 8))
        x, y = (i % cols) * T, (i // cols) * (T + 16); sh.paste(th, (x + 4, y + 4))
        dr.text((x + 4, y + T), f"{i} {'!' if r['flags'] else ''}{r['file'][:34]}", fill=(255, 220, 0) if r['flags'] else (200, 200, 200))
    sh.save(os.path.join(OUT, '_sheet.jpg'), quality=82)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    fs = sorted(f for f in glob.glob(os.path.join(ROOT, '*')) if f.lower().endswith(('jpg', 'jpeg', 'png', 'webp')))
    fs = [f for f in fs if not any(s in f for s in SKIP) and 'copy' not in os.path.basename(f)]
    if sys.argv[1:]: fs = [f for f in fs if any(a in f for a in sys.argv[1:])]
    try: MARKS.update(json.load(open(os.path.join(OUT, 'marks.json'))))
    except Exception: pass
    reps = []
    for f in fs:
        try: reps.append(process(f))
        except Exception as e: reps.append(dict(file=os.path.basename(f), sides={}, flags=[f'error: {e}']))
        print(len(reps) - 1, reps[-1]['file'], reps[-1]['flags'] or 'ok')
    json.dump(reps, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
    sheet(reps)
