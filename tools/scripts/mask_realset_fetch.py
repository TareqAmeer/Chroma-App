#!/usr/bin/env python3
"""Fetch the CHR-297 public real-photo mask set (images + ground truth) into a gitignored folder.

The photos are NOT committed (repo size); only the selection list
test/fixtures/mask-quality/realset.json (dataset, parquet file, row, source sha256) is.
Rows are read from Hugging Face parquet mirrors with HTTP range requests, so only the row
groups that hold the chosen rows are downloaded.

  python3 -I tools/scripts/mask_realset_fetch.py [out_dir]          # fetch from the committed list
  python3 -I tools/scripts/mask_realset_fetch.py --select [out_dir] # rebuild the list (scans rows)

out_dir defaults to test/output/mask-realset/. Each fixture becomes <id>/photo.png + <id>/gt.png
(8-bit grey, same size as the photo, long side <= 1024). Downloaded data is treated as untrusted:
only parquet bytes are parsed (pyarrow) and images are decoded with Pillow.
Needs: pip install pyarrow pillow numpy
"""
import sys, os, io, json, hashlib, urllib.request
import numpy as np
from PIL import Image
import pyarrow.parquet as pq

HF = 'https://huggingface.co/datasets/'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIST = os.path.join(ROOT, 'test/fixtures/mask-quality/realset.json')
LONG = 1024

SOURCES = {
    'p3m': dict(repo='nobg/P3M-10K', file='data/P3M_500_NP-00000-of-00001.parquet', home='https://github.com/JizhiziLi/P3M'),
    'aim': dict(repo='nobg/AIM-500', file='data/test-00000-of-00001.parquet', home='https://github.com/JizhiziLi/AIM'),
    'dis': dict(repo='nobg/DIS5K', file='data/DIS_TE1-00000-of-00001-f9bce3f0fddcae93.parquet', home='https://github.com/xuebinqin/DIS'),
    'ade': dict(repo='1aurent/ADE20K', file='data/validation-00000-of-00001.parquet', home='https://groups.csail.mit.edu/vision/datasets/ADE20K/'),
    'celeb': dict(repo='v-xchen-v/celebamask_hq', file='data/train-00000-of-00006.parquet', home='https://github.com/switchablenorms/CelebAMask-HQ'),
}


class HttpFile(io.RawIOBase):
    """Seekable read-only file over HTTP Range requests (enough for pyarrow.ParquetFile)."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=60).headers['Content-Length'])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]; return self.pos
    def read(self, n=-1):
        n = self.size - self.pos if n < 0 else min(n, self.size - self.pos)
        if n <= 0: return b''
        for attempt in range(4):
            try:
                req = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{self.pos + n - 1}'})
                d = urllib.request.urlopen(req, timeout=300).read(); break
            except OSError:
                if attempt == 3: raise
        self.pos += len(d); return d
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def open_pq(key):
    s = SOURCES[key]; return pq.ParquetFile(HttpFile(f"{HF}{s['repo']}/resolve/main/{s['file']}"))


def row_iter(pf, columns=None, groups=None):
    base = 0
    for g in range(pf.metadata.num_row_groups):
        n = pf.metadata.row_group(g).num_rows
        if groups is None or g in groups:
            for i, r in enumerate(pf.read_row_group(g, columns=columns).to_pylist()): yield base + i, r
        base += n


def group_of(pf, row):
    base = 0
    for g in range(pf.metadata.num_row_groups):
        n = pf.metadata.row_group(g).num_rows
        if row < base + n: return g
        base += n


def decode(key, r):
    """-> (PIL RGB photo, float32 GT in 0..1 at photo size, source-bytes sha256)."""
    img = Image.open(io.BytesIO(r['image']['bytes'])).convert('RGB')
    sha = hashlib.sha256(r['image']['bytes']).hexdigest()
    if key in ('p3m', 'aim'):
        gt = np.asarray(Image.open(io.BytesIO(r['mask']['bytes'])).convert('L'), np.float32) / 255
    elif key == 'dis':
        gt = np.asarray(Image.open(io.BytesIO(r['label']['bytes'])).convert('L'), np.float32) / 255
    elif key == 'celeb':  # label map 512x512: 1 hair, 4 skin (id2label.json of the mirror)
        lab = np.asarray(Image.open(io.BytesIO(r['label']['bytes'])))
        img = img.resize(lab.shape[::-1], Image.BICUBIC)
        gt = np.stack([(lab == 4), (lab == 1)]).astype(np.float32)  # [skin, hair]
    elif key == 'ade':  # full-ADE class map: R/10*256+G = name_ndx
        s = np.asarray(Image.open(io.BytesIO(r['segmentations'][0]['bytes'])).convert('RGB')).astype(int)
        cls = s[..., 0] // 10 * 256 + s[..., 1]
        sky = {o['name_ndx'] for o in r['objects'] if o['name'] == 'sky'}
        gt = np.isin(cls, list(sky)).astype(np.float32)
        if gt.shape[::-1] != img.size: img = img.resize(gt.shape[::-1], Image.BICUBIC)
    return img, gt, sha


def fit(img, gt):
    W, H = img.size; s = min(1.0, LONG / max(W, H))
    if s >= 1: return img, gt
    w, h = round(W * s), round(H * s)
    rs = lambda a: np.asarray(Image.fromarray(a).resize((w, h), Image.BILINEAR), np.float32)
    gt = np.stack([rs(g) for g in gt]) if gt.ndim == 3 else rs(gt)
    return img.resize((w, h), Image.BICUBIC), gt


def save(out, fid, img, gt):
    d = os.path.join(out, fid); os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, 'photo.png'))
    if gt.ndim == 3:
        for name, g in zip(('skin', 'hair'), gt): Image.fromarray((g * 255).round().astype(np.uint8)).save(os.path.join(d, f'gt-{name}.png'))
    else: Image.fromarray((gt * 255).round().astype(np.uint8)).save(os.path.join(d, 'gt.png'))


def select():
    """Deterministic scan: first rows per source that meet the category criteria."""
    picks = []
    def take(key, cat, tasks, n, ok, cols=None, groups=None, extra=lambda r: {}):
        pf = open_pq(key); k = 0
        for i, r in row_iter(pf, cols, groups):
            if k >= n: break
            if not ok(r): continue
            img, gt, sha = decode(key, r); cov = float(gt.mean()) if gt.ndim == 2 else float(gt[0].mean())
            if gt.ndim == 2 and not (0.05 < cov < 0.85): continue
            k += 1; picks.append(dict(id=f'{cat}-{k:03d}', category=cat, source=key, row=i, sha256=sha, tasks=tasks, gtCoverage=round(cov, 4), **extra(r)))
            print(picks[-1]['id'], key, i, flush=True)
    every = lambda step: (lambda r, c=[0]: (c.__setitem__(0, c[0] + 1) or (c[0] - 1) % step == 0))
    take('p3m', 'portrait', ['subject', 'click'], 10, every(50), groups={0, 1, 2})
    take('aim', 'object', ['subject', 'click'], 8, (lambda e: lambda r: r['type'] != 'Portrait' and e(r))(every(6)), extra=lambda r: dict(name=r['image_name'], aimType=r['type']))
    take('dis', 'fine-edge', ['subject', 'click'], 6, every(40), extra=lambda r: dict(name=r['image_name']))
    take('ade', 'sky', ['sky'], 8, (lambda e: lambda r: any(o['name'] == 'sky' for o in r['objects']) and 'outdoor' in r['scene'] and e(r))(every(3)), extra=lambda r: dict(name=r['filename']))
    take('celeb', 'face', ['face-skin', 'face-hair'], 8, every(12), groups={0})
    meta = {'note': 'CHR-297 public real-photo set: selection list only, photos are fetched by tools/scripts/mask_realset_fetch.py into test/output/mask-realset/ (gitignored).',
            'sources': {k: dict(v, url=f"{HF}{v['repo']}") for k, v in SOURCES.items()}, 'fixtures': picks}
    json.dump(meta, open(LIST, 'w'), indent=1); print('wrote', LIST, len(picks))


def fetch(out):
    meta = json.load(open(LIST)); by = {}
    for f in meta['fixtures']: by.setdefault(f['source'], []).append(f)
    for key, fx in by.items():
        todo = [f for f in fx if not os.path.exists(os.path.join(out, f['id'], 'photo.png'))]
        if not todo: continue
        pf = open_pq(key); want = {f['row']: f for f in todo}
        groups = {group_of(pf, r) for r in want}
        for i, r in row_iter(pf, None, groups):
            if i not in want: continue
            f = want[i]; img, gt, sha = decode(key, r)
            if sha != f['sha256']: raise SystemExit(f"{f['id']}: source sha256 mismatch (mirror changed?)")
            img, gt = fit(img, gt); save(out, f['id'], img, gt); print('fetched', f['id'], img.size, flush=True)
    print('ok', out)


if __name__ == '__main__':
    a = sys.argv[1:]; sel = '--select' in a; a = [x for x in a if x != '--select']
    out = os.path.abspath(a[0]) if a else os.path.join(ROOT, 'test/output/mask-realset')
    if sel: select()
    fetch(out)
