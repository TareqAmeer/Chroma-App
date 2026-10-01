# Test-everything plan

Goal: prove every control, visual, flow and performance budget of Chromasmith works, mostly in an
off-screen browser (fast, never touches the user's screen), then confirm in the real desktop app.

## What already exists (reuse, don't rebuild)

- ~60 Chromium gates (`npm test`, `npm run editor:gates`, `library:*`, `perf:test`, `export_harness`).
- `editor_webkit_smoke.mjs` — one boot + render under Playwright WebKit (closest engine to WKWebView).
- `tools/diagnostics/app_control.py --automation` + the in-app automation channel
  (`chromasmith-22.html`, `chromasmith_automation_*.json`): launches the **real** desktop app and runs
  JS inside it from a script. This is the hook for final desktop validation; no mouse control needed.
- `tools/diagnostics/cli.py` — freezes, memory, IPC timings, native errors of the live app.

Gap: ~200 native commands in `desktop/src-tauri/src` (152 called by name from the frontend) have no
browser stand-in, so the Library/gallery, catalog, ingest, faces, AI masks and RAW-native paths are
untestable off-screen today.

## Layer 1 — Native stand-in (unlocks the gallery in the browser)

1. `test/native_mock/` — a fake `window.__TAURI__.core.invoke` injected by Playwright before boot.
   Backed by a fixture library (`test/fixtures/library/`: ~40 files covering JPEG, HEIC, RW2, video,
   sidecars, duplicates, a corrupt file, a 5k-photo synthetic catalog for perf).
2. Responses are **recorded from the real app**, not hand-written: run the real app once with
   automation on, log each command's request/response shape to `test/native_mock/recordings/`.
3. `native:contract` check: every command name the frontend invokes must exist in the Rust source
   and in the mock; every recorded shape must still match. Fails on drift either way.

## Layer 2 — Control sweep (every button, slider, menu, shortcut)

1. `test/control_sweep.mjs` enumerates controls **from the running app** (all buttons, inputs,
   selects, `[role]` elements, menu items, registered keyboard shortcuts) on every surface:
   Library, Editor, every panel/tab, dialogs, empty/error states.
2. For each control: activate it, then assert (a) no console error, (b) something observable changed
   (DOM, app state, canvas hash, or an invoke call), (c) undo restores the prior state where undo
   applies, (d) no unhandled promise / stuck spinner after 3s.
3. Output a coverage table: controls found / exercised / passed / "did nothing". Anything "did
   nothing" is either a bug or added to an accepted list with a reason.
4. Folds in existing editor_wireframe_control_tests / keyboard / hover-focus gates rather than
   duplicating them.

## Layer 3 — Visuals

- Pixel-diff screenshots per surface × state × theme (light/dark) × width (every breakpoint +
  every resizer min/default/max). Reuse `visual:test` / `ui:test` baselines; add Library surfaces
  now reachable via Layer 1.
- Render correctness: `export_harness` goldens for every look preset (113), grain/halation/bloom,
  masks, RAW decode; `visual:scorecard` for calibration.
- Run the visual set twice: Chromium and Playwright WebKit. Diffs only in WebKit = engine bugs.

## Layer 4 — Flows (multi-step, real user journeys)

Scripted end-to-end, each asserting the final output file / catalog state:
import folder → browse/filter/rate → open in Editor → apply look + adjustments + mask → export;
RAW open + DCP; LUT build from before/after; Colour Copy; Collage; video trim+export; session
save/restore; undo stress; offline; crash-recovery (reload mid-edit).

## Layer 5 — Performance

- Extend `perf:test` budgets: app boot, first thumbnail, library scroll (5k catalog) fps,
  open photo, slider drag frame time, full-res export time, memory after 50 open/close cycles.
- Native side measured separately against the real engine (Rust benches / `cli.py` on a real
  library), since the mock can't measure it.

## Layer 6 — Final validation in the real desktop app (no screen takeover)

1. Build the in-repo bundle (`desktop/install-app.sh`); launch with
   `app_control.py start --automation` and attach `cli.py` diagnostics.
2. Re-run Layer 2's control sweep and Layer 4's flows **inside the real app** through the
   automation channel (same scripts, transport swapped from Playwright to the automation file).
   This exercises real WKWebView + real Rust engine + the user's real-size library copy.
3. Capture window screenshots via `app_control.py screenshot`; diff against the WebKit baselines.
4. Record real perf numbers; compare with Layer 5 budgets.
5. Pass = sweep 100% green, flows produce correct files, no freeze/memory growth flagged by
   diagnostics, perf within budget, across 3 consecutive launches (boot races only show up live).
6. Run it in a separate macOS user session or a cloud Mac runner so the user's screen is untouched;
   the window must stay visible to that session (hidden windows cause false 20s IPC stalls).

## Cadence

- Every commit: contract check + fast Chromium sweep subset (< 3 min).
- Every push to main (CI): full Layers 1–5 in Chromium + WebKit.
- Before a release tag: Layer 6 on the real app, 3 launches.

## Order of work

1. Native stand-in + recorder + contract check (biggest unlock).
2. Control sweep + coverage table.
3. Library visuals/flows now reachable; WebKit visual pass.
4. Perf additions.
5. Real-app runner reusing the sweep through the automation channel.

## Completeness check

"Everything" is defined by scans of the running app, never a typed list:
- Controls: Layer 2's live DOM enumeration on every surface/state/theme/width; done when
  found == exercised and "did nothing" is empty or justified.
- Native commands: `#[tauri::command]` scan of `desktop/src-tauri/src` vs frontend invoke scan vs
  mock; done when all three sets match.
- Surfaces/states: `editor:surface-coverage` + `editor:coverage` extended to Library; done at 100%.
- Looks: `LUT_META` keys (not a typed list) all rendered in export goldens.
- Widths/resizers: every breakpoint and every resizer min/default/max read from the app.
- Engines: each layer green in Chromium, WebKit, and (Layer 6) the real app.
- A fresh-context reviewer checks the coverage tables for gaps before the plan is called done.
