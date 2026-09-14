#!/bin/bash
# Thin wrapper kept for anyone still typing `./build-desktop.sh` out of habit, and for anything
# that still shells out to it directly. The real staging logic is scripts/build-desktop.mjs (Node,
# cross-platform) — see docs/windows-port.md G14 for why the old rsync+python3 version here didn't
# work on Windows. `desktop/package.json`'s `build:dist` calls the .mjs script directly and does
# NOT go through this wrapper, so Windows never needs bash at all.
set -euo pipefail
cd "$(dirname "$0")"
node scripts/build-desktop.mjs
