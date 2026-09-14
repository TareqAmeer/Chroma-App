#!/bin/sh
# PostToolUse/Write|Edit hook: bumps chromasmith-22.html's BUILD stamp to today's date whenever
# an edit lands and the stamp is stale. See CLAUDE.md §2's build-stamp note.
#
# Portable on purpose (docs/windows-port.md G15): the previous version used `jq` (not installed
# on Windows) and BSD `sed -i ''` (GNU sed on Windows/Linux takes a different -i syntax, so the
# in-place edit silently failed there too — the whole hook was a no-op off macOS). The logic now
# lives in bump-build-stamp.py, called with a real python interpreter: Python is already a hard
# dependency of other hooks and of build tooling on both platforms.
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
f="$repo/chromasmith-22.html"

# `python3` on a stock Windows PATH is often the Microsoft Store's execution-alias stub (prints
# an install nag, exit 9009) rather than a real interpreter, even with a real Python installed —
# `python` resolves correctly there. Try both; first one that actually runs wins.
py=python3
command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1 || py=python

"$py" "$repo/.claude/hooks/bump-build-stamp.py" "$f" 2>/dev/null
exit 0
