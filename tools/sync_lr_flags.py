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
   "Lightroom APIs" service, and add an "OAuth Web App" credential (Native
   App credentials get a fixed, non-editable redirect URI, which doesn't
   work here). Web App gives you a Client ID + Client Secret, and a
   Redirect URI field you can set yourself.
2. Adobe requires that Redirect URI to be https — enter exactly:
     https://127.0.0.1:8723/callback
   (Change the port with `export LR_REDIRECT_PORT=...` if 8723 is taken —
   enter whichever port you pick in the console too.)
3. Set:
     export LR_CLIENT_ID=...
     export LR_CLIENT_SECRET=...
4. First run opens a browser; sign in and approve. The script runs its own
   local HTTPS server (self-signed cert, generated on first use — expect
   one "connection not private" browser warning on the redirect, which is
   expected and safe to click through since it's a cert this script made
   for 127.0.0.1 itself) and catches the code automatically.

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
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urljoin

import requests

CLIENT_ID = os.environ.get("LR_CLIENT_ID", "")
# A "Web App" OAuth credential issues a Client Secret; a "Native App" one
# doesn't (PKCE substitutes for it). This script supports either — set
# LR_CLIENT_SECRET only if your credential has one.
CLIENT_SECRET = os.environ.get("LR_CLIENT_SECRET", "")
# Redirect goes to a tiny local HTTPS server this script runs itself, so the
# auth code is captured automatically — no copy-pasting a URL out of the
# browser. Adobe Web App credentials require an https:// redirect URI, so
# this uses a self-signed cert for 127.0.0.1 (openssl-generated on first
# use) — expect one "connection not private" browser warning to click
# through, since it's a cert this script made for itself, not a real CA.
# This exact URI must be entered as the credential's Redirect URI in
# developer.adobe.com/console.
LOOPBACK_PORT = int(os.environ.get("LR_REDIRECT_PORT", "8723"))
REDIRECT_URI = os.environ.get("LR_REDIRECT_URI", f"https://127.0.0.1:{LOOPBACK_PORT}/callback")
SCOPES = "openid,lr_partner_apis,offline_access"
TOKEN_CACHE = Path.home() / ".chromasmith_lr_token.json"
CERT_DIR = Path.home() / ".chromasmith_lr_cert"

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
            "Create an OAuth Web App credential at "
            "https://developer.adobe.com/console for the Lightroom APIs, "
            "then:\n"
            "  export LR_CLIENT_ID=...\n"
            "  export LR_CLIENT_SECRET=...\n"
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
    data = {
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "refresh_token": refresh_tok,
    }
    if CLIENT_SECRET:
        data["client_secret"] = CLIENT_SECRET
    resp = requests.post(IMS_TOKEN, data=data)
    if resp.status_code != 200:
        return None
    data = resp.json()
    save_token_cache(data)
    return data["access_token"]


def ensure_self_signed_cert() -> tuple:
    """Generate (once, cached) a self-signed TLS cert for 127.0.0.1 via the
    system `openssl` binary (present by default on macOS), so the local
    OAuth-callback server can satisfy Adobe's https-only redirect
    requirement. Returns (cert_path, key_path)."""
    CERT_DIR.mkdir(exist_ok=True)
    cert_path = CERT_DIR / "cert.pem"
    key_path = CERT_DIR / "key.pem"
    if cert_path.exists() and key_path.exists():
        return str(cert_path), str(key_path)
    import subprocess
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", str(key_path), "-out", str(cert_path),
            "-days", "3650", "-nodes",
            "-subj", "/CN=127.0.0.1",
            "-addext", "subjectAltName=IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )
    return str(cert_path), str(key_path)


class _OneShotCallbackServer:
    """Listens on https://127.0.0.1:LOOPBACK_PORT for exactly one OAuth
    redirect, captures ?code=... (or ?error=...) from the request, then
    stops."""

    def __init__(self):
        self.code = None
        self.error = None
        self._server = HTTPServer(("127.0.0.1", LOOPBACK_PORT), self._make_handler())
        import ssl
        cert_path, key_path = ensure_self_signed_cert()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
        self._server.socket = ctx.wrap_socket(self._server.socket, server_side=True)

    def _make_handler(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                qs = parse_qs(urlparse(self.path).query)
                outer.code = qs.get("code", [None])[0]
                outer.error = qs.get("error_description", qs.get("error", [None]))[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                msg = "Signed in — you can close this tab." if outer.code else f"Error: {outer.error}"
                self.wfile.write(f"<html><body>{msg}</body></html>".encode())

            def log_message(self, *a):
                pass  # keep terminal output quiet

        return Handler

    def wait_for_code(self, timeout=180) -> str:
        self._server.timeout = timeout
        self._server.handle_request()  # blocks for exactly one request
        self._server.server_close()
        if self.error:
            sys.exit(f"Lightroom sign-in failed: {self.error}")
        if not self.code:
            sys.exit("Timed out waiting for the browser sign-in redirect.")
        return self.code


def authorize_new_token() -> str:
    verifier, challenge = make_pkce_pair()
    auth_url = (
        f"{IMS_AUTHORIZE}?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}"
        f"&response_type=code&scope={SCOPES}"
        f"&code_challenge={challenge}&code_challenge_method=S256"
    )
    server = _OneShotCallbackServer()
    print("Opening browser for Lightroom sign-in...")
    print(f"If it doesn't open automatically, visit:\n  {auth_url}\n")
    print(f"Waiting on {REDIRECT_URI} for the sign-in redirect "
          f"(make sure this exact URI is an allowed Redirect URI on your Adobe credential)...")
    webbrowser.open(auth_url)
    code = server.wait_for_code()

    token_data = {
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }
    if CLIENT_SECRET:
        token_data["client_secret"] = CLIENT_SECRET
    resp = requests.post(IMS_TOKEN, data=token_data)
    resp.raise_for_status()
    data = resp.json()
    save_token_cache(data)
    return data["access_token"]


def save_token_cache(data: dict):
    TOKEN_CACHE.write_text(json.dumps(data))
    TOKEN_CACHE.chmod(0o600)


def lr_get_url(url: str, token: str) -> dict:
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "X-API-Key": CLIENT_ID,
        },
    )
    resp.raise_for_status()
    return json.loads(strip_xssi(resp.text))


def lr_get(path: str, token: str) -> dict:
    return lr_get_url(f"{LR_API}{path}", token)


def get_catalog_id(token: str) -> str:
    catalog = lr_get("/v2/catalog", token)
    return catalog["id"]


def iter_assets(catalog_id: str, token: str):
    """Yield every asset in the catalog, following pagination links.

    The API's `links.next.href` is resolved with urljoin against the CURRENT
    request's full URL (HAL-style relative resolution), not string-replaced
    against LR_API — the href isn't guaranteed to be an absolute URL
    prefixed with LR_API (naive concatenation produced a corrupt
    "lr.adobe.ioassets" host in testing when the href came back as a bare
    relative path).
    """
    url = f"{LR_API}/v2/catalogs/{catalog_id}/assets?subtype=image&limit=200"
    while url:
        data = lr_get_url(url, token)
        for res in data.get("resources", []):
            yield res
        next_href = data.get("links", {}).get("next", {}).get("href")
        url = urljoin(url, next_href) if next_href else None


def is_picked(asset: dict) -> bool:
    """Extract Lightroom's pick/flag state.

    Confirmed against a real catalog (both an unflagged and a genuinely
    picked asset): the pick/reject flag is NOT the star rating at all —
    `payload.ratings.<userId>.rating` stayed 0 on a photo that was picked.
    The real field is `payload.reviews.<userId>.flag`, one of "pick" /
    "reject" (keyed by the account's own user id, not a fixed field name;
    absent entirely on a photo with no flag either way). Only "pick" counts
    here — this script is pick/green-flag-only by design, so "reject" is
    deliberately ignored, matching Red never being written by this script.
    `ratings`/xmp:Rating are kept as a fallback only, in case some assets
    (e.g. ones flagged long ago, or via Lightroom Classic) still carry a
    star-rating-only convention instead.
    """
    payload = asset.get("payload", {})

    reviews = payload.get("reviews")
    if isinstance(reviews, dict):
        for entry in reviews.values():
            if isinstance(entry, dict) and entry.get("flag") == "pick":
                return True

    ratings = payload.get("ratings")
    if isinstance(ratings, dict):
        for entry in ratings.values():
            if isinstance(entry, dict) and isinstance(entry.get("rating"), (int, float)):
                if entry["rating"] > 0:
                    return True

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


def asset_sha256(asset: dict) -> str:
    payload = asset.get("payload", {})
    imp = payload.get("importSource", {})
    return (imp.get("sha256") or "").lower()


def local_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download_asset(asset: dict, catalog_id: str, token: str, dest_path: Path) -> str:
    """Download one asset's image bytes to dest_path.

    Verified against a real catalog's `links` shape (not `_links` — an
    earlier guess before live data was available): rels are prefixed
    "/rels/..." and hrefs are relative to the catalog's own base path (e.g.
    "assets/<id>/renditions/2048"), not the API root — resolved with urljoin
    against f"{LR_API}/v2/catalogs/{catalog_id}/".
    Tried in preference order: "/rels/master_create" (same URL also serves
    GET for the original file despite the "_create" name — REST-style
    verb-overloading) then the largest observed JPEG proxy renditions. A
    master GET may require extra Adobe approval beyond the basic Lightroom
    API scope — if it's absent or errors, this falls back to a JPEG proxy,
    which is enough to grade in Chromasmith but is NOT the original file
    bit-for-bit.
    Returns the rendition kind actually used, or "error:<reason>".
    """
    links = asset.get("links", {})
    base = f"{LR_API}/v2/catalogs/{catalog_id}/"
    candidates = [
        "/rels/master_create",
        "/rels/rendition_type/2048",
        "/rels/rendition_type/1280",
        "/rels/rendition_type/640",
    ]
    for key in candidates:
        link = links.get(key)
        if not link:
            continue
        href = link.get("href", "")
        if not href:
            continue
        url = urljoin(base, href)
        resp = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}", "X-API-Key": CLIENT_ID},
        )
        if resp.status_code == 200 and resp.content:
            dest_path.write_bytes(resp.content)
            return key
    return "error:no usable rendition link"


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


def clear_green_flag(photo_path: Path, dry_run: bool) -> str:
    """Remove label="Green" from the photo's sidecar (only that one
    attribute — every other field, including recipe/versions/keywords, is
    left untouched). Returns "cleared", "was-not-green", or "error:...".
    Used only by --fix-audit, to undo Green flags a previous buggy run of
    this script wrote incorrectly.
    """
    sc_path = sidecar_path(photo_path)
    if not sc_path.exists():
        return "was-not-green"
    existing = sc_path.read_text(encoding="utf-8", errors="replace")
    found = find_description_attrs(existing)
    if not found:
        return "was-not-green"
    start, end, self_closing = found
    attrs = existing[start:end]
    if 'xmp:Label="Green"' not in attrs:
        return "was-not-green"
    attrs = set_attr(attrs, "xmp:Label", None)
    closer = "/>" if self_closing else ">"
    tail_start = end + 2 if self_closing else end + 1
    new_text = f"{existing[:start]}{attrs}{closer}{existing[tail_start:]}"
    if dry_run:
        return "cleared"
    sc_path.write_text(new_text, encoding="utf-8")
    return "cleared"


def is_sidecar_green(photo_path: Path) -> bool:
    sc_path = sidecar_path(photo_path)
    if not sc_path.exists():
        return False
    text = sc_path.read_text(encoding="utf-8", errors="replace")
    found = find_description_attrs(text)
    if not found:
        return False
    start, end, _self_closing = found
    return 'xmp:Label="Green"' in text[start:end]


def find_all_green_photos(folder: Path):
    """Every photo under folder whose sidecar currently has label=Green."""
    for root, _dirs, files in os.walk(folder):
        for name in files:
            if Path(name).suffix.lower() in PHOTO_EXTS:
                p = Path(root) / name
                if is_sidecar_green(p):
                    yield p


def index_local_photos(folder: Path) -> dict:
    """Exact filename INCLUDING extension (lowercase) -> list of matching Paths.

    Keyed by the full filename, not just the stem: a RAW asset (e.g.
    "P_TM1448.RW2") and its JPEG sibling ("P_TM1448.jpg") are two SEPARATE
    Lightroom assets with their own independent pick state — matching by
    stem alone would flag one file whenever EITHER was picked, which is
    wrong when only one of the two actually was. A list (not a single Path)
    still lets the caller detect a genuine same-exact-filename collision
    (e.g. a camera filename counter repeating across two different import
    sessions/dates) and disambiguate it by content hash instead of guessing.
    """
    index: dict = {}
    for root, _dirs, files in os.walk(folder):
        for name in files:
            if Path(name).suffix.lower() in PHOTO_EXTS:
                index.setdefault(name.lower(), []).append(Path(root) / name)
    return index


def resolve_candidates(filename: str, asset: dict, local_index: dict, hash_cache: dict):
    """Resolve a Lightroom asset's filename to local file(s), the single
    matching logic shared by the sync path and --audit so they can never
    disagree. Returns (resolved_paths, unresolved_collision, raw_candidates).
    resolved_paths is [] when nothing local matches, or when a same-exact-
    filename collision couldn't be disambiguated by content hash (in which
    case unresolved_collision is True and raw_candidates holds every
    same-named file found, for reporting).
    """
    def cached_hash(path: Path) -> str:
        if path not in hash_cache:
            hash_cache[path] = local_sha256(path)
        return hash_cache[path]

    candidates = local_index.get(filename.lower(), [])
    if len(candidates) <= 1:
        return candidates, False, candidates

    want_hash = asset_sha256(asset)
    exact = [p for p in candidates if want_hash and cached_hash(p) == want_hash] if want_hash else []
    if len(exact) == 1:
        return exact, False, candidates
    return [], True, candidates


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path, nargs="?", default=None,
                     help="Local folder to flag matches in, and to download newly-picked "
                          "photos into (not needed with --debug-dump). Created if missing.")
    ap.add_argument("--dry-run", action="store_true", help="Report what would change without writing/downloading anything")
    ap.add_argument("--no-download", action="store_true",
                     help="Only flag photos already present in `folder`; skip downloading picked-but-missing ones "
                          "from Lightroom Cloud")
    ap.add_argument("--debug-dump", type=int, default=0, metavar="N",
                     help="Print raw JSON for the first N catalog assets and exit (use this if is_picked() picks the wrong field) — no local folder needed")
    ap.add_argument("--find-filename", type=str, default=None, metavar="NAME",
                     help="Print the full raw JSON for any asset whose filename contains NAME "
                          "(case-insensitive) and exit — no local folder needed. Use this to "
                          "inspect one photo you've actually picked/flagged in Lightroom.")
    ap.add_argument("--audit", action="store_true",
                     help="Cross-check every LOCAL file already flagged Green under `folder` against "
                          "the current real picked set from Lightroom, and report any that don't "
                          "correspond to an actual current pick (does not modify anything — use this "
                          "to find leftover incorrect flags from a previous buggy run).")
    ap.add_argument("--fix-audit", action="store_true",
                     help="Like --audit, but actually CLEARS the Green flag (only the label — nothing "
                          "else in the sidecar) from every file that doesn't correspond to a current "
                          "pick. Combine with --dry-run first to preview the exact list before writing.")
    args = ap.parse_args()

    token = get_access_token()
    catalog_id = get_catalog_id(token)

    if args.debug_dump:
        for i, asset in enumerate(iter_assets(catalog_id, token)):
            if i >= args.debug_dump:
                break
            print(json.dumps(asset, indent=2))
        return

    if args.find_filename:
        needle = args.find_filename.lower()
        found_any = False
        scanned = 0
        for asset in iter_assets(catalog_id, token):
            scanned += 1
            if scanned % 1000 == 0:
                print(f"  ...scanned {scanned} assets so far", file=sys.stderr)
            if needle in asset_filename(asset).lower():
                found_any = True
                print(json.dumps(asset, indent=2))
                break  # stop at the first match instead of walking the whole catalog
        if not found_any:
            print(f"No asset filename contains {args.find_filename!r} (scanned {scanned} assets)")
        return

    if args.folder is None:
        sys.exit("A folder is required (it's where flagged photos get downloaded to/flagged in).")

    if args.audit or args.fix_audit:
        if not args.folder.is_dir():
            sys.exit(f"Not a folder: {args.folder}")
        local_index = index_local_photos(args.folder)
        print(f"Indexed {len(local_index)} local photo(s) under {args.folder}")

        # Build the set of local paths that SHOULD currently be Green,
        # using the exact same resolution logic the sync path uses.
        hash_cache: dict = {}
        should_be_green = set()
        scanned = 0
        for asset in iter_assets(catalog_id, token):
            scanned += 1
            if scanned % 2000 == 0:
                print(f"  ...scanned {scanned} Lightroom assets so far", file=sys.stderr)
            if not is_picked(asset):
                continue
            filename = asset_filename(asset)
            if not filename:
                continue
            candidates, _unresolved, _raw = resolve_candidates(filename, asset, local_index, hash_cache)
            should_be_green.update(candidates)

        print(f"\n{len(should_be_green)} local file(s) currently correspond to a real Lightroom pick.")
        print("Checking every locally Green-flagged file against that set...")

        suspicious = []
        for green_path in find_all_green_photos(args.folder):
            if green_path not in should_be_green:
                suspicious.append(green_path)

        if not suspicious:
            print("\nNo suspicious Green flags found — every Green-flagged local file matches a real pick.")
            return

        if not args.fix_audit:
            print(f"\n{len(suspicious)} local file(s) are Green-flagged but do NOT correspond to a "
                  f"current Lightroom pick (verify these — a previous run's bug may have flagged them "
                  f"incorrectly; this audit did not change anything):")
            for p in suspicious:
                print(f"  - {p}")
            return

        mode = "DRY RUN — " if args.dry_run else ""
        print(f"\n{mode}Clearing Green from {len(suspicious)} incorrectly-flagged file(s)...")
        cleared = 0
        for p in suspicious:
            result = clear_green_flag(p, args.dry_run)
            if result == "cleared":
                cleared += 1
            else:
                print(f"  ! {p}: {result}")
        print(f"{mode}Cleared: {cleared}")
        return

    if not args.dry_run:
        args.folder.mkdir(parents=True, exist_ok=True)

    local_index = index_local_photos(args.folder) if args.folder.is_dir() else {}
    print(f"Indexed {len(local_index)} local photo(s) under {args.folder}")

    picked = 0
    matched = 0  # picked photos with at least one local file flagged
    downloaded = 0
    created = 0
    updated = 0
    already = 0
    unmatched = []
    multi_match = []  # same-exact-filename collisions the sha256 check couldn't resolve — skipped, not flagged

    hash_cache: dict = {}

    scanned = 0
    for asset in iter_assets(catalog_id, token):
        scanned += 1
        if scanned % 2000 == 0:
            print(f"  ...scanned {scanned} Lightroom assets so far", file=sys.stderr)
        if not is_picked(asset):
            continue
        picked += 1
        filename = asset_filename(asset)
        if not filename:
            continue
        candidates, unresolved_collision, raw_candidates = resolve_candidates(
            filename, asset, local_index, hash_cache)
        if unresolved_collision:
            multi_match.append((filename, raw_candidates))

        if candidates:
            local_paths = candidates
        elif unresolved_collision:
            # A local file DOES exist here, just ambiguously — never
            # download a spurious extra copy on top of it.
            continue
        else:
            if args.no_download:
                unmatched.append(filename)
                continue
            local_path = args.folder / filename
            if args.dry_run:
                print(f"  would download: {filename}")
                downloaded += 1
            else:
                dl_result = download_asset(asset, catalog_id, token, local_path)
                if dl_result.startswith("error:"):
                    print(f"  ! {filename}: {dl_result}")
                    unmatched.append(filename)
                    continue
                print(f"  downloaded ({dl_result}): {filename}")
                downloaded += 1
            local_paths = [local_path]

        matched += 1
        for local_path in local_paths:
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
    print(f"{mode}Matched/handled:  {matched}")
    print(f"{mode}  newly downloaded: {downloaded}")
    print(f"{mode}  sidecars created: {created}")
    print(f"{mode}  sidecars updated: {updated}")
    print(f"{mode}  already green:    {already}")
    if unmatched:
        print(f"\n{len(unmatched)} picked photo(s) could not be handled:")
        for name in unmatched[:20]:
            print(f"  - {name}")
        if len(unmatched) > 20:
            print(f"  ... and {len(unmatched) - 20} more")
    if multi_match:
        print(f"\n{len(multi_match)} picked photo(s) hit a same-exact-filename collision that "
              f"content-hash couldn't resolve (SKIPPED — not flagged, needs a manual look):")
        for name, paths in multi_match[:20]:
            print(f"  - {name}:")
            for p in paths:
                print(f"      {p}")
        if len(multi_match) > 20:
            print(f"  ... and {len(multi_match) - 20} more")


if __name__ == "__main__":
    main()
