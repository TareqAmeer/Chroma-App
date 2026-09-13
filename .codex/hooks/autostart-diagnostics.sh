#!/bin/sh
# PreToolUse/Bash hook: auto-starts diagnostics/cli.py watching the real app whenever a command
# actually installs/launches it, so live evidence is captured from the start instead of the user
# having to remember to start it. Narrowed 2026-09-10 to just install/launch commands — it used
# to also match plain `npm run build`/`tauri build`/`cargo build --bin`, so a compile-only build
# started a 20-minute watcher for no reason.
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
active="$repo/diagnostics/reports/.active_run"
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)

echo "$cmd" | grep -qE 'install-app\.sh|open .*-a .*Chromasmith\.app' || exit 0
[ -f "$active" ] && exit 0

cd "$repo" && nohup python3 diagnostics/cli.py start --duration 20m > /tmp/chromasmith_diag_autostart.log 2>&1 &
disown
exit 0
