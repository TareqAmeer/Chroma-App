#!/usr/bin/env python3
"""Single-look end-to-end composition validation, using Velvia as the test case
(we have its REAL .cube + .xmp + a repo VLog cube + screenshot panels -- the one
look where every form of ground truth exists at once).

Pipeline under test:
  1. Derive T = STD->VLOG from the OTHER two matched looks (astia, classic_neg) only
     (Velvia held out -- leave-one-out).
  2. Compose STD_velvia_pred = VLOG_velvia( T(x) ).
  3. Compare composed cube to the REAL velvia.cube directly (LUT-space dE -- the
     strongest possible test, no screenshot noise).
  4. Apply both composed and real cubes to the montage's Camera-Standard panel and
     compare to the actual Velvia screenshot panel (visual proof + dE).
"""
import os
import numpy as np
from PIL import Image
import cube_io as C
import derive_T as D
import build_repo_rebase as R
import fit_lut as F

HERE = os.path.dirname(__file__)
STD_DIR = os.path.join(HERE, "..", "..", "Fujify Luts and XMP")
VLOG_DIR = os.path.join(HERE, "vlog_cubes")


def main():
    # 1. derive T leaving Velvia out
    held_out = "velvia"
    others = [n for n in D.MATCHED if n != held_out]
    Ts = []
    for n in others:
        std, vlog = D.load(n)
        Ts.append(D.derive_T_single(std, vlog))
    T = np.median(np.stack(Ts, 0), axis=0)
    print(f"derived T from {others} (held out {held_out})")

    # 2. compose predicted Velvia STD cube
    real_std, real_vlog = D.load(held_out)
    lat = C.lattice(33)
    pred_std = np.clip(C.apply_lut(real_vlog, np.clip(T, 0, 1)), 0, 1)

    # 3. LUT-space comparison: predicted vs real STD cube, on the lattice
    de_lut = C.delta_e_approx(pred_std, real_std)
    print(f"\nLUT-space dE (composed vs REAL velvia.cube, on the 33^3 lattice):")
    print(f"  mean={de_lut.mean():6.2f}  median={np.median(de_lut):6.2f}  p95={np.percentile(de_lut,95):6.2f}")
    print("  (this is the headline number -- no screenshot/alignment noise at all)")

    # 4. visual: apply composed vs real cube to the montage CamStd panel, compare to actual Velvia panel
    panels = dict(F._scene_panels())
    scene = list(panels)[0]
    p = panels[scene]
    cs = p["Camera Standard"].astype(float) / 255
    tg = p["Velvia"].astype(float) / 255
    h = min(cs.shape[0], tg.shape[0]); w = min(cs.shape[1], tg.shape[1])
    cs, tg = cs[:h, :w], tg[:h, :w]

    out_pred = C.apply_lut(pred_std, cs)
    out_real = C.apply_lut(real_std, cs)
    de_pred_panel = C.delta_e_approx(out_pred, tg)
    de_real_panel = C.delta_e_approx(out_real, tg)
    print(f"\nScreenshot-panel dE vs actual Velvia panel:")
    print(f"  composed-cube render: med={np.median(de_pred_panel):5.2f} mean={de_pred_panel.mean():5.2f}")
    print(f"  REAL-cube    render: med={np.median(de_real_panel):5.2f} mean={de_real_panel.mean():5.2f}  "
          f"<- ceiling (real cube vs screenshot noise)")

    rows = [np.concatenate([cs, out_pred, out_real, tg], axis=1)]
    Image.fromarray((np.concatenate(rows, 0) * 255).astype(np.uint8)) \
         .save(os.path.join(HERE, "_velvia_composition_proof.png"))
    print("\nproof -> _velvia_composition_proof.png  (cols: CamStd | COMPOSED | REAL-cube | ACTUAL-screenshot)")
    print("\nVerdict: if 'LUT-space dE mean' is small (<~5) composition is viable and should be")
    print("redone for the 6 repo-covered looks; if it's large (~the old ~14-40 range), it")
    print("reconfirms composition is a dead end and the montage-poly fit remains the right call.")


if __name__ == "__main__":
    main()
