#!/usr/bin/env python3
"""Corrected-DCP-pipeline fit against Lightroom, on NATIVE (rawler) decode dumps.

This replaces the old wasm-based fit (dcp_dual_fit.py). Two things changed underneath it:
1. The native Rust decode (desktop/src-tauri/src/raw_decode.rs) is now the canonical input:
   rawler apply_scaling + PPG demosaic + libraw WB convention. The old libraw-wasm dumps turn
   out to be NON-LINEAR (wasm ~= 1.22 * native^0.634, verified per-pixel) — every old fitted
   constant (ev=-0.819, black=0.0397, WHITE_LEVEL_MATCH=2.334) was compensating for that.
2. The render mirrors the REBUILT bakeDcpLUT (chromasmith-22.html), which now follows the
   Adobe DNG-SDK / RawTherapee dcp.cc structure exactly:
   FM1 -> XYZ(D50) -> linear ProPhoto -> 2^(ev+BaselineExposureOffset) -> LookTable
   (index-clamps only, values extended-range) -> hue-preserving Adobe RGBTone tone curve ->
   ProPhoto->sRGB -> gamma. NO black subtraction (DCPs carry DefaultBlackRender=None), no
   early [0,1] ceilings.

Fit parameters: ev_a, ev_b (ev = ev_a + ev_b*log2(ISO/100)), gr, gb. Nothing else.

Inputs
  /tmp/chroma-dumps-native/<name>.bin   12-byte header (w,h,iso u32 LE) + u16 RGB, 752x502
  calib/dcp_scene_match.json            scene -> wasm dump name (reused for the RW2 name)
  repo *_lr.tif                         the Lightroom sRGB reference exports

Usage
  python calib/dcp_native_fit.py fit      # fit + write calib/dcp_native_fit.json
  python calib/dcp_native_fit.py report   # per-scene MAD + patch table (incl. SHADOW patches)
"""
import os, sys, json, struct
import numpy as np
from PIL import Image
import warnings; warnings.filterwarnings('ignore')

CAL   = os.path.dirname(os.path.abspath(__file__))
REPO  = os.path.dirname(CAL)
NAT   = "/tmp/chroma-dumps-native"
DCP   = os.path.join(REPO, "vendor/dcp/Panasonic DC-S9 Camera Standard.dcp")
MATCH = os.path.join(CAL, "dcp_scene_match.json")
OUT   = os.path.join(CAL, "dcp_native_fit.json")

SCENES = [("base",200),("scene2",1250),("scene3",2500),("scene4",500),("scene5",5000)]

# Patch positions (fraction of frame) per scene for the acceptance gate. The beach 'base'
# scene carries the user's exact tell: the subject's back (shadow-side skin) that Chromasmith
# crushed to near-black. Loss/gate MUST include shadows (process lesson: the old fit's
# midtone-only loss is why shadows were never right).
PATCHES = {  # verified against base_lr.tif: lit skin ~(170,120,95); shadow skin (103,62,44)/(80,53,47)
  "base": dict(back_lit=(0.22,0.48), back_shadow=(0.20,0.55), back_shadow2=(0.20,0.60),
               water=(0.50,0.33), sky=(0.55,0.10)),
}

# ── DCP parse ────────────────────────────────────────────────────────────────
def parse_dcp(path):
    d = open(path,"rb").read()
    off = struct.unpack("<I", d[4:8])[0]
    n = struct.unpack("<H", d[off:off+2])[0]
    TYPSZ = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8}
    tags = {}
    for i in range(n):
        e = off+2+i*12
        tag,typ,cnt = struct.unpack("<HHI", d[e:e+8])
        sz = TYPSZ[typ]*cnt
        ptr = struct.unpack("<I", d[e+8:e+12])[0] if sz>4 else e+8
        raw = d[ptr:ptr+sz]
        if typ==10:
            v = np.array(struct.unpack(f"<{2*cnt}i", raw), np.float64); val = v[0::2]/v[1::2]
        elif typ==11: val = np.array(struct.unpack(f"<{cnt}f", raw), np.float64)
        elif typ==4:  val = np.array(struct.unpack(f"<{cnt}I", raw))
        elif typ==3:  val = np.array(struct.unpack(f"<{cnt}H", raw))
        else: continue
        tags[tag] = val
    return dict(
        fm1=tags[50964].reshape(3,3),
        tone=tags[50940].reshape(-1,2), dims=tags[50981], look=tags[50982],
        enc=int(tags[51108][0]) if 51108 in tags else 0,
        base_off=float(tags[51109][0]) if 51109 in tags else 0.0)

# ── colour helpers (mirror chromasmith-22.html exactly) ──────────────────────
XYZ2PP  = np.array([[1.3459433,-0.2556075,-0.0511118],
                    [-0.5445989,1.5081673,0.0205351],
                    [0,0,1.2118128]])
PP2SRGB = np.array([[2.0340758,-0.7273341,-0.3067418],
                    [-0.2288131,1.2317301,-0.0029168],
                    [-0.0085698,-0.1532866,1.1618564]])
def srgb_g(x):  return np.where(x<=0.0031308, 12.92*x, 1.055*np.maximum(x,0)**(1/2.4)-0.055)

def rgb_to_hsv(rgb):
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx-mn
    h = np.zeros_like(mx)
    r,g,b = rgb[...,0],rgb[...,1],rgb[...,2]
    m = (d>1e-12)
    i = m&(mx==r); h[i] = (((g-b)/np.where(d==0,1,d))[i])%6
    i = m&(mx==g)&(mx!=r); h[i] = ((b-r)/np.where(d==0,1,d)+2)[i]
    i = m&(mx==b)&(mx!=r)&(mx!=g); h[i] = ((r-g)/np.where(d==0,1,d)+4)[i]
    s = np.where(mx>1e-12, d/np.maximum(mx,1e-12), 0)
    return h*60, s, mx
def hsv_to_rgb(h,s,v):
    hh = (h/60)%6; i = np.floor(hh).astype(int); f = hh-i
    p = v*(1-s); q = v*(1-s*f); t = v*(1-s*(1-f))
    out = np.zeros(h.shape+(3,))
    for k in range(6):
        m = (i==k)
        ch = [v,t,p] if k==0 else [q,v,p] if k==1 else [p,v,t] if k==2 else [p,q,v] if k==3 else [t,p,v] if k==4 else [v,p,q]
        out[...,0][m]=ch[0][m]; out[...,1][m]=ch[1][m]; out[...,2][m]=ch[2][m]
    return out

def apply_look_ext(dcp, rgb):
    """LookTable on extended-range values: only TABLE INDICES are clamped; v itself is not."""
    nh,ns,nv = int(dcp["dims"][0]), int(dcp["dims"][1]), int(dcp["dims"][2])
    tbl = dcp["look"].reshape(nv,nh,ns,3)
    h,s,v = rgb_to_hsv(rgb)          # v may exceed 1
    venc = np.minimum(srgb_g(v) if dcp["enc"]==1 else v, 1.0)   # index clamp only
    hi = h/360*nh; si = np.minimum(s,1.0)*(ns-1); vi = venc*(nv-1)
    h0 = np.floor(hi).astype(int)%nh; h1=(h0+1)%nh; hf=hi-np.floor(hi)
    s0 = np.minimum(np.floor(si).astype(int), ns-2); sf=si-s0; s1=s0+1
    v0 = np.minimum(np.floor(vi).astype(int), nv-2); vf=vi-v0; v1=v0+1
    def T(vv,hh,ss): return tbl[vv,hh,ss]
    d = ((T(v0,h0,s0)*(1-hf[...,None])+T(v0,h1,s0)*hf[...,None])*(1-sf[...,None])
        +(T(v0,h0,s1)*(1-hf[...,None])+T(v0,h1,s1)*hf[...,None])*sf[...,None])*(1-vf[...,None]) \
      + ((T(v1,h0,s0)*(1-hf[...,None])+T(v1,h1,s0)*hf[...,None])*(1-sf[...,None])
        +(T(v1,h0,s1)*(1-hf[...,None])+T(v1,h1,s1)*hf[...,None])*sf[...,None])*vf[...,None]
    h = (h + d[...,0])%360
    s = np.clip(s*d[...,1],0,1)      # s is a ratio, <=1 by definition
    v = np.maximum(v*d[...,2],0)     # extended range preserved
    return hsv_to_rgb(h,s,v)

def rgbtone(rgb, tone):
    """Hue-preserving Adobe RGBTone (DNG SDK / RT AdobeToneCurve), vectorized.
    Curve the max and min channels; median interpolated at its original ratio."""
    tx, ty = tone[:,0], tone[:,1]
    curve = lambda x: np.interp(np.clip(x,0,1), tx, ty)
    srt = np.sort(rgb, axis=-1)              # min, med, max
    mn, md, mx = srt[...,0], srt[...,1], srt[...,2]
    tmx = curve(mx); tmn = curve(mn)
    denom = np.where(mx-mn>1e-12, mx-mn, 1.0)
    tmd = np.where(mx-mn>1e-12, tmn + (tmx-tmn)*(md-mn)/denom, tmx)
    # scatter back to original channel order
    out = np.empty_like(rgb)
    order = np.argsort(rgb, axis=-1)         # indices of min, med, max
    np.put_along_axis(out, order, np.stack([tmn,tmd,tmx],axis=-1), axis=-1)
    return out

def render(dcp, cam, params, iso):
    """cam: HxWx3 float 0..1 linear camera RGB (camera-WB'd, native decode). sRGB 0..255 out."""
    x = np.log2(iso/100.0)
    ev = params["ev_a"] + params["ev_b"]*x
    gains = np.array([params["gr"], 1.0, params["gb"]])
    xyz = (cam*gains) @ dcp["fm1"].T
    pp  = np.maximum(xyz @ XYZ2PP.T, 0) * (2.0**(ev + dcp["base_off"]))   # floor only
    pp  = apply_look_ext(dcp, pp)
    pp  = rgbtone(pp, dcp["tone"])
    srgb = np.clip(pp @ PP2SRGB.T, 0, 1)
    return srgb_g(srgb)*255.0

# ── data loading ─────────────────────────────────────────────────────────────
def load_native(name):
    d = open(os.path.join(NAT, name.replace(".RW2","")+".bin"),"rb").read()
    w,h,iso = struct.unpack("<3I", d[:12])
    a = np.frombuffer(d, np.uint16, offset=12).reshape(h,w,3)
    return a.astype(np.float64)/65535.0, iso

def ref_small(scene, W):
    im = Image.open(os.path.join(REPO, ("base_lr.tif" if scene=="base" else scene+"_lr.tif"))).convert("RGB")
    H = round(W*im.size[1]/im.size[0])
    return np.asarray(im.resize((W,H), Image.LANCZOS), np.float64)

def aligned_mad(a, b, rng=2):
    H,W = min(a.shape[0],b.shape[0]), min(a.shape[1],b.shape[1])
    a=a[:H,:W]; b=b[:H,:W]
    best = None
    for dy in range(-rng,rng+1):
        for dx in range(-rng,rng+1):
            ac = a[max(0,dy):H+min(0,dy), max(0,dx):W+min(0,dx)]
            bc = b[max(0,-dy):H+min(0,-dy), max(0,-dx):W+min(0,-dx)]
            m = np.abs(ac-bc).mean()
            if best is None or m<best[0]: best=(m,dy,dx)
    return best

def patch(img, fx, fy, s=4):
    H,W = img.shape[:2]
    x,y = int(fx*W), int(fy*H)
    return img[max(0,y-s):y+s, max(0,x-s):x+s].reshape(-1,3).mean(0)

def prepare():
    dcp = parse_dcp(DCP)
    match = json.load(open(MATCH))
    p0 = dict(ev_a=0.0, ev_b=0.0, gr=1.0, gb=1.0)
    data = []
    for scene, iso in SCENES:
        cam, iso_hdr = load_native(match[scene]["dump"])
        assert abs(iso_hdr-iso)<=1, f"{scene}: header iso {iso_hdr} != expected {iso}"
        # downscale linear cam ~2x for faster loss evals (box; linear-safe)
        H,W = cam.shape[:2]; f=2
        cams = cam[:H//f*f,:W//f*f].reshape(H//f,f,W//f,f,3).mean((1,3))
        # The native decode is UNROTATED sensor orientation; the LR refs are EXIF-rotated.
        # For portrait refs, pick the 90° rotation (k=1 or 3) that best matches a quick render.
        ref_probe = Image.open(os.path.join(REPO, ("base_lr.tif" if scene=="base" else scene+"_lr.tif")))
        portrait_ref = ref_probe.size[1] > ref_probe.size[0]
        landscape_cam = cams.shape[1] > cams.shape[0]
        if portrait_ref and landscape_cam:
            probe = render(dcp, cams[::4,::4], p0, iso)
            best = None
            for k in (1,3):
                ref_k = ref_small(scene, np.rot90(cams,k).shape[1])
                m = aligned_mad(np.rot90(probe,k), ref_k[::4,::4] if False else np.asarray(
                    Image.fromarray(np.clip(ref_k,0,255).astype(np.uint8)).resize(
                        (np.rot90(probe,k).shape[1], np.rot90(probe,k).shape[0])), np.float64))[0]
                if best is None or m < best[0]: best = (m, k)
            cams = np.rot90(cams, best[1]).copy()
        data.append(dict(scene=scene, iso=iso, cam=cams, ref=ref_small(scene, cams.shape[1])))
    return dcp, data

# ── loss: full-frame MAD + heavy shadow-patch weight on the beach tell ───────
def loss(dcp, data, params):
    tot = 0.0
    for d in data:
        out = render(dcp, d["cam"], params, d["iso"])
        mad = aligned_mad(out, d["ref"])[0]
        tot += mad
        if d["scene"] in PATCHES:
            for nm,(fx,fy) in PATCHES[d["scene"]].items():
                pa = patch(out, fx, fy); pb = patch(d["ref"], fx, fy)
                wgt = 3.0 if "shadow" in nm or "back" in nm else 1.0
                tot += wgt * np.abs(pa-pb).mean() / len(PATCHES[d["scene"]])
    return tot/len(data)

def cmd_fit():
    from scipy.optimize import minimize
    dcp, data = prepare()
    p0 = [0.0, 0.0, 1.0, 1.0]   # ev_a, ev_b, gr, gb — expected near-neutral now
    unpack = lambda v: dict(ev_a=v[0], ev_b=v[1], gr=v[2], gb=v[3])
    f = lambda v: loss(dcp, data, unpack(v))
    print("initial loss:", round(f(p0),3))
    r = minimize(f, p0, method="Nelder-Mead",
                 options=dict(maxiter=400, xatol=1e-4, fatol=1e-3))
    P = unpack(r.x)
    print("fitted:", {k:round(v,4) for k,v in P.items()}, "loss", round(r.fun,3))
    json.dump(P, open(OUT,"w"), indent=1)
    print("wrote", OUT)
    cmd_report(P)

def cmd_report(P=None):
    dcp, data = prepare()
    if P is None:
        P = json.load(open(OUT))
    print(f"\nparams: {({k:round(v,4) for k,v in P.items()})}")
    print(f"{'scene':8s}{'ISO':>6s} {'MAD':>8s}")
    for d in data:
        out = render(dcp, d["cam"], P, d["iso"])
        mad, dy, dx = aligned_mad(out, d["ref"])
        print(f"{d['scene']:8s}{d['iso']:6d} {mad:8.2f}")
        if d["scene"] in PATCHES:
            for nm,(fx,fy) in PATCHES[d["scene"]].items():
                pa = patch(out, fx, fy); pb = patch(d["ref"], fx, fy)
                df = pb-pa
                flag = "  <-- GATE" if ("shadow" in nm or "back" in nm) else ""
                print(f"    {nm:12s} ours({pa[0]:5.1f},{pa[1]:5.1f},{pa[2]:5.1f})"
                      f" LR({pb[0]:5.1f},{pb[1]:5.1f},{pb[2]:5.1f})"
                      f" diff({df[0]:+5.1f},{df[1]:+5.1f},{df[2]:+5.1f}){flag}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv)>1 else "report"
    if cmd=="fit": cmd_fit()
    elif cmd=="report": cmd_report()
    else: print(__doc__)
