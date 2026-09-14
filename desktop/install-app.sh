#!/bin/bash
# Build the desktop app and register the ONE canonical bundle in place at
# src-tauri/target/release/bundle/macos/Chromasmith.app — no copy is made anywhere
# (2026-09-14 scope decision: the release build output IS the app).
#
# Why a single registered bundle still matters (learned the hard way, 2026-07-23): macOS Launch
# Services routes the Adobe OAuth custom-scheme callback (adobe+…://) to ANY registered copy of
# the app. Stray registrations — a second installed copy — made the callback launch a SECOND
# Chromasmith instance that could never finish the sign-in (the PKCE verifier lives in the
# instance that started it). Exactly one bundle stays registered: this one, in place.
set -euo pipefail
cd "$(dirname "$0")"

npm run build

APP="$(cd "$(dirname "$0")" && pwd)/src-tauri/target/release/bundle/macos/Chromasmith.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

"$LSREG" -f "$APP"

echo "Registered \"$APP\" (sole Launch Services registrant)."
echo "Fully quit (⌘Q) any running Chromasmith before testing native changes."
