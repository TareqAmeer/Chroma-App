#!/bin/sh
# PreToolUse/Read hook: blocks a full Read of chromasmith-22.html (17.7MB single-file app) when
# no offset/limit is given. This existed only as a memory rule ("never blind-Read
# chromasmith-22.html in full") — memories/CLAUDE.md are advisory (the model judges relevance and
# can skip them, especially as a session grows), so the rule was routinely not followed. A hook is
# deterministic: this blocks the call before it runs, every time, no judgment involved. See
# memory context-efficiency.md and CLAUDE.md §2's context-efficiency notes.
input=$(cat)
fp=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
lim=$(echo "$input" | jq -r '.tool_input.limit // empty' 2>/dev/null)

case "$fp" in
  */chromasmith-22.html|chromasmith-22.html) ;;
  *) exit 0 ;;
esac

if [ -n "$lim" ]; then
  exit 0
fi

cat >&2 <<'EOF'
BLOCKED: chromasmith-22.html is 17.7MB — a full Read costs hundreds of thousands of tokens.
grep -n for your target first, then Read with offset/limit around the hit (a narrow window,
not the whole file). If you need a broad understanding of an unfamiliar area, use the Explore
subagent instead of reading the file directly.
EOF
exit 2
