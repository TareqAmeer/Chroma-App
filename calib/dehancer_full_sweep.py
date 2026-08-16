"""Standalone, pure-Python (no browser, no vision, no Claude involvement) per-film
grain/halation/bloom calibration sweep against Dehancer Online.

Why per-film: Online's render API takes a bare 0-100 number for grain/halation/bloom with
no format/type/hue field (confirmed by reading the request shape in the JS bundle) -- the
"character" (grain coarseness/colour, halation hue/spread, bloom softness) is baked in
server-side per FILM PRESET, not a universal knob. A curve fit while holding preset="X"
constant is X's own character response; it does not transfer to preset "Y". So this script
re-sweeps 0/25/50/75/100 for each of grain/halation/bloom, PER FILM, and fits a separate
power-law curve per film per effect.

Cost: the three calibration charts are uploaded ONCE each (upload count is the only
free-tier-limited quantity per the JS bundle's maxUploadCountDaily) and re-rendered per
film via image/export -- 15 export calls per film (3 effects x 5 amounts), ~15-20s per
film. All N films: ~15N export calls, no re-uploads.

Run:  python calib/dehancer_full_sweep.py                    # all films in online_presets_raw.json
      python calib/dehancer_full_sweep.py "Fujichrome Velvia 50" "Kodak Ektar 100"  # subset
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy.optimize import curve_fit

sys.path.insert(0, os.path.dirname(__file__))
from dehancer_online_client import (
    upload_image, load_online_presets, state_for_preset, request_export, download,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "dehancer", "sweep_renders")
os.makedirs(OUT_DIR, exist_ok=True)

AMOUNTS = [0, 25, 50, 75, 100]

# Charts + measurement geometry (all verified against generator geometry logs -- see
# calib/grain_chart_geo.txt / calib/bloom_chart_geo.txt; halation reuses scorecard.py's
# own zone2 geometry, which was never affected by the grainmodel.py coordinate bug).
GRAIN_CHART = os.path.join(ROOT, "grain-test-2x.png")
HALATION_CHART = os.path.join(ROOT, "IMG_5774_2x.PNG")
BLOOM_CHART = os.path.join(ROOT, "bloom-test-2x.png")

# Gray18 profile block, corrected coordinates (grain_chart_geo.txt: 777,1960,1416,2190;
# inset 30px each side to avoid edge contamination).
GRAIN_RECT = (807, 1990, 1386, 2160)
# ZONE2 white100 bar: gap-strength window just above the bar's top edge (y=840, 2x coords).
HAL_X, HAL_Y_WINDOW = 3600, (790, 840)
# rowA r=40 disc center (bloom_chart_geo.txt), measured 10px beyond the disc edge (r=40).
BLOOM_CX, BLOOM_CY, BLOOM_R = 2060, 900, 40
BLOOM_SAMPLE_DY = 50  # cy + 50 = 10px beyond the r=40 edge


def power_law(x, a, n):
    return a * (x / 100.0) ** n


def measure_grain(path):
    im = np.array(Image.open(path).convert("RGB"), dtype=np.float32)
    x0, y0, x1, y1 = GRAIN_RECT
    region = im[y0:y1, x0:x1]
    return float(region.reshape(-1, 3).std(axis=0)[0])  # R channel


def measure_halation(path):
    im = np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    y0, y1 = HAL_Y_WINDOW
    window = im[y0:y1, HAL_X, 0]
    return float(window.max())


def measure_bloom(path):
    im = np.array(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    v = im[BLOOM_CY + BLOOM_SAMPLE_DY, BLOOM_CX]
    return float(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2])


EFFECTS = {
    "grain": {"chart": "grain", "measure": measure_grain},
    "halation": {"chart": "halation", "measure": measure_halation},
    "bloom": {"chart": "bloom", "measure": measure_bloom},
}


def sweep_one_film(image_ids, preset, out_path):
    """Runs the 5x3 sweep for one film preset. Returns {'grain': {...}, 'halation': {...},
    'bloom': {...}} each with amounts/measured/fit_a/fit_n/film_amount/film_target."""
    result = {}
    for effect_name in ("grain", "halation", "bloom"):
        image_id = image_ids[effect_name]
        measure_fn = EFFECTS[effect_name]["measure"]
        measured = []
        for a in AMOUNTS:
            overrides = {"grain": 0, "halation": 0, "bloom": 0}
            overrides[effect_name] = a
            state = state_for_preset(preset, **overrides)
            resp = request_export(image_id, state, size="large", fmt="jpeg")
            if not resp.get("success"):
                raise RuntimeError(f"export failed ({effect_name}, amount={a}): {resp}")
            out = os.path.join(OUT_DIR, f"{out_path}-{effect_name}-{a}.jpg")
            download(resp["url"], out)
            measured.append(measure_fn(out))
            os.remove(out)  # measured immediately, no need to keep

        amounts_arr = np.array(AMOUNTS, dtype=float)
        measured_arr = np.array(measured, dtype=float)
        try:
            popt, _ = curve_fit(power_law, amounts_arr, measured_arr, p0=[max(measured_arr) or 1.0, 1.0], maxfev=5000)
            fit_a, fit_n = float(popt[0]), float(popt[1])
        except Exception:
            fit_a, fit_n = float(measured_arr[-1]), 1.0  # degenerate fallback (e.g. all-zero)

        film_amount = preset[effect_name] if preset[f"is_{effect_name}_enabled"] else 0
        film_target = power_law(film_amount, fit_a, fit_n)

        result[effect_name] = {
            "amounts": AMOUNTS, "measured": measured,
            "fit_a": fit_a, "fit_n": fit_n,
            "film_amount": film_amount, "film_target": film_target,
        }
    return result


def dedupe_by_effect_signature(presets):
    """Print-profile variants of the same base film (e.g. 'Fujicolor 100 + 3513' vs
    'Fujicolor 100 + Kodak Endura') carry IDENTICAL grain/halation/bloom numbers -- only
    the print stage differs, and print is a post-negative stage that doesn't touch these
    three effects. Group by (grain,halation,bloom,enabled-flags) signature, sweep one
    representative per group, and let the caller copy the result to every name sharing
    that signature. Returns (representatives, {rep_name: [all names sharing its signature]}).
    """
    groups = {}
    for p in presets:
        sig = (p["grain"] if p["is_grain_enabled"] else 0,
               p["halation"] if p["is_halation_enabled"] else 0,
               p["bloom"] if p["is_bloom_enabled"] else 0,
               p["is_grain_enabled"], p["is_halation_enabled"], p["is_bloom_enabled"])
        groups.setdefault(sig, []).append(p)
    reps, alias_map = [], {}
    for sig, members in groups.items():
        rep = members[0]
        reps.append(rep)
        alias_map[rep["preset"]] = [m["preset"] for m in members]
    return reps, alias_map


def main(film_names=None):
    presets = load_online_presets()
    if film_names:
        presets = [p for p in presets if p["preset"] in film_names]
        missing = set(film_names) - {p["preset"] for p in presets}
        if missing:
            raise SystemExit(f"unknown preset name(s): {missing}")

    presets, alias_map = dedupe_by_effect_signature(presets)
    n_aliases = sum(len(v) for v in alias_map.values()) - len(presets)
    print(f"sweeping {len(presets)} unique film(s) "
          f"({n_aliases} print-variant duplicate(s) will reuse the same result)")

    print("uploading calibration charts (3 uploads total, reused for every film)...")
    image_ids = {
        "grain": upload_image(GRAIN_CHART),
        "halation": upload_image(HALATION_CHART),
        "bloom": upload_image(BLOOM_CHART),
    }
    print("  ", image_ids)

    out_json_path = os.path.join(HERE, "dehancer", "film_calibration.json")
    if os.path.exists(out_json_path):
        with open(out_json_path) as f:
            all_results = json.load(f)
    else:
        all_results = {}

    for i, preset in enumerate(presets):
        name = preset["preset"]
        aliases = alias_map.get(name, [name])
        if all(a in all_results for a in aliases):
            print(f"[{i+1}/{len(presets)}] {name} (+{len(aliases)-1} alias) -- already done, skipping")
            continue
        t0 = time.time()
        safe_name = "".join(c if c.isalnum() else "_" for c in name)
        try:
            result = sweep_one_film(image_ids, preset, safe_name)
            for alias_name in aliases:
                all_results[alias_name] = result
            with open(out_json_path, "w") as f:
                json.dump(all_results, f, indent=2)
            dt = time.time() - t0
            g, h, b = result["grain"]["fit_n"], result["halation"]["fit_n"], result["bloom"]["fit_n"]
            alias_note = f" (+{len(aliases)-1} alias)" if len(aliases) > 1 else ""
            print(f"[{i+1}/{len(presets)}] {name}{alias_note} -- done in {dt:.1f}s "
                  f"(exponents: grain={g:.2f} hal={h:.2f} bloom={b:.2f})")
        except Exception as e:
            print(f"[{i+1}/{len(presets)}] {name} -- FAILED: {e}")

    print(f"\nwrote {out_json_path}")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args if args else None)
