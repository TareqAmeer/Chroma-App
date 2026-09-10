#!/bin/sh
# PostToolUse/Write|Edit hook: bumps chromasmith-22.html's BUILD stamp to today's date whenever
# an edit lands and the stamp is stale. Extracted from the inline one-liner that used to live in
# settings.json, for readability — behavior unchanged. See CLAUDE.md §2's build-stamp note.
f="/Users/tareqameer/Documents/GitHub/Chroma-App/chromasmith-22.html"
edited=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ "$edited" = "$f" ] || exit 0

today=$(date +%Y-%m-%d)
cur=$(grep -o "const BUILD='[0-9-]*[a-z]*'" "$f" 2>/dev/null | head -1)
curdate=$(echo "$cur" | grep -o "[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}")
if [ "$curdate" != "$today" ]; then
  sed -i '' "s/const BUILD='[0-9-]*[a-z]*'/const BUILD='${today}a'/" "$f" 2>/dev/null
fi
exit 0
