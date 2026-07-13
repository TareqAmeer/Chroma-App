"""
Step A gate: applies calib/nr_validate.py's EXACT PASS/FAIL gate logic (same thresholds,
same fail categories: waxy-luma / noisy-chroma / muted) to compare the CURRENT hand-tuned
per-ISO table against the physically-derived table from calib/derive_iso_table.py, across
every already-available Lightroom-referenced ISO set.

Requires per set: /tmp/cs_dump/set{N}_cs_off.bin, _cs_on.bin (current table, from plain
dump_rw2), _cs_new.bin (derived table, via CS_NR_STRENGTH/CS_NR_LEVELS env override — see
raw_decode.rs's denoise_chroma_wavelet_rgb16 diagnostic escape hatch).

Usage: python3 calib/step_a_gate.py
"""
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
os.chdir(Path(__file__).parent.parent)

from nr_validate import (  # noqa: E402
    CHROMA_REMOVE_MAX, NR_MIN_ISO, SAT_RETAIN_MIN, SETS, Y_RETAIN_MIN,
    load_bin_srgb, load_tif, measure, tag_sat_ratio, TAG_SET, TAG_SAT_RETAIN_MIN,
)

SC = "/tmp/cs_dump"


def gate(c, l, iso):
    fails = []
    if not np.isnan(c["y"]) and not np.isnan(l["y"]) and c["y"] < Y_RETAIN_MIN * l["y"]:
        fails.append("waxy-luma")
    note = ""
    if not np.isnan(c["cb"]) and not np.isnan(l["cb"]) and c["cb"] > CHROMA_REMOVE_MAX * max(l["cb"], 1e-3):
        if iso >= NR_MIN_ISO:
            fails.append("noisy-chroma")
        else:
            note = " (under-chroma, NR-off ISO, ok)"
    if not np.isnan(c["sat"]) and c["sat"] < SAT_RETAIN_MIN:
        fails.append("muted")
    return fails, note


def main():
    print(f"{'set/ISO':<11}{'bucket':<8}{'variant':<6}{'Y':>7}{'Cb':>7}{'sat':>7}  verdict")
    print("-" * 66)
    any_fail_cur = any_fail_new = False
    for s, info in SETS.items():
        off_path = f"{SC}/set{s}_cs_off.bin"
        on_path = f"{SC}/set{s}_cs_on.bin"
        new_path = f"{SC}/set{s}_cs_new.bin"
        if not (os.path.exists(off_path) and os.path.exists(on_path) and os.path.exists(new_path)):
            print(f"set{s}/{info['iso']}: missing dumps, skip")
            continue
        cs_off = load_bin_srgb(off_path)
        cs_on_cur = load_bin_srgb(on_path)
        cs_on_new = load_bin_srgb(new_path)
        lr_off = load_tif(info["lr_no"])
        lr_on = load_tif(info["lr_def"])
        lr = measure(lr_off, lr_on)
        cur = measure(cs_off, cs_on_cur)
        new = measure(cs_off, cs_on_new)

        for b in ("shadow", "mid", "high"):
            for variant, m in (("cur", cur[b]), ("new", new[b])):
                fails, note = gate(m, lr[b], info["iso"])
                verdict = ("PASS" + note) if not fails else "FAIL:" + ",".join(fails)
                if fails:
                    if variant == "cur":
                        any_fail_cur = True
                    else:
                        any_fail_new = True

                def f(x):
                    return f"{x:.2f}" if not np.isnan(x) else "  - "
                print(f"{str(s)+'/'+str(info['iso']):<11}{b:<8}{variant:<6}"
                      f"{f(m['y']):>7}{f(m['cb']):>7}{f(m['sat']):>7}  {verdict}")
        if s == TAG_SET:
            for variant, on_img in (("cur", cs_on_cur), ("new", cs_on_new)):
                ratio, s_off, s_on = tag_sat_ratio(cs_off, on_img)
                tag_fail = ratio < TAG_SAT_RETAIN_MIN
                if tag_fail:
                    if variant == "cur":
                        any_fail_cur = True
                    else:
                        any_fail_new = True
                print(f"{'':<11}{'TAG':<8}{variant:<6}{'':>7}{'':>7}{ratio:>7.2f}  "
                      f"{'PASS' if not tag_fail else 'FAIL:desaturated-tag'}")
        print()

    print(f"CURRENT table overall: {'FAIL' if any_fail_cur else 'PASS'}")
    print(f"DERIVED (Step A) table overall: {'FAIL' if any_fail_new else 'PASS'}")


if __name__ == "__main__":
    main()
