#!/usr/bin/env python3
"""Draft labels for real-photo mask fixtures (CHR-297). For each photo: BiRefNet_lite alpha = DRAFT ground
truth (must be human-reviewed), EdgeSAM single centre-of-draft point = the app's current-style candidate.
Usage: mask_fixture_drafts.py <photos_dir> <out_dir> <birefnet_model.onnx> [only-substring]
Outputs per photo <out>/<id>/{photo.png,alpha.png,ai-mask.png,sheet.jpg}; photos stay outside the repo."""
import sys, os, re, time
import numpy as np
from PIL import Image, ImageOps
import onnxruntime as ort
src, out, bm = sys.argv[1], sys.argv[2], sys.argv[3]; only = sys.argv[4] if len(sys.argv) > 4 else ''
V = os.path.join(os.path.dirname(__file__), '../../desktop/src-tauri/vendor/sam')
o = ort.SessionOptions(); o.log_severity_level = 3
bir = ort.InferenceSession(bm, o, providers=['CPUExecutionProvider'])
enc = ort.InferenceSession(f'{V}/edge_sam_encoder.onnx', o, providers=['CPUExecutionProvider'])
dec = ort.InferenceSession(f'{V}/edge_sam_decoder.onnx', o, providers=['CPUExecutionProvider'])
MAXL = 1024
for fn in sorted(os.listdir(src)):
    if fn.startswith('.') or not fn.lower().endswith(('.jpg', '.jpeg', '.png')) or only not in fn: continue
    pid = re.sub(r'[^a-z0-9]+', '-', os.path.splitext(fn)[0].lower()).strip('-')
    d = os.path.join(out, pid)
    if os.path.exists(f'{d}/ai-mask.png'): continue
    os.makedirs(d, exist_ok=True); t0 = time.time()
    im = ImageOps.exif_transpose(Image.open(os.path.join(src, fn))).convert('RGB')
    s = MAXL / max(im.size); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS); W, H = im.size
    im.save(f'{d}/photo.png')
    a = np.asarray(im.resize((1024, 1024), Image.BICUBIC), dtype=np.float32) / 255
    x = ((a - [.485, .456, .406]) / [.229, .224, .225]).transpose(2, 0, 1)[None].astype(np.float32)
    m = bir.run(None, {'input_image': x})[0][0, 0]; m = 1 / (1 + np.exp(-m))
    alpha = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.uint8)
    Image.fromarray(alpha).save(f'{d}/alpha.png')
    ys, xs = np.nonzero(alpha > 200)
    cx, cy = (xs.mean(), ys.mean()) if len(xs) else (W / 2, H / 2)
    if len(xs):  # nearest confident-foreground pixel to the centroid, so the prompt lands on the subject
        k = int(np.argmin((xs - cx) ** 2 + (ys - cy) ** 2)); cx, cy = float(xs[k]), float(ys[k])
    # EdgeSAM per vendor/sam/README: (x-mean)/std, longest side 1024, zero-pad bottom/right; points in that space
    arr = (np.asarray(im, dtype=np.float32) - [123.675, 116.28, 103.53]) / [58.395, 57.12, 57.375]
    sq = np.zeros((1024, 1024, 3), np.float32); sq[:H, :W] = arr; sq = sq.transpose(2, 0, 1)[None]
    emb = enc.run(None, {'image': sq})[0]
    r = dec.run(None, {'image_embeddings': emb, 'point_coords': np.array([[[cx, cy]]], np.float32), 'point_labels': np.array([[1]], np.float32)})
    sc, mk = r[0].reshape(-1), r[1]; mk = mk.reshape(-1, mk.shape[-2], mk.shape[-1]); best = mk[int(np.argmax(sc))]
    up = np.asarray(Image.fromarray(best.astype(np.float32), mode='F').resize((1024, 1024), Image.BILINEAR))[:H, :W]  # 256->1024 padded, crop
    sam = ((up > 0).astype(np.uint8) * 255)
    Image.fromarray(sam).save(f'{d}/ai-mask.png')
    ph = np.asarray(im, dtype=np.float32)
    ov = lambda mm: np.clip(ph * (.35 + .65 * mm[..., None] / 255) + np.array([0, 0, 0]), 0, 255).astype(np.uint8)
    sheet = np.concatenate([np.asarray(im), np.repeat(alpha[..., None], 3, 2), np.repeat(sam[..., None], 3, 2), ov(alpha)], 1)
    Image.fromarray(sheet).resize((sheet.shape[1] // 2, sheet.shape[0] // 2), Image.LANCZOS).save(f'{d}/sheet.jpg', quality=85)
    print(pid, f'{time.time()-t0:.0f}s', flush=True)
