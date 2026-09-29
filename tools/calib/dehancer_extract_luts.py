"""Standalone, pure-Python colour-LUT extraction for every Dehancer Online film.

Uploads the 33^3 LUT chart ONCE, then for each of the ~67 unique base films (Online's 86
presets collapse to this many once print-profile variants of the same negative are
grouped), exports it through that film with grain/halation/bloom/vignette forced OFF (a
LUT must capture colour only -- halation/bloom are deterministic near bright/dark patch
edges and would corrupt the cube's extreme corners if left on; grain is stochastic and
would mostly cancel in chart_to_lut's inner-50%-mean anyway, but there's no reason to leave
it on), then runs chart_to_lut() and writes a .cube.

Bare-negative presets ("Fujichrome Velvia 50") are preferred over print-baked ones
("Fujichrome Velvia 50 + 2383") when both exist, matching how Chromasmith's own 11 shipped
looks are captured (colour only; print is a separate LUT stage). ~20 films only exist as
print-baked presets on Online -- extracted anyway, with `print_baked` + which print variant
recorded in the manifest so it's usable now and separable later if needed.

Cost: ONE chart upload total (free-tier upload quota is per-upload, not per-export), then
one TIFF export+download per film (~120MB each, ~65 films -> ~8GB, several seconds render +
download time per film).

Run:  python calib/dehancer_extract_luts.py                              # all films
      python calib/dehancer_extract_luts.py "Fujichrome Velvia 50"       # subset (base names)
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from dehancer_online_client import upload_image, load_online_presets, state_for_preset, request_export, download
from chartlut import chart_to_lut, write_cube, DEFAULT_CHART_PATH

HERE = os.path.dirname(os.path.abspath(__file__))
CUBES_DIR = os.path.join(HERE, "dehancer", "cubes")
RENDERS_DIR = os.path.join(HERE, "dehancer", "lut_renders")
MANIFEST_PATH = os.path.join(HERE, "dehancer", "luts_manifest.json")
os.makedirs(CUBES_DIR, exist_ok=True)
os.makedirs(RENDERS_DIR, exist_ok=True)

PRINT_SUFFIX_RE = re.compile(r"\s*\+\s*(2383|3513|Kodak Endura)$")


def base_name(preset_name):
    return PRINT_SUFFIX_RE.sub("", preset_name)


def group_by_base_film(presets):
    """Returns {base_name: chosen_preset_dict}, preferring the bare (non-print) preset
    when the group has one, else the first print-baked variant in API order."""
    groups = {}
    for p in presets:
        groups.setdefault(base_name(p["preset"]), []).append(p)
    chosen = {}
    for base, members in groups.items():
        bare = next((m for m in members if m["preset"] == base), None)
        chosen[base] = bare if bare else members[0]
    return chosen


def safe_filename(name):
    return re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()


def main(film_names=None):
    presets = load_online_presets()
    chosen = group_by_base_film(presets)
    if film_names:
        chosen = {k: v for k, v in chosen.items() if k in film_names}
        missing = set(film_names) - set(chosen.keys())
        if missing:
            raise SystemExit(f"unknown base film name(s): {missing}")

    print_baked_count = sum(1 for p in chosen.values() if p["preset"] != base_name(p["preset"]))
    print(f"extracting {len(chosen)} film(s) ({print_baked_count} print-baked, no bare version available)")

    print("uploading LUT chart (1 upload, reused for every film)...")
    image_id = upload_image(DEFAULT_CHART_PATH)
    print("  imageId:", image_id)

    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as f:
            manifest = json.load(f)
    else:
        manifest = {}

    items = sorted(chosen.items())
    for i, (base, preset) in enumerate(items):
        fname = safe_filename(base)
        cube_path = os.path.join(CUBES_DIR, f"{fname}.cube")
        if base in manifest and os.path.exists(cube_path):
            print(f"[{i+1}/{len(items)}] {base} -- already done, skipping")
            continue

        t0 = time.time()
        try:
            state = state_for_preset(preset, grain=0, halation=0, bloom=0)
            resp = request_export(image_id, state, size="large", fmt="tiff")
            if not resp.get("success"):
                raise RuntimeError(f"export failed: {resp}")
            render_path = os.path.join(RENDERS_DIR, f"{fname}.tiff")
            download(resp["url"], render_path)

            lut = chart_to_lut(render_path)
            write_cube(cube_path, lut, base)
            os.remove(render_path)  # extracted immediately, no need to keep the 120MB TIFF

            print_baked = preset["preset"] != base
            manifest[base] = {
                "preset_used": preset["preset"],
                "print_baked": print_baked,
                "lut_min": float(lut.min()), "lut_max": float(lut.max()),
                "cube": os.path.relpath(cube_path, HERE),
            }
            with open(MANIFEST_PATH, "w") as f:
                json.dump(manifest, f, indent=2)

            dt = time.time() - t0
            tag = " [print-baked]" if print_baked else ""
            print(f"[{i+1}/{len(items)}] {base}{tag} -- done in {dt:.1f}s "
                  f"(range {lut.min():.3f}-{lut.max():.3f})")
        except Exception as e:
            print(f"[{i+1}/{len(items)}] {base} -- FAILED: {e}")

    print(f"\nwrote {len(manifest)} cubes -> {CUBES_DIR}")
    print(f"manifest -> {MANIFEST_PATH}")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args if args else None)
