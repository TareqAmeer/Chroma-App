#!/bin/bash
# Build the desktop app and install it as the ONE canonical bundle at /Applications.
#
# Why this script exists (learned the hard way, 2026-07-23): macOS Launch Services routes the
# Adobe OAuth custom-scheme callback (adobe+…://) to ANY registered copy of the app. Stray
# registrations — the target/release build output, a repo-root duplicate, apps inside mounted
# build DMGs — made the callback launch a SECOND Chromasmith instance that could never finish
# the sign-in (the PKCE verifier lives in the instance that started it). Exactly one bundle
# may stay registered: /Applications/Chromasmith.app. "Chromasmith copy.app" in the repo root
# (Lightroom's Edit-In target) is a SYMLINK to it — do not replace it with a real copy.
set -euo pipefail
cd "$(dirname "$0")"

npm run build

APP=src-tauri/target/release/bundle/macos/Chromasmith.app
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

ditto "$APP" /Applications/Chromasmith.app
# The build output must NOT stay registered with Launch Services (it competes for the OAuth
# scheme); the DMG target is disabled in tauri.conf.json for the same reason.
"$LSREG" -u "$(cd "$(dirname "$APP")" && pwd)/Chromasmith.app" 2>/dev/null || true
"$LSREG" -f /Applications/Chromasmith.app

echo "Installed /Applications/Chromasmith.app (sole Launch Services registrant)."
echo "Fully quit (⌘Q) any running Chromasmith before testing native changes."

