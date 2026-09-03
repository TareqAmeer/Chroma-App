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

## Two layers: triage vs. deep-dive

`start`/`report` give an aggregate, end-of-session summary — good for "is
something actually wrong" (ruled out a backend hang once by showing "0
freezes, 0 errors" during a real bug that turned out to be frontend-side).
For the deep-dive moment that used to mean reaching straight for `ps`/
`sample`/`sqlite3` instead, three commands give exact numbers immediately,
no session required:

```bash
python3 diagnostics/cli.py inspect              # live CPU/RSS/threads/FDs, main + every child
python3 diagnostics/cli.py sample [--pid PID]   # stack sample right now, symbolicated
python3 diagnostics/cli.py db pending-thumbs    # exact catalog.db row state, read-only
python3 diagnostics/cli.py db --list            # see all canned db queries
python3 diagnostics/cli.py db --sql "SELECT ..." # raw read-only escape hatch
```

If a `start` session is active, each of these also logs into that run's
`events.jsonl` — so a deep-dive number taken mid-session still shows up in
`report.md`/incidents later, instead of living only in your terminal scrollback.

`inspect` and `db` are terse by default (compact lines / first 10 rows) — the
full detail is always ALSO written to a file, `--full` prints it inline. This
matches two things the Claude Code community consistently recommends for
keeping debugging fast and cheap on tokens: filter raw output down to the
error/key fields before it reaches the model instead of pasting full dumps,
and (for a genuinely large investigation) run the raw digging in a subagent —
its own isolated context reads the noisy output, only a short summary comes
back to the main conversation. `report --for-claude` already does the second
half of that for a full session; these three commands are the equivalent for
a single deep-dive number.

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
3. **Nothing else to do for a native session** — binaries built with
   `tauri-plugin-log` (main.rs) + `attachConsole()` (chromasmith-22.html) write
   both sides' logs to a real file automatically, and the native diagnostics
   bridge captures JS errors, IPC timing, and library config state, all with
   no manual paste. The printed Web Inspector snippet is now only a fallback
   (a browser/Pages session with no `window.__TAURI__`, or a binary older than
   these features — the tool tells you at session end if it never saw either).
   You can also read the log file yourself, any time, without this tool at
   all: `tail -f ~/Library/Logs/com.tareq.chromasmith/Chromasmith.log`.
4. Use the app normally — do the thing that's been flaky. From a second terminal,
   tag any moment worth remembering — this also captures a real screenshot of
   the app's own window (not a synthetic test-harness render):
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

### Auto-started sessions (Claude Code hook)

You don't have to run `start` by hand at all: a `PreToolUse` hook in
`.claude/settings.json` auto-starts a 20-minute capture session whenever Claude
Code runs a build/deploy/launch command matching `install-app.sh`, `tauri
build`, `npm run build`, `open -a ... Chromasmith.app`, or `cargo build ...
--bin chromasmith` — as long as a session isn't already active (checked via
the same `.active_run` pointer file `mark` uses). Exists because forgetting to
start one manually before testing was itself a recurring blind spot. Output
goes to `/tmp/chromasmith_diag_autostart.log` if you want to confirm it fired.

## What gets captured

| category | how | where it shows up |
|---|---|---|
| **Freezes** | `osascript` liveness ping every 3s; two consecutive misses = suspected freeze, triggers a `sample`/`spindump` stack capture of the hung process, then a best-effort symbolication of its deepest frames | `report.md` freeze table, incident bundles, `samples/*.sample.txt` |
| **Slow operations / memory growth** | `psutil` samples CPU%, RSS, thread count, open FDs every 1s; the native bridge logs every Tauri IPC call's duration automatically | `report.md` memory section (flagged if sustained growth ≥5 MB/min) + slow-IPC table (>500ms calls) |
| **Native + frontend logs** | **The real fix, not a workaround**: `tauri-plugin-log` (main.rs) writes a genuine file to disk — `~/Library/Logs/com.tareq.chromasmith/Chromasmith.log` — that `log_file.py` tails directly. `attachConsole()` (chromasmith-22.html, active automatically) forwards `console.log/warn/error` from the frontend into the SAME file. `log stream` was checked directly against a real running instance first and confirmed to only ever capture system-framework os_log traffic (AppleJPEG, CarbonCore, ...), never this app's own output — that's why a real file, not unified logging, is the fix. ⚠️ This logger is process-global: a noisy dependency (`rawler`, the RAW decoder) produced 1383 lines in one 45s session: suppressed at the source (`level_for`) and the parser is target-aware regardless, so only this app's own warnings count as report-level "errors" | `report.md` errors table + known-bug-class matches (incl. a dedicated **native-panic** match — there was no panic hook anywhere in this codebase before this) |
| **JS-side errors / silent-wrong-behavior** | the native diagnostics bridge in chromasmith-22.html (gated on `window.__TAURI__`, active automatically) captures `window.onerror`, `unhandledrejection`, `console.error`, each tagged with the app's own `getUISnapshot()` state and mapped back to its enclosing function; a manual Web Inspector paste remains a fallback for non-native sessions | `report.md` errors table, incident bundles' "Source location" section |
| **Library config state** | the same native bridge reads `chromasmith_lib_root` / current folder / background-paused straight from `localStorage` every ~5s, and flags if a previously-set value goes empty mid-session (e.g. a wiped WebKit data store) | `report.md` "Library config state" section |
| **Catalog indexing progress** | `diag.rs` tracks thumbnail-generation backlog/generated counters at their one existing computation site in `catalog_thumbnails` (catalog.rs) — first/last readings and whether the backlog is actually shrinking | `report.md` "Catalog indexing progress" section |
| **Stale-deploy detection** | the running binary's own mtime (resolved via the same process lookup that finds the PID) compared against HEAD's commit time, captured immediately at session start — independent of the native bridge, so it works even against an old binary | `report.md`/`for_claude.md` header, plus a terminal warning at session start |
| **Real window screenshots** | `cli.py mark` captures the app's actual window via `screencapture -l <windowID>` — a composited capture from the window server's own buffer (works regardless of focus/overlap), where the window ID comes from a tiny `swift` script (no CGWindowID API is reachable from AppleScript or this machine's Python 3.8) — deliberately not full computer-use screen sharing, a separate consent path | `report.md`/`for_claude.md` "User action markers", inline in the markdown |
| **Hung/deadlocked child processes** | `child_watch.py` discovers every descendant of the watched PID (`pgrep -P`, recursive) — invisible to the freeze detector, which only pings the main app's AppleEvent responsiveness and stays healthy even when a background child (e.g. a `--face-scan-worker` subprocess) is fully deadlocked. A child idle (near-0% CPU) for 20s+ triggers a `sample` stack capture on THAT pid plus an `lsof` pipe-fd count; verified live against a real reproduction of "child blocked writing to a full, undrained stdout/stderr pipe" — the stack came back `_io_FileIO_write -> _Py_write_impl -> write (in libsystem_kernel.dylib)`, a direct confirmation, not an inference. `--use-dtrace` upgrades this to an instant syscall-level confirmation instead of waiting out the idle window — see the alternatives-considered table below for why that's opt-in rather than the default | `report.md` "Child processes" section, incident bundles (a stall is an anchor, same as a freeze), known-bug-class match |

### Detecting a hung/deadlocked child — alternatives considered

Four ways to detect a child blocked writing to a full pipe were compared, three tested live
against a real reproduction (a parent piping a child's stdout without ever reading it) before
picking a default — not just implemented and then rationalized:

| approach | verdict |
|---|---|
| **dtrace** watching `syscall::write:entry/return` for the pid | Would catch the block the INSTANT it happens — no polling delay. Tested live: SIP does NOT block tracing this app or its own workers (SIP only restricts Apple's own system binaries), but dtrace still requires root regardless — `dtrace -n '...'` without sudo fails immediately with "DTrace requires additional privileges", and this environment has no passwordless sudo. Can't be the always-on default; offered as `--use-dtrace` (same sudo tradeoff as `--use-spindump`) for instant confirmation instead of waiting out the 20s heuristic below. |
| **macOS `ps -o stat,wchan`** (the D-state equivalent that works on Linux) | Tested live against the same reproduction: `STAT=SN WCHAN=-` — no signal distinguishing a process blocked in `write()` from any other idle sleep. Ruled out; this is a real macOS/Linux `ps` capability gap, not a lookup mistake. |
| **Heartbeat** (the child periodically reports "I'm alive and at step N") | The standard production pattern (systemd watchdog, supervisord, k8s liveness probes) and the most robust — but it requires instrumenting the CHILD's own code, which is an app change, not something an external diagnostic tool can retrofit onto an arbitrary future child it doesn't control the source of. Worth doing IN the app itself for a specific known-risky worker; out of scope here. |
| **CPU-idle heuristic + `lsof` pipe-fd count + `sample` stack capture** (what's implemented, default) | No privilege needed, degrades gracefully, and the `sample` stack trace is a DIRECT read of the blocked thread's own call stack, not an inference — verified live: it came back `_io_FileIO_write -> _Py_write_impl -> write (in libsystem_kernel.dylib)` on the same reproduction the other options were tested against. Detection is delayed by up to `STALL_WINDOW_S` (20s) vs. dtrace's instant catch — worth it for running without ever prompting for sudo. |

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
- `--use-dtrace` — when a child-process stall is suspected (`child_watch.py`),
  confirm it INSTANTLY via a short dtrace probe watching that pid's
  `write()`/`writev()` calls (may prompt for `sudo`), instead of relying only
  on the default CPU-idle-then-stack-sample heuristic. See "Detecting a
  hung/deadlocked child" below for why this is opt-in, not the default.

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
- The native diagnostics bridge and the log-file/`attachConsole()` fix only
  exist in binaries built after this feature landed. Against an older binary
  the tool falls back to the manual Web Inspector paste, and the JS-error/IPC/
  config/progress/log sections will simply be empty — the "never saw the
  native bridge write..." / "never saw the log file change..." notes at
  session end tell you when this is happening.
- `diag.rs`'s `log()` only reaches the file for what's explicitly routed
  through it — currently the panic hook (unconditional) plus catalog open/
  corruption and thumbnail-progress lines. Most of this codebase's `eprintln!`
  call sites still only go to a terminal, if one is attached — it's a
  targeted fix for the highest-value spots, not a full logging migration.
- The log file is process-global — every dependency crate's own `log::`
  output lands in it too, not just this app's. `log_file.py` only counts this
  app's own warnings as report-level "errors" (see the table above), but a
  genuinely new noisy dependency would still bloat the raw file size; if
  `tail -f`ing it gets unreadable, add another `.level_for("<crate>", Error)`
  in main.rs the same way `rawler` was quieted.
- `cli.py mark`'s screenshot needs macOS's Screen Recording permission
  granted to whatever process runs this tool's shell (System Settings >
  Privacy & Security > Screen Recording) — confirmed live that without it,
  `screencapture -l <windowID>` fails with "could not create image from
  window" against ANY app's window, not just Chromasmith's. The tool detects
  this specific failure and tells you so instead of a bare "no screenshot".
- Stack-sample symbolication (`symbolicate.py`) and error-to-function mapping
  (`source_context.py`) are heuristics over text output, not real debug-symbol
  resolution — they're meant to point you at the right neighborhood fast, not
  replace reading the raw `sample` file or the source line yourself.
- Known-bug-class matching is a plain substring/regex check against captured
  text, not static analysis — it can miss a real instance worded differently,
  and a match is a lead, not a diagnosis.
