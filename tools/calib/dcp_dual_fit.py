#!/usr/bin/env python3
"""Dual-illuminant DCP pipeline + residual-constant fit vs Lightroom references.

Root cause being fixed: the app's bakeDcpLUT uses ONLY ForwardMatrix1 (StdA/tungsten)
for every shot; Adobe interpolates FM1..FM2 per shot from the white balance. This
harness implements the DNG-SDK interpolation, renders the app's own wasm-decoded
linear camera-RGB dumps (from dbgDumpCam16 → /tmp/chroma-dumps), and fits the small
residual constants against the 6 clean Lightroom sRGB reference TIFFs.

Inputs
  /tmp/chroma-dumps/<name>.RW2.bin/.json   752x502x3 u16 linear camera RGB (WB'd) + meta
  /tmp/chroma-preview/raws/<name>.RW2      for the WB tags (0x24/25/26)
  repo *_chroma.png / *_lr.tif             the 6 validated scene pairs

Usage
  python calib/dcp_dual_fit.py match    # auto-match dumps to the 6 scene pairs
  python calib/dcp_dual_fit.py fit      # fit constants (writes calib/dcp_dual_fit.json)
  python calib/dcp_dual_fit.py report   # before/after table + skin/water patches
"""
import os, sys, json, struct
import numpy as np
from PIL import Image
import warnings; warnings.filterwarnings('ignore')

CAL   = os.path.dirname(os.path.abspath(__file__))
REPO  = os.path.dirname(CAL)
DUMPS = "/tmp/chroma-dumps"
RAWS  = "/tmp/chroma-preview/raws"
DCP   = os.path.join(REPO, "vendor/dcp/Panasonic DC-S9 Camera Standard.dcp")
OUT   = os.path.join(CAL, "dcp_dual_fit.json")
MATCH = os.path.join(CAL, "dcp_scene_match.json")

SCENES = [("base",200),("scene2",1250),("scene3",2500),("scene4",500),("scene5",5000)]
# scene6 (ISO 6400) excluded: its source RW2 isn't among the currently-staged files
# (~/Downloads no longer has it) — no dump to fit against. Re-add if the RW2 resurfaces.

# ── DCP parse (both illuminants) ─────────────────────────────────────────────
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
        cm1=tags[50721].reshape(3,3), cm2=tags[50722].reshape(3,3),
        fm1=tags[50964].reshape(3,3), fm2=tags[50965].reshape(3,3),
        ill1=int(tags[50778][0]), ill2=int(tags[50779][0]),      # 17=StdA, 21=D65
        tone=tags[50940].reshape(-1,2), dims=tags[50981], look=tags[50982],
        enc=int(tags[51108][0]) if 51108 in tags else 0,
        base_off=float(tags[51109][0]) if 51109 in tags else 0.0)

# ── RW2 WB multipliers (IFD0 tags 0x24/25/26) ────────────────────────────────
def rw2_wb(path):
    d = open(path,"rb").read(65536)
    off = struct.unpack("<I", d[4:8])[0]; n = struct.unpack("<H", d[off:off+2])[0]
    wb = {}
    for i in range(n):
        e = off+2+i*12
        tag,typ,cnt = struct.unpack("<HHI", d[e:e+8])
        if tag in (0x24,0x25,0x26): wb[tag] = struct.unpack("<H", d[e+8:e+10])[0]
    return np.array([wb[0x24]/wb[0x25], 1.0, wb[0x26]/wb[0x25]])  # R,G,B multipliers

# ── DNG-SDK illuminant interpolation ─────────────────────────────────────────
ILLUM_CCT = {17:2856.0, 21:6504.0, 23:5503.0}   # StdA, D65, D50
def xy_to_cct(x, y):   # McCamy — fine within 2800..6500K
    n = (x-0.3320)/(0.1858-y+1e-9)
    return 449.0*n**3 + 3525.0*n**2 + 6823.3*n + 5520.33
def wb_weight(dcp, neutral_cam):
    """neutral_cam: camera-space neutral = 1/multipliers. Returns w for CM/FM1 (StdA)."""
    c1, c2 = ILLUM_CCT[dcp["ill1"]], ILLUM_CCT[dcp["ill2"]]
    m1, m2 = 1e6/c1, 1e6/c2
    w = 0.5
    for _ in range(30):
        cm = w*dcp["cm1"] + (1-w)*dcp["cm2"]          # XYZ -> camera
        xyz = np.linalg.solve(cm, neutral_cam)
        x, y = xyz[0]/xyz.sum(), xyz[1]/xyz.sum()
        cct = np.clip(xy_to_cct(x,y), min(c1,c2), max(c1,c2))
        w_new = float(np.clip((1e6/cct - m2)/(m1 - m2), 0, 1))
        if abs(w_new-w) < 1e-4: w = w_new; break
        w = w_new
    return w

# ── colour helpers ───────────────────────────────────────────────────────────
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
    for k,(rr,gg,bb) in enumerate([(2,1,0),(1,2,0),(0,2,1),(0,1,2),(1,0,2),(2,0,1)]):
        m = (i==k)
        ch = [v,t,p] if k==0 else [q,v,p] if k==1 else [p,v,t] if k==2 else [p,q,v] if k==3 else [t,p,v] if k==4 else [v,p,q]
        out[...,0][m]=ch[0][m]; out[...,1][m]=ch[1][m]; out[...,2][m]=ch[2][m]
    return out

def apply_look(dcp, rgb):
    """ProfileLookTable HSV deltas, layout [val][hue][sat], V axis sRGB-enc when enc==1."""
    nh,ns,nv = int(dcp["dims"][0]), int(dcp["dims"][1]), int(dcp["dims"][2])
    tbl = dcp["look"].reshape(nv,nh,ns,3)
    h,s,v = rgb_to_hsv(np.clip(rgb,0,1))
    venc = srgb_g(v) if dcp["enc"]==1 else v
    hi = h/360*nh; si = s*(ns-1); vi = venc*(nv-1)
    h0 = np.floor(hi).astype(int)%nh; h1=(h0+1)%nh; hf=hi-np.floor(hi)
    s0 = np.minimum(np.floor(si).astype(int), ns-2); sf=si-s0; s1=s0+1
    v0 = np.minimum(np.floor(vi).astype(int), nv-2); vf=vi-v0; v1=v0+1
    def T(vv,hh,ss): return tbl[vv,hh,ss]
    d = ((T(v0,h0,s0)*(1-hf[...,None])+T(v0,h1,s0)*hf[...,None])*(1-sf[...,None])
        +(T(v0,h0,s1)*(1-hf[...,None])+T(v0,h1,s1)*hf[...,None])*sf[...,None])*(1-vf[...,None]) \
      + ((T(v1,h0,s0)*(1-hf[...,None])+T(v1,h1,s0)*hf[...,None])*(1-sf[...,None])
        +(T(v1,h0,s1)*(1-hf[...,None])+T(v1,h1,s1)*hf[...,None])*sf[...,None])*vf[...,None]
    h = (h + d[...,0])%360; s = np.clip(s*d[...,1],0,1); v = np.clip(v*d[...,2],0,1)
    return hsv_to_rgb(h,s,v)

def render(dcp, cam, params, w_fm, iso):
    """cam: HxWx3 float 0..1 linear camera RGB (already camera-WB'd). Returns sRGB 0..255."""
    x = np.log2(iso/100.0)
    ev    = params["ev_a"] + params["ev_b"]*x
    black = max(0.0, params["black_a"] + params["black_b"]*x)
    gains = np.array([params["gr"], 1.0, params["gb"]])
    fm = w_fm*dcp["fm1"] + (1-w_fm)*dcp["fm2"]
    xyz = (cam*gains) @ fm.T
    pp  = np.clip(xyz @ XYZ2PP.T, 0, 1) * (2.0**(ev + dcp["base_off"]))
    pp  = np.clip(pp, 0, 1)
    pp  = apply_look(dcp, pp)
    pp  = np.clip((pp - black)/(1-black), 0, 1)
    tone = dcp["tone"]
    for c in range(3):
        pp[...,c] = np.interp(pp[...,c], tone[:,0], tone[:,1])
    srgb = np.clip(pp @ PP2SRGB.T, 0, 1)
    return srgb_g(srgb)*255.0

# ── data loading ─────────────────────────────────────────────────────────────
def load_dump(name):
    j = json.load(open(os.path.join(DUMPS, name+".json")))
    a = np.fromfile(os.path.join(DUMPS, name+".bin"), np.uint16).reshape(j["h"], j["w"], 3)
    return a.astype(np.float64)/65535.0, j

def small(img_arr, W=188):
    im = Image.fromarray(np.clip(img_arr,0,255).astype(np.uint8))
    H = round(W*im.size[1]/im.size[0])
    return np.asarray(im.resize((W,H), Image.LANCZOS), np.float64)

def ref_small(scene, W=188):
    im = Image.open(os.path.join(REPO, ("base_lr.tif" if scene=="base" else scene+"_lr.tif"))).convert("RGB")
    H = round(W*im.size[1]/im.size[0])
    return np.asarray(im.resize((W,H), Image.LANCZOS), np.float64)

def chroma_small(scene, W=94):
    im = Image.open(os.path.join(REPO, ("base_chroma.png" if scene=="base" else scene+"_chroma.png"))).convert("RGB")
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

# ── scene matching ───────────────────────────────────────────────────────────
def cmd_match():
    dcp = parse_dcp(DCP)
    dumps = [f[:-5] for f in os.listdir(DUMPS) if f.endswith(".json")]
    match = {}
    for scene, iso in SCENES:
        tgt = chroma_small(scene)
        ty = tgt.mean(-1); ty=(ty-ty.mean())/(ty.std()+1e-9)
        best=None
        for name in dumps:
            cam,j = load_dump(name)
            if abs(j["meta"]["iso_speed"]-iso)>1: continue
            g = srgb_g(np.clip(cam[...,1],0,1))
            gi = Image.fromarray((g*255).astype(np.uint8)).resize((tgt.shape[1],tgt.shape[0]))
            gg = np.asarray(gi,np.float64); gg=(gg-gg.mean())/(gg.std()+1e-9)
            corr = float((ty*gg).mean())
            if best is None or corr>best[0]: best=(corr,name)
        match[scene]=dict(dump=best[1], corr=round(best[0],3), iso=iso)
        print(f"{scene:8s} ISO{iso:5d} -> {best[1]:22s} corr {best[0]:.3f}")
    json.dump(match, open(MATCH,"w"), indent=1)
    print("wrote", MATCH)

# ── fit ──────────────────────────────────────────────────────────────────────
def prepare():
    dcp = parse_dcp(DCP)
    match = json.load(open(MATCH))
    data = []
    for scene, iso in SCENES:
        name = match[scene]["dump"]
        cam, j = load_dump(name)
        wbm = rw2_wb(os.path.join(RAWS, name))
        w_fm = wb_weight(dcp, 1.0/wbm)
        # downscale the LINEAR cam data for fast loss evals (box; linear-safe)
        H,W = cam.shape[:2]; f=4
        cams = cam[:H//f*f,:W//f*f].reshape(H//f,f,W//f,f,3).mean((1,3))
        data.append(dict(scene=scene, iso=iso, cam=cams, ref=ref_small(scene, cams.shape[1]), w=w_fm))
        print(f"{scene:8s} {name:22s} wb_mul {np.round(wbm,3)} w_fm(StdA) {w_fm:.3f}")
    return dcp, data

def loss(dcp, data, params, dual=True):
    tot=0
    for d in data:
        w = d["w"] if dual else 1.0
        out = render(dcp, d["cam"], params, w, d["iso"])
        tot += aligned_mad(out, d["ref"])[0]
    return tot/len(data)

def cmd_fit():
    from scipy.optimize import minimize
    dcp, data = prepare()
    old = dict(ev_a=-0.8185, ev_b=-0.1732, gb_a=None)  # legacy for reference only
    p0  = [-0.82, -0.17, 1.0, 1.0, 0.02, -0.005]        # ev_a, ev_b, gr, gb, black_a, black_b
    def unpack(v): return dict(ev_a=v[0],ev_b=v[1],gr=v[2],gb=v[3],black_a=v[4],black_b=v[5])
    f = lambda v: loss(dcp, data, unpack(v), dual=True)
    print("initial dual loss:", round(f(p0),3))
    r = minimize(f, p0, method="Nelder-Mead",
                 options=dict(maxiter=800, xatol=1e-4, fatol=1e-4))
    P = unpack(r.x)
    print("fitted:", {k:round(v,4) for k,v in P.items()}, "loss", round(r.fun,3))
    json.dump(P, open(OUT,"w"), indent=1)
    print("wrote", OUT)

def cmd_report():
    dcp, data = prepare()
    P = json.load(open(OUT))
    OLDP = dict(ev_a=-0.8185,ev_b=-0.1732,gr=0.9709,gb=1.0714,black_a=0.0397,black_b=-0.00714)
    # gb in old model was gb_a+gb_b*x; fold: use gb_a and ignore slope for the "old" baseline
    print(f"\n{'scene':8s}{'ISO':>6s} {'old(FM1) MAD':>13s} {'new(dual) MAD':>14s}")
    for d in data:
        o = aligned_mad(render(dcp,d['cam'],OLDP,1.0,d['iso']), d['ref'])[0]
        n = aligned_mad(render(dcp,d['cam'],P,     d['w'],d['iso']), d['ref'])[0]
        print(f"{d['scene']:8s}{d['iso']:6d} {o:13.2f} {n:14.2f}   {'OK' if n<o else 'WORSE'}")
    # skin/water acceptance patches on the beach (fractions of frame)
    d = data[0]
    out_new = render(dcp, d["cam"], P, d["w"], d["iso"])
    ref = d["ref"]
    H,W = out_new.shape[:2]
    for nm,(fx,fy) in dict(water1=(0.50,0.33),water2=(0.64,0.42),skinC=(0.45,0.52),skinL=(0.19,0.44)).items():
        x,y = int(fx*W), int(fy*H); s=3
        a = out_new[y-s:y+s,x-s:x+s].reshape(-1,3).mean(0)
        b = ref[y-s:y+s,x-s:x+s].reshape(-1,3).mean(0)
        print(f"beach {nm:7s} new({a[0]:3.0f},{a[1]:3.0f},{a[2]:3.0f}) LR({b[0]:3.0f},{b[1]:3.0f},{b[2]:3.0f}) diff({b[0]-a[0]:+4.0f},{b[1]-a[1]:+4.0f},{b[2]-a[2]:+4.0f})")

# ── diagnostic: per-scene FREE fit (ev, gr, gb, black per scene) ─────────────
# If per-scene WB/exposure freedom collapses the residual (incl. the beach skin patch),
# the root cause is per-shot WB/exposure normalization (libraw vs Adobe AsShotNeutral) —
# deterministic and fixable. If skin still misses, the difference is hue-level
# (LookTable domain / pipeline order) and needs a different investigation.
def cmd_diag():
    from scipy.optimize import minimize
    dcp, data = prepare()
    print(f"\n{'scene':8s}{'ISO':>6s} {'globalfit MAD':>13s} {'per-scene MAD':>14s}  per-scene params")
    for d in data:
        def f(v):
            P=dict(ev_a=v[0],ev_b=0,gr=v[1],gb=v[2],black_a=v[3],black_b=0)
            return aligned_mad(render(dcp,d["cam"],P,d["w"],100), d["ref"])[0]  # iso=100 → x=0 → ev=v0
        r=minimize(f,[-0.9,1.0,1.0,0.02],method="Nelder-Mead",options=dict(maxiter=400,xatol=1e-4,fatol=1e-3))
        OLDP=dict(ev_a=-0.8185,ev_b=-0.1732,gr=0.9709,gb=1.0714,black_a=0.0397,black_b=-0.00714)
        o=aligned_mad(render(dcp,d["cam"],OLDP,1.0,d["iso"]), d["ref"])[0]
        v=r.x
        print(f"{d['scene']:8s}{d['iso']:6d} {o:13.2f} {r.fun:14.2f}  ev {v[0]:+.3f} gr {v[1]:.4f} gb {v[2]:.4f} blk {v[3]:.4f}")
        if d["scene"]=="base":
            P=dict(ev_a=v[0],ev_b=0,gr=v[1],gb=v[2],black_a=v[3],black_b=0)
            out=render(dcp,d["cam"],P,d["w"],100); ref=d["ref"]
            H,W=out.shape[:2]
            for nm,(fx,fy) in dict(water1=(0.50,0.33),skinC=(0.45,0.52),skinL=(0.19,0.44)).items():
                x,y=int(fx*W),int(fy*H); s=3
                a=out[y-s:y+s,x-s:x+s].reshape(-1,3).mean(0); b=ref[y-s:y+s,x-s:x+s].reshape(-1,3).mean(0)
                print(f"    beach {nm:7s} ours({a[0]:3.0f},{a[1]:3.0f},{a[2]:3.0f}) LR({b[0]:3.0f},{b[1]:3.0f},{b[2]:3.0f}) diff({b[0]-a[0]:+4.0f},{b[1]-a[1]:+4.0f},{b[2]-a[2]:+4.0f})")

if __name__=="__main__":
    cmd = sys.argv[1] if len(sys.argv)>1 else "report"
    {"match":cmd_match, "fit":cmd_fit, "report":cmd_report, "diag":cmd_diag}[cmd]()
