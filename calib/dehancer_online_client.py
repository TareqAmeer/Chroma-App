"""Plain-HTTP client for online.dehancer.com's upload -> render/export API.

Reverse-engineered by reading assets/index-*.js (string search only) and then confirmed
empirically against the live API -- see calib/dehancer/ONE_FILM_GATE.md and the plan notes
for the walkthrough. No browser, no vision, no computer-use needed once this works:
everything is `requests` calls.

Flow:
    1. POST /api/v1/upload/prepare {mimetype, size} -> {imageId, uploadId?, chunkSize, urls}
    2. PUT file bytes to each url in `urls` (chunked if chunkSize is set) -> collect etags
    3. POST /api/v1/upload/finish {imageId, etags, filename[, uploadId]}
    4. POST /api/v1/image/export/<imageId> {imageId, size, state, format} -> {success, url}
       (a pre-signed S3 GET URL, valid ~5min) or /image/render/<imageId> for a cheaper
       preview-grade JPEG (same body shape, no `format`).

Empirically confirmed quirks (not visible from reading the JS alone):
    - upload/finish: omit `uploadId` entirely when it's None (a single-part upload) --
      sending it as JSON null fails FST_ERR_VALIDATION (expects a string).
    - render/export take a SINGULAR `state` object; the /image/previews/<id> multi-image
      endpoint (not used here) takes a `states` ARRAY instead -- different shape.
    - export requires a `format` field: "tiff" | "jpeg" | "web".
    - **`state.preset` must be a real preset name.** Omitting it (e.g. to request an
      untouched "identity" render) makes the server hang and eventually respond
      `{"success": false, "error": "Timed out"}` after ~50s -- there's no way to get a
      true no-preset render through this endpoint. If you need an identity/no-film
      reference, get it from the app UI directly (Part 1 used a manual Desktop export for
      this reason) -- don't retry with a missing preset expecting it to work.

Free-tier upload quota exists (maxUploadCountDaily in the JS bundle) -- don't batch-upload
carelessly; this module uploads once per call and lets the caller decide how many times to
run it.
"""
import json
import mimetypes
import os

import requests

HERE = os.path.dirname(__file__)
BASE = "https://online.dehancer.com/api/v1"
ONLINE_PRESETS_PATH = os.path.join(HERE, "dehancer", "online_presets_raw.json")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "chromasmith-calib/1.0"})


def load_online_presets():
    with open(ONLINE_PRESETS_PATH) as f:
        return json.load(f)["presets"]


def preset_by_name(name):
    presets = load_online_presets()
    for p in presets:
        if p["preset"] == name:
            return p
    raise KeyError(f"no such preset: {name!r}")


def state_for_preset(preset, sequence=0, **overrides):
    """Mirrors translatePaneObjectToApiRequestStructure() in the online bundle: zero out
    an effect if its is_*_enabled flag is false, otherwise use its slider value. `overrides`
    lets a caller sweep one field (e.g. grain=0..100) while keeping the rest of a real
    preset's values -- used by the render-calibration sweep."""
    state = {
        "preset": preset["preset"],
        "contrast": preset["contrast"],
        "exposure": preset["exposure"],
        "temperature": preset["temperature"],
        "tint": preset["tint"],
        "color_boost": preset["color_boost"],
        "bloom": preset["bloom"] if preset["is_bloom_enabled"] else 0,
        "halation": preset["halation"] if preset["is_halation_enabled"] else 0,
        "grain": preset["grain"] if preset["is_grain_enabled"] else 0,
        "vignette_exposure": preset["vignette_exposure"] if preset["is_vignette_enabled"] else 0,
        "vignette_feather": preset["vignette_feather"],
        "vignette_size": preset["vignette_size"],
        "sequence": sequence,
    }
    state.update(overrides)
    return state


def upload_image(path):
    """Runs prepare -> PUT -> finish. Returns imageId. Raises on any failure so a bad
    upload never silently proceeds to render calls."""
    size = os.path.getsize(path)
    mimetype = mimetypes.guess_type(path)[0] or "image/png"

    r = SESSION.post(f"{BASE}/upload/prepare", json={"mimetype": mimetype, "size": size})
    r.raise_for_status()
    prep = r.json()
    if not prep.get("success"):
        raise RuntimeError(f"upload/prepare failed: {prep}")

    image_id = prep["imageId"]
    upload_id = prep.get("uploadId")
    urls = prep["urls"]
    chunk_size = prep.get("chunkSize")

    with open(path, "rb") as f:
        data = f.read()

    etags = []
    if chunk_size and len(urls) > 1:
        for i, url in enumerate(urls):
            start, end = i * chunk_size, min(len(data), (i + 1) * chunk_size)
            chunk = data[start:end]
            resp = SESSION.put(url, data=chunk)
            resp.raise_for_status()
            etags.append(resp.headers.get("ETag", "").strip('"'))
    else:
        resp = SESSION.put(urls[0], data=data)
        resp.raise_for_status()
        etags.append(resp.headers.get("ETag", "").strip('"'))

    finish_body = {
        "imageId": image_id,
        "etags": etags,
        "filename": os.path.basename(path),
    }
    if upload_id is not None:
        finish_body["uploadId"] = upload_id
    r = SESSION.post(f"{BASE}/upload/finish", json=finish_body)
    r.raise_for_status()
    fin = r.json()
    if not fin.get("success"):
        raise RuntimeError(f"upload/finish failed: {fin}")

    return image_id


def request_render(image_id, state, size="large"):
    """Cheaper preview-grade JPEG. `state` must include a real `preset` name (see module
    docstring -- omitting it hangs). Returns the parsed JSON; `resp['url']` is a
    pre-signed GET URL valid for a few minutes."""
    body = {"imageId": image_id, "size": size, "state": state}
    r = SESSION.post(f"{BASE}/image/render/{image_id}", json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def request_export(image_id, state, size="large", fmt="tiff"):
    """Full-quality export. fmt: 'tiff' | 'jpeg' | 'web'. Same `state.preset` requirement
    as request_render. Returns the parsed JSON with a pre-signed GET URL."""
    body = {"imageId": image_id, "size": size, "state": state, "format": fmt}
    r = SESSION.post(f"{BASE}/image/export/{image_id}", json=body, timeout=120)
    r.raise_for_status()
    return r.json()


def download(url, out_path):
    r = SESSION.get(url, timeout=120)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        f.write(r.content)
    return out_path


def get_image_info(image_id):
    r = SESSION.get(f"{BASE}/image/info/{image_id}")
    r.raise_for_status()
    return r.json()


def export_chart_for_preset(chart_path, preset_name, out_path, fmt="tiff"):
    """End-to-end convenience: upload a chart once, export it through one preset, download
    the result. For sweeping many presets against the SAME chart, upload once with
    upload_image() and call request_export() directly per preset instead -- re-uploading
    burns the free-tier daily quota for no reason."""
    image_id = upload_image(chart_path)
    preset = preset_by_name(preset_name)
    state = state_for_preset(preset)
    resp = request_export(image_id, state, fmt=fmt)
    if not resp.get("success"):
        raise RuntimeError(f"export failed: {resp}")
    download(resp["url"], out_path)
    return out_path


if __name__ == "__main__":
    chart_path = os.path.join(HERE, "dehancer", "chromasmith_lut_chart.png")
    out_path = os.path.join(HERE, "dehancer", "auto_velvia50_chart_v2.tiff")
    print("uploading + exporting Fujichrome Velvia 50 through", chart_path)
    export_chart_for_preset(chart_path, "Fujichrome Velvia 50", out_path)
    print("saved", out_path)
