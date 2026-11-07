#!/usr/bin/env python3
"""Run the app's bundled mask models on the CHR-297 public real-photo set and write predicted masks.

  python3 -I tools/scripts/mask_realset_run.py <set_dir> <models_dir> [--threads N]

<set_dir> is what mask_realset_fetch.py wrote; <models_dir> is desktop/src-tauri/vendor. Writes
<set_dir>/<id>/pred-<task>.png and <set_dir>/timings.json (median seconds per call per model).

The models run natively in the desktop app (Rust `ort`, desktop/src-tauri/src/{sam,matte,landscape,
faceparse}.rs), not in Chromium, so this mirrors those files' pre/post-processing exactly in
onnxruntime-python rather than driving the web page:
  subject   matte.rs MODNet (long side <= 1024, snapped to /32, (x-127.5)/127.5, clamp, bilinear up)
  click     sam.rs EdgeSAM single positive click at the GT's deepest interior point; most-stable
            multimask candidate (index >= 1), two-stage bilinear upsample, soft alpha k=4
  sky       landscape.rs UperNet 576x576, softmax over 150 classes, class 2
  face-*    faceparse.rs SegFormer 512x512, softmax at 128x128, class 1 (skin) / 13 (hair)
Pillow's BILINEAR (with reducing for downscale) stands in for the Rust `Triangle` resize.
"""
import sys, os, json, time
import numpy as np
from PIL import Image
import onnxruntime as ort

D, MD = sys.argv[1], sys.argv[2]
threads = int(sys.argv[sys.argv.index('--threads') + 1]) if '--threads' in sys.argv else 0
LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../test/fixtures/mask-quality/realset.json')
IMNET_M, IMNET_S = np.array([.485, .456, .406], np.float32), np.array([.229, .224, .225], np.float32)
times = {}

def sess(p):
    o = ort.SessionOptions(); o.log_severity_level = 3
    if threads: o.intra_op_num_threads = threads
    return ort.InferenceSession(os.path.join(MD, p), o, providers=['CPUExecutionProvider'])

def run(name, s, feed, outs):
    t = time.perf_counter(); y = s.run(outs, feed); times.setdefault(name, []).append(time.perf_counter() - t); return y

def up(a, w, h):  # sam.rs bilinear_resize (half-pixel centres) == PIL BILINEAR for upsampling
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((w, h), Image.BILINEAR), np.float32)

def chw(img, size): return np.asarray(img.resize(size, Image.BILINEAR), np.float32)

def softmax0(x): e = np.exp(x - x.max(0, keepdims=True)); return e / e.sum(0, keepdims=True)

def deepest_point(gt):
    """Pixel farthest from the GT boundary (chamfer distance at <=128px), as normalised (x, y)."""
    h, w = gt.shape; s = max(1, max(h, w) // 128)
    m = gt[::s, ::s] > .5; H, W = m.shape; INF = 1e9
    d = np.where(m, INF, 0.0)
    for y in range(H):
        for x in range(W):
            if d[y, x]:
                d[y, x] = min(d[y, x], (d[y-1, x] if y else 0) + 1, (d[y, x-1] if x else 0) + 1)
    for y in range(H - 1, -1, -1):
        for x in range(W - 1, -1, -1):
            if d[y, x]:
                d[y, x] = min(d[y, x], (d[y+1, x] if y < H-1 else 0) + 1, (d[y, x+1] if x < W-1 else 0) + 1)
    y, x = np.unravel_index(np.argmax(d), d.shape)
    return ((x + .5) * s / w, (y + .5) * s / h)

S = {}
def modnet(img):
    W, H = img.size; sc = min(1.0, 1024 / max(W, H)); sw, sh = max(32, int(W * sc) // 32 * 32), max(32, int(H * sc) // 32 * 32)
    x = ((chw(img, (sw, sh)) - 127.5) / 127.5).transpose(2, 0, 1)[None]
    S.setdefault('m', sess('matte/modnet.onnx'))
    y = run('modnet', S['m'], {'input': x}, ['output'])[0].reshape(sh, sw)
    return np.clip(up(np.clip(y, 0, 1), W, H), 0, 1)

def edgesam(img, pt):
    W, H = img.size; sc = 1024 / max(W, H); iw, ih = round(W * sc), round(H * sc)
    x = np.zeros((1, 3, 1024, 1024), np.float32)
    x[0, :, :ih, :iw] = ((chw(img, (iw, ih)) - [123.675, 116.28, 103.53]) / [58.395, 57.12, 57.375]).transpose(2, 0, 1)
    S.setdefault('e', sess('sam/edge_sam_encoder.onnx')); S.setdefault('d', sess('sam/edge_sam_decoder.onnx'))
    emb = run('edgesam-encoder', S['e'], {'image': x}, ['image_embeddings'])[0]
    c = np.array([[[pt[0] * W * sc, pt[1] * H * sc]]], np.float32)
    scores, masks = run('edgesam-decoder', S['d'], {'image_embeddings': emb, 'point_coords': c, 'point_labels': np.ones((1, 1), np.float32)}, ['scores', 'masks'])
    m = masks[0]; st = [((m[i] > 1).sum() / max(1, (m[i] > -1).sum())) for i in range(4)]
    best = 1 + int(np.argmax(st[1:]))  # sam.rs pick_candidate, single click, first_multi=1
    sq = up(m[best], 1024, 1024)[:ih, :iw]
    return 1 / (1 + np.exp(-4 * up(sq, W, H)))

def landscape_sky(img):
    W, H = img.size; x = ((chw(img, (576, 576)) / 255 - IMNET_M) / IMNET_S).transpose(2, 0, 1)[None]
    S.setdefault('l', sess('landscape/model_quantized.onnx'))
    lg = run('landscape', S['l'], {'pixel_values': x.astype(np.float32)}, ['logits'])[0][0]
    return np.clip(up(softmax0(lg)[2], W, H), 0, 1)

def faceparse(img):
    W, H = img.size; x = ((chw(img, (512, 512)) / 255 - IMNET_M) / IMNET_S).transpose(2, 0, 1)[None]
    S.setdefault('f', sess('faceparse/model_quantized.onnx'))
    p = softmax0(run('faceparse', S['f'], {'pixel_values': x.astype(np.float32)}, ['logits'])[0][0])
    return np.clip(up(p[1], W, H), 0, 1), np.clip(up(p[13], W, H), 0, 1)

def save(a, p): Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8)).save(p)

meta = json.load(open(LIST)); points = {}
for f in meta['fixtures']:
    d = os.path.join(D, f['id']); img = Image.open(os.path.join(d, 'photo.png')).convert('RGB')
    if 'subject' in f['tasks']: save(modnet(img), os.path.join(d, 'pred-subject.png'))
    if 'click' in f['tasks']:
        gt = np.asarray(Image.open(os.path.join(d, 'gt.png')), np.float32) / 255; pt = deepest_point(gt); points[f['id']] = pt
        save(edgesam(img, pt), os.path.join(d, 'pred-click.png'))
    if 'sky' in f['tasks']: save(landscape_sky(img), os.path.join(d, 'pred-sky.png'))
    if 'face-skin' in f['tasks']:
        sk, hr = faceparse(img); save(sk, os.path.join(d, 'pred-face-skin.png')); save(hr, os.path.join(d, 'pred-face-hair.png'))
    print('ran', f['id'], flush=True)
json.dump({'note': 'median wall seconds per ORT call, CPU EP, this machine', 'cpu': os.cpu_count(), 'onnxruntime': ort.__version__,
           'median_s': {k: round(float(np.median(v)), 3) for k, v in times.items()}, 'clickPoints': points}, open(os.path.join(D, 'timings.json'), 'w'), indent=1)
print(json.dumps({k: round(float(np.median(v)), 3) for k, v in times.items()}))
