#!/bin/sh
# PreToolUse/ExitPlanMode hook: a plan can't be submitted for approval without a
# "## Completeness check" section. Added 2026-09-11 after the UI-workflow plan's session prompts
# listed the kinds of surface to capture by hand and left out all app chrome (top bars, tool rail,
# status bars) — every later session faithfully covered the hand-written list, so a clipped tool
# rail went unseen by the whole pipeline. See docs/process-lessons.md #18.
#
# Blocking (exit 2) is deliberate: a written rule ("define completeness from the app") already
# existed as lesson #16 and was not followed. A trivial plan satisfies this with one line
# ("## Completeness check" + "N/A — single-file bug fix"), so the cost is near zero.
plans="$HOME/.claude/plans"
latest=$(ls -t "$plans"/*.md 2>/dev/null | head -1)
[ -n "$latest" ] || exit 0
# Only judge a plan written in the last 6 hours (the one being submitted), not an old file.
[ -n "$(find "$latest" -mmin -360 2>/dev/null)" ] || exit 0
grep -q '^## Completeness check' "$latest" && exit 0

cat >&2 <<'EOF'
Plan blocked: add a "## Completeness check" section to the plan file before submitting it.
For a trivial plan, one line is enough: "N/A — <why nothing can be missed>". Otherwise answer:
1. Denominator — which command/scan of the REAL app or repo produces the full list of things this
   plan must cover? (A list typed into the plan or a prompt is not a denominator.)
2. Done = that scan passes — each session prompt that enumerates things ends with "…and anything
   else <scan> finds", and its done-criterion is the scan, not the enumerated list.
3. Axes — which apply and where each is enforced: themes, every window width, every resizer at
   min/default/max, modes (e.g. rail labels/icons), states (hover, empty, loaded, error…).
4. Past-miss replay — name at least one real past miss (e.g. the clipped narrow tool rail,
   2026-09-11) and say which step of this plan would now catch it.
5. Gap review — a fresh-context subagent was asked "what would this plan fail to cover?"; list
   its findings and how the plan addresses each.
EOF
exit 2
