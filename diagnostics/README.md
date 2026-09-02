# Live diagnostic tool

Watches the **real, running** `/Applications/Chromasmith.app` while you use it by
hand, and turns "it felt slow" / "that button did nothing" / "the app froze" into
a timestamped, categorized event log — so debugging starts from evidence instead
of screenshots and assumptions.

This is the complement to `npm test` / `calib/*.py`, not a replacement. Those are
deterministic, headless, CI-gated checks against fixtures and golden images. This
tool is for what those structurally can't see: real WKWebView timing, the real
catalog on real hardware, a bug that only shows up 20 minutes into actual
clicking.

## Setup (once)

```bash
python3 -m venv .diagvenv && source .diagvenv/bin/activate   # or reuse .calibvenv
pip install -r diagnostics/requirements.txt
```

## Usage

1. Launch Chromasmith normally (Dock, Finder, Spotlight — `/Applications/Chromasmith.app`).
2. Start a capture session:
   ```bash
   python3 diagnostics/cli.py start --duration 15m
   ```
   (`--duration` accepts `90s`, `15m`, `2h`; Ctrl-C ends the session early.)
3. The tool prints a one-time snippet — paste it into Safari's Web Inspector
   console (**Develop > Chromasmith > the page**) to also capture JS-side errors
   (window.onerror, unhandled promise rejections, console.error). This is
   optional: the tool works without it, you just lose JS-error / silent-wrong-
   behavior visibility for that session. There is no native bridge from
   WKWebView's console to anywhere retrievable today, so this manual paste is
   the minimum ritual to get that channel.
4. Use the app normally — do the thing that's been flaky. From a second terminal,
   tag any moment worth remembering:
   ```bash
   python3 diagnostics/cli.py mark "clicked Export"
   ```
5. Session ends (duration elapsed or Ctrl-C) and a report is generated
   automatically: `report.md` (human-readable), `for_claude.md` (condensed
   digest sized for pasting into a conversation), and `incidents/*.md` (one
   file per correlated freeze/error, see below).
6. Re-render a report from a past run any time:
   ```bash
   python3 diagnostics/cli.py report                    # latest run
   python3 diagnostics/cli.py report --run 20260902-143000
   python3 diagnostics/cli.py report --for-claude        # also print the digest
   ```

## What gets captured

| category | how | where it shows up |
|---|---|---|
| **Freezes** | `osascript` liveness ping every 3s; two consecutive misses = suspected freeze, triggers a `sample`/`spindump` stack capture of the hung process, then a best-effort symbolication of its deepest frames | `report.md` freeze table, incident bundles, `samples/*.sample.txt` |
| **Slow operations / memory growth** | `psutil` samples CPU%, RSS, thread count, open FDs every 1s; the paste-once snippet also logs every Tauri IPC call's duration | `report.md` memory section (flagged if sustained growth ≥5 MB/min) + slow-IPC table (>500ms calls) |
| **Silent native errors** | `log stream --predicate 'process == "chromasmith"'` (unified logging — the only way to see stderr from a GUI-launched app) greps for `GLSL compile/link error` (CLAUDE.md §3's "quiet shader bug" class) and `catalog.corrupt-*.db` sightings | `report.md` errors table + known-bug-class matches |
| **JS-side errors / silent-wrong-behavior** | the paste-once snippet forwards `window.onerror`, `unhandledrejection`, `console.error` to a local relay (`127.0.0.1:8732`), each tagged with the app's own `getUISnapshot()` state and mapped back to its enclosing function in `chromasmith-22.html` | `report.md` errors table, incident bundles' "Source location" section |

## Making sense of a run (beyond the raw event log)

- **Incidents** (`incidents/incident_N.md`) — every freeze/error, plus everything
  within a ±5s window of it (process metrics, IPC calls in flight, the nearest
  UI state snapshot, any user markers, and any known-bug-class match), bundled
  into one self-contained file — read one file per problem instead of
  cross-referencing timestamps across `events.jsonl` by hand.
- **Top suspects** (`report.md`'s first section) — incidents ranked by a rough
  severity score (freeze duration, error count, known-bug matches) so the most
  likely cause is the first thing you read, not something buried in a table.
- **Known-bug-class matches** — captured error text is pattern-matched against
  the bug classes CLAUDE.md already documents as having cost real debugging
  time in this codebase (the quiet-shader-bug GLSL reserved-word trap, the
  `origin!=='ai'` comparison bug, `catalog.corrupt-*.db` incidents, flaky
  `CONTEXT_LOST_WEBGL`). A match doesn't mean it's confirmed — it means "check
  this known failure mode first."
- **Retry-loop detection** — flags a burst of ≥5 near-identical error/log lines
  within 30s, the shape of the "hq_offline retried a permanently-stuck camera
  forever" class of bug, where no single line looks wrong but the repetition is
  the tell.
- **Run-over-run baseline** (`diagnostics/baseline.json`, gitignored) — each
  report is compared against the average of the last 9 runs, so "3 freezes"
  reads as "3 freezes vs 0 normally" instead of a number with no context.
- **`for_claude.md`** — a condensed digest (repo/BUILD stamp, verdict, ranked
  incidents, retry loops, known-bug matches) sized to paste directly into a
  conversation instead of handing over the raw JSONL.

## Flags

- `--relaunch` — spawn the app binary directly (`Contents/MacOS/chromasmith`)
  under this tool's own subprocess instead of attaching to a Finder/Dock-launched
  instance. Guarantees stderr capture (bypasses any unified-logging predicate
  quirks) but changes launch conditions (env, working dir, LaunchServices
  registration) — off by default.
- `--use-spindump` — if a freeze is detected but `sample` fails to capture it
  (a process wedged badly enough that even `sample`'s own AppleEvent-adjacent
  calls don't respond), escalate to `spindump` (may prompt for `sudo`).

## Output layout

```
diagnostics/reports/<run-timestamp>/
  events.jsonl          # one JSON object per line: {ts, category, ...}
  meta.json             # git commit/branch/dirty files + BUILD stamp at run start
  report.md             # human-readable summary, incl. Top suspects + baseline comparison
  for_claude.md          # condensed digest sized for pasting into a conversation
  samples/*.sample.txt  # raw stack samples from detected freezes
  incidents/incident_N.md  # one self-contained bundle per correlated freeze/error
diagnostics/baseline.json  # rolling run-over-run history (freeze/error counts, mem slope)
```

`diagnostics/reports/` and `diagnostics/baseline.json` are gitignored — all of
this is local-only.

## Known limitations

- The app must be found by process name (`chromasmith`) and, when more than one
  candidate is running, the one under `/Applications/Chromasmith.app` is
  preferred — never a stray "Chromasmith copy.app" build artifact. If neither
  disambiguates cleanly you'll see a warning naming the app path it attached to;
  check that before trusting the run.
- Freeze detection has ~3-6s granularity (ping interval + two-miss confirmation)
  — a freeze shorter than that won't be flagged, though it also likely wasn't
  the freeze you were chasing.
- The JS relay requires a manual paste each session; there is no way around this
  without adding a native `console` → Tauri `invoke` bridge in
  `chromasmith-22.html` itself (out of scope for this tool).
- Stack-sample symbolication (`symbolicate.py`) and error-to-function mapping
  (`source_context.py`) are heuristics over text output, not real debug-symbol
  resolution — they're meant to point you at the right neighborhood fast, not
  replace reading the raw `sample` file or the source line yourself.
- Known-bug-class matching is a plain substring/regex check against captured
  text, not static analysis — it can miss a real instance worded differently,
  and a match is a lead, not a diagnosis.
