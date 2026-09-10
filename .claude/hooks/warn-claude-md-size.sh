#!/bin/sh
# PostToolUse/Write|Edit hook: warns (non-blocking) when CLAUDE.md grows past ~45KB. Same shape
# as the BUILD-stamp hook — claude-md-structure.md memory said to "periodically run wc -c
# CLAUDE.md by hand," which is the same "remember to check a number" pattern the BUILD-stamp hook
# already solved for the app file. This is advisory (exit 0, stderr only) rather than a hard
# block: CLAUDE.md size is a judgment call about what to hive off to docs/*.md, not an objective
# pass/fail the way the Read-size gate is.
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
f="$repo/CLAUDE.md"
edited=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ "$edited" = "$f" ] || exit 0

size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
[ -n "$size" ] || exit 0

if [ "$size" -gt 46080 ]; then
  echo "NOTE: CLAUDE.md is now ${size} bytes (>45KB). It's loaded in full every turn — consider hiving off a section into docs/*.md (see claude-md-structure memory)." >&2
fi
exit 0
