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
index.html                  THE PRODUCT PAGE (GitHub Pages root) — hand-written, self-contained,
                            reuses chromasmith-22.html's own :root tokens. NOT the app.
app/index.html              Clean /app/ URL → redirects to chromasmith-22.html (the old root
                            redirect, moved). The editor's own path never changed: both build
                            scripts still copy chromasmith-22.html, and the COI service worker
                            still registers at the site root.
site/                       Landing-page assets + the three scripts that generate them
                            (shoot-screenshots.mjs drives the REAL app in Playwright — the old
                            hand-taken ui-review-screenshots/ folder was untracked and got lost;
                            build-assets.mjs optimises photos from the gitignored photos-src/;
                            build-page.mjs injects them between markers in index.html).
                            See site/README.md. ⚠️ Output is WebP because .gitignore excludes
                            *.jpg globally, and the encoder is Chromium because cwebp is absent
                            and macOS sips refuses -s format webp (exit 13).
LICENSES-MODELS.md          Every bundled ONNX model and its licence — written because two of
                            them (EdgeSAM, face-parsing/SegFormer) are non-commercial/research
                            and a public .dmg now ships them.
chromasmith-22.html         THE ENTIRE APP — HTML + CSS + JS + GLSL shaders in one file
coi-serviceworker.min.js    Cross-origin-isolation shim so the RAW decoder works on
                            GitHub Pages (gzuidhof, MIT)
README.md                   User-facing intro + run instructions
CLAUDE.md                   This file
vendor/
  libraw/                   LibRaw WebAssembly RW2/RAW decoder (index.js, worker.js, .wasm)
  dcp/                      14 Panasonic DC-S9 Adobe DCP camera profiles (runtime copies)
  mediabunny/               MP4 demux/mux for video grading (docs/video-grading.md) — MPL-2.0, kept as its own
                            file and lazy-`import()`ed like libraw, NOT inlined like pako/utif2
  luts/                     102 of the 113 built-in look presets, as RAW 33³ RGB bytes
                            (107,811 B each). Fetched + cached on demand — see §2's payload note
ios/ + package.json + capacitor.config.json + build-ios.sh + patches/ + .github/workflows/
                            Capacitor iOS shell → unsigned IPA built by CI (see §2).
                            .github/workflows/desktop-dmg.yml builds the macOS .dmg on a `v*` tag
                            → GitHub Release. ⚠️ macos-13 (x86_64) is required by the Intel-only
                            vendored libonnxruntime.dylib, and the dmg is packaged with hdiutil
                            rather than by touching tauri.conf.json's deliberate targets:["app"].
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
  never hand-copied — `bakeDcpLUT` is an exact DNG-SDK transcription (docs/raw-dcp.md) and a drifting second
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

**`test/ui_audit.mjs`** walks every tool section at 1440×820 / 1600×1000 / 1280×720 in `?deskx=1`,
**plus a separate 375×812 phone pass** (2026-08-15). The phone pass loads its own page WITHOUT
`?deskx=1` and audits the bottom sheet: under 700px the app is a different shell entirely
(CLAUDE.md §4), and `deskx` pins the desktop one — so adding 375px to `VIEWPORTS` would have
audited a layout no phone ever renders. It found a real defect on its first run (a 12×20px modal
close button, less than half the 28px touch floor). `CS_UI_NO_MOBILE=1` skips it. It
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
shader-truncation white-screen class of bug immediately (watch for `[pageerror]`). Recipes are
JSON in `test/recipes/`, fixtures are PNGs in `test/fixtures/` (`portrait.png` is a tanned field +
pale disc + dark dot — a deliberate uneven-skin test case). `test/probe_*.mjs` are ad-hoc probes
built on the same rig for measuring pixels rather than diffing images.

`npm run lint:ai` (part of `npm test`) is a source-level check, not a render one: it fails if any
raw `origin==='ai'` / `origin!=='ai'` comparison exists outside `mskIsAI()`. It exists because the
whole segmentation path is gated on `window.__TAURI__` and therefore **invisible to the browser
harness** — see the warning in docs/skin-tone.md.

### ⚠️ Two tests on this machine are FLAKY, and both were measured, not guessed (2026-08-15)

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
     uniformity** (docs/skin-tone.md) + **Amount** (`mskE.w`, one master scale over the finished selection;
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
  4. **comp pass** — screen-blends bloom+halation, then **grain** (value-noise, see calib/CLAUDE.md’s grain model section), then
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
  + uniformity (docs/skin-tone.md), a live thumbnail, and can be reordered/renamed/muted/soloed; raster (brush/
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

## 6. Process lessons (read before tuning)

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
14. **The Library (`desktop/library-ui.js`) is native-gated, so an ordinary browser page-load
   check renders nothing — a layout bug there is invisible unless you specifically drive
   `?libtest=1`** (mocks the Tauri commands + `window.lrCloud` so the real Library DOM/CSS
   renders in a plain browser; `window.libtestLrConnect()` flips the mock Lightroom to
   connected). Two consecutive builds shipped with the sidebar invisible before this was
   caught — always screenshot-verify Library layout changes through `?libtest=1` before
   rebuilding the app, not after. Relatedly: a UI redesign must **migrate persisted state, not
   just change defaults** — stale `localStorage` (e.g. an old tree-collapsed flag) can silently
   override a new default. Use a new storage key (and delete the legacy one) whenever a
   persisted choice's meaning changes.

---

## 7. Zone geometry & full calibration walkthrough

See [calib/CLAUDE.md](calib/CLAUDE.md) for chart zone pixel coordinates and the
full halation/grain/Fujify calibration method.

