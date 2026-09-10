#!/bin/sh
# PreToolUse/Read|Grep|Glob hook: counts raw exploration-shaped reads in a row and nudges
# (non-blocking) to consider the Explore subagent once the count gets high, instead of leaving
# this as a memory rule that competes for relevance and gets skipped under exactly the
# circumstances it matters most (a big multi-file audit, which is also when the model is busiest
# and least likely to re-derive "should I have delegated this").
#
# This exists because the previous version of this advice — context-efficiency memory rule #3
# ("delegate multi-file/codebase search to Explore") — was demonstrated NOT working, live, in the
# session that wrote this hook: a ~20-call repo audit ran entirely as raw Bash/Read/Grep in the
# main thread instead. A hook can't judge "is this task audit-shaped" semantically, but it CAN
# deterministically count "N raw reads in a row with no subagent dispatch," which is a cheap,
# honest proxy — imperfect, but enforced rather than hoped for.
#
# Not a hard block: unlike the chromasmith-22.html read-size gate, "should this have been
# delegated" isn't objectively checkable, so this only nudges (exit 0, stderr note) rather than
# blocking (exit 2) — a false positive here would wrongly stop legitimate focused work.
state="/Users/tareqameer/Documents/GitHub/Chroma-App/.claude/.explore-nudge-count"
threshold=12

count=$(cat "$state" 2>/dev/null || echo 0)
count=$((count + 1))

if [ "$count" -ge "$threshold" ]; then
  echo "NOTE: ${count} raw file reads/greps in a row with no subagent dispatch — if this is a broad multi-file search or audit (not iterating on one thing), consider fanning it out to 1-3 Explore subagents instead: only the conclusion lands in context, not every intermediate read. See CLAUDE.md's context-efficiency notes." >&2
  count=0
fi

echo "$count" > "$state" 2>/dev/null
exit 0
