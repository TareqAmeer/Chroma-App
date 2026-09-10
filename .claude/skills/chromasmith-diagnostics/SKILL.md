---
name: chromasmith-diagnostics
description: Attach diagnostics/cli.py to the currently-running Chromasmith desktop app to watch for freezes, memory growth, native+JS errors, IPC durations, and retry loops — instead of manual ps/sample/sqlite3 polling or restarting the app to check state. Use whenever investigating a live desktop-app symptom, or when the chromasmith-debugger subagent isn't the right fit (e.g. just watching, not fixing a specific reported bug).
---

# Chromasmith live diagnostics

`diagnostics/cli.py` watches the real, already-running app and writes `report.md` /
`for_claude.md` / `incidents/*.md`. Full usage in `diagnostics/README.md`. Prefer this over
manually killing/relaunching the app, ad hoc `ps`/`sample`/`top`, or looping raw `sqlite3`
queries against `catalog.db`.

## Start it

```bash
python3 diagnostics/cli.py start --duration 20m
```

**Attach to the app that's ALREADY running — don't restart it first.** Restarting defeats the
freeze/retry-loop detection, which needs one continuous session to see a pattern develop. A
`PreToolUse` hook (`.claude/hooks/autostart-diagnostics.sh`) already auto-starts this whenever a
command installs or launches the real app, so it's often already running by the time you'd reach
for this.

## Three confirmed gaps — route around them, don't trust the report blindly

1. **The JS relay needs a one-time manual paste** into Safari's Web Inspector console, once per
   session. If that never happened, the tool has zero JS-side visibility (IPC durations,
   `console.error`, JS-state snapshots) for the whole session and won't say so. Ask the user to do
   this early if JS-side evidence matters — don't assume it's armed.
2. **Native stderr capture is unreliable.** `log show --predicate 'process == "chromasmith"'` (the
   tool's documented mechanism) has returned zero lines for a normally `open`-launched instance.
   Don't trust the "native errors" section to have actually captured Rust-side `eprintln!`/
   `println!` output; corroborate with a direct check when it matters.
3. **`getUISnapshot()` only covers the Editor, not the Library.** The periodic heartbeat calls a
   function defined in `chromasmith-22.html` — it captures editor sliders/toggles/curves and
   nothing about the Library screen's grid, activity pill, or thumbnail-loading state. A clean
   report (0 errors, 0 freezes) proves the backend is fine; it says nothing about whether the
   Library frontend is correctly reflecting that.

## When the symptom is something the user SAW, not inferred

If the user reports something visible (a stuck indicator, a frozen counter, "still shows
working") rather than something inferred (slowness with no specific readout), get a real
screenshot of the app as one of the FIRST steps — alongside starting diagnostics, not after
several rounds of backend-only fixes have failed. A face-scan investigation once went through 5+
rounds of genuine, verified backend fixes while the actual remaining cause was two frontend JS
bugs invisible to this tool's own gap #3 above — only an actual screenshot surfaced it, in under
10 minutes.

## Boot/startup bugs specifically

For any boot-sequence bug (e.g. "editor flashes before Library"), a quick synthetic test or code
read is not enough — launch the real app fresh (full quit + relaunch) at least 3 times in a row
and watch the whole sequence. These are often races that only show up under real load, over
multiple real launches; one clean run proves nothing. Enabling the Tauri `devtools` Cargo feature
temporarily (revert before committing) gets a real console/inspector on a release-shaped build.

See also the `chromasmith-debugger` subagent, which wraps this tool as its primary evidence
source for actually fixing a specific reported bug (hypothesis-driven, verifies live before
declaring done). Reach for this skill directly when you just need to watch/characterize a symptom
first, not when you already know you're fixing something specific.
