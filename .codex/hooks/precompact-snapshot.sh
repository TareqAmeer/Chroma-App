#!/bin/sh
# PreCompact hook: snapshots cheap, non-hallucinated state right before compaction summarizes
# the conversation away. Compaction is a lossy model-generated summary — this gives the
# post-compact session a concrete anchor (what's actually changed on disk, what's still open)
# instead of relying entirely on the summary having captured it. Appended, not overwritten, so a
# session with several compactions keeps a trail.
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
out="$repo/.claude/last-compact-snapshot.md"
cd "$repo" 2>/dev/null || exit 0

{
  echo "## Pre-compact snapshot — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo '```'
  git status --short 2>/dev/null
  echo '```'
  echo
  echo "Diff stat:"
  echo '```'
  git diff --stat HEAD 2>/dev/null | tail -20
  echo '```'
  echo
  echo "Last 5 commits:"
  echo '```'
  git log --oneline -5 2>/dev/null
  echo '```'
  echo
} >> "$out" 2>/dev/null

exit 0
