#!/bin/sh
# PreToolUse/Read hook: nudges (non-blocking) on a full Read of test/editor_ux_spec.json without
# offset/limit. 109KB / 102 items — small enough that a hard block (like chromasmith-22.html's
# block-full-html-read.sh) would be overkill, and docs/editor-redesign-plan.md's own workflow
# says to edit this file directly when adding a spec item, so blocking would fight a real,
# legitimate use. This only nudges toward the cheaper path for the two things a session actually
# needs it for:
#   - status of the backlog -> `python3 test/verify.py --editor-ux` (a 4KB done/open checklist,
#     ~27x smaller than the raw file, built exactly for this)
#   - one specific item -> `grep -n '"<ID>"' test/editor_ux_spec.json` to find its line, then
#     Read with offset/limit around it (items are ~8 lines each; each ID appears as its own
#     `"E7": {`-shaped line, so the grep is a direct hit)
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
target="$repo/test/editor_ux_spec.json"

input=$(cat)
fp=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
lim=$(echo "$input" | jq -r '.tool_input.limit // empty' 2>/dev/null)

[ "$fp" = "$target" ] || exit 0
[ -n "$lim" ] && exit 0

# Plain stderr on a PreToolUse exit-0 is never shown to Claude, only logged — the documented way
# to surface non-blocking guidance is JSON on stdout with hookSpecificOutput.additionalContext.
jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: "editor_ux_spec.json is 109KB/102 items — reading it in full costs far more than either thing you probably need: backlog status -> `python3 test/verify.py --editor-ux` (a ~4KB done/open checklist); one item -> `grep -n \"<ID>\" test/editor_ux_spec.json`, then Read with offset/limit around that line (each item is ~8 lines). Proceeding with the full read anyway is fine if you genuinely need the whole backlog at once."}}'
exit 0
