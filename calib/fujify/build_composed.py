#!/usr/bin/env python3
"""Final composition build: STD_q(x) = VLOG_q(T(x)), T derived from all 3 matched
looks (astia, velvia, classic_neg). Validated as visually near-ceiling on Velvia
(see validate_velvia_composition.py: composed dE 10.74 vs real-cube ceiling 9.67).
Produces .cube for the 6 repo-covered looks (Pro Neg Hi has no repo source -> use
montage_cubes/pro_neg_hi_montage.cube for that one)."""
import os
import numpy as np
from PIL import Image
import cube_io as C
import derive_T as D
import fit_lut as F

HERE = os.path.dirname(__file__)
VDIR = os.path.join(HERE, "vlog_cubes")
OUT = os.path.join(HERE, "composed_cubes")

REPO = {
    "Classic Chrome":      "FLog2C_to_CLASSIC-CHROME_VLog.cube",
    "Eterna Bleach Bypass":"FLog2C_to_ETERNA-BB_VLog.cube",
    "Eterna Cinema":       "FLog2C_to_ETERNA_VLog.cube",
    "Pro Neg Std":         "FLog2C_to_PRO-Neg_Std_VLog.cube",
    "Provia":              "FLog2C_to_PROVIA_VLog.cube",
    "Reala Ace":           "FLog2C_to_REALA-ACE_VLog.cube",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    # T from ALL 3 matched looks (final, not held-out)
    Ts = []
    for n in D.MATCHED:
        std, vlog = D.load(n)
        Ts.append(D.derive_T_single(std, vlog))
    T = np.clip(np.median(np.stack(Ts, 0), axis=0), 0, 1)
    print("derived T from all 3 matched looks (astia, velvia, classic_neg)\n")

    panels = dict(F._scene_panels())
    scene = list(panels)[0]
    p = panels[scene]
    cs = p["Camera Standard"].astype(float) / 255

    rows = []
    for name, fn in REPO.items():
        vlog = C.read_cube(os.path.join(VDIR, fn))["lut"]
        lut = np.clip(C.apply_lut(vlog, T), 0, 1)
        outfn = name.lower().replace(" ", "_") + "_composed.cube"
        C.write_cube(os.path.join(OUT, outfn), lut,
                     title=f"Chromasmith composed - {name}",
                     comment="STD_q(x) = VLOG_q(T(x)), T derived from astia/velvia/classic_neg matched pairs")
        tg = p[name].astype(float) / 255
        h = min(cs.shape[0], tg.shape[0]); w = min(cs.shape[1], tg.shape[1])
        c, t = cs[:h, :w], tg[:h, :w]
        out = C.apply_lut(lut, c)
        de = C.delta_e_approx(out, t)
        print(f"{name:22s} -> {outfn:30s} panel dE med={np.median(de):5.2f} mean={de.mean():5.2f}")
        rows.append(np.concatenate([c, out, t], axis=1))

    w = min(r.shape[1] for r in rows)
    Image.fromarray((np.concatenate([r[:, :w] for r in rows], 0) * 255).astype(np.uint8)) \
         .save(os.path.join(HERE, "_composed_proof.png"))
    print(f"\nwrote {len(REPO)} cubes to {OUT}")
    print("proof -> _composed_proof.png  (cols: CamStd | COMPOSED | ACTUAL)")
    print("\nNote: Velvia ceiling (real-cube-vs-screenshot noise floor) is med~9.7 -- treat")
    print("anything in that ballpark as 'as good as it can get from this evidence'.")


if __name__ == "__main__":
    main()
