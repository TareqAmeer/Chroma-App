#!/usr/bin/env python3
"""Plan B: rebase the V-Log-Alchemy repo cubes (V-Log base) onto Camera-Standard base.

STD_q(x) = repo_VLOG_q( T(x) ),  T = STD(sRGB) -> Lumix V-Log/V-Gamut, from published
Panasonic math (approximate: Lumix 'Standard' is treated as an sRGB display image).
  x(sRGB) --sRGB EOTF--> linear --Rec709->V-Gamut 3x3--> linear --V-Log curve--> [0,1]
Replace T with one derived from matched S9 Standard/V-Log frames for an exact rebase.
"""
import os
import numpy as np
from PIL import Image
import cube_io as C
import extract_panels as E
import fit_lut as F

HERE = os.path.dirname(__file__)
VDIR = os.path.join(HERE, "vlog_cubes")
OUT = os.path.join(HERE, "repo_cubes_std")

# repo file -> user-facing look name (Pro Neg Hi has no repo cube -> montage only)
REPO = {
    "Classic Chrome":      "FLog2C_to_CLASSIC-CHROME_VLog.cube",
    "Eterna Bleach Bypass":"FLog2C_to_ETERNA-BB_VLog.cube",
    "Eterna Cinema":       "FLog2C_to_ETERNA_VLog.cube",
    "Pro Neg Std":         "FLog2C_to_PRO-Neg_Std_VLog.cube",
    "Provia":              "FLog2C_to_PROVIA_VLog.cube",
    "Reala Ace":           "FLog2C_to_REALA-ACE_VLog.cube",
}

# Panasonic V-Gamut -> Rec.709 (published); invert for Rec709(sRGB)->V-Gamut
VG_TO_709 = np.array([[ 1.806576, -0.695697, -0.110879],
                      [-0.170090,  1.305955, -0.135865],
                      [-0.025206, -0.154468,  1.179674]])
M_709_TO_VG = np.linalg.inv(VG_TO_709)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_vlog(x):
    b, cc, d = 0.00873, 0.241514, 0.598206
    x = np.maximum(x, 0.0)
    return np.where(x < 0.01, 5.6 * x + 0.125, cc * np.log10(x + b) + d)


def T_std_to_vlog(rgb):
    """sRGB (Standard) -> Lumix V-Log/V-Gamut encoded value in [0,1]."""
    lin = srgb_to_linear(np.clip(rgb, 0, 1))
    vg = lin @ M_709_TO_VG.T
    return np.clip(linear_to_vlog(vg), 0.0, 1.0)


def rebase(vlog_lut, size=33):
    lat = C.lattice(size)
    tin = T_std_to_vlog(lat)
    return np.clip(C.apply_lut(vlog_lut, tin), 0.0, 1.0)


def main():
    os.makedirs(OUT, exist_ok=True)
    panels = dict(F._scene_panels())
    scene = list(panels)[0]
    rows = []
    for name, fn in REPO.items():
        vlog = C.read_cube(os.path.join(VDIR, fn))["lut"]
        lut = rebase(vlog)
        outfn = name.lower().replace(" ", "_") + "_repo_std.cube"
        C.write_cube(os.path.join(OUT, outfn), lut,
                     title=f"Chromasmith repo-rebased - {name}",
                     comment="repo V-Log look rebased to Camera Standard via Panasonic V-Log math (approx)")
        cs = panels[scene]["Camera Standard"].astype(float) / 255
        tg = panels[scene][name].astype(float) / 255
        h = min(cs.shape[0], tg.shape[0]); w = min(cs.shape[1], tg.shape[1])
        cs = cs[:h, :w]; tg = tg[:h, :w]
        out = C.apply_lut(lut, cs)
        de = C.delta_e_approx(out, tg)
        print(f"{name:22s} -> {outfn:34s} vs montage panel: dE med={np.median(de):5.2f}")
        rows.append(np.concatenate([cs, out, tg], axis=1))
    w = min(r.shape[1] for r in rows)
    Image.fromarray((np.concatenate([r[:, :w] for r in rows], 0) * 255).astype(np.uint8)) \
         .save(os.path.join(HERE, "_repo_rebase_proof.png"))
    print(f"\nwrote {len(REPO)} cubes to {OUT}")
    print("proof -> _repo_rebase_proof.png  (cols: CamStd | REPO-REBASED | fujify ACTUAL)")


if __name__ == "__main__":
    main()
