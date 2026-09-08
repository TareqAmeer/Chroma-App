#!/bin/bash
# Build the desktop app and install it as the ONE canonical bundle at
# "<repo root>/Chromasmith copy.app" — no longer /Applications (2026-09-08 scope decision: only
# the copy inside this repo matters now).
#
# Why a single canonical bundle still matters (learned the hard way, 2026-07-23): macOS Launch
# Services routes the Adobe OAuth custom-scheme callback (adobe+…://) to ANY registered copy of
# the app. Stray registrations — the target/release build output, a second installed copy — made
# the callback launch a SECOND Chromasmith instance that could never finish the sign-in (the PKCE
# verifier lives in the instance that started it). Exactly one bundle stays registered: the repo
# copy this script installs.
set -euo pipefail
cd "$(dirname "$0")"

npm run build

APP=src-tauri/target/release/bundle/macos/Chromasmith.app
DEST="$(cd .. && pwd)/Chromasmith copy.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

ditto "$APP" "$DEST"
# The build output must NOT stay registered with Launch Services (it competes for the OAuth
# scheme); the DMG target is disabled in tauri.conf.json for the same reason.
"$LSREG" -u "$(cd "$(dirname "$APP")" && pwd)/Chromasmith.app" 2>/dev/null || true
"$LSREG" -f "$DEST"

echo "Installed \"$DEST\" (sole Launch Services registrant)."
echo "Fully quit (⌘Q) any running Chromasmith before testing native changes."
