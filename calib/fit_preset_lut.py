#!/usr/bin/env python3
"""Fit ONE 33^3 LUT for a Lightroom preset from (TIFF no-preset, JPEG with-preset)
pairs — jointly across all pairs so the LUT generalizes across photos (the user's
per-photo match-and-refine LUTs only covered each photo's own gamut).

Input pairs: calib/BEACH LUT/<name>.tif (LR export, NO preset)
             calib/BEACH LUT/<name>.jpg (LR export, WITH preset)
Output:      calib/LUT LIBRARY/a beach preset v5.7.cube  (+ cmp_beach_*.png strips)

Method: box-downsample 4x (kills grain/sharpen/NR texture), trilinearly SPLAT each
observed (in -> out) sample into the 33^3 grid over input RGB, weighted-average,
then Laplacian-diffuse into unobserved nodes (smooth extrapolation).

python calib/fit_preset_lut.py
"""
import os, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
CAL = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(CAL, "BEACH LUT")
N = 33
PAIRS = ["__TM3329", "__TM3402", "__TM4566", "__TM6184"]
OUT_CUBE = os.path.join(CAL, "LUT LIBRARY", "a beach preset v5.7.cube")

def box4(a):
    h, w = a.shape[0] // 4 * 4, a.shape[1] // 4 * 4
    return a[:h, :w].reshape(h // 4, 4, w // 4, 4, 3).mean((1, 3))

def load_pair(name):
    ti = np.array(Image.open(os.path.join(SRC, name + ".tif")))[..., :3]
    jp = np.array(Image.open(os.path.join(SRC, name + ".jpg")))[..., :3]
    ti = ti.astype(np.float64) / (65535.0 if ti.dtype == np.uint16 else 255.0)
    jp = jp.astype(np.float64) / 255.0
    H = min(ti.shape[0], jp.shape[0]); W = min(ti.shape[1], jp.shape[1])
    cc = lambda a: a[(a.shape[0]-H)//2:(a.shape[0]-H)//2+H, (a.shape[1]-W)//2:(a.shape[1]-W)//2+W]
    return box4(cc(ti)), box4(cc(jp))

def splat(inp, out, wsum, csum):
    """Trilinear splat of out colors into the grid indexed by inp colors."""
    p = inp.reshape(-1, 3) * (N - 1)
    o = out.reshape(-1, 3)
    i0 = np.clip(np.floor(p).astype(int), 0, N - 2)
    f = p - i0
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (np.abs(1 - dr - f[:, 0]) * np.abs(1 - dg - f[:, 1]) * np.abs(1 - db - f[:, 2]))
                idx = ((i0[:, 0] + dr) * N + (i0[:, 1] + dg)) * N + (i0[:, 2] + db)
                np.add.at(wsum, idx, w)
                np.add.at(csum, idx, o * w[:, None])

def build_lut(pairs):
    wsum = np.zeros(N ** 3)
    csum = np.zeros((N ** 3, 3))
    for inp, out in pairs:
        splat(inp, out, wsum, csum)
    known = wsum > 1.0  # require at least ~1 full sample of weight
    lut = np.zeros((N ** 3, 3))
    lut[known] = csum[known] / wsum[known, None]
    # Laplacian diffusion fill: unknown nodes relax toward neighbour average,
    # known nodes stay pinned. Initialize unknowns with identity (input color).
    g = np.stack(np.meshgrid(np.arange(N), np.arange(N), np.arange(N),
                             indexing="ij"), -1).reshape(-1, 3) / (N - 1)  # r,g,b
    lut[~known] = g[~known]
    L = lut.reshape(N, N, N, 3).copy()
    K = known.reshape(N, N, N)
    for _ in range(400):
        avg = np.zeros_like(L); cnt = np.zeros((N, N, N, 1))
        for ax in range(3):
            for sh in (1, -1):
                avg += np.roll(L, sh, axis=ax); cnt += 1
                # zero-out wrap contributions
                sl = [slice(None)] * 3
                sl[ax] = 0 if sh == 1 else N - 1
                avg[tuple(sl)] -= np.roll(L, sh, axis=ax)[tuple(sl)]
                cnt[tuple(sl)] -= 1
        relaxed = avg / cnt
        L[~K] = relaxed[~K]
    out = L.reshape(-1, 3)
    return np.clip(out, 0, 1), known

def apply_lut(lut, img):
    p = img.reshape(-1, 3) * (N - 1)
    i0 = np.clip(np.floor(p).astype(int), 0, N - 2)
    f = p - i0
    res = np.zeros_like(p)
    L = lut.reshape(N, N, N, 3)
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (np.abs(1 - dr - f[:, 0]) * np.abs(1 - dg - f[:, 1]) * np.abs(1 - db - f[:, 2]))
                res += L[i0[:, 0] + dr, i0[:, 1] + dg, i0[:, 2] + db] * w[:, None]
    return res.reshape(img.shape)

def squint(a, k=8):
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    return a[:h, :w].reshape(h // k, k, w // k, k, -1).mean((1, 3))

def loss(lut, inp, out):
    return np.abs(squint(apply_lut(lut, inp)) - squint(out)).mean()

def write_cube(lut, path, title):
    # cube file order: R fastest (matches parseCube/gen_lut_presets.py).
    # Our lut array is indexed (r*N+g)*N+b -> reorder to b-slowest? cube wants
    # for b: for g: for r:  -> index r + g*N + b*N*N reading order. Build lines
    # by iterating b,g,r and indexing our (r,g,b) layout.
    L = lut.reshape(N, N, N, 3)  # [r][g][b]
    lines = ["TITLE \"%s\"" % title, "LUT_3D_SIZE %d" % N, ""]
    for b in range(N):
        for gch in range(N):
            for r in range(N):
                v = L[r, gch, b]
                lines.append("%.6f %.6f %.6f" % (v[0], v[1], v[2]))
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")

def main():
    pairs = {}
    for name in PAIRS:
        pairs[name] = load_pair(name)
        print("loaded", name, pairs[name][0].shape)
    # consistency matrix: fit on ONE, evaluate on ALL (the user's complaint in numbers)
    print("\nloss matrix (rows: fitted on; cols: evaluated on):")
    print("            " + "  ".join("%8s" % n[-6:] for n in PAIRS))
    for fit_on in PAIRS:
        lut, _ = build_lut([pairs[fit_on]])
        row = [loss(lut, *pairs[n]) for n in PAIRS]
        print("%10s  " % fit_on[-6:] + "  ".join("%8.4f" % v for v in row))
    joint, known = build_lut(list(pairs.values()))
    row = [loss(joint, *pairs[n]) for n in PAIRS]
    print("%10s  " % "JOINT" + "  ".join("%8.4f" % v for v in row))
    print("grid coverage: %.1f%% nodes observed" % (100 * known.mean()))
    # comparison strips
    for name in PAIRS:
        inp, out = pairs[name]
        got = apply_lut(joint, inp)
        o8 = (np.clip(got, 0, 1) * 255).round().astype(np.uint8)
        r8 = (np.clip(out, 0, 1) * 255).round().astype(np.uint8)
        s = np.concatenate([o8[::4, ::4], r8[::4, ::4]], axis=1)
        Image.fromarray(s).save(os.path.join(CAL, "cmp_beach_%s.png" % name.strip("_")))
    write_cube(joint, OUT_CUBE, "a beach preset v5.7")
    print("wrote", OUT_CUBE)

if __name__ == "__main__":
    main()
