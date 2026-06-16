#!/usr/bin/env python3
"""Build best-effort STD->look 3D LUTs for the 7 missing presets by fitting a smooth
global polynomial color transform to the montage (Camera Standard -> preset) pairs.
Outputs .cube files (convert to Lightroom .xmp via Adobe Enhanced Profile tooling)."""
import os
import numpy as np
from PIL import Image
import cube_io as C
import extract_panels as E
import fit_lut as F

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "montage_cubes")
TARGETS = ["Classic Chrome", "Eterna Bleach Bypass", "Eterna Cinema",
           "Pro Neg Hi", "Pro Neg Std", "Provia", "Reala Ace"]


def main():
    os.makedirs(OUT, exist_ok=True)
    scenes = list(dict(F._scene_panels()))
    panels0 = dict(F._scene_panels())[scenes[0]]
    proof_rows = []
    for name in TARGETS:
        coef = F.fit_poly(*F.collect_pairs(name))            # fit on all scenes
        lut = F.poly_to_lut(coef)
        fn = name.lower().replace(" ", "_") + "_montage.cube"
        C.write_cube(os.path.join(OUT, fn), lut,
                     title=f"Chromasmith montage fit - {name}",
                     comment="STD->look, fit from fujify comparison montages (best-effort)")
        # held-out proof on scene[0]
        coef_h = F.fit_poly(*F.collect_pairs(name, exclude_scene=scenes[0]))
        cs = panels0["Camera Standard"].astype(float) / 255
        tg = panels0[name].astype(float) / 255
        h = min(cs.shape[0], tg.shape[0]); w = min(cs.shape[1], tg.shape[1])
        cs = cs[:h, :w]; tg = tg[:h, :w]
        out = F.apply_poly(coef_h, cs)
        de = C.delta_e_approx(out, tg)
        print(f"{name:22s} -> {fn:34s} held-out dE med={np.median(de):5.2f} mean={de.mean():5.2f}")
        proof_rows.append(np.concatenate([cs, out, tg], axis=1))
    w = min(r.shape[1] for r in proof_rows)
    Image.fromarray((np.concatenate([r[:, :w] for r in proof_rows], 0) * 255).astype(np.uint8)) \
         .save(os.path.join(HERE, "_montage_proof.png"))
    print(f"\nwrote {len(TARGETS)} cubes to {OUT}")
    print("proof strip -> _montage_proof.png  (cols: CamStd | FITTED | ACTUAL)")


if __name__ == "__main__":
    main()
