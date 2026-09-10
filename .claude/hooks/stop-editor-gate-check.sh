#!/bin/sh
# Stop hook: if chromasmith-22.html/library-ui.js/desktop-native.js have uncommitted changes,
# runs the fast Editor gates (snap-check/html-check) before letting the turn end, so a broken
# Editor build can't be silently left uncommitted at session end. Subset of what pre-commit runs
# (full editor:gates) — this is the cheap always-on check; pre-commit still gates the real commit.
repo="/Users/tareqameer/Documents/GitHub/Chroma-App"
cd "$repo" || exit 0

git diff --quiet HEAD -- chromasmith-22.html desktop/library-ui.js desktop/desktop-native.js 2>/dev/null && exit 0

out=$(bash build-desktop.sh 2>&1 && node test/editor_snap_lists_check.mjs 2>&1 && node test/editor_html_validity_check.mjs 2>&1)
code=$?
if [ $code -ne 0 ]; then
  echo "Fast Editor gates (snap-check/html-check) failed on uncommitted chromasmith-22.html/library-ui.js changes — fix before finishing:" >&2
  echo "$out" | tail -30 >&2
  exit 2
fi
exit 0
