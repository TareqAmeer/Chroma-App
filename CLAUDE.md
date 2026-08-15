# Chromasmith — developer handoff

Chromasmith is a **single-file, fully-offline** browser app for film-emulation and
colour-grading photos: apply film looks (LUTs), grain, halation, bloom and basic
adjustments, then export at full resolution. It also builds LUTs from before/after
examples and decodes Panasonic RAW locally. Everything runs client-side in WebGL — no
uploads, no server, no build step.

This document is the entry point for anyone (human or AI) continuing the work. It covers
the architecture, the calibration science behind the film effects, the Python tooling,
and the hard-won lessons from building it.

---

## 1. Repository layout

```
index.html                  Redirect → the app
chromasmith-22.html         THE ENTIRE APP — HTML + CSS + JS + GLSL shaders in one file
coi-serviceworker.min.js    Cross-origin-isolation shim so the RAW decoder works on
                            GitHub Pages (gzuidhof, MIT)
README.md                   User-facing intro + run instructions
CLAUDE.md                   This file
vendor/
  libraw/                   LibRaw WebAssembly RW2/RAW decoder (index.js, worker.js, .wasm)
  dcp/                      14 Panasonic DC-S9 Adobe DCP camera profiles (runtime copies)
  mediabunny/               MP4 demux/mux for video grading (§12) — MPL-2.0, kept as its own
                            file and lazy-`import()`ed like libraw, NOT inlined like pako/utif2
  luts/                     102 of the 113 built-in look presets, as RAW 33³ RGB bytes
                            (107,811 B each). Fetched + cached on demand — see §2's payload note
ios/ + package.json + capacitor.config.json + build-ios.sh + patches/ + .github/workflows/
                            Capacitor iOS shell → unsigned IPA built by CI (see §2)
calib/                      Calibration & analysis tooling (Python). Not needed to RUN the
                            app — only to re-derive/verify the film-effect constants.
  *.py                      Models, optimizers, validators, chart generators
  *.json                    Fitted parameter sets
  requirements.txt          Python deps (numpy/Pillow/scipy)
  README.md                 Tooling notes
  IMG_5774_2x.PNG           Clean base test chart (4800×6400)
  dehancer halation x2.png  Dehancer halation-only reference (the calibration ground truth)
  LUT LIBRARY/              46 of the shipped looks as .cube files (sideload-ready); the other
                            67 are in dehancer/cubes/. Together these are the source of truth
                            for every LUT_PRESETS / vendor/luts entry
  split_lut_presets.py      Moves the non-core presets out of the HTML into vendor/luts/ (§2)
  DCP Camera Profiles/      Source Adobe DCPs for the DC-S9
  fujify/                   Fujifilm-look recreation pipeline (scripts + notes)
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
  `<script>`, shown in the header + startup log. **Bump it in every session that edits the
  file** so users can spot a stale Pages/Safari cache. Current: `2026-08-14a`.
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
  never hand-copied — `bakeDcpLUT` is an exact DNG-SDK transcription (§7) and a drifting second
  copy would show up only as "RAW colour is subtly wrong". `perf_bench.mjs` asserts the worker
  and main thread agree to **max|Δ| = 0** over all 823,875 LUT entries, and that adding a
  dependency the worker can't see fails loudly rather than silently.
  ⚠️ Transferred `ArrayBuffer`s are **detached** in the main thread, so `_cpuRun` falls back to
  running inline only *before* dispatch, never after a job is in flight.
- **Local preview gotcha (macOS):** sandboxed preview servers can't read `~/Documents` (TCC).
  Serve a copy from `/tmp/` instead.

### iOS app shell (Capacitor → sideloadable IPA)

`ios/` wraps the SAME single file in a WKWebView (Capacitor 8, CocoaPods). Pieces:
- `build-ios.sh` stages `chromasmith-22.html → www/index.html` + `vendor/` (never point webDir
  at the repo root — calib/ would ship). `www/`, `node_modules/` are gitignored; `ios/` is
  committed (its own .gitignore covers Pods/build/public).
- `.github/workflows/ios-ipa.yml` builds an **unsigned `Chromasmith.ipa`** on a macOS runner on
  every push touching the app (this Mac has no Xcode — CI is the only build path). The user
  downloads the artifact and signs via **Flarestore**.
- `patches/@capacitor+ios*.patch` (applied by patch-package on `npm ci`) adds COOP/COEP headers
  in `WebViewAssetHandler` so `crossOriginIsolated`/SharedArrayBuffer (RW2 decode) can work in
  the shell. ⚠️ This is why the iOS platform uses **CocoaPods, not SPM** — SPM pulls Capacitor
  from a remote package that can't be patched; CocoaPods builds from `node_modules`. Whether
  WKWebView honors it is probed at startup (log line "SAB/RAW yes/no"); RW2 fails gracefully.
- In-app native hooks are ALL gated on `window.Capacitor` (`capNative()`), so browser/Pages
  behavior is untouched: `capShareFiles()` writes exports to the app cache (Filesystem plugin)
  and opens the NATIVE share sheet (Share plugin) — no user-activation limits, so the
  multi-photo "Tap to save" fallback never fires natively. `Info.plist` carries
  `NSPhotoLibraryAddUsageDescription` (share-sheet "Save Image" runs in-process and needs it).

### Calibration tooling

```bash
python3 -m venv .calibvenv && source .calibvenv/bin/activate
pip install -r calib/requirements.txt
python calib/scorecard.py        # FAST halation PASS/FAIL table (run first/always)
python calib/render_chart.py     # render a model + side-by-side vs the Dehancer reference
python calib/optimize_hal.py     # autonomous dense-loss optimizer (background-able)
```

### Export regression gate (`test/`) — the fast way to verify a shader edit

```bash
npm test                          # everything below, in order
node test/export_harness.mjs      # renders every fixture x recipe into test/output/
node test/export_harness.mjs --golden   # regenerate test/golden/ (only when a change is intended)
npm run mask:test                 # raster-mask storage + round-trip + copy-on-write undo
npm run ui:test                   # desktop layout audit (see below); --json for detail
npm run perf:test                 # perf budgets; --baseline to re-record
```

**`test/ui_audit.mjs`** walks every tool section at 1440×820 / 1600×1000 / 1280×720 in `?deskx=1`
and asserts six invariants: no panel fragmentation (§10.8), no control painted before its own
label (§10.9), no overlapping siblings, a 28px pointer-target floor (18px for checkboxes/colour
swatches, deliberately — see the comment in the file), an 11px font floor, and 4.5:1 text
contrast. Baselines live in `test/baselines/` — **not** `test/output/`, which is gitignored.
It exists because these defects are invisible in a screenshot of the DEFAULT panel and only
appear once a panel grows tall; reading its JSON is also far cheaper than round-tripping
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

**`test/mask_raster.mjs`** exists because **no export golden contains a raster mask** — every
recipe uses analytic shapes, so the entire brush/sky/AI storage path had zero coverage. It
asserts byte-exact snapshot round-trips, that legacy plain-`Array` masks still load, and that
painting cannot corrupt a history entry.

`test/export_harness.mjs` loads the REAL `chromasmith-22.html` in Playwright/Chromium (software
SwiftShader GL, so output doesn't depend on the host GPU) and drives it through the app's own
`applyUISnapshot`/`processToCanvas`. It is the cheapest way to prove a shader edit compiles and
that untouched paths are **bit-exact** — far faster than clicking, and it catches the
shader-truncation white-screen class of bug immediately (watch for `[pageerror]`). Recipes are
JSON in `test/recipes/`, fixtures are PNGs in `test/fixtures/` (`portrait.png` is a tanned field +
pale disc + dark dot — a deliberate uneven-skin test case). `test/probe_*.mjs` are ad-hoc probes
built on the same rig for measuring pixels rather than diffing images.

`npm run lint:ai` (part of `npm test`) is a source-level check, not a render one: it fails if any
raw `origin==='ai'` / `origin!=='ai'` comparison exists outside `mskIsAI()`. It exists because the
whole segmentation path is gated on `window.__TAURI__` and therefore **invisible to the browser
harness** — see the warning in §5b.

⚠️ Two determinism rules the harness enforces, both learned by having them fail silently:
- **Recipes are isolated per combo.** `applyUISnapshot` treats an *absent* `selects` key as "leave
  this alone" (correct for selective paste), so a recipe with no LUT used to inherit the previous
  recipe's LUT. Latent for a long time because `lut_look` sorted last and state resets per
  FIXTURE, not per recipe. The harness now clears `sel-lut`/`sel-print` explicitly and **throws**
  if state hasn't settled instead of rendering a knowingly-wrong frame into a golden.
- **The seeded `Math.random` stream resets per combo**, not per page. Per-page, each combo's grain
  depended on how many renders preceded it, so merely ADDING a recipe invalidated the grain
  goldens of every later fixture — a spurious "regression" with no code change behind it.

---

## 3. App architecture (`chromasmith-22.html`)

Everything is in one file. Key pieces:

- **`FXR` class** — the WebGL2 renderer. 5 shader programs: `lut`, `src`, `blur`,
  `blur_hal`, `comp`. Pipeline per frame:
  1. **lut pass** — full grading chain, in order: [optional **V-Log input transform**
     (`useVlog`): analytic inverse V-Log EOTF + exact V-Gamut→Rec.709 matrix, before anything
     else] → sharpen/clarity unsharp mask (on source pixels) → look LUT → [**HSL mixer**
     (`useHsl`): a 2nd 33³ LUT re-baked on the CPU from `applyHSL()` whenever a band slider
     moves] → `basicAdjust()` (exposure/contrast/WB/etc.) → [**local-adjust masks** (`mskN`):
     up to 8 analytic radial/linear masks passed as vec4 uniform arrays (`MSK_MAX=8`), global-uv mapped via
     `uvOffL/uvScaleL` so preview/loupe/export tiles place them identically; per mask
     exp/con/temp/sat/**Texture** + luminance-range gate + **colour-range gate + skin-tone
     uniformity** (§5b) + **Amount** (`mskE.w`, one master scale over the finished selection;
     muting rides this slot at 0) + invert. Mask **"type 2" is SHAPELESS** — weight 1 everywhere,
     so the range gates alone select; that is the Colour Range / Luminance Range mask, and for it
     `invert` flips the GATES rather than the shape (inverting a full-frame shape gives zero).
     ⚠️ Texture reuses `srcHP`, the source high-pass hoisted to the top of `main()` and shared with
     the global Sharpen/Clarity, gated on `mskAnyTex` so its 4 extra taps are never paid by
     default] → [**tone curves** (`useCurve`):
     256×1 table baked from monotone-cubic point curves, sampled at texel centers so identity
     is byte-identical]. Each optional stage is gated off (and identity-gated in
     `getFXParams`) by default. ⚠️ **Saturation & vibrance are NOT applied here** — they moved
     to the comp pass (see below). ⚠️ GLSL functions must be DECLARED BEFORE USE — `maskAdjust`
     once referenced `s2lp` above its definition and blacked the whole pipeline.
  2. **emit pass** — computes the halation/bloom *emission* map from the graded image.
  3. **blur passes** — per-channel Gaussian blur of the emission (σ_R ≫ σ_G ≫ σ_B).
  4. **comp pass** — screen-blends bloom+halation, then **grain** (value-noise, see §6b), then
     **film artifacts** (procedural dust/hairs + wobbling vertical scratches + warm light leak;
     image-relative coords + a stable seed `fxState.artSeed`/Reshuffle so preview==export, and
     tile renders are byte-identical), then (if a Print profile is selected) a 2nd 3D LUT
     `printLut` via `usePrint`/`setPrintLUT`, then **saturation/vibrance** (`adjSat2`/`adjVib2`),
     then vignette. Order mirrors Dehancer:
     negative → halation → **grain** → **artifacts** → **print** → **grade (sat/vib)** → vignette.
     - ⚠️ **Grain is BEFORE print** (it's in the negative; the print stock then modulates it).
       Identity vs after-print when no print profile is selected.
     - ⚠️ **Saturation/vibrance run AFTER print** on purpose: pulling saturation to 0 must
       collapse the PRINTED pixel to its luma (neutral), not re-tint an already-grey pixel. If
       they ran before print (the old order), a print profile re-tinted neutrals and
       0-saturation no longer matched Dehancer (`calib/*lut print 0 sat*.png`: DH grey→neutral).
- **`render(P,w,h,opts)`** — `opts.glowScale` downsamples the blur buffers (cheap preview);
  `opts.scOverride` forces the sigma-scale (= fullWidth/REF) so a tile/crop blurs with the
  *whole image's* radius; `opts.uvOff/uvScale/seed` keep grain continuous across tiles.
- **Tiled export** (`renderTiled`) — processes huge images in overlapping tiles with a
  halo ≥3σ so peak GPU memory stays tiny and seams are mathematically invisible. The 1:1
  loupe reuses the same mechanism.
- **Preview** renders at `devicePixelRatio` (capped 2×) into a ~1800px backing store, then
  CSS-fits it. The **1:1 loupe** instead renders a native-resolution crop with
  `scOverride=fullWidth/REF` so grain & halation appear at *true export* scale.

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

## 3b. Design tokens & typography (added 2026-08-09)

All in the `:root` block at the top of the `<style>`. **Use the tokens; don't reintroduce literals.**

- **`--sans` = Inter Variable 400–700, `--display` = Instrument Serif Italic** — both embedded as
  base64 `@font-face` data URIs (Latin subsets, ~85KB combined; SIL OFL 1.1, credited in the
  Guide). The app is offline and single-file, so there is no CDN to fetch from and no `font-display`
  to worry about. `--serif` is kept as an alias of `--display` so older rules still resolve.
- ⚠️ **`--mono` is for numerals, code and the build stamp — it is not a UI voice.** It was used
  81× against 8 of `--sans`, with 23 `text-transform:uppercase` rules on top, which is what made
  the app read as generated "technical" UI rather than a photo tool. **Uppercase now survives in
  exactly one role: the panel/section eyebrow** (`.fx-ctrl-title`, `.fx-sub`). Numeric readouts
  carry `font-variant-numeric:tabular-nums` so figures don't jitter as they change.
- `--fs-0..7` type scale, `--sp-1..6` spacing, `--ease`/`--dur-1`/`--dur-2` motion. Smallest UI
  text is 11px (`--fs-1`); `test/ui_audit.mjs` enforces that floor.
- **Accent (`--acc`) is an information channel, not decoration**: primary action, active
  navigation, and "you changed this" (`.fx-row.fx-mod`). It is deliberately NOT used for active
  segmented-control items or for every slider fill.
- **Icons**: one stroke set in `ICONS` (Lucide-shaped, ISC), rendered via `icon(name,size)` at
  16 / 20 / 22px only. **No emoji and no unicode glyphs in desktop chrome** — they render
  per-platform and never match a stroke weight.
- **Sliders** fill from the CENTRE on symmetric ranges (`fxPaintSlider` derives bipolarity from
  each element's own min/max, so dynamically built rows need no wiring) and stay neutral grey
  until the value leaves its default.
- **A section that is switched off is dimmed (`.fx-fields.ff-off`), not `display:none`** — and
  touching any control inside it turns the section on. See §10.13 for why hiding it was actively
  harmful.

## 4. The four tabs

- **Effects & Export** — load image, pick an **Input profile** (Standard or **V-Log (Lumix)** —
  converts V-Log/V-Gamut→Rec.709 before the look LUT), a preset/LUT, a **Print profile**
  (Kodak/Fuji print, applied as a 2nd 3D LUT AFTER the film look + halation — see §8), basic
  adjustments, **Tone Curves** (master+R/G/B point-curve editor), **Color Mixer** (8-band HSL),
  **Local Adjustments** (up to 8 masks — radial/linear/brush/sky/AI plus shapeless **Colour Range**
  and **Luminance Range**; each carries Amount, Texture, an optional **Skin Tone** colour-range gate
  + uniformity (§5b), a live thumbnail, and can be reordered/renamed/muted/soloed; raster (brush/
  sky/AI) masks store at up to 2048px and have an edge-aware **Refine** button — a guided filter
  that snaps their edges to the photo's own boundaries), grain/**Film Artifacts** (dust/scratches/
  light leak + Reshuffle)/halation (incl. **No remjet** strong mode — see §5)/bloom/vignette/
  borders, **Canvas** (aspect-ratio matte around image+borders — ratio chips/zoom/bg color or
  blurred-photo fill via `canvasCompose()`, shared by preview & export; order: photo → borders
  → canvas), crop/rotate/straighten, export at full res. Plus: one-tap Looks gallery, WB
  eyedropper, auto-enhance, undo/redo (⌘Z/⌘Y, covers geometry, curves, HSL and masks too),
  split before/after, live histogram, zoom/pan, 1:1 loupe, session save, EXIF readout, batch
  export with progress + cancel.
  - **Multi-photo batches**: dropping several images loads them all into `fxImages[]`; a
    **filmstrip** of thumbnails appears below the preview (`buildFilmstrip()`/`fxSelectImage()`) so
    you can click any loaded photo to preview/crop/rotate it (`fxCurIdx` — NOT always index 0;
    `curItem()`/`curGeom()` follow it). Effects/adjustments apply to every photo identically
    (shared `fxState`/sliders); geometry (crop/rotate/flip/straighten) is also shared across the
    batch, broadcast from whichever photo is currently selected (`broadcastGeom()` reads
    `curItem()`, not `fxImages[0]` — a photo-specific edit must propagate from the photo actually
    being edited). An **All photos / Current photo** export-scope toggle appears once >1 photo is
    loaded (`fxExportScope`).
  - **Mobile (≤700px) is app-shaped, not web-shaped**: the photo fills the screen; tapping a
    tool icon slides up a bottom sheet (`body.sheet-open`, 42vh — ⚠️ Chrome will NOT
    interpolate a height transition from 0 to `min()`/`calc()`, use a plain length +
    `max-height` cap) and `fxPreviewMaxH()` measures the LIVE wrap for re-fits. Global
    `user-select:none` (inputs exempt), tabs hidden behind the ⋯ action-bar sheet
    (`fxMoreMenu`), big ＋ empty state (`fxPickPhotos`), `toast()` pills, slider value
    bubbles + double-tap-to-reset, swipe-to-switch photos, long-press-to-compare, dbl-tap
    zoom, export overlay (`_expOverlay`), looks gallery relocated to a horizontal preset
    rail under the preview (`relocatePreviewTools`). Haptics via `hapt()` (native-gated).
  - ⚠️ **`exportFX()`'s Phase-1 render loop wraps EACH photo in its own try/catch.** Before this,
    one bad/oversized/corrupt photo mid-batch threw out of the loop straight to the outer catch —
    every photo rendered *before* it was silently discarded (`saveFiles` never ran) with only an
    error logged, so a batch export could "lose" photos with no obvious cause. Now a per-photo
    failure is logged and skipped; the rest of the batch (and anything already rendered) still
    saves. The final `updateWork()/renderPreview()` preview-refresh call is *also* separately
    try/caught, so a failure restoring the on-screen preview after export can never be confused
    with (or mask) a real export failure.
- **Match & Refine** — before/after pair → fits a `.cube` LUT empirically (no model
  assumptions). Optional starting `.cube`/`.xmp`. Emits a per-colour HSL summary.
- **Colour Copy** — per-channel histogram match from a reference image → `.cube`/`.xmp`.
- **Guide** — in-app how-to + FAQ (mirrors the README).

---

## 5. Halation calibration — the core science

**Goal:** make the WebGL halation/bloom indistinguishable from Dehancer's film emulation
at a glance, then refine numerically. Because the app's clean base chart (`IMG_5774_2x.PNG`)
is **pixel-identical** to Dehancer's own base, `our_render` can be diffed directly against
`dehancer halation x2.png` — no base-grading confound.

### The committed rule-based emission model (v22.1b)

```javascript
// FXR.CAL.halation in chromasmith-22.html:
halation:{thr:0.10,knee:0.141,power:1.0,bluesupp:0.9691,
          powL:3.9247,kW:1.0028,kC:0.8860,aG:0.1972,bP:2.10,
          powLg:3.9247,gA:-1.0,gB:0.15,                 // green channel: lum curve + G≥R hue gate
          sigmaR:7.5233,sigmaG:2.9672,sigmaB:1.1285,
          gainR:1.2380,gainG:0.0764,gainB:0.0,defAmount:70}  // gainG dot-safe (see ⚠️ below)
```
(σ are at the 1×/2400px reference width — double them for the 2×/4800px calibration images.
`bluesupp` doubles as the model's `bB`.)

### Two-channel emission (warm red + hue-gated green = the yellow band)
The emission is **two channels** (the `src` shader writes `o.rg`), blurred independently by
`blur_hal` (σ_R for red, σ_G for green) — so a bright edge reads white→**yellow**→orange→red
(σ_R≫σ_G: near the edge R+G overlap = yellow, deeper only R = red). This yellow band appears in
BOTH standard and no-remjet (calib/optimize_hal_twochannel.py):
```
sat    = max(R,G,B) − min(R,G,B)
white  = lum ^ powL                                            // steep brightness-toward-white
color  = sat · max(R + aG·G − bB·max(B−R,0) + bP·min(R,B), 0)  // asymmetric blue-supp + magenta
emitR  = smoothstep(thr,thr+knee,lum) · (kW·white + kC·color)  // warm backing — ALL bright sources
gate   = smoothstep(gA, gB, G − R)        // ~1 when G≥R, ~0 when R≫G   (LINEAR-light G,R)
emitG  = smoothstep(thr,thr+knee,lum) · lum^powLg · gate       // YELLOW driver — hue-gated
glow.r = max(blur_σR(emitR) − hp·emitR, 0) · gainR             // PER-CHANNEL high-pass (hp uniform)
glow.g = max(blur_σG(emitG) − hp·emitG, 0) · gainG
result = screen(base_linear, glow)
```
The **hue gate** (`G≥R`) is the key: green fires only for white/grey/yellow/green/cyan and NOT
red/orange/purple — so red/orange/purple keep a pure-red halo (matches Dehancer's measured per-
colour halo G/R: red 0.0, orange 0.15, purple 0.01, yellow 0.56, green/cyan 0.72, white 0.60). ⚠️
Don't drop the gate or red bars grow a wrong orange rim. Standard RED params (gainR/sigmaR + the
emitR constants) are UNCHANGED from the single-channel v22 fit, so red-based scorecard metrics are
byte-identical; only the green channel (gainG/sigmaG/powLg/gA/gB) was added.

### Why this shape (the physical insight that unlocked the fit)
Real film halation: any bright source scatters off the film backing and re-exposes the
emulsion in the **backing dye's colour** (red-orange), regardless of the source's own
colour. So two emission drivers are needed:
- **`kW·lum^powL`** (powL≈3.9, steep): a pure-brightness term. White glows strongly; mid-grey
  barely (0.5^3.9≈0.07). This keeps flat grey bars neutral instead of self-tinting pink.
- **`kC·sat·warmth`**: a saturation/warmth term so saturated colours (red, green, cyan,
  purple…) halate while neutrals (sat=0) don't. Only the blue *excess over red* is suppressed
  (`bB`), so purple (R≈B) halates while cool/blue stay suppressed.

A single driver can't do both: brightness-only can't make saturated red (lum≈0.3) halate;
red-channel-only makes flat greys self-emit and pink-flood.

Three fixes layered onto the original v22 to kill user-reported defects the gap-only
point-sample harness missed:
1. **Asymmetric blue suppression** (`−bB·max(B−R,0)`): makes purple halate (it was 0.000)
   while keeping neutrals provably untouched (sat=0 zeroes the whole colour term).
2. **High-pass glow** (`max(blur(emit)−emit,0)`): in a uniform field, light scattered out ≈
   light scattered in → net halation ≈0, so large flat colour blocks stop self-flooding
   ("red bar turns orange" bug); halation only appears at gradients/edges. Decouples
   gap-halo strength from interior flooding so `gainG` can stay nonzero (soft red-orange).
3. **Magenta/purple driver** (`+bP·min(R,B)`, bP=2.10): `min(R,B)` is nonzero only where R
   *and* B are both present (magenta/purple/pink), so it boosts purple strength
   (0.187→0.327, matching Dehancer's 0.325) without touching any other hue. Needed because
   this chart's purple is `(200,0,200)` with R==B exactly, so `bB` (an R/B-excess suppressor)
   is provably inert on it.

### Halation "No remjet" + "Extreme" toggles
Real film without the anti-halation remjet backing halates much more strongly. The `No remjet`
toggle (default off = bit-identical standard behaviour) uses
`FXR.CAL.halation.noRemjet={gainR,gainG,gainB,sigmaScaleR,sigmaScaleG,thr,hp,powL,powLg}`. Three
things differ from standard, each from a separate piece of evidence in `dehancer no remjet x2.png`:
1. **Stronger/wider** — higher per-channel gains + σ scales. White-edge fit is analytic (outside a
   white edge the surround is black so screen() is a no-op:
   `result_c(d)=l2s(src·gain_c·½·erfc(d/(σ_c√2)))`) — an exact instant fit (edge RMS ≈2.3/255).
2. **Lower luminance to halate** — flatter `powL`/`powLg` (≈1.6 vs the standard steep 3.92) so dim
   greys *and* cool tones glow (the standard exponent zeroes mid/dark-grey emission). `powL` is fit
   to the grey-row left-edge halo strengths.
3. **Smooth flooded interior** — low `hp` (0.55). The comp shader does a **per-channel** high-pass
   `rawH -= emit*halHP`; a high `hp` carves a dark ring / colour step just inside bright blocks
   (the v1 "weird inner glow" bug), so no-remjet lowers it to flood interiors smoothly like the
   reference.

⚠️ **Fit the white-EDGE, not the whole chart.** A global RGB chart loss pushes green DOWN (the
green that yellows a white edge over-greens coloured edges) — the trap that produced the weak
reddish-orange v1. Use `calib/optimize_hal_twochannel.py` (white-edge erfc + grey-row powL +
rainbow-column hue-gate check).

⚠️ **`gainG` must be DOT-SAFE (the 2D over-peak trap).** Green has a narrower σ than red, so on a
**compact** source (a dot) the green blur over-concentrates in 2D and can exceed red → the white
dot glows *green* instead of yellow (a real user-reported bug). A 1D white-edge fit misses this
(1D amplitude scales as gain/σ, 2D as gain/σ²). Keep `gainG ≲ gainR·(σ_G/σ_R)²` so the green peak
stays below red everywhere (verify: a white dot has **0** pixels with G>R, max G/R<1). This caps
the edge yellow somewhat — that's the unavoidable trade for not greening dots. ⚠️ **A single gain
can't match both a tiny dot and a big bar** (Dehancer's halation isn't linear in source size — the
dot needs ~3× the gain a bar wants, which would clip the bar). Tune `gainR` to the BIG sources
(bars/blocks) and accept that tiny dots glow a bit weaker than Dehancer; the dot's *hue* (yellow
not green) is what matters.

The **`Extreme`** toggle multiplies the no-remjet gains by `extremeScale` (≈3 → ≈×5–6 of
standard) for a heavy stylised bloom; it implies no-remjet. Both default off; both carried through
preview, export, session and FX snapshot.

### Halation "Shadow protect" slider
Dark eyes fully surrounded by bright fur/skin flood red with halation on (σ_R ≫ σ_G glow
fills small dark enclosures). Physically correct but reads as red-eye. The `Shadow protect`
slider (default 0 = bit-identical calibrated behaviour) scales the received glow by
`smoothstep(0, halProt, lum(base))`. ⚠️ A receiver-lum gate can NEVER default on — the
chart's gaps are pure black (lum 0), darker than real eyes, so an always-on gate would kill
the Dehancer-matched gap halos.

### Two-sigma investigation (concluded: not worth it)
The gray80 gap halo is slightly weaker than Dehancer (0.43 vs 0.60), but it already PASSES.
A two-sigma architecture (separate blur for the neutral vs coloured term) was prototyped
thoroughly: **every** configuration that closes gray80 introduces a new white-overshoot or
green/cyan failure. Root cause: Dehancer's gray80 gap is *stronger* than its white edge
(0.60 vs 0.46) — an inversion impossible for a brightness-driven emission where white is
both brighter and closer to its sample point. It implies Dehancer **saturates** neutral
emission; ours doesn't. The current single-sigma model sits at a genuine Pareto-optimum.
Don't reopen this without an emission-curve change and a willingness to re-fit everything.

### Calibration method
`optimize_hal.py` builds a "glance" loss — `mean(w·|squint(ours) − squint(dehancer)|)` where
`squint` is a downsample/blur (models "can't tell at a glance") and `w` upweights gaps/edges/
colour blocks — and minimizes it with scipy Nelder-Mead, entirely in Python (zero token cost
per eval). The inner-edge "tiny glow" the user wanted is **emergent** from the channel-split
blur (σ_R ≫ σ_G): at an edge both glows overlap (amber), deeper only red remains (deep red) —
a dedicated inner-glow term optimized to ~zero gain, so none is needed.

---

## 5b. Skin Tone — the one CONTRACTIVE colour operator

### Panel layout (rebuilt 2026-08-09 — read this before editing `mskRebuild`)
The panel is three **collapsible groups**, not one flat column: **Selection** (which pixels) ·
**Adjust** (what to do to them) · **Skin Tone** (`origin==='skin'` ONLY). Open/closed state is
per-GROUP in `localStorage`, not per-mask. Rare operations (reorder, rename, mute, solo, eraser,
subtract, invert, delete) live in the `⋯` menu (`mskMoreMenu`) on the mask's own row, which also
shows state as chips rather than glyphs appended to the name.

⚠️ **The colour-range gate belongs to Selection, not to Skin Tone.** It chooses *pixels*; skin
uniformity is an *adjustment*. On an ordinary mask it renders in Selection; on a Skin mask it is
step 1 of the guided flow — so it appears exactly once either way. It previously rendered under a
"Skin Tone" heading on every mask type including Radial, Linear and Luminance Range.

The guided flow is **presentation only** — `skinUniformity()`, `colRangeWeight`, `mskSkinTarget`
and `mskMeasureSrcV` are untouched. The label mapping is: Strength → `uH`+`uS` together (both
axes remain under Advanced), Keep shading → `preserve`, Only darken → `tanOneWay`, Depth/Warmth →
`tanDepth`/`tanWarm`. `MSK_SKIN_PRESETS` are plain value sets, nothing new.

Two findings below are now surfaced *in the panel* rather than only documented here, because they
are the ones that silently make results worse: a live "N samples · about X% selected" readout, a
warning at one sample, and a warning when `feather > 0.4` lets the shape outvote the colour gate.
⚠️ `crWeightJS(h,C,samples,range)` takes `range` as **0..100** and divides internally — pre-
dividing collapses the kernel to ~zero width (this is how the coverage readout first shipped
reporting 0% for every photo).


Every other colour control in the app is **additive**: `adjSkin`, `applyHSL`,
`applyPointColors` and `maskAdjust` all compute `x → x + Δ`. Adding a constant leaves the
*spread* of the selected tones untouched — which is why a patchy tan resists all of them: raising
warmth moves a pale chest and an already-tanned face equally, so the chest stays pale relative to
a face that is now over-cooked.

`skinUniformity()` (lut pass) is the missing operator: `x → x + w·u·(target − x)`. Distance to a
reference tone shrinks by `(1−u)`, so far-from-target pixels move a lot and near-target pixels
barely move. **Tan** moves the TARGET (resolved on the CPU in `mskSkinTarget`), never the pixels,
so pushing it deepens the whole selection instead of compounding on the dark parts. Modelled on
Capture One's Skin Tone tool; Lightroom has no equivalent.

Three per-mask pieces, all reusing the existing mask machinery:
- **`colRangeWeight()`** — gates the mask by hue/sat near up to 4 eyedropper picks (`mskG` holds
  the count + range, `mskCS` the samples, two per vec4), multiplied into `w` beside the lum gate.
  The gate is the **UNION (max)** of the per-sample kernels, not a sum: overlapping picks must not
  push past 1, and it keeps the weight FLAT across the sampled region (see the failure mode below).
  Same kernel shape as `pcWeight` but ⚠️ **deliberately without its `min(1,s*3)` saturation floor**
  — skin highlights and sheen are genuinely low-saturation, and that floor would drop the
  brightest skin out of the selection and leave a bright halo along every highlight.
  ⚠️ **One sample cannot cover a body.** Skin straddles the hue wrap point: matte skin sits just
  above 0.0 and sheeny/pinker skin just below 1.0. Measured on `__TM3390.jpg`, a gate centred on
  the cheek gave the lower chest only **0.04** — so the palest area, the one furthest from the
  target, barely moved and hue *diverged*. Hence multi-sample, and hence `crSampleMean` uses a
  **circular** mean for hue (a plain average of 0.98 and 0.02 gives cyan, not red).
- **Target decoupled from the gate centre** (`mskI`) — Match pick / **Monk Skin Tone** swatch (10
  shades, CC BY 4.0, credited in the Guide) / any custom colour. The gate must be picked from the
  photo; the target must not have to be, or a tan tone absent from the frame is unreachable.
- **`preserve` ("Preserve modeling", `mskH.w`)** — required once the target is absolute. Converging
  every pixel's V onto a fixed swatch value would crush the subject to one flat lightness and make
  shadowed skin as bright as lit skin. `vRef` mixes between the pixel's own value (0 = true
  contraction: evens a tan LINE, flattens form) and `srcV`, the measured mean of the gated pixels
  (1 = a pure level offset, form intact). ⚠️ `srcV` is measured ONCE in JS (`mskMeasureSrcV`, off
  the graded preview canvas) and passed as a uniform — re-measuring per export tile would make
  each tile converge to a different level and show as blocks. Its JS gate mirror must stay in sync
  with `colRangeWeight`.

**`mskShowSel` / the "Selection" preview mode** renders a mask's *effective* weight (shape × lum
gate × colour gate) as a red overlay. `mskOverlaySync` draws only the SHAPE in JS/SVG, so it never
showed the lum gate either; a colour range is untunable blind. Only the two `renderPreview` calls
pass `showSel` — exports never do. It does not yet reach the 1:1 loupe (see `ROADMAP.md`).

### ⚠️ SEGMENT FIRST, then refine by colour — do not repeat this mistake
`+ Skin` is **desktop-only and segmentation-first**: scribble over the subject, EdgeSAM/SAM2
(`desktop/src-tauri/src/sam.rs`) returns them, and the colour samples refine *within* that region.
`mskIsAI(m)` (not `origin==='ai'`) routes the AI plumbing, so a Skin mask is an AI mask.

⚠️ **A Skin mask has `origin:'skin'` with `ai:true` — never compare `origin` to `'ai'` directly.**
When this refactor was first done, a grep for `origin==='ai'` found and fixed five call sites and
silently missed four written as the NEGATED `origin!=='ai'`. Two were on the scribble path —
including the `pointerdown` handler, which bailed before collecting a single point — so scribbling
did *literally nothing* on a Skin mask while the panel showed the tool armed and healthy. Nothing
caught it: the segmentation path is gated on `window.__TAURI__`, so the browser harness cannot
reach it at all. `npm run lint:ai` (`test/lint_ai_origin.mjs`) now fails the build on any such
comparison; verified it flags all four against the commit that shipped the bug.

The tool was originally built the other way round — colour gate first, geometry as an afterthought —
and that cost real time for a structural reason worth stating plainly: **a colour gate cannot answer
"which pixels are this person".** A pet, wet hair, sunlit limestone and a bystander all sit inside
skin's own hue/saturation range. Measured on `__TM3390.jpg`, trying to force it produced a clean
oscillation, each fix breaking the previous one:
- a bounded ellipse dropped skin the gate had already found (far arm 0.35, outer shoulder 0.66,
  armpit 0.68, chest side 0.83 — all at gate 1.0);
- going shapeless fixed that but admitted the mountains, not at block-average level (every rock
  probe reads 0) but **per pixel**, where limestone's chroma noise is genuinely skin-coloured;
- a neutral floor killed the rock but also killed chest hair and beard, punching speckled holes
  through the chest, because saturation cannot tell bright near-neutral rock from dark near-neutral
  hair. (Gating that cut on luminance separates them, and is what ships — but it is a patch on the
  wrong architecture.)

Geometry separates all of it trivially. Two supporting pieces stayed, both useful in their own
right: the gate is evaluated on a **4×4 box-averaged colour** (`progs.lumdown` → `skbox`, sampled as
`skinCol`) so isolated noisy pixels cannot pass — select from a denoised copy, apply to the sharp
pixel — and `crWeightJS` mirrors the gate for `srcV`, so ⚠️ any change to `colRangeWeight`
**including its luminance term** must be mirrored there or `srcV` silently drifts.

### ⚠️ The non-obvious failure mode: FLAT weight matters more than high weight
Each pixel moves by `w·u·(target−x)`, so a spread in **w** across the skin competes with the
spread in **distance** — and when w wins, the tones stop converging and can actively diverge. Both
halves of `w` have to be kept flat over the subject:

- **The gate** — via enough colour samples. Measured on `__TM3390.jpg`
  (`test/probe_tm3390.mjs`, 6 skin points from cheek to lower chest): **1 sample** → gate weights
  0.04–1.00 and hue **diverged**; **2 samples** → 0.86–1.00, hue closed 40% / sat 45%;
  **3 samples** → sat closed 49%.
- **The shape** — via a LOW feather. ⚠️ Counterintuitive: `feather` is where the falloff *starts*,
  so a high feather fades from the ellipse **centre** and makes the shape the dominant term. Back-
  solving the ellipse radius for each skin point gave `t = 0.11..0.42`; at feather 0.25 (falloff
  starts at t=0.5) every skin point gets shape exactly **1.0**, and the effective-weight spread
  fell from **0.82 → 0.156**. Final result on lit skin: hue closed **47%**, sat **38%**.
  ⚠️ `feather` is stored **0..0.5** — the shader's `max(1-2f,0)` saturates at 0.5, so the top half
  of the old 0..1 slider was inert. The slider now maps 0-100 → 0-0.5 and `_mskMigrate` clamps;
  both are no-ops for how existing masks render.

Hence `+ Skin` defaults to Range 55, feather 0.25, and a UI that pushes shift-click-to-add-samples
plus the Selection view. **A weakly-selected patch that is far from the target makes things worse,
not better.**

⚠️ **Value/lightness is deliberately NOT expected to converge.** Two of those six points are deep
shadow (v 0.365 and 0.208); forcing them to match the sunlit cheek's brightness is exactly the
form-destroying flattening `preserve` exists to prevent. Judge lightness only across *lit* skin,
and expect a small number there (14%) at the default `preserve = 70`.

**The skin path works in OKLAB LCh, not HSV** (`GLSL_OKLAB`, interpolated into both the lut pass and
`lumdown`; `rgb2oklch`/`oklch2rgb` mirror it in JS). ⚠️ Only the skin path — `applyHSL`,
`applyPointColors` and `deriveXMP` stay on `r2hsv`, since they are separately calibrated.
Constants verified before use: white/black/grey give a=b=0 exactly and a 20k-sample sRGB round trip
errs by 4.2e-4/255.

This is what collapsed two hand-tuned cuts into one. HSV "saturation" is near-identical for bright
limestone and deep-shadow skin, so separating them needed a bright-neutral cut AND a dark-value cut
— and the dark cut then scored the darkest beard pixels 0.12, punching visible holes through the
beard and chest. Oklab **chroma** separates all of it on one perceptually-uniform axis:

| | Oklab C | gate |
|---|---|---|
| rock / scree | 0.0046 | 0 |
| sunglass lens | 0.0051–0.0101 | 0 |
| **cut** | **0.010 → 0.016** | |
| wet hair / shadowed pec | 0.0176 / 0.0186 | 1 |
| darkest beard | 0.0201 | 1 |
| lit skin | 0.049–0.075 | 1 |

Oklab `L` is also real lightness rather than `max(r,g,b)`, which is what the frequency separation and
Preserve modeling were always meant to act on — ⚠️ hence `lumdown` emits `rgb2oklab(sc).x` in its
alpha, NOT a Rec.709 luma, or the low-frequency reference and the target would sit on different
scales. Measured after the move: hue spread closed 70%, chroma 65%, weight spread 0.039.

**Older HSV-era cuts, kept for the reasoning:**
- *Never bright and neutral* — `1 - neutral*smoothstep(0.45,0.68,v)`. Bright near-neutral is rock,
  snow, concrete; dark near-neutral is hair, beard and brows, which must stay selected or they
  punch speckled holes through the chest and jaw.
- *Never near-black* — `smoothstep(0.12,0.22,v)`. Sunglasses, pupils and eye sockets measure
  v = 0.02..0.11 while the darkest real skin in the frame (shadowed pec, shadow under the jaw)
  measures v = 0.32..0.33 — ~3x margin either side. Without it the glasses were tanned: the
  eye-socket pixels sit at h=0.959, only 0.048 round the wheel from the skin samples (just across
  the wrap), so they passed hue and saturation cleanly.

⚠️ **Colour alone cannot exclude a same-hued subject.** Sampling shadowed skin (93,49,40 — dark
brown) necessarily pulls dark brown dog fur in: with a flat shape the dog's head gated **0.75**.
The shape must do it — drag the ellipse off the animal, or add a Brush mask with `− Subtract prev`.
The structural fix was a segmented person/skin mask (ROADMAP item 4, done — `+ Skin` is
segmentation-first) plus, for what SAM's subject mask still can't separate from skin (lips, eyes,
glasses, hair), automatic face-feature exclusion (ROADMAP item 16, done —
`desktop/src-tauri/src/faceparse.rs`, model `jonathandinu/face-parsing`, **not** BiSeNet — see that
file's doc comment and `desktop/src-tauri/vendor/faceparse/README.md` for why the originally-quoted
class table was wrong and had to be independently verified against the real `.onnx`). The "✂
Auto-exclude face features" button (Skin mask panel, desktop only) derives a head crop from the
subject mask's own bounding box and turns the result into one eraser mask via the same
`isExclude` mechanism a hand-painted eraser uses.

### Card import, named subjects, and auto-seeded skin samples (Phase C, 2026-08-15)

- **Card import** (`desktop/src-tauri/src/ingest.rs` + a "Devices" section in `library-ui.js`)
  replaces the Lightroom trip: volume detection, date-organised copy with folder/filename
  templates, an optional second copy in the same pass, size verification, duplicate skipping,
  progress and eject. Never moves, only copies. ⚠️ Dates come from EXIF **DateTimeOriginal**, not
  `DateTime` — for the repo's own test photos those differ by 2 and 5 days because an editor
  rewrote them, and Finder/`sips -g creation` show the *wrong* one. `ingest_run` is split out of
  the `#[tauri::command]` so the whole path is testable without an AppHandle.
- **Named subjects** (`subject.rs`, "Subjects" in the AI-mask panel): teach a subject from a
  selection, then find it in another photo. Read that file's header before touching the UI — its
  measured limits are what the UI shape is *for* (~77-80% recall, no usable presence signal, so
  Find always presents a result to confirm and never applies across a batch; references are kept
  individually because WHICH photos you teach from matters more than how many; and a haircut does
  **not** break a subject, so there is deliberately no re-teach prompt).
- **Skin samples are auto-seeded** from the segmented region (`mskAutoSamples`) — k-means, k=4, in
  Oklab LCh — instead of requiring the shift-click ritual that produced §5b's one-sample failure.
  Measured against the hand-picked 3-sample baseline on `__TM3390` (`test/probe_tm3390.mjs`'s
  `AUTO-seeded` case): effective-weight spread **0.018 vs 0.039**, hue closed **73% vs 70%**,
  chroma **67% vs 65%** — better on all three.
  ⚠️ Two things it needs, both found by measuring: seed only from pixels above §5b's **0.016**
  chroma cut (not the shader's 0.010 smoothstep floor, a different job — at 0.010 grey rock inside
  the selection formed its own cluster and the gate then leaked onto rock at 0.258), and **drop
  clusters holding <8% of the pixels**, or a rim of contamination inside the mask gets a sample of
  its own and blows the weight spread out to 0.247.
- **`Match shoot`** (a 4th skin target mode) saves one measured tone in `localStorage` so a whole
  set converges on ONE skin rendering; `Even them out` converges each photo onto its own mean,
  which is why two frames of the same person in different light drift apart.

---

## 6. Calibration tooling (`calib/`)

- **`scorecard.py`** — THE fast validation gate. One human-legible PASS/FAIL table covering
  every requirement (per-colour gap halo + interior flood, grey/warm/cool/white bars,
  thin-line R&G, halo softness) on three small crops in seconds, BASELINE vs NEW. **Run it
  before and after every change.** Reads `IMG_5774_2x.PNG` + `dehancer halation x2.png` from
  `calib/`.
- **`halmodel.py`** — shared model module: `s2l/l2s/smoothstep/screen/gauss_blur`,
  `emit_rule`, `apply_halation` (high-pass glow), `render_rule`.
- **`render_chart.py`** — renders a model vs `IMG_5774_2x.PNG`, writes side-by-side strips
  vs the Dehancer reference.
- **`optimize_hal.py`** — autonomous Nelder-Mead dense-loss optimizer (zero token cost per
  eval; runs entirely in Python). Produced `best_params.json`.
- **`gen_chart.py`** — chart geometry. **`validate_v22.py`** — zone-by-zone point samples
  (secondary guardrail only — see lessons).
- **Grain:** `gen_grain_chart.py` (flat test chart), `calibrate_grain_formats.py` (the SHIPPED
  per-format fit from the Dehancer exports `dehancer-{8,16,35,65}mm-{60,100}.png`), plus the older
  `grainmodel.py`/`optimize_grain*.py`/`measure_grain.py`/`grain_params*.json` (superseded).

### 6b. The film-grain model (value-noise, calibrated per film format)
The shipped grain (comp shader + `FXR.CAL.grain`) replaced the old 1px white-noise hash that was
invisible at any size. Key points:
- **Value (lattice) noise**, not a continuous hash: `vlat()`/`vnoise()` hash the integer lattice
  and interpolate → grain CLUMPS of a controllable size (white noise has no size). ⚠️ Use the
  **`hash12`** (Dave Hoskins) lattice hash, NOT `h21` — `h21`'s `127.1` multiplier has a `0.1`
  fractional residue, so adjacent cells barely differ → a REPEATING tiled pattern (visible
  streaks / "organized grid"). `vnoise` sums **3 octaves ROTATED** between each other + quintic
  interp so no axis-aligned grid survives; unit std ≈0.157 (baked into `grK`).
- **Fixed-pixel clump size**: `grFreq = (renderW/uvScaleX)/cellPx` → cells are a constant pixel
  size in the OUTPUT (visible in the fit-preview AND Dehancer-accurate at export; tiles/loupe stay
  continuous via `guv`). ⚠️ Image-fraction cells (the first attempt) go SUB-PIXEL in the
  downscaled preview → the value noise averages to ~0 (σ collapses, no clumps). Must be buffer-px.
- **Per-channel signal-dependent σ**: `σ_c = grA·k_c·v_c^powG·(1−smoothstep(hiLo,hiHi,v_c))`.
  σ rises with luminance, peaks ~v0.7, rolls off in highlights. R≈1.2×G≈B (NOT blue-suppressed —
  that was a measurement artifact of a stale `profile_block` Y-coord landing on a colour ramp).
- **Shared+independent mix** (`noise_c = wi·indep_c + ws·shared`, wi²+ws²=1) gives the measured
  channel correlation ≈0.4 (some chroma grain, like Dehancer).
- **Film format = size + strength** (`CAL.grain.formats`): 8mm coarsest, 65mm finest & WEAKEST
  (0.52× of 35mm). Amount has headroom past Dehancer (`amountSpan`); slider ~70 ≈ Dehancer's max.
- ⚠️ **Measure grain by mean-subtraction, NOT a high-pass blur** — a high-pass removes the coarse
  grain and halves σ (the trap that made the old `grain_targets.json`/v4 look weak). Grain is
  applied in display space, BEFORE print.
- **`gen_lut_presets.py`** — regenerates the embedded `LUT_PRESETS` base64 blobs from the
  `LUT LIBRARY/` cubes.
- Fitted params live in `*.json` (`best_params.json` is the committed halation model;
  `dcp_fit_iso.json` the ISO-dependent RAW correction; `grain_params*.json` the grain model;
  `noremjet_params.json` the no-remjet halation boost).
- **Print profiles:** `extract_print_luts.py` recovers exact 33³ `.cube`s from the two
  5640×3840 print-applied LUT charts (`dehancer kodak/fuji lut print x2.png`) via the same
  patch-mean algorithm as the app's `chartToLUT` → `calib/PRINT PROFILES/*.cube` (kept OUT
  of `LUT LIBRARY/` so the film-look list stays clean). `gen_print_presets.py` then bakes
  them into the embedded `PRINT_PRESETS` blob. Validated: applying each cube to
  `dehancer base x2.PNG` matches the `dehancer kodak/fujifilm print x2.png` calib renders to
  <0.5/255 mean.

---

## 7. RW2 / RAW + DCP camera-profile pipeline

- Decoder: `libraw-wasm@1.1.2` (vendored, sha512-verified). Lazy `import()` on first RW2
  load. `.RAW` extension also accepted (some Panasonic modes write RW2 data as `.RAW`).
- `loadRw2()` → `raw.imageData()` returns an **object** `{width,height,colors,bits,data}`,
  not a flat array (was an all-black bug). Orientation honored (`userFlip:-1`).
- **DCP profiles**: a "RAW profile" dropdown (default Camera Standard) applies Adobe DCPs
  from `vendor/dcp/` so RW2 colour ≈ Lightroom. Decode switches to linear 16-bit camera RGB;
  a 65³ LUT baked from the DCP is applied per pixel.
- **The DCP bake follows the Adobe DNG-SDK/RawTherapee structure exactly** (verified against
  RT's `rtengine/dcp.cc`/`curves.h` source): FM1 → XYZ(D50) → linear ProPhoto →
  2^(ev+BaselineExposureOffset) → LookTable (TABLE-INDEX clamps only, values extended-range)
  → **hue-preserving Adobe RGBTone tone curve** (curve on max+min channel, median
  interpolated — NEVER per-channel, which crushes/over-saturates shadows) → ProPhoto→sRGB.
  **NO black subtraction and no early [0,1] ceilings anywhere** — the S9 DCPs carry
  `DefaultBlackRender=None` (renderer black subtraction is spec-forbidden) and the
  ProfileToneCurve has its own shadow toe.
- Correction constants are near-identity and **not ISO-dependent**: `dcpFit` returns
  `{ev:0.0, gr:0.9860, gb:0.9783}` — fitted in `calib/dcp_native_fit.py` against 5 LR
  reference TIFFs on the NATIVE (rawler) decode, with shadow-skin patches in the loss/gate.
- A final **hue/sat/value-gated residual lift** closes the last LR gap (bright saturated COOL
  regions — blue sky — rendered ~7/255 darker; skin/water/shadows sit outside the gates and
  are untouched). Fitted in `calib/dcp_residual_tone.py` → `calib/dcp_sky_gate.json`, baked
  as constants at the end of `bakeDcpLUT` in final sRGB-gamma space (the measurement space).
  ⚠️ A 1D tone curve CANNOT express this residual — sky and water share hue AND luma; only
  saturation separates them (0.30 vs 0.13). Don't refit it as a tone/exposure tweak.
  ⚠️ The old ISO-dependent fudges (`ev=-0.819-0.17x`, `black=0.04`, native
  `WHITE_LEVEL_MATCH=2.334`) existed only to bend a **mis-linearized libraw-wasm decode**
  (measured: wasm ≈ 1.22·native^0.634 per channel) toward LR at midtones — they crushed
  shadows by design. Never reintroduce a "black" term: fix linearity instead.
- The desktop shell decodes natively (`desktop/src-tauri/src/raw_decode.rs`): rawler
  `apply_scaling` (per-CFA black/white) + `PPGDemosaic` + libraw WB convention (min mult = 1).
  The browser/wasm path linearizes libraw-wasm's output with the measured inverse power law
  before the DCP LUT (see `loadRw2`).
- ⚠️ DNG/DCP gotchas: LookTable layout is `[val][hue][sat]`; V axis is sRGB-encoded when
  `LookTableEncoding=1`; rawpy 0.21 mis-decodes the DC-S9 (wrong white level) — the Python
  harness reads dumps from `desktop/src-tauri/examples/dump_rw2.rs` (native pipeline,
  `cargo run --release --example dump_rw2 -- in.RW2 out.bin 8`).
- ⚠️ Memory: terminate the libraw worker after each decode (it leaked ~0.5–1GB shared wasm
  memory per file). Per-file try/catch + readable error strings already in place.
- **When the user says "doesn't match Lightroom", FIRST ask what's rendering the comparison
  image** — macOS Preview of a `.RAW` shows the camera's embedded JPEG (warmer/darker), not
  the real RAW render.

---

## 8. LUT workflows

- **LUT chart round-trip**: "LUT chart" generates a 5640×3840 PNG of all 33³ colours; apply
  a look elsewhere, drop the export back, and `chartToLUT` reads patch means (inner 50%, so
  grain/sharpen/NR cancel) → an exact 33³ LUT. Identity round-trip verified (maxDiff =
  quantization 1/510). ⚠️ A LUT captures GLOBAL colour/tone only — not sharpen/NR/grain/
  local masks.
- **Lumix Lab compatibility**: every emitted `.cube` (`writeCube`) carries
  `#LUMIXPHOTOSTYLE STD` as line 2. Without it the camera assumes V-Log and colours go wrong.
  ⚠️ If a regenerate ever drops this tag, re-add it.
- **Device-link cube** (`a beach preset v5.7 lumix.cube`): maps camera-STD pixels →
  Chromasmith's beach-preset output, so applying it in-camera to STD reproduces the look.
  Fit from matched RW2+SOOC-JPEG pairs.
- ⚠️ **A LUT captured from a single photo / narrow gamut has GARBAGE in unobserved saturated
  corners.** Always sanity-check a captured preset on the **LUT chart** (full cube), not just
  a normal photo. When an original parametric `.xmp` with identity tone curves exists, prefer
  baking XMP→LUT analytically over capturing the rendered look. (The blind standalone
  "XMP→LUT" tab was removed — its `applyHSL` hue bands were too narrow to match Lightroom;
  Match & Refine / Colour Copy are the correct empirical tools.)

---

## 9. Fujify Fujifilm-look recreation (`calib/fujify/`)

Recreates Lightroom presets for 7 Fujifilm looks as `.cube` profiles.
- **Composition** (`build_composed.py` → composed cubes): derive a look-independent transform
  and compose looks. Beats the montage poly-fit for most looks (dE roughly halved on Pro Neg
  Std/Provia/Reala Ace, landing near the ~9.7 dE screenshot-reference ceiling).
- **Montage** (`build_montage.py`): degree-3 polynomial fit from screenshot comparison
  panels. Only option for Pro Neg Hi (no repo V-Log source).
- ⚠️ The montage **input screenshots** (`Fujify Luts and XMP/`) are not bundled — supply them
  to re-run. The composed outputs already live in `calib/LUT LIBRARY/*_composed.cube`.
- See `calib/fujify/README.md` and `INSTALL_in_Lightroom.md` for the full method (and the
  blocked proprietary XMP-table codec notes — base-85 + non-standard compression, uncracked).

---

## 10. Process lessons (read before tuning)

Learned the hard/expensive way:

1. **Render-and-look FIRST; point-samples are a secondary guardrail.** A lot of prior work
   was done blind on `validate_v22.py`'s gap-only metric, which structurally cannot see
   interior flooding (pink-flood, yellow-bleed) — the most visible defects to a human. Always
   render the full chart side-by-side with the reference and walk a visual checklist before
   trusting any number. Sample flat *interiors*, not just gaps/edges.
2. **A fast all-requirements scorecard gate beats slow blind optimization.** Two multi-minute
   re-optimizations "improved the loss" while collapsing `gainG→0` (hard pure-red halo)
   because the loss under-weighted some requirements. `scorecard.py` computes every
   requirement in seconds. **Never run a long optimization whose loss doesn't encode every
   requirement** — the optimizer trades away anything not in the loss.
3. **Validate the mechanism on a few read-only point computations first.** The high-pass fix
   was proven (interior flood 0.305→0.000 at identical params, gap R unchanged) in seconds,
   before any file edit — no optimization needed.
4. **Never put backticks/`${` in GLSL comments inside JS template literals** (see §3), and
   **reload the live page in a real browser after every shader edit**.
5. **`overflow-x:hidden` on `html`/`body` silently disables `position:sticky`** on all
   descendants (it makes the body a scroll-clipping context). Use `overflow-x:clip`.
6. When the user reports a RAW colour mismatch, **first ask what's rendering the comparison**
   (Preview shows the embedded JPEG, not the RAW).
7. The app preset list must mirror its `.cube` sources — `calib/LUT LIBRARY/` (46) plus
   `calib/dehancer/cubes/` (67) = the 113 keys in `LUT_META`; a LUT with a real
   non-`_composed` source (astia/classic_neg/velvia) beats its composed recreation.
   ⚠️ Adding presets is not free any more — see §2's payload note. A new look belongs in
   `vendor/luts/`, not inline, and `LUT_META` is what makes it appear.
8. **`column-count:1` does NOT mean "not multi-column".** It still establishes a multicol
   formatting context, and per CSS Multicol a multicol box with a **definite block-size**
   fragments its overflow into EXTRA COLUMNS along the inline axis instead of overflowing
   vertically. `.fx-panel` had `column-count:2` globally, `1` under `fx-deskb`, and a definite
   height under `deskx` — so any tool panel taller than the window silently became 2–4
   side-by-side columns with `scrollTop` pinned at 0: vertical scrolling did nothing and
   everything past the first screenful was unreachable. Measured on Masks at 1440×820:
   `scrollWidth 937` vs `clientWidth 319`. Use `columns:initial` to leave the context entirely.
   The older `[data-fxsec="looks"]{column-span:all}` rule was a per-card patch for a symptom of
   this same root cause — a hint that had been sitting in the file for a long time.
9. **`.fx-row` assigns `order` to three specific children, so every other child must get one
   too.** `.fx-label` is `order:1`, `.fx-val` is `2`, `.fx-slider` is `3`; anything else
   (checkbox, `<select>`, colour input, button group) kept the flex default `order:0` and
   painted BEFORE its own label. 18 rows read backwards, e.g. "Match pick Swatch Custom |
   Target". `.fx-row>*{order:2}` is the base rule that prevents it recurring.
10. **A comment claiming a complexity class is not evidence.** `_boxFilterJS` was documented as
   an O(w·h) prefix sum and written as a naive O(w·h·r) window sum — it even computed a row
   total into `acc` and never used it. Six calls at 2048×1365 cost ~2s of blocked main thread
   per "Refine edges". When a hot path feels slow, read the loop, don't trust the header.
11. **Typed arrays do not survive `JSON.stringify`.** `Uint8ClampedArray` serializes to
   `{"0":…,"1":…}`, which is both enormous and lossy on the way back. Every mask persistence
   path (session, Library sidecar, copy/paste recipe, undo history) must go through
   `_mskToSnap`/`_mskFromSnap`, never a raw JSON clone of a live mask.
12. **Seeded-`Math.random` goldens are order-dependent.** Every `FX.render` without an explicit
   `opts.seed` consumes one number from the stream, so the three grain goldens depended on how
   many PREVIEW renders happened during harness setup — adding a live preview render shifted all
   three with no change to export output. `export_harness.mjs` now reseeds immediately before the
   render. To prove an app change is output-neutral, render the pre-change file through the same
   harness and byte-compare; don't reason about it.
13. **Hiding a disabled section with `display:none` also hides it from the UI audit.** Switching
   off-sections to dimmed-but-rendered immediately surfaced a control that had been unreadable
   for a long time (an 8px "BLR" text label in a 24px circle). Anything permanently hidden is
   permanently unaudited.

---

## 11. Zone geometry (2× pixel coords, for re-measurement)

Zone 2 bars (x=2400–4799): 100% white y840–986, 80% grey y1020–1166, 60% y1200–1346,
40% y1380–1526, 20% y1560–1706, warm(255,190,110) y1760–1906, cool(110,180,255) y1920–2066.
Gap ≈34px. Measure interiors ≥40px from any edge.
Zone 7 full-width lines/blocks at x=3600: white line y5240, warm(255,160,80) y5360,
cool(110,180,255) y5480, red(255,80,80) y5600. **Always use the 2×/4800×6400 PNGs.**

---

## 12. Video grading (in progress)

Single-clip video grading through the existing `FXR` pipeline: load an MP4, scrub/grade with the
same LUT/grain/halation/adjustment stack as stills, export a graded MP4. Explicitly NOT a timeline
NLE — one clip, global adjustments, trim in/out at most. Full design doc, gap analysis vs.
comparable apps (Dehancer, FilmBox, Lightroom video), and phased plan:
`~/.claude/plans/review-the-video-editing-elegant-squid.md` (or wherever it was moved — ask if
missing). Phases V0 ("play it") → V4 ("trim + audio"), V5 opportunistic polish.

- **Demux/mux: `vendor/mediabunny/`**, NOT hand-rolled. Use its high-level API
  (`Input`/`VideoSampleSink`/`Output`/`CanvasSource`) — it already solves rotation metadata,
  exact-frame seeking, audio passthrough, and WebCodecs timestamp/keyframe/flush correctness.
  Lazy `import()`, same pattern as `getLibRaw()` (`:6418`). Kept out of the inline `<script>`
  blocks (unlike pako/utif2) because MPL-2.0 is file-level copyleft.
- **Reject clearly, at load, with a named reason:** fragmented MP4, HLS, AVI, MKV, edit lists —
  whatever `ALL_FORMATS` can't handle.
- ⚠️ **Grain/artifact seeds must become per-frame, but naively.** The stills design deliberately
  makes `seed`/`artSeed` STABLE (preview==export, tiles byte-identical) — for video, stable-across-
  frames is grain freezing to the screen. Use a HASH of frameIndex, not a linear step
  (`clipSeed + frameIndex*k`) — a linear step near-repeats whenever `13×k` lands close to a
  multiple of 100, producing a periodic grain "pulse". A `Grain motion` slider blends toward the
  clip-constant seed to control boil vs. freeze.
- ⚠️ **Never `getPixels()` on the export path** — full GPU stall + JS row-flip per frame. Render
  into the same composite canvas used for borders/watermark and hand that to `CanvasSource`.
- ⚠️ **`setImage`'s unconditional `gl.deleteTexture(this.imgTx)` will delete a live video texture**
  if a video's `imgTx` is aliased to a persistent `vidTx` and a photo is then loaded. Guard:
  `if(this.imgTx && this.imgTx!==this.vidTx) gl.deleteTexture(this.imgTx)`.
- **Every new shader uniform (`srcFlipY`, `srcXf`, range remap, HLG tonemap, dither, grain motion)
  must default to today's behaviour exactly** — all 18 PNGs in `test/golden/` must stay byte-exact
  through every phase of this work. Run `node test/export_harness.mjs` after any shader touch and
  watch for `[console.error] GLSL compile error` (§3's "quieter bug class" — it will not
  white-screen the app, it silently no-ops the whole program).
- ⚠️ GLSL reserved words are an active risk here specifically: **`sample` and `output`** are
  exactly the identifiers a video feature reaches for, and both are reserved in GLSL ES. Prefix:
  `vidSample`, `vidOut`.
- **`test/video_harness.mjs`** (`npm run video:test`, same Playwright/SwiftShader rig as
  `export_harness.mjs`) is headless-testable because Chromium's `VideoDecoder`/`VideoEncoder` use
  software codecs even under SwiftShader. Fixture: `test/fixtures/video_tiny.mp4` — 10 frames,
  160×120, 10fps, each frame's luma = `(frameIndex*20) mod 255` (an exact, content-addressable way
  to verify a seek landed on the RIGHT frame without a perceptual diff; regenerate with
  `ffmpeg -f lavfi -i "color=c=black:s=160x120:r=10:d=1,geq=lum='mod(N*20\,255)':cb=128:cr=128"
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart video_tiny.mp4`). Currently covers V0: demux
  metadata (frameCount/rotation/isVfr/isHdr), per-frame seek correctness, seek determinism
  (walking a clip 0→9 and 9→0 must produce identical frames — this is the "grain differs between
  preview and export" class of check, still valid before frame-seeded grain exists because it's
  really testing `fxVideoSeekTo`'s stale-result generation-counter guard), and the guard that
  matters most: loading a video must not perturb a still render (`chart.png x identity` re-rendered
  on the SAME page after video code has run, diffed byte-for-byte against its own golden).
  ⚠️ **`getSample(0)` returned `null` on a real irregular-timestamp fixture during V0 testing** even
  though the same file decoded fine via the `.samples()` async iterator — `loadFXVideoFile` grabs
  the first frame via the iterator for exactly this reason; don't regress it back to `getSample(0)`.
  Not yet covered (lands with later phases): encode/export, rotation-metadata fixtures (ffmpeg on
  this dev machine won't reliably write an ISOBMFF `colr`/rotation matrix box — a real phone-shot
  fixture will be needed), HDR fixtures (same tooling gap).
- **Playback (V1)** does not chase real-time — `fxVideoPlayTick` tracks wall-clock elapsed time
  against the clip's fps and jumps straight to whichever frame SHOULD be showing now, dropping
  any it can't render in time, rather than queuing (a queue makes lag compound; a drop just reads
  as a lower live frame rate). Paused automatically on every photo/video switch (`fxSyncTransportUI`
  calls `fxVideoPause()`) so switching away can't leave a RAF loop targeting the outgoing item.
- **Per-frame grain seed**: `fxVideoFrameSeed` hashes `(clipSeed, frameIndex)` with a sin/fract
  hash, NOT a linear step — verified the rejected linear formula's near-repeat bug for real
  (`clipSeed+frameIndex*7.7371`: frames 13 apart land within 0.58 of each other since
  `13×7.7371≈100.58`) and confirmed the hash keeps >2.8 separation at the same offset. The `Grain
  motion` slider (0..100) blends between the frozen clip-constant seed and the fully independent
  per-frame hash.
- ⚠️ **HLG handling is ENGINE-DEPENDENT, and the desktop app was getting it wrong.** The previous
  note here said "no manual HLG tonemap is needed" — that was measured in **Chromium only**, and
  it was wrong for the shipping desktop app. Its own caveat ("re-check on whatever engine is
  current") turned out to be the important sentence.
  Measured on `IMG_8015.MOV` (HEVC yuv420p10le, BT.2020/HLG/bt2020-ncl), frame 0, identical
  160×90 downsample:

  | rendering | mean | meanSat | maxSat |
  |---|---|---|---|
  | ffmpeg naive (no conversion) | 137.2 | 29.6 | 108 |
  | **Apple ColorSync HLG→709** (`sips --matchTo ITU-709.icc`) | **124.1** | **41.3** | **141** |
  | **WKWebView** (the desktop app) | 137.5 | 30.1 | 118 |
  | **Chromium** (the web build) | 122.9 | 41.3 | 147 |

  **Chromium converts correctly; WKWebView does not** — it decodes HLG and relabels the
  `VideoFrame` as `bt709`/`iec61966-2-1` *without* applying the conversion, so HLG footage rendered
  flat and ~30% under-saturated in the desktop app.
  `fxNeedsHlgTransform(trackColorSpace, videoFrame)` decides this by **comparing the container's
  track colour space against the delivered frame's** — never a UA sniff — so it self-corrects if
  either engine changes. When it fires, `hlg2rec709()` in the lut pass does the conversion.
  ⚠️ The shader chain is the ITU standard, not a hand-rolled curve: HLG inverse OETF → OOTF with
  system gamma from the **BT.2408** formula `1.2 + 0.42·log10(L_W/1000)` → normalise by the
  **BT.2408 reference white of 203 cd/m²** (which is exactly `eotf_BT2100_HLG(0.75)`) → BT.2020→709
  matrix → sRGB encode. `calib/hlg_to_709.py` derives and validates it, cross-checked against the
  **colour-science** reference library (inverse OETF to 2.6e-9, full EOTF to 3.1e-6 cd/m²).
  `L_W` defaults to **400 nits**, the documented nominal for HLG-mastered material.
  ⚠️ **colour-science requires numpy≥2 and will break `.calibvenv`'s scipy pin** — keep it in a
  separate venv (`python3 -m venv /tmp/colourvenv`). This was learned by breaking it.
- ⚠️ **We cannot tone map HDR ourselves, and cannot preview/export HDR.** Verified in Chromium
  against the same clip: `VideoFrame.format === null` for 10-bit and `allocationSize()` throws, so
  `copyTo()` cannot read the planes; uploading to `RGBA16F` with
  `UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE` and reading back through an `RGBA32F` FBO peaks at
  **0.9565 with zero pixels above 1.0** — already clamped to SDR. There is no `rec2100-hlg` canvas
  and no `configureHighDynamicRange`. So a real BT.2446/BT.2390 operator is impossible here; the
  HLG→709 conversion above is a colour-space fix, NOT a tone map. `fxHdrProbe()` re-measures all of
  this in whatever engine is running (diagnostics only; writes JSON in the native shell when
  `diag-on`).
  ⚠️ **macOS previews HLG clips in HDR** (QuickLook shows an HDR badge), so a side-by-side against
  QuickLook is SDR-vs-HDR and will never match exactly — that is not a bug.
- ⚠️ **The extended Log input selector (S-Log3/C-Log3/Log-C) is still deferred, separately from
  HDR above** — no real reference footage for those has been obtained yet, and each needs its own
  verified curve constants. Same rule as before: don't implement from formula alone; get real
  footage (or a known-correct reference still) first.
- ✅ **RESOLVED: the VFR flag was a false-positive bug, not a missing feature.** `probeVfr()` read
  exactly 30 packets in DECODE order and sorted by presentation timestamp — on any B-frame-coded
  stream (i.e. almost all real H.264/HEVC footage) this produces one spurious large gap at the
  TAIL every time, because the last few decode-order packets grabbed are B-frames whose
  presentation timestamps land mid-range, while the packets that would fill the gap haven't been
  read yet. Verified on the same real clip: 29 of 29 real deltas were exactly 0.0333s (perfect
  29.97fps CFR); only the boundary delta was wrong, and it alone triggered the VFR flag. Fixed by
  over-reading a B-frame-reorder margin (16 packets) and discarding the tail before computing
  variance. Separately, researched how open-source editors handle genuine VFR (Shotcut/MLT,
  Kdenlive: detect, then CONFORM to CFR before editing — timelines are frame-indexed) and confirmed
  `fxVideoSeekTo`'s existing time-based seek (`frameIndex/fps` → `samples(t)`) already does the
  lazy equivalent, with no architecture change needed.
- ✅ **Audio passthrough (V4) shipped**: `EncodedAudioPacketSource` re-muxes the original AAC
  packets unchanged. ⚠️ Real AAC streams commonly start at a NEGATIVE presentation timestamp
  (encoder priming/pre-roll) — confirmed on the same real clip ("Timestamps must be non-negative,
  got -0.044s"). Fixed with the standard remux technique (same as ffmpeg's
  `-avoid_negative_ts make_zero`): shift the WHOLE audio stream by the first packet's timestamp so
  it starts at exactly 0 — never clamp packets independently, which collapses several leading
  packets onto the same timestamp. Non-AAC audio gets a clean "video only" export with a warning,
  not a silent transcode.
- ✅ **Fixed: video was exporting/previewing upside down.** `setVideoFrame` never applied
  `UNPACK_FLIP_Y_WEBGL` the way `setImage` does for photos. The original justification (preserving
  a zero-copy blit path for a raw `VideoFrame` upload) didn't match the actual implementation —
  every call site draws the sample onto a plain 2D canvas first via `sample.draw()`, exactly like
  a photo canvas, so it needs the identical flip. Verified with a top/bottom-asymmetric test clip.
- ✅ **Trim now actually trims (V6, first slice).** `trimInFrame`/`trimOutFrame` used to be written
  by the transport sliders and read by nothing — `fxVideoExportSmall` always exported the whole
  clip. It now derives `trimF0/trimF1`, loops only that range, and rebases OUTPUT timestamps to
  start at 0 (same technique the audio pass already used for negative AAC priming timestamps).
  Audio is windowed to the trimmed range the same way, keeping the packet that straddles the
  in-point (the standard ffmpeg/MLT `-ss` convention) so trimmed audio is never short. Playback
  (`fxVideoPlayTick`) now also **loops within the trim window** via a `fxVideoLoop` toggle instead
  of always stopping at the end — the old "stop" behaviour was an explicit V1 simplification, not
  a design choice. Added a Shotcut/Kdenlive-style keyboard map for video (Space play/pause, ←/→
  frame-step, Shift+←/→ second-step, I/O set trim at playhead, Home/End jump to trim in/out) and
  transport buttons (frame-step, loop, Set In/Out) — none of this existed before. `test/video_harness.mjs`
  gained a [5] section covering the transport wiring (trim-set/step/goto/loop), DOM-level so it
  stays fast; the full trimmed-export frame/timestamp math is exercised in the browser directly,
  not yet in the harness — see the open items below.
- ✅ **The rest of the V6 punch list shipped in the same pass** (same plan file):
  - **Geometry (crop/rotate/flip/straighten) now reaches video export.** `fxVideoExportSmall` used
    to draw the raw decoded sample straight into the encoder, bypassing `geomCanvas`'s pipeline
    entirely — the Crop tool visibly did nothing to an exported clip. `geomCanvas` was split into
    `applyGeomTo(canvas,geom)` (pure, reusable) + a one-line `geomCanvas(item)` wrapper so both
    stills and the per-frame export loop share the identical transform, with zero behavior change
    for photos (verified: 18/18 export goldens still byte-exact after the refactor alone).
  - **Borders + canvas matte now render into video export** (`_videoComposeBorderMatte`), mirroring
    `exportFX`/`canvasCompose` exactly — border thickness and matte aspect ratio are constant for
    a whole clip, so their output size is computed ONCE and every frame draws into pre-allocated
    canvases (no per-frame allocation). This is what makes a 9:16/1:1/4:5 video export possible.
  - **Export settings UI**: Quality (Draft/Standard/High/Maximum — bitrate scales off the same
    20Mbps/1080p30 reference the old hardcoded value used, so High+1080p+30fps is byte-for-byte
    the prior default), Resolution (Source/4K/1080p/720p), Codec (H.264/HEVC, HEVC silently falls
    back to H.264 via the same `getFirstEncodableVideoCodec` probe if unencodable), Frame rate
    (Source/30/24 — decimation only, sampling is now TIME-based (`samples(srcTimeS)`) rather than
    frame-index-based specifically so this and trim compose without special-casing).
  - **In-playback audio**: `loadFXVideoFile` decodes the whole track into an `AudioBuffer` via
    `AudioContext.decodeAudioData` at load time (separate from `_mbAudioTrack`, which export still
    uses for the lossless packet-passthrough remux — playback needs decoded PCM, export needs the
    original encoded packets). Once a source node is running, `fxVideoPlayTick` reads
    `AudioContext.currentTime` as its clock instead of `performance.now()` — tighter A/V sync than
    an independent wall-clock RAF loop. Mute is a single global toggle (`fxVideoMuted`); at export
    it just skips `output.addAudioTrack` — no re-encode needed either way.
  - **Fade in/out** (picture only — passthrough audio can't be faded without a decode/re-encode
    pass, out of scope). Applied at export as a black-backdrop alpha composite per frame; the UI
    is two plain number inputs in seconds.
  - **Preview quality proxy**: a Full/½/¼ selector scales ONLY the live preview's WebGL backing
    store (`renderPreview`'s `pw,ph`, gated on `kind==='video'`) — export is never affected. Zero
    behavior change at its default (1×).
  - **Scopes**: histogram/waveform/RGB-parade/vectorscope share one mode selector next to the
    existing histogram toggle and the SAME downsampled sample buffer `drawHistogram` already
    built — switching modes costs nothing extra. Ported ffmpeg's `vf_waveform`/`vf_vectorscope`
    conventions (additive intensity, Rec.709 Cb/Cr wheel, the 6 colour-bar target boxes, the 123°
    skin-tone/I-axis line — see §5b) as plain JS/canvas2D, not vendored, per the "port
    conventions, write the JS" call on this feature (GPL-3.0 makes Shotcut/Kdenlive/ffmpeg's own
    *code* licence-compatible, but it's C++, not JS — not worth a source port for four draw calls).
  - **Guides overlay**: rule-of-thirds + SMPTE 90%/93% title/action-safe boxes, pure SVG overlay,
    never rendered into a preview snapshot or export.
  - **Thumbnail strip** (`fxVideoBuildThumbs`): 16 evenly-spaced low-res frames decoded lazily
    under the scrubber, one `requestAnimationFrame` yield between each so it never blocks
    scrubbing/playback; abandons mid-build if the user switches items.
  - `test/video_harness.mjs` gained a [6] export smoke test — the WHOLE `fxVideoExportSmall` path
    (geometry, borders/matte, quality/codec/fps, fades, audio remux) had zero CI coverage before
    this; it now trims a fixture to 3 frames, stubs `window.saveFile` (bare top-level identifier,
    same override pattern the stills export path already relies on), and asserts a real non-trivial
    MP4 comes out the other end without throwing.
  - **Library integration** (`desktop/src-tauri/src/library.rs` + `desktop/library-ui.js`): `.mp4`/
    `.mov`/`.m4v` now list alongside photos (`is_video` flag, `kind:"video"`), filter by "Video" in
    the type filter, and open into the editor via the exact same `read_file_bytes` → `File` →
    `loadFXImages` path a photo takes (video was already handled there via `VID_EXT_RE`/MIME —
    the gap was purely that the Library filtered clips out of `list_dir` before the editor ever
    saw them). No thumbnail decoder for video (`image` crate can't read MP4; not worth an ffmpeg
    dependency for a grid thumbnail) — `get_thumbnail` fails cleanly for it and the grid shows a
    dark placeholder + ▶ badge instead of a broken `<img>`.
  ⚠️ Genuinely deferred, not attempted blind: a full custom timeline-canvas widget replacing the
  two range sliders (A2 in the plan — the sliders now clamp against each other and paint a range-
  fill background instead, which covers the "can't invert the handles" bug without the bigger
  rewrite); speed ramp/retiming (interacts badly with per-frame grain seeding and forces an audio
  decision, see the plan's non-goals); multi-clip timeline; audio gain/volume (needs `AudioEncoder`,
  breaks Safari); stabilization/deflicker. See the plan file for the full reasoning on each.
