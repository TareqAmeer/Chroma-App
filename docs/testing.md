# Test suite reference

Moved out of CLAUDE.md (2026-09-10) to keep the root file a thin index — this doc is loaded only
when working on the test suite itself, not on every turn. See CLAUDE.md §2 for the run commands;
this is the "why does each gate exist and what does it actually check" detail.

`npm run editor:gates` (also `npm test`'s `editor:gates` step, `githooks/pre-commit` for any
commit touching `chromasmith-22.html`, and `.github/workflows/editor-gates.yml` on every push/PR)
rebuilds `desktop/dist/` first — every gate underneath loads that staged copy, and this script
used to skip the rebuild, so a run could quietly pass or fail against a previous session's stale
build. For the Library's own gates too, or the Playwright click-through behaviour suite, use
`python3 test/verify.py --editor [--full]` (see `test/verify.py`'s docstring for flags). None of
this closes the desktop-engine gap — every check here drives Chromium, not the WKWebView the real
Tauri desktop app renders with. A green run means no Chromium-visible regression, not that the
actual `.app` is unaffected.

**`test/ui_audit.mjs`** walks every tool section at 1440×820 / 1600×1000 / 1280×720 in `?deskx=1`,
**plus a separate 375×812 phone pass** (2026-08-15). The phone pass loads its own page WITHOUT
`?deskx=1` and audits the bottom sheet: under 700px the app is a different shell entirely
(CLAUDE.md §4), and `deskx` pins the desktop one — so adding 375px to `VIEWPORTS` would have
audited a layout no phone ever renders. It found a real defect on its first run (a 12×20px modal
close button, less than half the 28px touch floor). `CS_UI_NO_MOBILE=1` skips it. It
and asserts six invariants: no panel fragmentation (CLAUDE.md §6 lesson 8), no control painted
before its own label (§6 lesson 9), no overlapping siblings, a 28px pointer-target floor (18px for
checkboxes/colour swatches, deliberately — see the comment in the file), an 11px font floor, and
4.5:1 text contrast. Baselines live in `test/baselines/` — **not** `test/output/`, which is
gitignored. It exists because these defects are invisible in a screenshot of the DEFAULT panel and
only appear once a panel grows tall; reading its JSON is also far cheaper than round-tripping
screenshots through a model.

**`test/perf_bench.mjs`** holds seven budgets, each anchored to a real pre-optimisation
measurement: `_boxFilterJS` ×6 @2048×1365 (was 1996ms), retained undo history with a brush mask
(was 9.5MB for a *512×384* mask), renders during a 30-event slider drag (was **1** — grading a
slider produced no feedback at all), `getUISnapshot`, the fraction of look thumbnails that render
on a gallery build (was **all 113**, one rAF each), the retained `_presetLutCache` (was unbounded
— 48.7MB of Float32Array after scrolling "All"), and the worst frame gap during a 65³ DCP bake
(was a **1157ms** whole-second freeze on every RAW load).

Three of them carry a correctness guard alongside the timing, because in each case a faster
version that returns *different* numbers would be worse than the slow one and completely
invisible: `_boxFilterJS` is diffed against a reference implementation, the worker's DCP bake is
diffed against the main thread's (max|Δ| must be 0 over all 823,875 entries — this is also what
catches a dependency that silently failed to reach the worker), and the lazy gallery asserts
that *something* rendered, since "renders only what's visible" and "renders nothing at all"
score identically on a ratio.

**`test/library_perf.mjs`** (`npm run lib:test`) covers the Library grid, which had two
independent scaling faults, both measured on a synthetic folder (`?libtest=1&libn=N` — the
`list_dir` mock takes a count):

| entries | DOM nodes | folder open |
|---|---|---|
| 200 | 5,114 → 5,114 (unchanged — below `VIRT_MIN`, deliberately the old path) | ~3s |
| 1,000 | 17,914 → **1,995** | 4.3s → 3.0s |
| 5,000 | never loaded | **>30s timeout → ~3-4s** |

- The grid built a card per file (~18 DOM nodes each). It now mounts only the rows near the
  viewport, with full-width spacers holding the scroll height. ⚠️ Below `VIRT_MIN` (400) the OLD
  path runs untouched — virtualising a 40-photo folder buys nothing and would put a scroll
  listener and a measurement pass between every existing behaviour and its DOM.
  ⚠️ Column count and row pitch are measured from the LIVE grid (`virtMetrics`), never recomputed
  from CSS: both come from `auto-fill` and depend on thumbnail size, dock state and window width,
  so a hand-derived copy would be a second source of truth that drifts.
- `clusterByHash` is O(n²) and its inner comparison allocated **two BigInts from hex strings and
  counted bits one at a time** — ~64 BigInt ops per pair, 12.5M times at n=5,000. That was
  effectively the entire 41.9s. Now each hash is parsed once into hi/lo `Int32Array`s and compared
  with two XORs and two SWAR popcounts. The gate asserts the fast path agrees with the original
  BigInt implementation **exactly** over 83,436 pairs, including deliberate near-duplicates at
  every Hamming distance 0-8 so the threshold boundary is covered — a faster hamming returning
  different distances would silently re-cluster the user's duplicates and still look like a win.

**`test/mask_raster.mjs`** exists because **no export golden contains a raster mask** — every
recipe uses analytic shapes, so the entire brush/sky/AI storage path had zero coverage. It
asserts byte-exact snapshot round-trips, that legacy plain-`Array` masks still load, and that
painting cannot corrupt a history entry.

`test/export_harness.mjs` loads the REAL `chromasmith-22.html` in Playwright/Chromium (software
SwiftShader GL, so output doesn't depend on the host GPU) and drives it through the app's own
`applyUISnapshot`/`processToCanvas`. It is the cheapest way to prove a shader edit compiles and
that untouched paths are **bit-exact** — far faster than clicking, and it catches the
shader-truncation white-screen class of bug immediately (watch for `[pageerror]`), and now also
fails outright on a `[console.error] GLSL compile error`/`LINK FAILED` instead of only printing it
(the "quieter" no-op bug class — CLAUDE.md §3 — used to slip through since it doesn't blank the
canvas). Recipes are JSON in `test/recipes/`, fixtures are PNGs in `test/fixtures/`
(`portrait.png` is a tanned field + pale disc + dark dot — a deliberate uneven-skin test case).
`test/probe_*.mjs` are ad-hoc probes built on the same rig for measuring pixels rather than
diffing images.

`npm run lint:ai` (part of `npm test`) is a source-level check, not a render one: it fails if any
raw `origin==='ai'` / `origin!=='ai'` comparison exists outside `mskIsAI()`. It exists because the
whole segmentation path is gated on `window.__TAURI__` and therefore **invisible to the browser
harness** — see the warning in docs/skin-tone.md.

## ⚠️ Two tests on this machine are FLAKY, and both were measured, not guessed (2026-08-15)

Before spending hours bisecting a "regression" in either of these, re-run. Both were characterised
by running the CLEAN tree repeatedly, so neither is caused by whatever you just changed:

- **`export_harness` intermittently renders NOTHING.** Every fixture x recipe comes back as an
  all-zero **RGBA (0,0,0,0)** canvas, so all 18 goldens mismatch at once with identical deltas
  (max 255, mean ~107-178). It used to report `ok` for every render and exit 0, which reads
  exactly like a catastrophic shader regression and sends you looking in the wrong place — it was
  the single most expensive false lead in the Phase D work. The harness now **throws a BLANK
  RENDER error** instead: alpha is the tell, since the pipeline always writes `vec4(rgb,1.0)` and
  no shader edit can produce alpha 0. ⚠️ This guard matters most for `--golden`, which would
  otherwise happily overwrite all 18 goldens with blank PNGs.
  **Root cause, confirmed by that guard's diagnostics: the WebGL context is LOST**
  (`contextLost: true`, `glError` 37442 = `CONTEXT_LOST_WEBGL`, and every program then reports
  `LINK FAILED`). It is a SwiftShader/driver event, not anything in the app, and it poisons every
  render after it — which is why the whole run fails at once rather than one image. The harness
  now **retries the entire run once** on a blank render; anything else still fails immediately on
  the first attempt. Frequency drops noticeably with fewer Chromium instances running.
- **`video_harness`'s "still byte-exact after video" check fails ~40% of runs** (measured: clean
  tree, 2 of 5), reporting e.g. `chart.png x identity ... 5531 vs 5365 bytes`. A real image that
  differs slightly, not a blank, so it is a different fault from the one above. Unattributed;
  suspect the seeded-`Math.random` ordering rule below, since the number of renders a video path
  fires before the still is timing-dependent.

⚠️ Two determinism rules the harness enforces, both learned by having them fail silently:
- **Recipes are isolated per combo.** `applyUISnapshot` treats an *absent* `selects` key as "leave
  this alone" (correct for selective paste), so a recipe with no LUT used to inherit the previous
  recipe's LUT. Latent for a long time because `lut_look` sorted last and state resets per
  FIXTURE, not per recipe. The harness now clears `sel-lut`/`sel-print` explicitly and **throws**
  if state hasn't settled instead of rendering a knowingly-wrong frame into a golden.
- **The seeded `Math.random` stream resets per combo**, not per page. Per-page, each combo's grain
  depended on how many renders preceded it, so merely ADDING a recipe invalidated the grain
  goldens of every later fixture — a spurious "regression" with no code change behind it.

## Layout coverage: every width, every resizer, every region (added 2026-09-11)

**Requirement:** any layout check tests *every available width* — every viewport in its list ×
every resizable region at its min, default and max × every layout mode (rail labels/icons, panel
open/closed). This is enforced, not advisory:

- `checkClipping(page, rootSel, label)` (test/wireframe_checks_lib.mjs) — a visible control, icon,
  image or canvas that is PARTLY cut off by an overflow-hidden container or the window edge.
  Fully hidden elements are ignored (a closed panel), and content inside a scrolling container is
  allowed to be half-scrolled out of view.
- `checkResizerCoverage(page, coveredIds, label)` — fails if the DOM has a drag handle
  (`[id$="-resizer"]`, `.fx-edge`) that the calling test's layout matrix doesn't name. Adding a new
  resizable region fails the gate until it is tested at min/default/max.
- `editor_responsive_qa.mjs` — 8 viewports × rail (labels, icons) × panel (220, 320, 440, closed) ×
  docked filmstrip (90, 120, 420) = 192 layouts; overlap + wrap + clip on each. Blocking gate.
  Ranges come from the app's own clamps (`fxPanelWidth`, `LIB_DOCK_MIN/MAX`) — update the matrix if
  those change.
- `library_responsive_qa.mjs` — 11 viewports × sidebar (150, 230, 420) clip sweep.
- `surface_coverage_check.mjs` (`npm run editor:surface-coverage`) — every layout region (id'd
  child of body/main/.fx-layout/#lib-overlay, or chrome-named) must have its OWN
  `design/surfaces.json` entry; being inside a bigger surface doesn't count. Advisory until S6b
  adds the chrome entries (T60), then blocking.

## Reviewed panel-diff baselines

Scoped panel checks never create or update an accepted baseline. A normal check fails when its
reviewed file is absent:

```bash
node test/editor_wireframe_diff.mjs --panel masks --json
```

Generate an unreviewed candidate only with the explicit flag below. It writes to the committed
`test/baselines/panel-diff-candidates/` review queue and prints a concise difference report.

```bash
node test/editor_wireframe_diff.mjs --panel masks --json --write-baseline-candidate
```

Do not move a candidate to `test/baselines/panel-diff-reviewed/` until the user has reviewed every
entry and supplied its acceptance reason. Missing controls/selectors are findings, not acceptable
empty observations. Reviewed files require `status: "reviewed"` and a non-empty reason per entry.
