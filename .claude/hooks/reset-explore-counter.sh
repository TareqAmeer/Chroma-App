#!/bin/sh
# Resets the counter nudge-explore-delegation.sh maintains. Wired to two events:
#   - PreToolUse/Agent — a subagent was actually dispatched, so the nudge already did its job
#     (or wasn't needed); don't nag again immediately after.
#   - UserPromptSubmit — a new task/turn starts; don't let a count from an unrelated earlier
#     task carry over and fire mid-way through something small.
rm -f "/Users/tareqameer/Documents/GitHub/Chroma-App/.claude/.explore-nudge-count" 2>/dev/null
exit 0
