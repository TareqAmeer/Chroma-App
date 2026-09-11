# Chromasmith — developer handoff

Chromasmith is a **single-file, fully-offline** browser app for film-emulation and
colour-grading photos: apply film looks (LUTs), grain, halation, bloom and basic
adjustments, then export at full resolution. It also builds LUTs from before/after
examples and decodes Panasonic RAW locally. Everything runs client-side in WebGL — no
uploads, no server, no build step.

This document is the entry point for anyone (human or AI) continuing the work. It covers
the architecture, the calibration science behind the film effects, the Python tooling,
and the hard-won lessons from building it.

**Contract — the handful of rules most worth not missing:**
1. Never blind-`Read` `chromasmith-22.html` in full (17.7MB) — `grep -n` first, then `Read` with
   `offset`/`limit`. A hook blocks a full read anyway; this is just so you don't hit it.
2. Reload the real page after ANY shader-string edit, even a comment — §3's backtick-truncation
   class doesn't show up any other way. Run `node test/export_harness.mjs` after too — it now
   fails on a GLSL compile error, not just a blank canvas.
3. For any live-app bug report (freeze, slow op, silent-wrong-behavior, memory growth, indexing
   stall) where the cause isn't already obvious from a stack trace or failing test, use the
   `chromasmith-debugger` subagent — don't investigate inline in the main thread. It's built
   around `diagnostics/` as primary evidence and verifies the fix live before declaring it done;
   several past sessions burned multiple rounds investigating inline what this now exists to do.
4. Commit and push after every real edit (`auto-commit` memory) — the user checks the live GitHub
   Pages build, so unpushed work isn't testable.
5. Bump `BUILD` in `chromasmith-22.html` — automatic via a hook, nothing to do here.
6. **Design-token values live in `design/tokens.json`**, not in the `:root`/`body.light` blocks —
   those (and library-ui.js's DS block) are generated between `/* TOKENS:*:START/END */` markers by
   `node scripts/build-tokens.mjs`. Edit tokens.json, regenerate; a hand edit inside the markers is lost.
7. **Read [docs/process-lessons.md](docs/process-lessons.md) before any UI/layout, test, or flaky-bug
   work** — 17 lessons that each cost real time. The one-line versions are in §6 below.

---

## 1. Repository layout

```
index.html              Product page (GitHub Pages root) — hand-written, NOT the app
app/index.html          /app/ → redirects to chromasmith-22.html
chromasmith-22.html     THE ENTIRE APP — HTML + CSS + JS + GLSL in one file
design/                 tokens.json (token source of truth), surfaces.json, specs — docs/ui-workflow/
site/                   Landing-page assets + generators (see site/README.md). ⚠️ WebP only:
                        .gitignore excludes *.jpg; encoder is Chromium (no cwebp, sips refuses webp)
LICENSES-MODELS.md      Bundled ONNX models + licences (EdgeSAM, SegFormer are non-commercial)
coi-serviceworker.min.js  Cross-origin isolation shim so RAW decode works on Pages
vendor/                 libraw (RW2 wasm), dcp (14 DC-S9 profiles), mediabunny (video, MPL-2.0,
                        lazy import), luts (102 of 113 presets as raw 33³ bytes — §2)
ios/, build-ios.sh, patches/   Capacitor iOS shell — docs/ios-shell.md
.github/workflows/      ios-ipa.yml; desktop-dmg.yml on `v*` tag. ⚠️ macos-13 (x86_64) required by
                        the Intel-only libonnxruntime.dylib; dmg via hdiutil, tauri targets:["app"]
calib/                  Calibration tooling (Python) — calib/CLAUDE.md. Not needed to run the app.
                        LUT LIBRARY/ (46) + dehancer/cubes/ (67) = source of every preset
```

**Not bundled** (gitignored; supply your own): original RAW/JPEG/TIFF captures, the venv,
and the proof/validation PNGs the scripts emit. The app ships **113** look presets: the 11
`User Looks` are embedded as base64 inside `chromasmith-22.html` (`LUT_PRESETS`), the other 102
live in `vendor/luts/`. `LUT_META` — not `LUT_PRESETS` — is the authoritative key list. Either
way the app is self-contained without `calib/`.

---

## 2. Running & developing

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

Deploy the folder as-is to GitHub Pages or any static host.

- **RAW support needs cross-origin isolation** (`SharedArrayBuffer` → COOP/COEP). GitHub
  Pages can't set those headers, so `coi-serviceworker.min.js` (registered as the first
  `<head>` script) enables isolation client-side and reloads once on first visit. Everything
  else works without it.
- **Build stamp:** `chromasmith-22.html` has `const BUILD='YYYY-MM-DDx'` near the top of its
  `<script>`, shown in the header + startup log, so users can spot a stale Pages/Safari cache.
  A `PostToolUse` hook (`.claude/settings.json`) auto-bumps it to today's date on any Edit/Write
  to the file — nothing to remember manually.
- ⚠️ **Watch the payload.** "Single-file" is about the app CODE, not about inlining bulk data.
  The preset library grew 11 → 113 as base64 string literals and took the file to **17.7 MB
  (10.2 MB gzipped)** — parsed in full on every web cold load, every iOS launch and every
  desktop `dist/` read. `calib/split_lut_presets.py` moved the 102 non-core presets into
  `vendor/luts/<key>.bin` as raw bytes (**3.02 MB / 1.76 MB gzipped**, a 5.8× cut in transfer).
  Before inlining any new bulk asset, check what it does to `gzip -9 -c chromasmith-22.html | wc -c`.
  - Load order in `presetBytes()`: inline `LUT_PRESETS` → IndexedDB `lutcache` → `fetch`.
  - The 11 `User Looks` stay inline **on purpose**: a bare copy of the HTML opened over
    `file://` cannot `fetch()`, and those are the looks that have to survive that.
  - ⚠️ The cache is a **second object store** (`lutcache`, DB v2). It must not share the `luts`
    store — `lutLibList()` is a bare `getAllKeys()` feeding the "My library" optgroup, so 102
    cached built-ins in there would all appear as the user's own uploaded LUTs.
  - `lutWarmCache()` pulls the rest into IndexedDB on idle after `load`, so the WEB build is
    genuinely offline-capable after one visit. Desktop/iOS read `vendor/` off local disk and
    never depended on it. Both build scripts already `cp -R vendor`, so nothing to wire up.
- **Heavy JS goes in the pixel worker** (`_cpuRun`, next to `srgbG`). `bakeDcpLUT` (65³ =
  274,625 iterations; **1157 ms of frozen UI** on every RAW load / profile change) and
  `exportSharpen` (a ~72M-channel loop over a 24MP export) both run there now.
  ⚠️ The worker source is **built from the real functions** via `Function.prototype.toString`,
  never hand-copied — `bakeDcpLUT` is an exact DNG-SDK transcription (docs/raw-dcp.md) and a drifting second
  copy would show up only as "RAW colour is subtly wrong". `perf_bench.mjs` asserts the worker
  and main thread agree to **max|Δ| = 0** over all 823,875 LUT entries, and that adding a
  dependency the worker can't see fails loudly rather than silently.
  ⚠️ Transferred `ArrayBuffer`s are **detached** in the main thread, so `_cpuRun` falls back to
  running inline only *before* dispatch, never after a job is in flight.
- **Local preview gotcha (macOS):** sandboxed preview servers can't read `~/Documents` (TCC).
  Serve a copy from `/tmp/` instead.


### iOS app shell
See [docs/ios-shell.md](docs/ios-shell.md) — load before touching `ios/`, `build-ios.sh`, `patches/` or `capNative()`.

### Calibration tooling
Setup + commands in [calib/CLAUDE.md](calib/CLAUDE.md) (auto-loads inside `calib/`); skill `chromasmith-calib`.

### Export regression gate (`test/`) — the fast way to verify a shader edit

```bash
npm test                          # everything below, in order
node test/export_harness.mjs      # renders every fixture x recipe into test/output/
node test/export_harness.mjs --golden   # regenerate test/golden/ (only when a change is intended)
npm run mask:test                 # raster-mask storage + round-trip + copy-on-write undo
npm run ui:test                   # desktop layout audit (see below); --json for detail
npm run perf:test                 # perf budgets; --baseline to re-record
npm run editor:gates              # Editor wireframe/inventory/responsive/coverage/snap/html gates
```

**[docs/testing.md](docs/testing.md)** has the full detail on what each gate above actually
checks and why (`ui_audit`'s six invariants, `perf_bench`'s seven budgets, `library_perf`'s
virtualisation/hashing fixes, `mask_raster`, `export_harness`'s determinism rules) plus the two
gates known to be flaky on this machine (`export_harness` blank-render / `video_harness` still-
frame mismatch) and how to tell a real regression from that noise. Load it before touching any
test file, not before running the tests. In short: `npm run editor:gates` (also `npm test`'s
`editor:gates` step, `githooks/pre-commit`, and CI) always rebuilds `desktop/dist/` first so no
gate can pass or fail against stale code; `python3 test/verify.py --editor [--full]` runs the
Library gates and the Playwright suite too. None of this closes the desktop-engine gap — every
check here drives Chromium, not the WKWebView the real Tauri desktop app renders with. A green
run means no Chromium-visible regression, not that the actual `.app` is unaffected.

---

## 3. App architecture (`chromasmith-22.html`)

Everything is in one file. The `FXR` WebGL2 renderer runs lut → emit → blur → comp passes;
grain is before print, saturation/vibrance after print, tiled export and the 1:1 loupe share one
mechanism. Full stage order and the reasons: [docs/render-pipeline.md](docs/render-pipeline.md) —
load before touching any shader, `render()`, `renderTiled` or the loupe (skill `shader-edit` too).

### ⚠️ The single most dangerous bug class
**Never put a backtick `` ` `` or `${` inside a GLSL `//` comment** — the GLSL lives inside
a JS template literal, so a stray backtick silently truncates the shader source and throws
`SyntaxError: missing ) after argument list`, breaking the entire page. This has bitten the
project twice. Use double-quotes for inline code/values in shader comments, and **always
reload the live page in a real browser after touching shader source**, even for a comment.

### ⚠️ The QUIETER shader bug class: a compile error that does not break the page
A GLSL compile/link failure does **not** white-screen the app the way a truncated template literal
does. The page loads, the UI works, and the affected program simply renders as if its whole feature
were switched off. That reads as a logic bug and can burn hours. It happened with a parameter named
`half` — a **reserved word in GLSL ES** — which silently killed the `lut` program, so *every mask
did nothing* while the app looked completely healthy. Other reserved words that read as innocent
identifiers: `half`, `input`, `output`, `filter`, `sample`, `cast`, `union`, `this`, `double`.

Practical rule: after ANY shader edit, run `node test/export_harness.mjs` and **watch for
`[console.error] GLSL compile error`** — the harness surfaces it immediately and would have caught
this in seconds. A silent no-op is worse than a crash, so never judge a shader change by "the page
still loads".

---

## 3b. Design tokens & typography

See [docs/design-tokens.md](docs/design-tokens.md) — `:root` token usage, typography, icons.

## 4. The app's pages

See [docs/app-tabs.md](docs/app-tabs.md) — Effects & Export, Match & Refine, Colour Copy, Guide (Collage not yet documented there).

---

## 5. Deep-dive reference docs (load on demand, not needed to run the app)

These cover work that touches a specific subsystem — load the relevant one instead of
carrying it in every turn:

- **[calib/CLAUDE.md](calib/CLAUDE.md)** — halation/bloom emission model science, `calib/`
  tooling, the grain model, Fujify Fujifilm-look recreation, chart zone geometry. Auto-loads
  when working inside `calib/`; load before tuning any `FXR.CAL.*` constant. See also skill
  `chromasmith-calib`.
- **[docs/skin-tone.md](docs/skin-tone.md)** — the Skin Tone mask: Oklab-based contractive
  colour operator, segmentation-first design, panel layout, auto-seeded samples, named
  subjects. Load before touching `mskRebuild`, `skinUniformity()`, `colRangeWeight()`, or the
  AI-mask panel.
- **[docs/raw-dcp.md](docs/raw-dcp.md)** — RW2/RAW decode + Adobe DCP camera-profile pipeline.
  Load before touching `loadRw2`, `bakeDcpLUT`, or `desktop/src-tauri/src/raw_decode.rs`.
- **[docs/lut-workflows.md](docs/lut-workflows.md)** — LUT chart capture/round-trip, Lumix Lab
  compatibility, device-link cubes. Load before touching `chartToLUT`/`writeCube`.
- **[docs/video-grading.md](docs/video-grading.md)** — video grading feature (demux/mux,
  per-frame grain seeding, HLG handling, trim/export, audio passthrough). Load before any
  video-related (`fxVideo*`) work.
- **[docs/testing.md](docs/testing.md)** — what each `test/` gate checks and why (perf budgets,
  virtualisation/hashing fixes, determinism rules), plus the two gates known to be flaky on this
  machine. Load before touching any test file; §2 above has just the run commands.
- **[docs/editor-redesign-plan.md](docs/editor-redesign-plan.md)** — the Editor redesign process:
  who designs what, the per-panel loop (design → `PAIRS` entry → spec item → behaviour test →
  implement → gates), the order of work, and what each check can and cannot see. **Load this
  before any Editor layout/style work** — it supersedes HANDOVER_EDITOR.md's ordering, which
  predates the tooling now in place. `npm run editor:coverage` is its live status view.
- **[HANDOVER_EDITOR.md](HANDOVER_EDITOR.md)** — history of how that tooling got here: the
  regressions-only gate bug, the seeded backlog, lessons from the Library pass. ⚠️ Partly stale
  — several gaps it describes as missing (structural inventory, responsive sweep, behaviour
  suite) now exist. Read it for the reasoning, not the current state.

## 6. Process lessons (one-liners — detail in [docs/process-lessons.md](docs/process-lessons.md))

- Calibration: render-and-look first; a fast all-requirements scorecard beats blind optimisation; prove a mechanism on a few point computations first (#1–3).
- CSS: `overflow-x:hidden` on html/body kills `position:sticky` (use `clip`); `column-count:1` still makes a multicol context (use `columns:initial`); every `.fx-row` child needs an `order` (#5, #8, #9).
- A comment claiming a complexity class is not evidence — read the loop (#10).
- Typed arrays don't survive `JSON.stringify` — masks go through `_mskToSnap`/`_mskFromSnap` (#11).
- Seeded-random goldens are order-dependent — reseed right before the render; prove neutrality by byte-compare (#12).
- `display:none` hides things from the UI audit too — dim, don't hide (#13).
- Library is native-gated — verify its layout via `?libtest=1`; migrate persisted state, don't just change defaults (#14).
- Before toggling a container's display/visibility, read ALL its children (#15).
- Resizable/breakpoint UI needs a state-matrix test at min/threshold/max, with hand-written expectations (#16).
- Never act on a written-up flaky-bug theory without reproducing it live first; rerun enough to see the rate move (#17).

---

## 7. Zone geometry & full calibration walkthrough

See [calib/CLAUDE.md](calib/CLAUDE.md) for chart zone pixel coordinates and the
full halation/grain/Fujify calibration method.

