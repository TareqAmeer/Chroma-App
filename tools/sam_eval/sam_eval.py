"""Offline SAM prompt-strategy eval. Mirrors desktop/src-tauri/src/sam.rs preprocessing.
usage: python sam_eval.py <img.png> <prompt.json> <out_dir> [gt.png]
prompt.json: {"pts":[{nx,ny,positive}], "box":[x0,y0,x1,y1] (optional)}"""
import sys, json, time, os
import numpy as np, onnxruntime as ort
from PIL import Image

R = "/Users/tareqameer/Documents/GitHub/Chroma-App/desktop/src-tauri/vendor/"
P = ["CPUExecutionProvider"]
_s = {}
def sess(f):
    if f not in _s: _s[f] = ort.InferenceSession(R + f, providers=P)
    return _s[f]

def edge_encode(rgb):
    h, w = rgb.shape[:2]; sc = 1024 / max(w, h)
    nw, nh = round(w * sc), round(h * sc)
    im = np.asarray(Image.fromarray(rgb).resize((nw, nh), Image.BILINEAR)).astype(np.float32)
    im = (im - [123.675, 116.28, 103.53]) / [58.395, 57.12, 57.375]
    pad = np.zeros((1024, 1024, 3), np.float32); pad[:nh, :nw] = im
    t = time.time(); e = sess("sam/edge_sam_encoder.onnx").run(None, {"image": pad.transpose(2, 0, 1)[None].astype(np.float32)})[0]
    return dict(e=e, w=w, h=h, sc=sc, nw=nw, nh=nh, t=time.time() - t)

def sam2_encode(rgb):
    h, w = rgb.shape[:2]
    im = np.asarray(Image.fromarray(rgb).resize((1024, 1024), Image.BILINEAR)).astype(np.float32) / 255
    im = (im - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    t = time.time(); f0, f1, e = sess("sam2/encoder.onnx").run(None, {"image": im.transpose(2, 0, 1)[None].astype(np.float32)})
    return dict(e=e, f0=f0, f1=f1, w=w, h=h, t=time.time() - t)

def up(low, emb, sam2):
    # low: 256x256 logits -> full-res logits (w,h)
    if sam2:
        return np.asarray(Image.fromarray(low.astype(np.float32)).resize((emb["w"], emb["h"]), Image.BILINEAR))
    sq = np.asarray(Image.fromarray(low.astype(np.float32)).resize((1024, 1024), Image.BILINEAR))
    crop = sq[:emb["nh"], :emb["nw"]]
    return np.asarray(Image.fromarray(crop).resize((emb["w"], emb["h"]), Image.BILINEAR))

def edge_decode(emb, pts, labels, pad):
    c = [[x * emb["w"] * emb["sc"], y * emb["h"] * emb["sc"]] for x, y in pts]; l = list(labels)
    if pad: c.append([0, 0]); l.append(-1)
    t = time.time()
    s, m = sess("sam/edge_sam_decoder.onnx").run(None, {"image_embeddings": emb["e"], "point_coords": np.array([c], np.float32), "point_labels": np.array([l], np.float32)})
    return s[0], m[0], time.time() - t

def sam2_decode(emb, pts, labels, pad, mask_in=None):
    c = [[x * 1024, y * 1024] for x, y in pts]; l = list(labels)
    if pad: c.append([0, 0]); l.append(-1)
    t = time.time()
    m, iou = sess("sam2/decoder.onnx").run(None, {"image_embed": emb["e"], "high_res_feats_0": emb["f0"], "high_res_feats_1": emb["f1"],
        "point_coords": np.array([c], np.float32), "point_labels": np.array([l], np.float32),
        "mask_input": (mask_in if mask_in is not None else np.zeros((1, 1, 256, 256), np.float32)),
        "has_mask_input": np.array([1.0 if mask_in is not None else 0.0], np.float32)})
    return iou[0], m[0], time.time() - t

def subsample(pts, k):
    if len(pts) <= k: return pts
    return [pts[round(i * (len(pts) - 1) / (k - 1))] for i in range(k)]

def fps(pts, k):  # farthest point sampling, start nearest the centroid
    a = np.array(pts); cen = a.mean(0); idx = [int(np.argmin(((a - cen) ** 2).sum(1)))]
    d = ((a - a[idx[0]]) ** 2).sum(1)
    while len(idx) < min(k, len(a)):
        i = int(np.argmax(d)); idx.append(i); d = np.minimum(d, ((a - a[i]) ** 2).sum(1))
    return [pts[i] for i in idx]

def metrics(mask, gt):
    m = mask > 0; g = gt > 127
    inter = (m & g).sum(); uni = (m | g).sum()
    return dict(iou=round(inter / max(uni, 1), 3), spill=round((m & ~g).sum() / max(g.sum(), 1), 3), miss=round((g & ~m).sum() / max(g.sum(), 1), 3))

if __name__ == "__main__":
    img, pj, out = sys.argv[1:4]; gtp = sys.argv[4] if len(sys.argv) > 4 else None
    os.makedirs(out, exist_ok=True)
    rgb = np.asarray(Image.open(img).convert("RGB"))
    pr = json.load(open(pj)); allp = pr["pts"]
    pos = [(p["nx"], p["ny"]) for p in allp if p["positive"]]
    neg = [(p["nx"], p["ny"]) for p in allp if not p["positive"]]
    gt = np.asarray(Image.open(gtp).convert("L").resize((rgb.shape[1], rgb.shape[0]))) if gtp else None
    E = edge_encode(rgb); S2 = sam2_encode(rgb)
    print(f"encode edge {E['t']:.2f}s sam2 {S2['t']:.2f}s")
    variants = {}
    def run(name, pts, labels, model, pick, pad, mask_in=None):
        if model == "edge": sc, ms, dt = edge_decode(E, pts, labels, pad)
        else: sc, ms, dt = sam2_decode(S2, pts, labels, pad, mask_in)
        if pick == "argmax": i = int(np.argmax(sc))
        elif pick == "ch0": i = 0
        elif pick == "argmax_multi": i = 1 + int(np.argmax(sc[1:]))
        else: i = pick
        full = up(ms[i], E if model == "edge" else S2, model == "sam2")
        r = dict(ch=i, scores=[round(float(x), 3) for x in sc], dec_ms=round(dt * 1000), area=round(float((full > 0).mean()), 4))
        if gt is not None: r.update(metrics(full, gt))
        variants[name] = r
        Image.fromarray(((full > 0) * 255).astype(np.uint8)).save(f"{out}/{name}.png")
        return ms[i]
    sets = {"cur6": subsample(pos, 6), "fps3": fps(pos, 3), "fps6": fps(pos, 6), "fps12": fps(pos, 12), "c1": fps(pos, 1)}
    if "box" in pr: sets_box = pr["box"]
    for sn, pts in sets.items():
        lab = [1] * len(pts)
        p = pts + subsample(neg, 6); l = lab + [0] * len(subsample(neg, 6))
        for pick in ["argmax", "ch0", "argmax_multi"]:
            for pad in [False, True]:
                run(f"edge_{sn}_{pick}_{'pad' if pad else 'nopad'}", p, l, "edge", pick, pad)
        for pick in ["argmax"] + [0, 1, 2]:
            for pad in [False, True]:
                run(f"sam2_{sn}_{pick}_{'pad' if pad else 'nopad'}", p, l, "sam2", pick, pad)
    if "box" in pr:
        x0, y0, x1, y1 = pr["box"]
        for pick in ["argmax", "ch0"]:
            run(f"edge_box_{pick}", [(x0, y0), (x1, y1)], [2, 3], "edge", pick, False)
            run(f"edge_box+c_{pick}", [(x0, y0), (x1, y1)] + sets["fps3"], [2, 3, 1, 1, 1], "edge", pick, False)
        for pick in ["argmax", 0]:
            run(f"sam2_box_{pick}", [(x0, y0), (x1, y1)], [2, 3], "sam2", pick, False)
            run(f"sam2_box+c_{pick}", [(x0, y0), (x1, y1)] + sets["fps3"], [2, 3, 1, 1, 1], "sam2", pick, False)
    # iterative: sam2 fps3 then feed logits back with fps6
    m1 = run("sam2_iter1", sets["fps3"], [1, 1, 1], "sam2", "argmax", True)
    run("sam2_iter2", sets["fps6"], [1] * 6, "sam2", "argmax", True, m1[None, None].astype(np.float32))
    json.dump(variants, open(f"{out}/results.json", "w"), indent=1)
    key = (lambda kv: -kv[1].get("iou", 0)) if gt is not None else (lambda kv: kv[1]["area"])
    for k, v in sorted(variants.items(), key=key):
        print(k, v)
