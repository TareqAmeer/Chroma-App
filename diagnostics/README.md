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
4. Use the app normally — do the thing that's been flaky.
5. Session ends (duration elapsed or Ctrl-C) and a report is generated
   automatically at `diagnostics/reports/<timestamp>/report.md`.
6. Re-render a report from a past run any time:
   ```bash
   python3 diagnostics/cli.py report            # latest run
   python3 diagnostics/cli.py report --run 20260902-143000
   ```

## What gets captured

| category | how | where it shows up |
|---|---|---|
| **Freezes** | `osascript` liveness ping every 3s; two consecutive misses = suspected freeze, triggers a `sample`/`spindump` stack capture of the hung process | `report.md` freeze table + `samples/*.sample.txt` |
| **Slow operations / memory growth** | `psutil` samples CPU%, RSS, thread count, open FDs every 1s | `report.md` memory section (start/peak/end/slope, flagged if sustained growth ≥5 MB/min) |
| **Silent errors** | `log stream --predicate 'process == "chromasmith"'` (unified logging — the only way to see stderr from a GUI-launched app) greps for `GLSL compile/link error` (CLAUDE.md §3's "quiet shader bug" class — a shader silently no-ops instead of crashing) and `catalog.corrupt-*.db` sightings | `report.md` errors table |
| **JS-side errors / silent-wrong-behavior** | the paste-once snippet forwards `window.onerror`, `unhandledrejection`, `console.error` to a local relay (`127.0.0.1:8732`) | `report.md` errors table, `kind: js_*` |

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
  events.jsonl        # one JSON object per line: {ts, category, ...}
  report.md           # human-readable summary
  samples/*.sample.txt  # raw stack samples from detected freezes
```

`diagnostics/reports/` is gitignored — each run is local-only.

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
