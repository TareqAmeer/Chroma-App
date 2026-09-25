#!/usr/bin/env python3
"""Pack the reviewed film-edge strips into the app's shipped asset set.

Reads "local borders/_out/" (report.json + votes/rejects/adjust from the review pages)
and writes vendor/frames/film/<n>-s<side>.webp + manifest.json. Scans are renumbered
1..N; the number -> source-file map stays local in "local borders/_out/pack_map.json".
Run: .calibvenv/bin/python scripts/pack_borders.py
"""
import json, os, shutil
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'local borders', '_out')
DST = os.path.join(HERE, '..', 'vendor', 'frames', 'film')
MAXW = 2000

def jl(name, dflt):
    try: return json.load(open(os.path.join(OUT, name)))
    except Exception: return dflt

reps, votes, rejects, adjust = jl('report.json', []), jl('votes.json', {}), set(jl('rejects.json', [])), jl('adjust.json', {})
shutil.rmtree(DST, ignore_errors=True); os.makedirs(DST)
manifest, pmap, total = [], {}, 0
for r in sorted(reps, key=lambda r: r['file']):
    if votes.get(r['file']) == 'n': continue
    strips = []
    for side, v in sorted(r.get('sides', {}).items()):
        if not v.get('piece') or v.get('bad') or v['piece'] in rejects: continue
        im = Image.open(os.path.join(OUT, 'pieces', v['piece'])).convert('RGBA')
        a = np.asarray(im)
        if a[..., 3].max() < 128: continue
        # band top / thickness, measured the same way as the samples page (median over columns)
        al = a[..., 3] >= 128; tops, bands = [], []
        for u in range(0, al.shape[1], 3):
            col = np.flatnonzero(al[:, u])
            if not len(col): continue
            y = col[0]; e = y; gap = 0
            for q in range(y, al.shape[0]):
                if al[q, u]: e = q; gap = 0
                else:
                    gap += 1
                    if gap > 3: break
            tops.append(y); bands.append(e - y + 1)
        if not tops: continue
        # Stray photo content hanging far inside the frame edge (dark photo that touched the band
        # during extraction) reads as a grey smudge over the picture. Real ragged edges and drips
        # stay close to the band, so drop strips carrying real mass well past it.
        t0, b0 = float(np.median(tops)), float(np.median(bands))
        deep = a[int(min(a.shape[0] - 1, t0 + 1.8 * b0)):, :, 3]
        if deep.size and deep.mean() / 255 > 0.06:
            print('  drop (photo past the edge):', v['piece'], round(deep.mean() / 255, 3)); continue
        s = min(1.0, MAXW / im.width)
        if s < 1: im = im.resize((round(im.width * s), max(2, round(im.height * s))), Image.LANCZOS)
        # store as luminance+alpha: the app tints the texture itself
        la = im.convert('LA')
        strips.append(dict(side=int(side), top=float(np.median(tops)) * s, band=max(1.0, float(np.median(bands)) * s),
                           h=la.height, w=la.width, corner=float(v.get('corner', 0)) * s, _img=la))
    if not strips: continue
    n = len(manifest) + 1
    for st in strips:
        f = f'{n}-s{st["side"]}.webp'
        st.pop('_img').save(os.path.join(DST, f), 'WEBP', lossless=True, quality=100, method=6)
        st['file'] = f; total += os.path.getsize(os.path.join(DST, f))
    ad = adjust.get(r['file']) or {}
    manifest.append(dict(id=n, scale=float(ad.get('s', 1)), offset=float(ad.get('o', 0)), strips=strips))
    pmap[n] = r['file']
json.dump(dict(version=1, scans=manifest), open(os.path.join(DST, 'manifest.json'), 'w'), separators=(',', ':'))
json.dump(pmap, open(os.path.join(OUT, 'pack_map.json'), 'w'), indent=1)
import re
app = os.path.join(HERE, '..', 'chromasmith-22.html')
html = open(app).read()
html2 = re.sub(r'const FILM_EDGE_SCANS=\d+;', f'const FILM_EDGE_SCANS={len(manifest)};', html, count=1)
if html2 != html: open(app, 'w').write(html2)
print(f'{len(manifest)} scans, {sum(len(m["strips"]) for m in manifest)} strips, {total / 1e6:.1f} MB')
