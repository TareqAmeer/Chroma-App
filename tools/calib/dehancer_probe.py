#!/usr/bin/env python3
"""Read-only probe of Dehancer Desktop's local, unencrypted metadata.

Extracts (no automation, no exports, no app running needed):
  - calib/dehancer/films.json           the 63 film profiles' metadata (id, caption,
                                         ISO_index, expand_impact/mode, film_type,
                                         color_type, tags, license_matrix, .mlut hash)
  - calib/dehancer/effect_profiles.json  every halation/bloom/grain/damage variant from
                                         the app bundle, keyed by format (and ISO for grain)

Nothing here touches the encrypted .mlut CLUT payloads or exports any pixels — this is
pure JSON/SQLite/MessagePack parsing. See calib/dehancer_defaults_probe.py for the
empirical "is halation per-film?" probe, and CLAUDE.md / the plan for context.

Run from repo root (venv active):  python calib/dehancer_probe.py
"""
import json
import os
import sqlite3

import msgpack

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "dehancer")
os.makedirs(OUT, exist_ok=True)

APP_RESOURCES = "/Applications/Dehancer Desktop.app/Contents/Resources"
FILM_DB = os.path.expanduser(
    "~/Library/Application Support/com.dehancer.desktop.v7/film_profiles_1_4.db"
)

EFFECT_DIRS = {
    "halation": "index_film.json",
    "bloom": "index_film.json",
    "grain": "index_film.json",
    "film_breath": "index_film.json",
    "gate_weave": "index_film.json",
    "damage": ["index_dirt.json", "index_photo_dirt.json"],
}


def probe_films():
    """film_profiles_1_4.db: profiles.data is MessagePack, unencrypted."""
    con = sqlite3.connect(f"file:{FILM_DB}?mode=ro", uri=True)
    rows = con.execute(
        'select "index",id,caption,hash,revision,is_actual,data from profiles'
    ).fetchall()
    con.close()

    films = []
    for idx, pid, caption, hash_, revision, is_actual, data in rows:
        meta = msgpack.unpackb(data, raw=False)
        films.append(
            {
                "index": idx,
                "id": pid,
                "caption": caption,
                "hash": hash_,
                "revision": revision,
                "is_actual": bool(is_actual),
                "iso_index": meta.get("ISO_index"),
                "expand_impact": meta.get("expand_impact"),
                "expand_mode": meta.get("expand_mode"),
                "film_type": meta.get("film_type"),
                "color_type": meta.get("color_type"),
                "tags": meta.get("tags"),
                "author": meta.get("author"),
                "maintainer": meta.get("maintainer"),
                "license_matrix": meta.get("license_matrix"),
                "is_published": meta.get("is_published"),
                "local_path": meta.get("local_path"),
                "mlut_hash": meta.get("local_path", "").rsplit("/", 1)[-1].split(".")[0]
                if meta.get("local_path")
                else None,
            }
        )
    films.sort(key=lambda f: f["id"])
    return films


def val(x):
    """Unwrap Dehancer's {value,min,max} slider dicts to the bare float, recursively."""
    if isinstance(x, dict):
        if "value" in x and set(x.keys()) <= {"value", "min", "max"}:
            return x["value"]
        return {k: val(v) for k, v in x.items()}
    if isinstance(x, list):
        return [val(v) for v in x]
    return x


def probe_effect_index(path):
    d = json.load(open(path))
    group = d.get("film") or next(iter(d.values()))
    return {
        "default_id": group.get("default_id"),
        "profiles": {p["id"]: {"name": p["name"], **val(p["profile"])} for p in group["profiles"]},
    }


def probe_effects():
    out = {}
    for name, files in EFFECT_DIRS.items():
        files = files if isinstance(files, list) else [files]
        out[name] = {}
        for fn in files:
            path = os.path.join(APP_RESOURCES, "profiles", name, fn)
            if not os.path.exists(path):
                continue
            key = fn.replace("index_", "").replace(".json", "")
            out[name][key] = probe_effect_index(path)
    return out


def main():
    films = probe_films()
    films_path = os.path.join(OUT, "films.json")
    json.dump(films, open(films_path, "w"), indent=1)
    print(f"films.json: {len(films)} films -> {films_path}")

    effects = probe_effects()
    effects_path = os.path.join(OUT, "effect_profiles.json")
    json.dump(effects, open(effects_path, "w"), indent=1)
    print(f"effect_profiles.json -> {effects_path}")
    for name, groups in effects.items():
        for key, g in groups.items():
            print(f"  {name}/{key}: default={g['default_id']} n={len(g['profiles'])}")

    # Spot check: the .mlut hash we derive from local_path must match the file actually
    # on disk (proves local_path parsing is correct — this is the field the Part 2 export
    # pipeline keys off). NOTE: ISO_index is 0 for all 63 films in this catalog (verified
    # separately) — it is not a per-film ISO value despite the name; do not spot-check it.
    ektar = next((f for f in films if f["id"] == "kodak-ektar-100"), None)
    if ektar:
        on_disk = os.path.exists(
            os.path.expanduser(
                f"~/Library/Application Support/com.dehancer.desktop.v7/LUTs/film/"
                f"{ektar['mlut_hash']}.mlut"
            )
        )
        ok = ektar["mlut_hash"] == "424663398757751091" and on_disk
        print(f"\nspot-check kodak-ektar-100: mlut_hash={ektar['mlut_hash']} "
              f"on_disk={on_disk} -> {'PASS' if ok else 'FAIL'}")
    else:
        print("\nspot-check kodak-ektar-100: NOT FOUND")

    iso_values = {f["iso_index"] for f in films}
    if iso_values == {0}:
        print("NOTE: ISO_index is constant (0) across all films — not a usable per-film "
              "signal. film_type/color_type do vary; see films.json.")


if __name__ == "__main__":
    main()
