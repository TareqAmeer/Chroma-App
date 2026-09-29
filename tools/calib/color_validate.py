"""
Offline color-accuracy validator: runs the REAL production DCP bake+apply code (extracted
verbatim into scratchpad/dcp_apply.js, executed via Node — not a from-scratch reimplementation
that could hide its own bugs) against raw camera-linear decodes, and compares DCP-GRADED output
to the matching Lightroom reference, per ISO, per tone zone (shadow/mid/highlight).

This SUPERSEDES the earlier ad-hoc scripts used mid-investigation this session, which applied a
flat sRGB gamma directly to linear camera RGB (no ForwardMatrix/LookTable/tone-curve at all) and
then compared THAT to Lightroom's fully color-managed output — an apples-to-oranges test that
manufactured a spurious "highlight compression" signal. This script is the corrected, valid
comparison: our own real color pipeline vs Lightroom, at the pixel level.

Regenerate the .bin inputs (raw camera-linear dumps) with:
  cargo run --release --example dump_rw2 -- <RW2> <out.bin> 1   (from desktop/src-tauri)
Then DCP-grade them with:
  node scratchpad/dcp_apply.js <out.bin> "vendor/dcp/Panasonic DC-S9 Camera Standard.dcp" <graded.bin>
This script consumes the resulting *_dcp_graded.bin files (RGBA8, header w,h + raw bytes).

Run: python calib/color_validate.py
"""
import os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SC = "/private/tmp/claude-501/-Users-tareqameer-Documents-GitHub-Chroma-App/90b32845-2d88-4db5-a609-abc7c61ec0f1/scratchpad"

SETS = {
    1: dict(iso=12800, lr="LR-defaultNR.tif"),
    2: dict(iso=5000, lr="LR-defaultNR2.tif"),
    3: dict(iso=2000, lr="LR-defaultNR3.tif"),
    5: dict(iso=100, lr="LR-defaultNR5.tif"),
}

N_PATCHES = 30
PATCH = 40


def load_graded_bin(path):
    raw = open(path, "rb").read()
    w, h = np.frombuffer(raw, "<u4", 2)
    rgba = np.frombuffer(raw, "<u1", offset=8).reshape(int(h), int(w), 4)
    return rgba[..., :3].astype(np.float64) / 255.0


def load_tif(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float64) / 255.0


def sample_grid(h, w, n, patch):
    pts = []
    step_y, step_x = h // int(np.sqrt(n)), w // int(np.sqrt(n))
    for y0 in range(patch, h - patch, max(step_y, 1)):
        for x0 in range(patch, w - patch, max(step_x, 1)):
            pts.append((y0, x0))
    return pts[:n]


def main():
    print(f"{'ISO':>7}  {'zone':<10}{'CS val':>8}{'LR val':>8}{'val ratio':>10}"
          f"{'CS sat':>8}{'LR sat':>8}{'sat ratio':>10}   verdict")
    print("-" * 82)
    any_fail = False
    for s, info in SETS.items():
        cs = load_graded_bin(f"{SC}/set{s}_dcp_graded.bin")
        lr = load_tif(info["lr"])
        ch, cw = cs.shape[:2]
        lh, lw = lr.shape[:2]
        sy, sx = lh / ch, lw / cw
        pts = sample_grid(ch, cw, N_PATCHES, PATCH)
        rows = {"shadow": [], "mid": [], "highlight": []}
        for (y0, x0) in pts:
            cs_p = cs[y0 - PATCH:y0 + PATCH, x0 - PATCH:x0 + PATCH]
            ly, lx = int(y0 * sy), int(x0 * sx)
            lr_p = lr[ly - PATCH:ly + PATCH, lx - PATCH:lx + PATCH]
            if cs_p.size == 0 or lr_p.size == 0:
                continue
            lr_v = lr_p.max(axis=-1).mean()
            zone = "shadow" if lr_v < 0.33 else ("highlight" if lr_v > 0.66 else "mid")
            cs_mx, cs_mn = cs_p.max(axis=-1), cs_p.min(axis=-1)
            lr_mx, lr_mn = lr_p.max(axis=-1), lr_p.min(axis=-1)
            cs_val, lr_val = cs_mx.mean(), lr_mx.mean()
            cs_sat = np.where(cs_mx > 1e-6, (cs_mx - cs_mn) / np.maximum(cs_mx, 1e-6), 0).mean()
            lr_sat = np.where(lr_mx > 1e-6, (lr_mx - lr_mn) / np.maximum(lr_mx, 1e-6), 0).mean()
            rows[zone].append((cs_val, lr_val, cs_sat, lr_sat))
        for zone in ("shadow", "mid", "highlight"):
            if not rows[zone]:
                continue
            arr = np.array(rows[zone])
            cs_val, lr_val, cs_sat, lr_sat = arr.mean(axis=0)
            vr = cs_val / max(lr_val, 1e-6)
            sr = cs_sat / max(lr_sat, 1e-6)
            fails = []
            if vr < 0.85:
                fails.append("dark")
            if sr < 0.80:
                fails.append("desat")
            verdict = "PASS" if not fails else "FAIL:" + ",".join(fails)
            if fails:
                any_fail = True
            print(f"{info['iso']:>7}  {zone:<10}{cs_val:>8.3f}{lr_val:>8.3f}{vr:>10.2f}"
                  f"{cs_sat:>8.3f}{lr_sat:>8.3f}{sr:>10.2f}   {verdict} (n={len(rows[zone])})")
        print()
    print("val ratio / sat ratio = CS/LR on matched patches, using the REAL DCP-graded pipeline")
    print("(ForwardMatrix->exposure->LookTable->hue-preserving tone curve->ProPhoto->sRGB->residual lift).")
    print(f"\nOVERALL: {'FAIL — real color pipeline bug found' if any_fail else 'PASS — DCP pipeline matches Lightroom'}")


if __name__ == "__main__":
    main()
