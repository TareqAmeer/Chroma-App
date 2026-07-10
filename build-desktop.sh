#!/bin/bash
# Stage the web app into desktop/dist/ for the Tauri macOS shell.
# desktop/dist/ is generated — never edit it, never point frontendDist at the repo root
# (calib/ and the Python tooling must not ship inside the app bundle).
#
# Unlike the iOS build, coi-serviceworker.min.js is NOT staged here: it exists only to work
# around GitHub Pages being unable to set custom response headers. Tauri sets the required
# Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers natively
# (desktop/src-tauri/tauri.conf.json -> app.security.headers), so the shim would be inert
# (and its self-reload-once logic is simply unneeded weight here).
set -euo pipefail
cd "$(dirname "$0")"

rm -rf desktop/dist
mkdir -p desktop/dist
cp chromasmith-22.html desktop/dist/index.html
cp -R vendor desktop/dist/vendor
cp desktop/desktop-native.js desktop/dist/desktop-native.js
cp desktop/library-ui.js desktop/dist/library-ui.js

# Inject the native-shell glue scripts right before </body>, WITHOUT touching the source
# chromasmith-22.html (it stays a platform-agnostic single file for web/iOS). Native-only
# concerns (traffic-light spacing, window drag region, menu-bar wiring, the Library folder
# browser) live entirely in these injected scripts and only run when window.__TAURI__ is
# present. library-ui.js loads after desktop-native.js (it calls loadFXImages, a global
# desktop-native.js also relies on, and reads window.chromasmithToggleLibrary's caller wiring
# from it) — order matters less than both being present, but keep it for clarity.
python3 - <<'PY'
p = "desktop/dist/index.html"
html = open(p, encoding="utf-8").read()
# rfind, not the first match: a Google-Photos OAuth popup string earlier in the file
# contains a literal "</body>" substring (see chromasmith-22.html's _GP_CB handler),
# which a naive first-match replace grabbed instead of the real closing tag.
idx = html.rfind("</body>")
assert idx != -1, "index.html has no </body> to inject before"
tags = '<script src="desktop-native.js"></script>\n<script src="library-ui.js"></script>\n'
html = html[:idx] + tags + html[idx:]
open(p, "w", encoding="utf-8").write(html)
PY

echo "desktop/dist/ staged: $(du -sh desktop/dist | cut -f1)"
