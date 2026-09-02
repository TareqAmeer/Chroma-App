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
3. **Nothing else to do for a native session** — as of BUILD `2026-09-02b` /
   binary builds including `diag.rs`, chromasmith-22.html's own native
   diagnostics bridge captures JS errors, IPC timing, library config state,
   and native log/panic/progress data automatically, with no manual paste.
   The printed Web Inspector snippet is now only a fallback (a browser/Pages
   session with no `window.__TAURI__`, or a binary older than this feature —
   the tool tells you at session end if it never saw the bridge write anything).
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
| **Slow operations / memory growth** | `psutil` samples CPU%, RSS, thread count, open FDs every 1s; the native bridge logs every Tauri IPC call's duration automatically | `report.md` memory section (flagged if sustained growth ≥5 MB/min) + slow-IPC table (>500ms calls) |
| **Native errors (Rust)** | `diag.rs`'s in-process ring buffer (populated by a `panic::set_hook` and a handful of key call sites — catalog open/corruption, thumbnail-generation progress), polled via the `diag_native_state` Tauri command every 2s. **`log stream` was checked directly against a real running instance and confirmed to only ever capture system-framework os_log traffic (AppleJPEG, CarbonCore, ...) attributed to the process — never this app's own `eprintln!`/`println!` text** — so it's kept only as a secondary check (still useful for actual OS-level events like a WebGL context loss), not the primary native-error channel it used to be documented as | `report.md` errors table + known-bug-class matches (incl. a dedicated **native-panic** match — there was no panic hook anywhere in this codebase before) |
| **JS-side errors / silent-wrong-behavior** | the native diagnostics bridge in chromasmith-22.html (gated on `window.__TAURI__`, active automatically) captures `window.onerror`, `unhandledrejection`, `console.error`, each tagged with the app's own `getUISnapshot()` state and mapped back to its enclosing function; a manual Web Inspector paste remains a fallback for non-native sessions | `report.md` errors table, incident bundles' "Source location" section |
| **Library config state** | the same native bridge reads `chromasmith_lib_root` / current folder / background-paused straight from `localStorage` every ~5s, and flags if a previously-set value goes empty mid-session (e.g. a wiped WebKit data store) | `report.md` "Library config state" section |
| **Catalog indexing progress** | `diag.rs` tracks thumbnail-generation backlog/generated counters at their one existing computation site in `catalog_thumbnails` (catalog.rs) — first/last readings and whether the backlog is actually shrinking | `report.md` "Catalog indexing progress" section |
| **Stale-deploy detection** | the running binary's own mtime (resolved via the same process lookup that finds the PID) compared against HEAD's commit time, captured immediately at session start — independent of the native bridge, so it works even against an old binary | `report.md`/`for_claude.md` header, plus a terminal warning at session start |

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
- **`for_claude.md`** — a condensed digest (repo/BUILD stamp, binary staleness,
  verdict, library config + catalog progress, ranked incidents, retry loops,
  known-bug matches) sized to paste directly into a conversation instead of
  handing over the raw JSONL.

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
- The native diagnostics bridge only exists in `chromasmith-22.html` builds
  from `2026-09-02b` onward. Against an older binary the tool falls back to
  the manual Web Inspector paste, and the JS-error/IPC/config/progress
  sections will simply be empty — the "never saw the native bridge write..."
  note at session end tells you when this is happening.
- The native Rust ring buffer (`diag.rs`) only sees what's explicitly logged
  through it — currently the panic hook (unconditional) plus catalog open/
  corruption and thumbnail-progress lines. Most of this codebase's `eprintln!`
  call sites still only go to a terminal, if one is attached — it's a
  targeted fix for the highest-value spots, not a full logging migration.
- Stack-sample symbolication (`symbolicate.py`) and error-to-function mapping
  (`source_context.py`) are heuristics over text output, not real debug-symbol
  resolution — they're meant to point you at the right neighborhood fast, not
  replace reading the raw `sample` file or the source line yourself.
- Known-bug-class matching is a plain substring/regex check against captured
  text, not static analysis — it can miss a real instance worded differently,
  and a match is a lead, not a diagnosis.
