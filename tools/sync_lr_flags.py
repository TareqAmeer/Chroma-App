#!/usr/bin/env python3
"""Pull "picked" (green-flag) photos from Lightroom Cloud and mark the same
files as Green-flagged in Chromasmith, by writing/merging the .xmp sidecar
Chromasmith already reads (desktop/src-tauri/src/library.rs: sidecar_path,
Sidecar, write_sidecar).

One-way, pick-flag-only: this script only ever sets label="Green" on a
matched, picked photo. It never writes "Red", never touches rating/favorite,
and never removes an existing flag Chromasmith already has.

--- One-time setup (you do this part, not the script) ---
1. Create a project at https://developer.adobe.com/console with access to the
   "Lightroom APIs" service, and add an OAuth credential.
2. Note the Client ID. An "OAuth Native App" credential (no Client Secret —
   it authenticates with PKCE instead, which this script uses) works fine.
3. Check the credential's configured Redirect URI(s) in the console. Set:
     export LR_CLIENT_ID=...
     export LR_REDIRECT_URI=...   # only if it isn't the default below
4. First run will print a URL to open in a browser; sign in, approve, and
   paste back the redirected URL (or just its `code=` value) when prompted.

--- Usage ---
    python3 tools/sync_lr_flags.py /path/to/local/photo/folder
    python3 tools/sync_lr_flags.py /path/to/local/photo/folder --dry-run
    python3 tools/sync_lr_flags.py /path/to/local/photo/folder --debug-dump 3

Requires: pip install requests
"""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import webbrowser
from pathlib import Path

import requests

CLIENT_ID = os.environ.get("LR_CLIENT_ID", "")
# "OAuth Native App" credentials have no Client Secret (they're public
# clients) — auth uses PKCE instead, which needs no secret.
REDIRECT_URI = os.environ.get("LR_REDIRECT_URI", "https://developer.adobe.com/console/redirect")
SCOPES = "openid,lr_partner_apis,offline_access"
TOKEN_CACHE = Path.home() / ".chromasmith_lr_token.json"

IMS_AUTHORIZE = "https://ims-na1.adobelogin.com/ims/authorize/v2"
IMS_TOKEN = "https://ims-na1.adobelogin.com/ims/token/v3"
LR_API = "https://lr.adobe.io"

PHOTO_EXTS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng", ".rw2", ".raw",
    ".heic", ".heif", ".psd",
}


def strip_xssi(text: str) -> str:
    """Adobe Lightroom API responses are prefixed with `while (1) {}` to
    prevent JSON hijacking in old browsers. Strip it before parsing."""
    return re.sub(r"^while \(1\) \{\}\n?", "", text, count=1)


def require_credentials():
    if not CLIENT_ID:
        sys.exit(
            "Missing LR_CLIENT_ID.\n"
            "Create an OAuth Native App credential at "
            "https://developer.adobe.com/console for the Lightroom APIs, "
            "then:\n"
            "  export LR_CLIENT_ID=...\n"
        )


def make_pkce_pair():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def get_access_token() -> str:
    require_credentials()
    if TOKEN_CACHE.exists():
        cached = json.loads(TOKEN_CACHE.read_text())
        refreshed = refresh_token(cached.get("refresh_token", ""))
        if refreshed:
            return refreshed
    return authorize_new_token()


def refresh_token(refresh_tok: str):
    if not refresh_tok:
        return None
    resp = requests.post(
        IMS_TOKEN,
        data={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_tok,
        },
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    save_token_cache(data)
    return data["access_token"]


def authorize_new_token() -> str:
    verifier, challenge = make_pkce_pair()
    auth_url = (
        f"{IMS_AUTHORIZE}?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}"
        f"&response_type=code&scope={SCOPES}"
        f"&code_challenge={challenge}&code_challenge_method=S256"
    )
    print("Opening browser for Lightroom sign-in...")
    print(f"If it doesn't open automatically, visit:\n  {auth_url}\n")
    webbrowser.open(auth_url)
    redirected = input(
        "After approving, paste the FULL redirected URL (or just the `code` "
        "value) here: "
    ).strip()
    match = re.search(r"[?&]code=([^&\s]+)", redirected)
    code = match.group(1) if match else redirected

    resp = requests.post(
        IMS_TOKEN,
        data={
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    save_token_cache(data)
    return data["access_token"]


def save_token_cache(data: dict):
    TOKEN_CACHE.write_text(json.dumps(data))
    TOKEN_CACHE.chmod(0o600)


def lr_get(path: str, token: str) -> dict:
    resp = requests.get(
        f"{LR_API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "X-API-Key": CLIENT_ID,
        },
    )
    resp.raise_for_status()
    return json.loads(strip_xssi(resp.text))


def get_catalog_id(token: str) -> str:
    catalog = lr_get("/v2/catalog", token)
    return catalog["id"]


def iter_assets(catalog_id: str, token: str):
    """Yield every asset in the catalog, following pagination links."""
    path = f"/v2/catalogs/{catalog_id}/assets?subtype=image&limit=200"
    while path:
        data = lr_get(path, token)
        for res in data.get("resources", []):
            yield res
        next_link = data.get("links", {}).get("next", {}).get("href")
        path = next_link.replace(LR_API, "") if next_link else None


def is_picked(asset: dict) -> bool:
    """Best-effort extraction of Lightroom's pick/flag state.

    ⚠️ Not independently verified against a live catalog (no API credentials
    available in this environment). Checked in priority order:
      1. payload.rating on the asset itself (some Lightroom API responses
         expose flag state directly as 1=picked, -1=rejected, 0/absent=none).
      2. xmp:Rating inside the embedded XMP packet (payload.xmp), same
         convention, in case rating isn't top-level.
    If neither field is what your catalog actually returns, run this script
    once with --debug-dump N to print N raw asset payloads and see the real
    field name/value for a photo you've picked, then fix this one function.
    """
    payload = asset.get("payload", {})
    top_rating = payload.get("rating")
    if isinstance(top_rating, (int, float)):
        return top_rating > 0

    xmp = payload.get("xmp")
    if isinstance(xmp, str):
        m = re.search(r"xmp:Rating[=>]\s*\"?(-?\d+)", xmp)
        if m:
            return int(m.group(1)) > 0
    elif isinstance(xmp, dict):
        rating = xmp.get("xmp", {}).get("Rating") if isinstance(xmp.get("xmp"), dict) else None
        if isinstance(rating, (int, float)):
            return rating > 0

    return False


def asset_filename(asset: dict) -> str:
    payload = asset.get("payload", {})
    imp = payload.get("importSource", {})
    return imp.get("fileName", "")


# --- Sidecar read/write, mirroring desktop/src-tauri/src/library.rs ---

XMP_TEMPLATE = """<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Chromasmith">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:chromasmith="http://chromasmith.app/ns/1.0/" {attrs}/>
 </rdf:RDF>
</x:xmpmeta>
"""


def sidecar_path(photo_path: Path) -> Path:
    return photo_path.with_suffix(".xmp")


def find_description_attrs(text: str):
    """Locate the attribute-string span inside <rdf:Description ... /> or
    <rdf:Description ...>. Returns (start, end, self_closing) or None."""
    m = re.search(r"<rdf:Description\b", text)
    if not m:
        return None
    tag_start = m.end()
    close_self = text.find("/>", tag_start)
    close_open = text.find(">", tag_start)
    if close_self != -1 and (close_open == -1 or close_self < close_open):
        return tag_start, close_self, True
    if close_open != -1:
        return tag_start, close_open, False
    return None


def set_attr(attrs: str, name: str, value):
    """Set/replace/remove one `name="value"` attribute in an attribute string."""
    pattern = re.compile(rf'\s*{re.escape(name)}="[^"]*"')
    attrs = pattern.sub("", attrs)
    if value is not None:
        attrs = f'{attrs} {name}="{value}"'
    return attrs


def has_attr(attrs: str, name: str) -> bool:
    return re.search(rf'\b{re.escape(name)}="', attrs) is not None


def mark_green_flag(photo_path: Path, dry_run: bool) -> str:
    """Set label="Green" in the photo's sidecar, creating or merging as
    needed. Returns "created", "updated", "already-green", or "error:...".
    """
    sc_path = sidecar_path(photo_path)
    existing = sc_path.read_text(encoding="utf-8", errors="replace") if sc_path.exists() else None

    if existing is not None:
        found = find_description_attrs(existing)
        if found:
            start, end, self_closing = found
            attrs = existing[start:end]
            if re.search(r'xmp:Label="Green"', attrs):
                return "already-green"
            if not has_attr(attrs, "xmlns:xmp"):
                attrs = set_attr(attrs, "xmlns:xmp", "http://ns.adobe.com/xap/1.0/")
            if not has_attr(attrs, "xmlns:chromasmith"):
                attrs = set_attr(attrs, "xmlns:chromasmith", "http://chromasmith.app/ns/1.0/")
            if not has_attr(attrs, "rdf:about"):
                attrs = set_attr(attrs, "rdf:about", "")
            attrs = set_attr(attrs, "xmp:Label", "Green")
            closer = "/>" if self_closing else ">"
            tail_start = end + 2 if self_closing else end + 1
            new_text = f"{existing[:start]}{attrs}{closer}{existing[tail_start:]}"
        else:
            # Existing file has no recognizable <rdf:Description> — don't
            # guess at merging into it; write a fresh minimal template
            # instead of risking corrupting an unrelated sidecar format.
            new_text = XMP_TEMPLATE.format(attrs='xmp:Rating="0" xmp:Label="Green"')
    else:
        new_text = XMP_TEMPLATE.format(attrs='xmp:Rating="0" xmp:Label="Green"')

    if dry_run:
        return "updated" if existing else "created"

    sc_path.write_text(new_text, encoding="utf-8")
    return "updated" if existing else "created"


def index_local_photos(folder: Path) -> dict:
    """filename (lowercase) -> Path, for every photo under folder."""
    index = {}
    for root, _dirs, files in os.walk(folder):
        for name in files:
            if Path(name).suffix.lower() in PHOTO_EXTS:
                index.setdefault(name.lower(), Path(root) / name)
    return index


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path, help="Local folder of photos Chromasmith's Library points at")
    ap.add_argument("--dry-run", action="store_true", help="Report what would change without writing files")
    ap.add_argument("--debug-dump", type=int, default=0, metavar="N",
                     help="Print raw JSON for the first N catalog assets and exit (use this if is_picked() picks the wrong field)")
    args = ap.parse_args()

    if not args.folder.is_dir():
        sys.exit(f"Not a folder: {args.folder}")

    token = get_access_token()
    catalog_id = get_catalog_id(token)

    if args.debug_dump:
        for i, asset in enumerate(iter_assets(catalog_id, token)):
            if i >= args.debug_dump:
                break
            print(json.dumps(asset, indent=2))
        return

    local_index = index_local_photos(args.folder)
    print(f"Indexed {len(local_index)} local photo(s) under {args.folder}")

    picked = 0
    matched = 0
    created = 0
    updated = 0
    already = 0
    unmatched = []

    for asset in iter_assets(catalog_id, token):
        if not is_picked(asset):
            continue
        picked += 1
        filename = asset_filename(asset)
        if not filename:
            continue
        local_path = local_index.get(filename.lower())
        if not local_path:
            unmatched.append(filename)
            continue
        matched += 1
        result = mark_green_flag(local_path, args.dry_run)
        if result == "created":
            created += 1
        elif result == "updated":
            updated += 1
        elif result == "already-green":
            already += 1
        else:
            print(f"  ! {local_path}: {result}")

    mode = "DRY RUN — " if args.dry_run else ""
    print(f"\n{mode}Lightroom picked: {picked}")
    print(f"{mode}Matched locally:  {matched}")
    print(f"{mode}  sidecars created: {created}")
    print(f"{mode}  sidecars updated: {updated}")
    print(f"{mode}  already green:    {already}")
    if unmatched:
        print(f"\n{len(unmatched)} picked photo(s) with no local match:")
        for name in unmatched[:20]:
            print(f"  - {name}")
        if len(unmatched) > 20:
            print(f"  ... and {len(unmatched) - 20} more")


if __name__ == "__main__":
    main()
