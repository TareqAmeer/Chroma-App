#!/usr/bin/env python3
"""Re-label reviewed-bad draft masks (CHR-297) from per-photo prompts. Usage:
  mask_fixture_fix.py <drafts_dir> <fixes.json>
fixes.json: {id: {"mode":"sam"|"nonsky", "objects":[{"pos":[[nx,ny],..],"neg":[[nx,ny],..]},..], "keep_draft":bool}}
Coordinates are normalised 0..1 on the photo. mode "sam": each object -> one EdgeSAM multi-point mask, unioned;
final alpha = max(sam, birefnet_draft * dilated(sam)) (keeps soft edges, drops stray draft noise); keep_draft ORs the
original draft in first. mode "nonsky": everything that is not bright/blue sky (foliage against sky).
Writes <id>/alpha_fixed.png + sheet_fixed.jpg (photo | old draft | new label | overlay)."""
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter
import onnxruntime as ort
D, F = sys.argv[1], json.load(open(sys.argv[2]))
V = os.path.join(os.path.dirname(__file__), '../../desktop/src-tauri/vendor/sam')
o = ort.SessionOptions(); o.log_severity_level = 3
enc = ort.InferenceSession(f'{V}/edge_sam_encoder.onnx', o, providers=['CPUExecutionProvider'])
dec = ort.InferenceSession(f'{V}/edge_sam_decoder.onnx', o, providers=['CPUExecutionProvider'])
def dil(m, r): return np.asarray(Image.fromarray(m).filter(ImageFilter.MaxFilter(2 * r + 1)))
for pid, cfg in F.items():
    d = f'{D}/{pid}'; im = Image.open(f'{d}/photo.png').convert('RGB'); W, H = im.size
    old = np.asarray(Image.open(f'{d}/alpha.png'))
    if cfg['mode'] == 'nonsky':
        a = np.asarray(im, dtype=np.float32); lum = a.mean(2); blue = a[..., 2] - a[..., 0]
        sky = (lum > cfg.get('lum', 120)) | (blue > cfg.get('blue', 35))
        sky = np.asarray(Image.fromarray((sky * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255
        new = ((1 - sky) * 255).astype(np.uint8)
    else:
        arr = (np.asarray(im, dtype=np.float32) - [123.675, 116.28, 103.53]) / [58.395, 57.12, 57.375]
        sq = np.zeros((1024, 1024, 3), np.float32); sq[:H, :W] = arr
        emb = enc.run(None, {'image': sq.transpose(2, 0, 1)[None]})[0]
        union = np.zeros((H, W), bool)
        for ob in cfg['objects']:
            pts = [[x * W, y * H] for x, y in ob['pos']] + [[x * W, y * H] for x, y in ob.get('neg', [])]
            lab = [1] * len(ob['pos']) + [0] * len(ob.get('neg', []))
            r = dec.run(None, {'image_embeddings': emb, 'point_coords': np.array([pts], np.float32), 'point_labels': np.array([lab], np.float32)})
            sc, mk = r[0].reshape(-1), r[1].reshape(-1, 256, 256)
            up = np.asarray(Image.fromarray(mk[int(np.argmax(sc))].astype(np.float32)).resize((1024, 1024), Image.BILINEAR))[:H, :W]
            union |= up > 0
        sam = (union * 255).astype(np.uint8)
        base = old if cfg.get('keep_draft') else (old.astype(np.float32) * (dil(sam, 8) > 0)).astype(np.uint8)
        new = np.maximum(sam, base)
    Image.fromarray(new).save(f'{d}/alpha_fixed.png')
    ph = np.asarray(im, dtype=np.float32); ov = np.clip(ph * (.3 + .7 * new[..., None] / 255), 0, 255).astype(np.uint8)
    g = lambda m: np.repeat(m[..., None], 3, 2)
    sheet = np.concatenate([np.asarray(im), g(old), g(new), ov], 1)
    Image.fromarray(sheet).resize((sheet.shape[1] // 2, sheet.shape[0] // 2), Image.LANCZOS).save(f'{d}/sheet_fixed.jpg', quality=85)
    print(pid, 'ok', flush=True)
