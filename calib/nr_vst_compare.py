"""
Scores the VST/Poisson-Gaussian denoise prototype (calib/vst_denoise.py) against both the
existing hand-tuned per-ISO wavelet NR (raw_decode.rs) and Lightroom's default NR, reusing
the tone-robust on/off-ratio methodology from calib/nr_validate.py (see that file's docstring
for the full rationale — measure each app/version against its OWN no-NR baseline, since
absolute pixels aren't comparable across different color pipelines).

Specifically targets the user-reported real-world failure case: __TM8159 (ISO 5000, sunlit
water with a dog silhouette) — the current "Highlight Desaturation" slider at 100/100 still
leaves visible chroma speckle on the water highlights. This script checks whether the VST
prototype does better there, not just on synthetic ramp-chart metrics.

Inputs (must already exist — see the header comments in calib/vst_denoise.py and
calib/noise_fit.py for how to produce them):
  /tmp/cs_dump/set2_cs_off.bin, set2_cs_on.bin   — dump_rw2 output, CS_NO_CHROMA_NR=1 / unset
  LR-noNR2.tif, LR-defaultNR2.tif                — Lightroom references (repo root)
  calib/tm8159_vst_noisy.png, tm8159_vst_denoised.png — vst_denoise.py output

⚠️ Caveat: the VST preview PNGs use a quick gray-world WB + sRGB gamma for visualization
(see vst_denoise.py docstring) — NOT the same color pipeline as CS's DCP bake or Lightroom's
render. This comparison is therefore about RELATIVE noise reduction (on/off ratios), same
tone-robust philosophy as nr_validate.py, not absolute color match.

Usage: python3 calib/nr_vst_compare.py
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
os.chdir(Path(__file__).parent.parent)

from nr_validate import load_bin_srgb, load_tif, measure, srgb  # noqa: E402

CS_DUMP_DIR = "/tmp/cs_dump"


def load_png_rgb(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float64) / 255.0


def fmt_ratio(x):
    return f"{x:.3f}" if not np.isnan(x) else "  -  "


def main():
    lr_off = load_tif("LR-noNR2.tif")
    lr_on = load_tif("LR-defaultNR2.tif")
    cs_off = load_bin_srgb(f"{CS_DUMP_DIR}/set2_cs_off.bin")
    cs_on = load_bin_srgb(f"{CS_DUMP_DIR}/set2_cs_on.bin")
    vst_off = load_png_rgb("calib/tm8159_vst_noisy.png")
    vst_on = load_png_rgb("calib/tm8159_vst_denoised.png")

    lr = measure(lr_off, lr_on)
    cs = measure(cs_off, cs_on)
    vst = measure(vst_off, vst_on)

    print(f"__TM8159 (ISO 5000) — on/off ratio (lower = more noise removed relative to own baseline)\n")
    print(f"{'bucket':<8}{'Y: LR':>8}{'CS':>8}{'VST':>8}   |  {'Cb: LR':>8}{'CS':>8}{'VST':>8}"
          f"   |  {'sat: LR':>9}{'CS':>8}{'VST':>8}")
    print("-" * 92)
    for bucket in ("shadow", "mid", "high"):
        l, c, v = lr[bucket], cs[bucket], vst[bucket]
        print(
            f"{bucket:<8}"
            f"{fmt_ratio(l['y']):>8}{fmt_ratio(c['y']):>8}{fmt_ratio(v['y']):>8}   |  "
            f"{fmt_ratio(l['cb']):>8}{fmt_ratio(c['cb']):>8}{fmt_ratio(v['cb']):>8}   |  "
            f"{fmt_ratio(l['sat']):>9}{fmt_ratio(c['sat']):>8}{fmt_ratio(v['sat']):>8}"
        )

    print(
        "\nRead as: Y ~1 = luma preserved (good); Cb closer to LR's Cb = comparable chroma-noise\n"
        "removal; sat closer to 1 = real color preserved (not muted). VST should match or beat\n"
        "CS's numbers, especially in the 'high' (highlight) bucket where the water-sparkle\n"
        "speckle lives and CS's Highlight-Desaturation slider still doesn't fully clean it."
    )


if __name__ == "__main__":
    main()
