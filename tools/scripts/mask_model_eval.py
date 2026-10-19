#!/usr/bin/env python3
"""Run whole-image matting/saliency models on the CHR-297 photos and write masks for scoring.
Usage: mask_model_eval.py <drafts_dir> <manifest-reviewed.json> <models_dir> <out_dir> [model ...]
Models: bir512 (BiRefNet-lite 512), isnet (ISNet general, 1024), modnet (MODNet, <=1024 long side).
Writes <out>/<model>/<id>.png + manifest-<model>.json (refinedMask), prints median seconds/photo.
bir512 shares an architecture family with the BiRefNet-made drafts, so its scores are biased upward."""
import sys, os, json, time
import numpy as np
from PIL import Image
import onnxruntime as ort
D, M, MD, O = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3], sys.argv[4]; names = sys.argv[5:] or ['bir512', 'isnet', 'modnet']
o = ort.SessionOptions(); o.log_severity_level = 3
def prep(name, im):
    a = np.asarray(im, dtype=np.float32) / 255
    if name == 'bir512': return ((a - [.485, .456, .406]) / [.229, .224, .225]).transpose(2, 0, 1)[None].astype(np.float32)
    if name == 'isnet': return (a - [.485, .456, .406]).transpose(2, 0, 1)[None].astype(np.float32)
    return ((a - .5) / .5).transpose(2, 0, 1)[None].astype(np.float32)
for name in names:
    s = ort.InferenceSession(f'{MD}/{name}/model.onnx', o, providers=['CPUExecutionProvider']); os.makedirs(f'{O}/{name}', exist_ok=True); fx = []; ts = []
    for f in M['fixtures']:
        pid = f['id']; im = Image.open(f'{D}/{pid}/photo.png').convert('RGB'); W, H = im.size
        if name == 'bir512': sz = (512, 512)
        elif name == 'isnet': sz = (1024, 1024)
        else: sz = (W // 32 * 32, H // 32 * 32)
        x = prep(name, im.resize(sz, Image.BICUBIC)); t = time.time(); y = s.run(None, {s.get_inputs()[0].name: x})[0][0, 0]; ts.append(time.time() - t)
        if y.min() < 0 or y.max() > 1: y = 1 / (1 + np.exp(-y))
        y = (y - y.min()) / max(1e-6, y.max() - y.min()) if name == 'isnet' else y
        a = np.asarray(Image.fromarray((y * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC))
        Image.fromarray(a).save(f'{O}/{name}/{pid}.png')
        fx.append(dict(f, refinedMask=os.path.abspath(f'{O}/{name}/{pid}.png'), photo=os.path.join(os.path.abspath(D), f['photo']), groundTruth=os.path.join(os.path.abspath(D), f['groundTruth']), sourceMask=os.path.join(os.path.abspath(D), f['sourceMask'])))
    json.dump(dict(M, fixtures=fx), open(f'{O}/manifest-{name}.json', 'w')); print(name, 'median s/photo', round(float(np.median(ts)), 2), flush=True)
