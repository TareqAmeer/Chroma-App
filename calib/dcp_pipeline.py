#!/usr/bin/env python3
"""DCP (Adobe DNG Camera Profile) pipeline prototype — match Lightroom's RW2 render.

Parses a .dcp, decodes an RW2 to linear white-balanced camera RGB via rawpy
(same params the app's libraw-wasm decode will use), applies the Adobe DNG-SDK
pipeline, and diffs the result against a Lightroom-exported reference TIFF:

  camRGB --ForwardMatrix--> XYZ(D50) --> linear ProPhoto(D50)
         --> ProfileLookTable (HSV deltas) --> ProfileToneCurve
         --> ProPhoto->sRGB --> clip --> sRGB gamma

One global exposure scalar (Adobe BaselineExposure is private) is fitted
numerically against the reference.

Usage:
  python calib/dcp_pipeline.py            # render + diff + side-by-side strip
  python calib/dcp_pipeline.py --fit      # also fit the exposure scalar first
"""
import struct, sys, os, json
import numpy as np

CAL = os.path.dirname(os.path.abspath(__file__))
DCP_PATH = os.path.join(CAL, "DCP Camera Profiles", "Panasonic DC-S9 Camera Standard.dcp")
RW2_PATH = os.path.join(CAL, "TM3617.RW2")
REF_PATH = os.path.join(CAL, "TM3617.tif")
PARAMS_PATH = os.path.join(CAL, "dcp_fit.json")

# ── DCP parsing (TIFF IFD, little-endian, magic 0x4352 "CR") ──────────────────
def parse_dcp(path):
    d = open(path, "rb").read()
    assert d[:2] == b"II", "DCP must be little-endian"
    bo = "<"
    off = struct.unpack(bo + "I", d[4:8])[0]
    n = struct.unpack(bo + "H", d[off:off + 2])[0]
    TYPSZ = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8}
    tags = {}
    for i in range(n):
        e = off + 2 + i * 12
        tag, typ, cnt = struct.unpack(bo + "HHI", d[e:e + 8])
        sz = TYPSZ[typ] * cnt
        ptr = struct.unpack(bo + "I", d[e + 8:e + 12])[0] if sz > 4 else e + 8
        raw = d[ptr:ptr + sz]
        if typ == 10:   # SRATIONAL
            v = np.array(struct.unpack(bo + f"{2*cnt}i", raw), dtype=np.float64)
            val = v[0::2] / v[1::2]
        elif typ == 11: # FLOAT
            val = np.array(struct.unpack(bo + f"{cnt}f", raw), dtype=np.float64)
        elif typ == 4:
            val = np.array(struct.unpack(bo + f"{cnt}I", raw))
        elif typ == 3:
            val = np.array(struct.unpack(bo + f"{cnt}H", raw))
        elif typ == 2:
            val = raw.rstrip(b"\0").decode("ascii", "replace")
        else:
            val = raw
        tags[tag] = val
    dcp = {
        "fm": tags[50964].reshape(3, 3),                       # ForwardMatrix1
        "tone": tags[50940].reshape(-1, 2),                    # ProfileToneCurve (x,y)
        "look_dims": tuple(int(x) for x in tags[50981]),       # (hue, sat, val)
        # DNG 1.4: data order is value (outer), hue (middle), sat (inner) — NOT dims order
        "look": tags[50982].reshape(int(tags[50981][2]), int(tags[50981][0]),
                                    int(tags[50981][1]), 3),
        "look_enc": int(tags.get(51108, [0])[0]),              # 1 = sRGB-encoded V axis
        "baseline_off": float(tags.get(51109, np.array([0.0]))[0]),
        "name": tags.get(50936, "?"),
    }
    return dcp

# ── color spaces ──────────────────────────────────────────────────────────────
# XYZ(D50) -> linear ProPhoto (RIMM), and ProPhoto -> sRGB(D65) via Bradford
XYZ2PP = np.array([[ 1.3459433, -0.2556075, -0.0511118],
                   [-0.5445989,  1.5081673,  0.0205351],
                   [ 0.0000000,  0.0000000,  1.2118128]])
PP2XYZ = np.linalg.inv(XYZ2PP)
# Bradford D50->D65
D50toD65 = np.array([[ 0.9555766, -0.0230393,  0.0631636],
                     [-0.0282895,  1.0099416,  0.0210077],
                     [ 0.0122982, -0.0204830,  1.3299098]])
XYZ65toSRGB = np.array([[ 3.2404542, -1.5371385, -0.4985314],
                        [-0.9692660,  1.8760108,  0.0415560],
                        [ 0.0556434, -0.2040259,  1.0572252]])
PP2SRGB = XYZ65toSRGB @ D50toD65 @ PP2XYZ

def srgb_gamma(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.clip(x, 0, None), 1/2.4) - 0.055)

def srgb_degamma(x):
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))

# ── HSV (vectorized, hue in degrees) ─────────────────────────────────────────
def rgb_to_hsv(rgb):
    mx = rgb.max(-1); mn = rgb.min(-1); c = mx - mn
    h = np.zeros_like(mx)
    m = c > 1e-12
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    i = m & (mx == r); h[i] = ((g - b)[i] / c[i]) % 6
    i = m & (mx == g) & (mx != r); h[i] = (b - r)[i] / c[i] + 2
    i = m & (mx == b) & (mx != r) & (mx != g); h[i] = (r - g)[i] / c[i] + 4
    h *= 60.0
    s = np.where(mx > 1e-12, c / np.where(mx > 1e-12, mx, 1), 0.0)
    return h, s, mx

def hsv_to_rgb(h, s, v):
    h = (h % 360.0) / 60.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)

# ── LookTable application (DNG 1.4 spec) ─────────────────────────────────────
def apply_look(pp, dcp):
    """pp: linear ProPhoto in [0,1]. Returns linear ProPhoto."""
    nh, ns, nv = dcp["look_dims"]
    tbl = dcp["look"]  # (nh, ns, nv, 3): hueShift deg, satScale, valScale
    h, s, v = rgb_to_hsv(np.clip(pp, 0, 1))
    # encoding 1: table's V axis is indexed by sRGB-encoded value
    venc = srgb_gamma(v) if dcp["look_enc"] == 1 else v
    hi = h / 360.0 * nh           # hue wraps: nh divisions
    si = s * (ns - 1)
    vi = venc * (nv - 1)
    h0 = np.floor(hi).astype(int) % nh; h1 = (h0 + 1) % nh; hf = hi - np.floor(hi)
    s0 = np.clip(np.floor(si).astype(int), 0, ns - 2); sf = si - s0; s1 = s0 + 1
    v0 = np.clip(np.floor(vi).astype(int), 0, nv - 2); vf = vi - v0; v1 = v0 + 1
    def g(hh, ss, vv):
        return tbl[vv, hh, ss]  # layout is [val][hue][sat] (DNG 1.4 data order)
    hf = hf[..., None]; sf = sf[..., None]; vf = vf[..., None]
    c = ((g(h0,s0,v0)*(1-hf) + g(h1,s0,v0)*hf)*(1-sf) + (g(h0,s1,v0)*(1-hf) + g(h1,s1,v0)*hf)*sf)*(1-vf) \
      + ((g(h0,s0,v1)*(1-hf) + g(h1,s0,v1)*hf)*(1-sf) + (g(h0,s1,v1)*(1-hf) + g(h1,s1,v1)*hf)*sf)*vf
    h2 = h + c[..., 0]
    s2 = np.clip(s * c[..., 1], 0, 1)
    v2 = np.clip(v * c[..., 2], 0, 1)
    return hsv_to_rgb(h2, s2, v2)

# ── Tone curve (DNG SDK hue-preserving RGB method) ───────────────────────────
def tone_lut(dcp, n=4096):
    pts = dcp["tone"]
    x = np.linspace(0, 1, n)
    return x, np.interp(x, pts[:, 0], pts[:, 1])

def apply_tone(pp, dcp):
    """DNG SDK dng_render: apply 1-D curve to max/min, interpolate mid to keep hue."""
    x, lut = tone_lut(dcp)
    def f(v): return np.interp(np.clip(v, 0, 1), x, lut)
    r, g, b = pp[..., 0], pp[..., 1], pp[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    fmx = f(mx); fmn = f(mn)
    # mid channel scaled to preserve its position between min & max (RGBtoRGBTable trick)
    den = mx - mn
    safe = den > 1e-12
    out = np.empty_like(pp)
    for i, ch in enumerate((r, g, b)):
        t = np.where(safe, (ch - mn) / np.where(safe, den, 1), 0.0)
        out[..., i] = np.where(safe, fmn + t * (fmx - fmn), fmx)
    return out

# ── full pipeline ─────────────────────────────────────────────────────────────
# Fitted constants (vs the Lightroom reference TIFF): ev/black absorb Adobe's private
# BaselineExposure + flare subtraction; gr/gb absorb the small difference between
# LR's as-shot WB interpretation and libraw's camera-WB multipliers.
DEFAULT_FIT = {"ev": -1.148, "black": 0.0156, "gr": 0.9491, "gb": 1.0750}

def render(cam, dcp, fit=None):
    """cam: float linear WB'd camera RGB (...,3) in [0,1]. Returns sRGB float [0,1]."""
    p = fit or DEFAULT_FIT
    c = cam * np.array([p["gr"], 1.0, p["gb"]])
    xyz = c @ dcp["fm"].T
    pp = xyz @ XYZ2PP.T
    pp = np.clip(pp * 2.0 ** (p["ev"] + dcp["baseline_off"]), 0, 1)
    pp = apply_look(pp, dcp)
    if p["black"] > 0:
        pp = np.clip((pp - p["black"]) / (1 - p["black"]), 0, 1)
    x, lut = tone_lut(dcp)
    pp = np.interp(np.clip(pp, 0, 1), x, lut)   # per-channel tone curve (beats hue-preserving here)
    srgb = np.clip(pp @ PP2SRGB.T, 0, 1)
    return srgb_gamma(srgb)

# ── decode + reference ────────────────────────────────────────────────────────
CAM_DUMP = "/tmp/cam16_6016x4016.bin"  # dumped from the app's wasm libraw (rawpy's
# bundled LibRaw 0.21.2 mis-decodes the DC-S9: wrong white level, 'data corrupted').
# Produced in-browser with {useCameraWb:1,outputColor:0,outputBps:16,gamm:[1,1],
# noAutoBright:1,userQual:3,userFlip:-1} — EXACTLY what the app's DCP path will use.

def decode_rw2(path):
    w, h = 6016, 4016
    a = np.fromfile(CAM_DUMP, dtype=np.uint16).reshape(h, w, 3)
    return a.astype(np.float64) / 65535.0

def load_ref(path):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(path)
    a = np.array(im)
    if a.dtype == np.uint16:
        return a[..., :3].astype(np.float64) / 65535.0
    return a[..., :3].astype(np.float64) / 255.0

def squint(a, k=8):
    """downsample by k via box filter — 'at a glance' compare, hides NR/sharpening."""
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    return a[:h, :w].reshape(h // k, k, w // k, k, -1).mean((1, 3))

def main():
    fit = "--fit" in sys.argv
    print("parsing DCP:", os.path.basename(DCP_PATH))
    dcp = parse_dcp(DCP_PATH)
    print("  profile:", dcp["name"], "look", dcp["look_dims"], "enc", dcp["look_enc"],
          "baseOff", dcp["baseline_off"])
    print("decoding RW2 (linear camera RGB)…")
    cam = decode_rw2(RW2_PATH)
    print("  cam:", cam.shape, "max", cam.max().round(4))
    ref = load_ref(REF_PATH)
    print("  ref:", ref.shape)
    if cam.shape[:2] != ref.shape[:2]:
        # LR crops a few edge pixels vs libraw; center-crop both to common size
        H = min(cam.shape[0], ref.shape[0]); W = min(cam.shape[1], ref.shape[1])
        def cc(a):
            y=(a.shape[0]-H)//2; x=(a.shape[1]-W)//2; return a[y:y+H, x:x+W]
        cam, ref = cc(cam), cc(ref)
        print("  center-cropped to", cam.shape)
    sq_ref = squint(ref)
    sub = cam[::4, ::4]          # fit on a subsample for speed
    sq_ref_sub = squint(ref[::4, ::4], k=2)

    if fit:
        from scipy.optimize import minimize
        def loss(pv):
            f = {"ev": pv[0], "black": max(0, pv[1]), "gr": pv[2], "gb": pv[3]}
            return np.abs(squint(render(sub, dcp, f), k=2) - sq_ref_sub).mean()
        res = minimize(loss, [DEFAULT_FIT["ev"], DEFAULT_FIT["black"],
                              DEFAULT_FIT["gr"], DEFAULT_FIT["gb"]],
                       method="Nelder-Mead", options={"xatol": 1e-3, "fatol": 1e-5, "maxiter": 300})
        f = {"ev": float(res.x[0]), "black": float(max(0, res.x[1])),
             "gr": float(res.x[2]), "gb": float(res.x[3]), "loss": float(res.fun)}
        json.dump(f, open(PARAMS_PATH, "w"), indent=1)
        print(f"  fitted: {f}")
    p = json.load(open(PARAMS_PATH)) if os.path.exists(PARAMS_PATH) else DEFAULT_FIT
    print(f"rendering full-res with fit {p}…")
    out = render(cam, dcp, p)
    d = np.abs(squint(out) - sq_ref)
    print(f"  squint mean|Δ| = {d.mean():.4f}  (per-ch {d.mean((0,1)).round(4)})  p95 {np.percentile(d,95):.4f}")
    # sample patches (y, x, label) on the squinted grid
    from PIL import Image
    o8 = (np.clip(out, 0, 1) * 255).round().astype(np.uint8)
    r8 = (np.clip(ref, 0, 1) * 255).round().astype(np.uint8)
    H, W = o8.shape[:2]
    for (fy, fx, lab) in [(0.30, 0.50, "lifebuoy red"), (0.10, 0.80, "sky"),
                          (0.75, 0.50, "shingle"), (0.62, 0.20, "people/skin")]:
        y, x = int(H * fy), int(W * fx)
        print(f"  {lab:14s} ours {o8[y, x]} vs LR {r8[y, x]}")
    strip = np.concatenate([o8[::6, ::6], r8[::6, ::6]], axis=1)
    Image.fromarray(strip).save(os.path.join(CAL, "cmp_dcp_full.png"))
    print("wrote calib/cmp_dcp_full.png (left=ours, right=Lightroom)")

if __name__ == "__main__":
    main()
