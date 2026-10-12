#!/bin/bash
# Build the desktop app and register the ONE canonical bundle in place at
# the build's real output (see scripts/cargo-target.mjs) — no copy is made anywhere
# (2026-09-14 scope decision: the release build output IS the app).
#
# Why a single registered bundle still matters (learned the hard way, 2026-07-23): macOS Launch
# Services routes the Adobe OAuth custom-scheme callback (adobe+…://) to ANY registered copy of
# the app. Stray registrations — a second installed copy — made the callback launch a SECOND
# Chromasmith instance that could never finish the sign-in (the PKCE verifier lives in the
# instance that started it). Exactly one bundle stays registered: this one, in place.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

npm run build

# The build's real output dir comes from scripts/cargo-target.mjs (npm run build sets CARGO_TARGET_DIR
# to it — a shared ~/.cache dir, NOT the repo-local src-tauri/target). Resolving it from the same
# module is what keeps this script, tools/diagnostics and the test probes from launching a stale copy.
APP="$(node "$SCRIPT_DIR/../scripts/cargo-target.mjs" bundle)"
EXE="$APP/Contents/MacOS/chromasmith"
LEGACY="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/Chromasmith.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

[ -x "$EXE" ] || { echo "build output missing: $EXE" >&2; exit 1; }
# A pre-shared-cache repo-local bundle would be a second registrant (Adobe OAuth callback bug, see
# above) and a stale binary for anything that still hardcodes its path — unregister it.
if [ "$LEGACY" != "$APP" ] && [ -d "$LEGACY" ]; then
  "$LSREG" -u "$LEGACY" || true
  echo "Unregistered stale repo-local bundle: $LEGACY"
fi
"$LSREG" -f "$APP"

# Prove the registered binary is the one just built (a build older than this script run = stale).
BUILT_AT=$(stat -f %m "$EXE")
if [ $(( $(date +%s) - BUILT_AT )) -gt 3600 ]; then
  echo "WARNING: $EXE was not rebuilt in the last hour (mtime $(date -r "$BUILT_AT"))" >&2
fi
echo "Registered \"$APP\" (sole Launch Services registrant)."
echo "Binary: $(date -r "$BUILT_AT")  sha256 $(shasum -a 256 "$EXE" | cut -c1-16)"
echo "Fully quit (⌘Q) any running Chromasmith before testing native changes."
