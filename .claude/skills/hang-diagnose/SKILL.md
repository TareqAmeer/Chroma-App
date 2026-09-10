---
name: hang-diagnose
description: Diagnose a suspected infinite-loop/hang (a test or interaction that never resolves and pins CPU, as opposed to something that just fails normally) using CDP stack-sampling instead of guessing at causes one at a time with throwaway instrumented scripts. Use the moment something hangs rather than fails.
---

# Hang diagnosis via CDP stack-sampling

When something hangs (never resolves, pins CPU) rather than failing normally, go straight to CDP
`Debugger.pause` stack-sampling. Don't guess at causes one at a time by adding one piece of
instrumentation per throwaway script — diagnosing one real hang this way (the
`mskRebuild()`/`fxEnsureDepthMap()` infinite loop, 2026-09-10) took ~8 separate scripts, 5 of them
wrong-hypothesis detours, before landing on the one technique that found it in a single run.

## Use the existing tool first

```bash
node test/editor_hang_diagnose.mjs "<expr>" --setup "..."
```

Don't hand-roll a new script unless this genuinely doesn't fit the case.

## The technique, if you need to write it directly

Fire the suspect call un-awaited, then poll `cdp.send('Debugger.pause')` on a ~1s timer and print
the call-stack sample each tick.
- A **tight loop** shows the SAME few frames repeating.
- **Real (if slow) progress** shows the stack changing, or eventually settling.

## Adjacent habits that matter while doing this

- Keep process-status checks minimal: `ps -o pid,%cpu,etime,comm -p <pid>` — never a bare
  `ps aux | grep` that dumps full Chromium launch-flag command lines (hundreds of wasted tokens).
- Never pipe a long-running backgrounded command through `tail` for "live" progress — `tail`
  without `-f` buffers until the piped process exits, so a mid-run check returns nothing and
  wastes a poll cycle. Redirect straight to a log file (`> /tmp/x.log 2>&1 &`) and `tail`/`cat`
  that instead.
- When grepping `chromasmith-22.html` for this, filter by line length first
  (`awk 'length($0)<N'`) — the file has very long single-line base64 font blocks that can
  accidentally match unrelated keyword greps and flood the response.
- Don't spawn a new polling wakeup just to re-check "is it still running" with no new action to
  take if it is — batch a longer wait instead of several short ones when nothing changes.

## Once you have a theory

Never act on a written explanation of a flaky/intermittent hang — including your own reasoning
earlier in the same conversation — without reproducing it live first. Confirm the claimed cause
with one live check (a `console.log`, `document.getAnimations()`, a computed style, a screenshot
at the actual moment of failure) before building a fix, and don't call it fixed off one clean run.
