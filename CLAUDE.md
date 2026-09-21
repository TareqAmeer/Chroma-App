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
   work** — 18 lessons that each cost real time. The one-line versions are in §6 below.
8. **Plans must define completeness from the running app, not a hand-typed list.** A plan that says
   "cover every X" names the scan that lists every X and makes that scan its done-criterion; it
   covers themes, every width, every resizer min/default/max and every state, and gets a
   fresh-context gap review. A hook blocks ExitPlanMode until the plan has a "## Completeness check".

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
.github/workflows/      ios-ipa.yml; desktop-release.yml (dmg + Windows NSIS installer) on `v*`
                        tag. ⚠️ macos-13 (x86_64) required by the Intel-only libonnxruntime.dylib;
                        dmg via hdiutil, tauri.macos.conf.json targets:["app"]
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

- RAW needs cross-origin isolation (`coi-serviceworker.min.js` handles it on Pages); `BUILD` stamp is hook-bumped.
- ⚠️ Payload: never inline bulk data into `chromasmith-22.html` (17.7MB already); check `gzip -9 -c chromasmith-22.html | wc -c`. The 11 `User Looks` stay inline; the other 102 LUTs live in `vendor/luts/`.
- ⚠️ Heavy JS goes in the pixel worker, built from the real functions via `toString` — never hand-copy.
- macOS preview servers can't read `~/Documents` — serve a copy from `/tmp/`.
- Full detail (LUT load order, lutcache store, worker parity, transferred buffers): [docs/dev-notes.md](docs/dev-notes.md) — load before touching LUT loading, `_cpuRun`, or payload size.



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

See [docs/app-tabs.md](docs/app-tabs.md) — Effects & Export, Match & Refine, Colour Copy, Collage, Guide.

---

## 5. Deep-dive reference docs (load on demand, not needed to run the app)

These cover work that touches a specific subsystem — load the relevant one instead of
carrying it in every turn:

- **[docs/windows-port.md](docs/windows-port.md)** — the Windows desktop-shell port: status table,
  phased plan, ground rules for changes that reach both platforms, and the Windows-vs-macOS
  tools/feature comparison. Load before any `desktop/src-tauri` or `.claude/hooks` work touching
  Windows, or before continuing the port.
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
  the evidence-driven component and per-panel loop, its focused checks, the order of work, and
  what each check can and cannot see. **Load this
  before any Editor layout/style work** — it supersedes HANDOVER_EDITOR.md's ordering, which
  predates the tooling now in place. `npm run editor:coverage` is its live status view.
- **[HANDOVER_EDITOR.md](HANDOVER_EDITOR.md)** — history of how that tooling got here: the
  regressions-only gate bug, the seeded backlog, lessons from the Library pass. ⚠️ Partly stale
  — several gaps it describes as missing (structural inventory, responsive sweep, behaviour
  suite) now exist. Read it for the reasoning, not the current state.

## 6. Process lessons

20 lessons, each cost real time: [docs/process-lessons.md](docs/process-lessons.md). Read before UI/layout, test or flaky-bug work.
Headlines: render-and-look before optimising; `overflow-x:hidden` kills sticky (use `clip`); typed arrays don't survive `JSON.stringify`; reseed before golden renders; `display:none` hides from the UI audit; never act on a flaky-bug theory without reproducing it live; completeness comes from scanning the running app, not a typed list.

---

## 7. Zone geometry & full calibration walkthrough

See [calib/CLAUDE.md](calib/CLAUDE.md) for chart zone pixel coordinates and the
full halation/grain/Fujify calibration method.
