#!/usr/bin/env python3
"""Latency + peak-RSS bench for masking models (CHR-298). CPU provider, one subprocess per model so
peak RSS is clean. Usage: mask_model_bench.py <models_dir> [runs]   (needs onnxruntime, numpy, pillow)
<models_dir>/{mobilesam/{encoder,decoder}.onnx, birefnet_lite/model.onnx}; bundled EdgeSAM/SAM2 are read
from desktop/src-tauri/vendor. Image: test/fixtures/portrait.png. Prints JSON."""
import sys, os, json, time, resource, subprocess
import numpy as np
V = 'desktop/src-tauri/vendor'
def run_one(name, runs):
    import onnxruntime as ort
    from PIL import Image
    md = sys.argv[1]; img = Image.open('test/fixtures/portrait.png').convert('RGB')
    opt = ort.SessionOptions(); opt.log_severity_level = 3
    def sess(p): return ort.InferenceSession(p, opt, providers=['CPUExecutionProvider'])
    def t(f):
        ts = []
        for _ in range(runs + 1):
            s = time.perf_counter(); f(); ts.append(time.perf_counter() - s)
        return ts[0], sorted(ts[1:])[len(ts[1:]) // 2]
    f32 = lambda a: np.asarray(a, dtype=np.float32)
    sq = np.asarray(img.resize((1024, 1024)), dtype=np.float32)
    nchw = f32(((sq / 255 - [.485, .456, .406]) / [.229, .224, .225]).transpose(2, 0, 1)[None])
    pts = f32([[[512, 512]]]); lab = f32([[1]])
    s0 = time.perf_counter()
    if name == 'mobilesam':
        e = sess(f'{md}/mobilesam/encoder.onnx'); d = sess(f'{md}/mobilesam/decoder.onnx'); load = time.perf_counter() - s0
        im = np.asarray(img, dtype=np.float32); emb = e.run(None, {'input_image': im})[0]
        ec = t(lambda: e.run(None, {'input_image': im}))
        dc = t(lambda: d.run(None, {'image_embeddings': emb, 'point_coords': pts, 'point_labels': lab, 'mask_input': np.zeros((1, 1, 256, 256), np.float32), 'has_mask_input': f32([0]), 'orig_im_size': f32([im.shape[0], im.shape[1]])}))
    elif name == 'edgesam':
        e = sess(f'{V}/sam/edge_sam_encoder.onnx'); d = sess(f'{V}/sam/edge_sam_decoder.onnx'); load = time.perf_counter() - s0
        x = f32(sq.transpose(2, 0, 1)[None]); emb = e.run(None, {'image': x})[0]
        ec = t(lambda: e.run(None, {'image': x}))
        dc = t(lambda: d.run(None, {'image_embeddings': emb, 'point_coords': pts, 'point_labels': lab}))
    elif name == 'sam2':
        e = sess(f'{V}/sam2/encoder.onnx'); d = sess(f'{V}/sam2/decoder.onnx'); load = time.perf_counter() - s0
        x = nchw; o = e.run(None, {'image': x}); o = dict(zip([i.name for i in e.get_outputs()], o))
        ec = t(lambda: e.run(None, {'image': x}))
        dc = t(lambda: d.run(None, {'image_embed': o['image_embed'], 'high_res_feats_0': o['high_res_feats_0'], 'high_res_feats_1': o['high_res_feats_1'], 'point_coords': pts, 'point_labels': lab, 'mask_input': np.zeros((1, 1, 256, 256), np.float32), 'has_mask_input': f32([0])}))
    else:
        e = sess(f'{md}/birefnet_lite/model.onnx'); load = time.perf_counter() - s0
        ec = t(lambda: e.run(None, {'input_image': nchw})); dc = (0, 0)
    print(json.dumps({'model': name, 'load_s': round(load, 2), 'enc_cold_s': round(ec[0], 3), 'enc_warm_s': round(ec[1], 3), 'dec_warm_s': round(dc[1], 4), 'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6)}))
if __name__ == '__main__':
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    if len(sys.argv) > 3: run_one(sys.argv[3], runs)
    else:
        for n in ['edgesam', 'mobilesam', 'sam2', 'birefnet_lite']:
            r = subprocess.run([sys.executable, __file__, sys.argv[1], str(runs), n], capture_output=True, text=True)
            print(r.stdout.strip() or f'{n} FAILED: {r.stderr[-300:]}', flush=True)
