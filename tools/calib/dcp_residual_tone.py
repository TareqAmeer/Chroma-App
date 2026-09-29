#!/usr/bin/env python3
"""Residual tone-curve fit: close the last brightness gap vs Lightroom.

After the structural DCP rebuild (dcp_native_fit.py), hue matches LR everywhere but
BRIGHT regions render ~6-8/255 darker (sky/highlights), while shadows/mids match.
Global ev can't fix this without breaking the shadow match — the residual is
tone-DEPENDENT. This script measures (LR - ours) as a function of OUR output tone
across all matched scenes, fits a small monotone residual curve anchored at 0 and 1,
and validates the correction with the same patch gates as dcp_native_fit.py.

The fitted knots get baked into chromasmith-22.html (DCP_RESID) and applied
hue-preservingly (RGBTone) right after the DCP ToneCurve inside bakeDcpLUT.

Usage
  python calib/dcp_residual_tone.py measure   # per-scene + pooled residual-by-tone table
  python calib/dcp_residual_tone.py fit       # fit knots -> calib/dcp_residual_tone.json
  python calib/dcp_residual_tone.py report    # before/after patch table + MAD, gate check
"""
import os, sys, json, struct
import numpy as np
from PIL import Image
import warnings; warnings.filterwarnings('ignore')

CAL = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, CAL)
from dcp_native_fit import (parse_dcp, render, ref_small, aligned_mad, rgbtone,
                            patch, PATCHES, DCP, MATCH, NAT, REPO, SCENES)

OUT = os.path.join(CAL, "dcp_residual_tone.json")
PARAMS = json.load(open(os.path.join(CAL, "dcp_native_fit.json")))

# All comparison pairs: the 5 matched scenes + the user's own comparison frame
# (__TM3329-4 is the same beach scene as 'base' -> same LR reference TIFF).
PAIRS = [(s, i, None) for s, i in SCENES] + [("base", 200, "__TM3329-4")]

def load_native_bin(name):
    d = open(os.path.join(NAT, name + ".bin"), "rb").read()
    w, h, iso = struct.unpack("<3I", d[:12])
    a = np.frombuffer(d, np.uint16, offset=12).reshape(h, w, 3)
    return a.astype(np.float64) / 65535.0, iso

def prepare_pairs():
    dcp = parse_dcp(DCP)
    match = json.load(open(MATCH))
    out = []
    for scene, iso, override in PAIRS:
        name = override or match[scene]["dump"].replace(".RW2", "")
        cam, iso_hdr = load_native_bin(name)
        H, W = cam.shape[:2]; f = 2
        cams = cam[:H//f*f, :W//f*f].reshape(H//f, f, W//f, f, 3).mean((1, 3))
        ref_probe = Image.open(os.path.join(REPO, ("base_lr.tif" if scene == "base" else scene + "_lr.tif")))
        if (ref_probe.size[1] > ref_probe.size[0]) and (cams.shape[1] > cams.shape[0]):
            p0 = dict(ev_a=0, ev_b=0, gr=1, gb=1)
            probe = render(dcp, cams[::4, ::4], p0, iso)
            best = None
            for k in (1, 3):
                r = np.rot90(probe, k)
                m = aligned_mad(r, np.asarray(ref_probe.convert("RGB").resize((r.shape[1], r.shape[0])), np.float64))[0]
                if best is None or m < best[0]: best = (m, k)
            cams = np.rot90(cams, best[1]).copy()
        out.append(dict(scene=scene, label=name, iso=iso, cam=cams, ref=ref_small(scene, cams.shape[1])))
    return dcp, out

# ── residual measurement ─────────────────────────────────────────────────────
def smooth_mask(img, thresh=6.0):
    """True where the 3x3 local range of luma is small — excludes edges/texture,
    where sub-pixel misalignment between renders would poison the residual."""
    l = img @ np.array([0.2126, 0.7152, 0.0722])
    mx = l.copy(); mn = l.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            s = np.roll(np.roll(l, dy, 0), dx, 1)
            mx = np.maximum(mx, s); mn = np.minimum(mn, s)
    return (mx - mn) < thresh

def residual_bins(out, ref, nbins=32):
    """Per-tone-bin median (LR - ours), per channel + luma. Bin by OUR luma."""
    H = min(out.shape[0], ref.shape[0]); W = min(out.shape[1], ref.shape[1])
    o = out[:H, :W]; r = ref[:H, :W]
    m = smooth_mask(o) & smooth_mask(r)
    luma_o = o @ np.array([0.2126, 0.7152, 0.0722])
    bins = np.clip((luma_o / 255.0 * nbins).astype(int), 0, nbins - 1)
    rows = []
    for b in range(nbins):
        sel = m & (bins == b)
        n = sel.sum()
        if n < 200:
            rows.append(None); continue
        d = (r - o)[sel]
        rows.append(dict(n=int(n), tone=(b + 0.5) / nbins,
                         dr=float(np.median(d[:, 0])), dg=float(np.median(d[:, 1])),
                         db=float(np.median(d[:, 2])), dl=float(np.median(d @ np.array([0.2126, 0.7152, 0.0722])))))
    return rows

def cmd_measure():
    dcp, data = prepare_pairs()
    pooled = {}
    for d in data:
        out = render(dcp, d["cam"], PARAMS, d["iso"])
        _, dy, dx = aligned_mad(out, d["ref"])
        H = min(out.shape[0], d["ref"].shape[0]); W = min(out.shape[1], d["ref"].shape[1])
        o = out[max(0, dy):H+min(0, dy), max(0, dx):W+min(0, dx)]
        r = d["ref"][max(0, -dy):H+min(0, -dy), max(0, -dx):W+min(0, -dx)]
        rows = residual_bins(o, r)
        print(f"\n── {d['scene']} ({d['label']}, ISO {d['iso']}) ─ residual (LR-ours) by tone bin")
        print(f"{'tone':>6s} {'n':>8s} {'dR':>6s} {'dG':>6s} {'dB':>6s} {'dLuma':>6s}")
        for row in rows:
            if row is None: continue
            print(f"{row['tone']:6.3f} {row['n']:8d} {row['dr']:6.1f} {row['dg']:6.1f} {row['db']:6.1f} {row['dl']:6.1f}")
            pooled.setdefault(round(row['tone'], 3), []).append((row['n'], row['dl'], row['dr'], row['dg'], row['db']))
    print("\n── POOLED (weighted by n) ─")
    print(f"{'tone':>6s} {'scenes':>7s} {'dLuma':>6s} {'dR':>6s} {'dG':>6s} {'dB':>6s}")
    for tone in sorted(pooled):
        rows = pooled[tone]
        wn = sum(r[0] for r in rows)
        wl = sum(r[0]*r[1] for r in rows)/wn
        wr = sum(r[0]*r[2] for r in rows)/wn
        wg = sum(r[0]*r[3] for r in rows)/wn
        wb = sum(r[0]*r[4] for r in rows)/wn
        print(f"{tone:6.3f} {len(rows):7d} {wl:6.1f} {wr:6.1f} {wg:6.1f} {wb:6.1f}")

# ── fit + apply ──────────────────────────────────────────────────────────────
# The measured residual is PER-CHANNEL (LR lifts R and B ~3/255 more than G at sky tones —
# a real chroma nuance, consistent across the well-aligned scenes), so the correction is
# three small per-channel curves, identity-anchored at 0 and 1 and pinned to identity below
# tone ~0.3 (beach shadows already match; the gate forbids moving them).
KNOT_XS = [0.0, 0.30, 0.50, 0.68, 0.85, 1.0]
FREE_IDX = [2, 3, 4]  # dy free at 0.50/0.68/0.85 only; 0/0.30/1.0 pinned to identity

def resid_curve_from_knots(knots):
    """knots: [[x,dy],...]. Returns f(y)->y' vectorized via PCHIP on (x, x+dy)."""
    from scipy.interpolate import PchipInterpolator
    xs = np.array([k[0] for k in knots]); dys = np.array([k[1] for k in knots])
    ys = np.clip(xs + dys, 0, 1)
    p = PchipInterpolator(xs, ys)
    return lambda y: np.clip(p(np.clip(y, 0, 1)), 0, 1)

def curves_from_params(v):
    """v: 12 values (4 free knots x 3 channels, in 0..1 tone units)."""
    fs = []
    for c in range(3):
        knots = [[x, 0.0] for x in KNOT_XS]
        for i, k in enumerate(FREE_IDX):
            knots[k][1] = v[c * len(FREE_IDX) + i]
        fs.append(resid_curve_from_knots(knots))
    return fs

def apply_resid(out255, fs):
    o = out255 / 255.0
    return np.stack([fs[c](o[..., c]) for c in range(3)], axis=-1) * 255.0

def render_with_resid(dcp, cam, params, iso, fs):
    return apply_resid(render(dcp, cam, params, iso), fs)

def cmd_fit():
    from scipy.optimize import minimize
    dcp, data = prepare_pairs()
    rendered = []
    for d in data:
        out = render(dcp, d["cam"], PARAMS, d["iso"])
        mad, dy, dx = aligned_mad(out, d["ref"])
        rendered.append((d, out, dy, dx, 1.0 / max(mad, 1.0)))  # downweight badly-aligned scenes

    def loss(v):
        fs = curves_from_params(v)
        tot = 0.0; wsum = 0.0
        for d, out, dy, dx, w in rendered:
            o2 = apply_resid(out, fs)
            H = min(o2.shape[0], d["ref"].shape[0]); W = min(o2.shape[1], d["ref"].shape[1])
            o = o2[max(0, dy):H+min(0, dy), max(0, dx):W+min(0, dx)]
            r = d["ref"][max(0, -dy):H+min(0, -dy), max(0, -dx):W+min(0, -dx)]
            m = smooth_mask(o) & smooth_mask(r)
            tot += w * np.abs((r - o)[m]).mean(); wsum += w
            if d["scene"] in PATCHES and d["label"].startswith("__TM3329"):
                for nm, (fx, fy) in PATCHES[d["scene"]].items():
                    pa = patch(o2, fx, fy); pb = patch(d["ref"], fx, fy)
                    wgt = 3.0 if ("shadow" in nm or "back" in nm) else 2.0
                    tot += w * wgt * np.abs(pa - pb).mean() / len(PATCHES[d["scene"]])
        # smoothness: penalize knot deltas and knot-to-knot swings (kills oscillation overfit)
        v2 = np.asarray(v).reshape(3, len(FREE_IDX))
        reg = 8.0 * np.abs(v2).mean() + 25.0 * np.abs(np.diff(v2, axis=1)).mean()
        return tot / wsum + reg

    v0 = np.zeros(3 * len(FREE_IDX))
    print("initial loss:", round(loss(v0), 3))
    r = minimize(loss, v0, method="Nelder-Mead", options=dict(maxiter=1500, xatol=1e-4, fatol=1e-3))
    print("fitted loss:", round(r.fun, 3))
    chans = []
    for c in range(3):
        knots = [[x, 0.0] for x in KNOT_XS]
        for i, k in enumerate(FREE_IDX):
            knots[k][1] = float(r.x[c * len(FREE_IDX) + i])
        chans.append(knots)
        print(f"ch{c} knots:", [[round(a, 3), round(b, 4)] for a, b in knots])
    json.dump(dict(channels=chans), open(OUT, "w"), indent=1)
    print("wrote", OUT)
    cmd_report()

def load_curves():
    chans = json.load(open(OUT))["channels"]
    return [resid_curve_from_knots(k) for k in chans]

def cmd_report():
    dcp, data = prepare_pairs()
    fs = load_curves()
    print(f"{'scene':12s}{'ISO':>6s} {'MAD before':>11s} {'MAD after':>10s}")
    for d in data:
        out0 = render(dcp, d["cam"], PARAMS, d["iso"])
        out1 = apply_resid(out0, fs)
        m0 = aligned_mad(out0, d["ref"])[0]
        m1 = aligned_mad(out1, d["ref"])[0]
        print(f"{d['label']:12s}{d['iso']:6d} {m0:11.2f} {m1:10.2f}")
        if d["scene"] in PATCHES:
            for nm, (fx, fy) in PATCHES[d["scene"]].items():
                pa0 = patch(out0, fx, fy); pa1 = patch(out1, fx, fy); pb = patch(d["ref"], fx, fy)
                d0 = pb - pa0; d1 = pb - pa1
                flag = "  <-- GATE" if ("shadow" in nm or "back" in nm) else ""
                print(f"    {nm:12s} before({d0[0]:+5.1f},{d0[1]:+5.1f},{d0[2]:+5.1f})"
                      f" after({d1[0]:+5.1f},{d1[1]:+5.1f},{d1[2]:+5.1f}){flag}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "measure"
    dict(measure=cmd_measure, fit=cmd_fit, report=cmd_report)[cmd]()
