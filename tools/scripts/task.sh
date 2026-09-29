#!/usr/bin/env bash
# One isolated worktree + branch per Linear ticket, so parallel chats never touch each other's files.
#   scripts/task.sh start CHR-12 thumbnail-line   create worktree, print the prompt to paste into a new chat
#   scripts/task.sh list                          show active task worktrees
#   scripts/task.sh done CHR-12                   remove the worktree (after the branch is merged)
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
BASE="$(dirname "$ROOT")/Chroma-App-tasks"
cmd="${1:-}"; id="$(echo "${2:-}" | tr 'A-Z' 'a-z')"; slug="${3:-work}"
case "$cmd" in
  start)
    [ -n "$id" ] || { echo "usage: task.sh start CHR-12 short-slug"; exit 1; }
    dir="$BASE/$id"; branch="task/$id-$slug"; UP="$(echo "$id" | tr a-z A-Z)"
    git -C "$ROOT" fetch origin main --quiet
    mkdir -p "$BASE"
    git -C "$ROOT" worktree add -b "$branch" "$dir" origin/main
    for nm in node_modules desktop/node_modules; do [ -d "$ROOT/$nm" ] && ln -s "$ROOT/$nm" "$dir/$nm"; done
    [ -f "$ROOT/.claude/settings.local.json" ] && { mkdir -p "$dir/.claude"; cp "$ROOT/.claude/settings.local.json" "$dir/.claude/"; }
    cat <<EOF

Worktree: $dir   Branch: $branch
Open a NEW chat with its folder set to: $dir
Paste this as the first message:
------------------------------------------------------------
Work on Linear ticket $UP. Read it with the Linear get_issue tool, note its area:* labels, and only touch
those areas. Stay inside this worktree, commit to this branch, push it, and open a PR to main.
Do not bump BUILD or edit CLAUDE.md. When finished, comment on the ticket and set it In Review.
------------------------------------------------------------
EOF
    ;;
  list) git -C "$ROOT" worktree list | grep "Chroma-App-tasks" || echo "no task worktrees" ;;
  done)
    [ -n "$id" ] || { echo "usage: task.sh done CHR-12"; exit 1; }
    dir="$BASE/$id"
    for nm in node_modules desktop/node_modules; do [ -L "$dir/$nm" ] && rm "$dir/$nm"; done
    rm -f "$dir/.claude/settings.local.json"; rmdir "$dir/.claude" 2>/dev/null || true
    git -C "$ROOT" worktree remove "$dir" && echo "removed $dir (branch kept; delete with git branch -d after merge)"
    ;;
  *) sed -n 2,5p "$0"; exit 1 ;;
esac
