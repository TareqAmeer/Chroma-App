#!/bin/sh
# Stop hook: if chromasmith-22.html/library-ui.js/desktop-native.js have uncommitted changes,
# runs the fast Editor gates (snap-check/html-check) before letting the turn end, so a broken
# Editor build can't be silently left uncommitted at session end. Subset of what pre-commit runs
# (full editor:gates) — this is the cheap always-on check; pre-commit still gates the real commit.
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$repo" || exit 0

STATE_DIR=".claude/state"
mkdir -p "$STATE_DIR"

# ── Panel-scoped wireframe diff (docs/ui-workflow/STATE.md) ─────────────────────────────────
# When a panel is being actively worked (.claude/state/active-panel holds its id), block the
# turn on any wireframe-diff regression in that panel specifically — a tighter, faster loop than
# the generic snap/html check below, which knows nothing about wireframe fidelity at all.
if [ -f "$STATE_DIR/active-panel" ]; then
  panel=$(tr -d '[:space:]' < "$STATE_DIR/active-panel")
  if [ -n "$panel" ]; then
    hash_file="$STATE_DIR/panel-hash-$panel"
    block_file="$STATE_DIR/panel-blocks-$panel"
    report_file="$STATE_DIR/panel-last-failure-$panel.json"
    cur_hash=$(shasum chromasmith-22.html | awk '{print $1}')
    prev_hash=$(cat "$hash_file" 2>/dev/null || echo "")
    if [ "$cur_hash" = "$prev_hash" ]; then
      : # this exact panel+hash passed before — safe to skip the expensive diff
    else
      if ! bash build-desktop.sh >"$STATE_DIR/panel-build-$panel.log" 2>&1; then
        echo "Panel '$panel' build failed; see $STATE_DIR/panel-build-$panel.log" >&2
        exit 2
      fi
      diff_json=$(node test/editor_wireframe_diff.mjs --panel "$panel" --json 2>/tmp/panel-diff-err.log)
      diff_code=$?
      if [ $diff_code -ne 0 ]; then
        printf '%s\n' "$diff_json" > "$report_file"
        blocks=$(cat "$block_file" 2>/dev/null || echo 0)
        blocks=$((blocks + 1))
        echo "$blocks" > "$block_file"
        if [ "$blocks" -ge 3 ]; then
          echo "Panel '$panel' still fails after $blocks rounds — human attention is required." >&2
          echo "Full mismatch report retained at $report_file" >&2
        else
          echo "Panel '$panel' wireframe diff found mismatches (block $blocks/3):" >&2
        fi
        echo "$diff_json" >&2
        exit 2
      fi
      # Only a clean run earns the panel+source hash cache and clears stale failure state.
      echo "$cur_hash" > "$hash_file"
      rm -f "$block_file" "$report_file" "$STATE_DIR/panel-build-$panel.log"
    fi
  fi
fi

git diff --quiet HEAD -- chromasmith-22.html desktop/library-ui.js desktop/desktop-native.js 2>/dev/null && exit 0

out=$(bash build-desktop.sh 2>&1 && node test/editor_snap_lists_check.mjs 2>&1 && node test/editor_html_validity_check.mjs 2>&1)
code=$?
if [ $code -ne 0 ]; then
  echo "Fast Editor gates (snap-check/html-check) failed on uncommitted chromasmith-22.html/library-ui.js changes — fix before finishing:" >&2
  echo "$out" | tail -30 >&2
  exit 2
fi
exit 0
