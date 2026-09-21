#!/bin/bash
# After a Linear get_issue, remind to view any attached images (they are not visible otherwise).
cat >/dev/null
echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Linear ticket fetched: if the description/comments contain <linear-image> or image links, call mcp__cf473797-4be5-4497-844a-11a8d17b631d__extract_images (load via ToolSearch) with that markdown to SEE the screenshots BEFORE diagnosing. Also check list_comments for images."}}'
