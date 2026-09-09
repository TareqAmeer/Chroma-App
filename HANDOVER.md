# Chromasmith — Engineering Handover

For a senior engineer taking this over and pairing with Claude Code going forward. This is the
authoritative onboarding doc; `CLAUDE.md` (root) is the day-to-day reference you'll keep open.
Everything below is grounded in files actually read in this repo on 2026-09-09 — no invented
scripts, selectors, or test names.

---

## 1. Project Vision, User Persona & Mental Model

**Chromasmith** is a film-emulation and colour-grading photo editor for people who shoot RAW
(specifically a Panasonic DC-S9) and want a Dehancer/analog-film look — halation, bloom, grain,
film-stock LUTs, print-stock simulation — without a subscription app or a round trip to the cloud.
The persona is a hobbyist-to-serious photographer who wants Lightroom/Capture One-grade local
tools (RAW decode, face/subject-aware masking, a real photo catalog) but running entirely on their
own machine, offline, for free.

There are **two products sharing one rendering core**, not one:

1. **The web/iOS app** — `chromasmith-22.html`, a single self-contained file (HTML+CSS+JS+GLSL,
   no build step) that runs the entire grading pipeline in WebGL2 in the browser. Deployed as-is
   to GitHub Pages, and wrapped for iOS via Capacitor (`ios/`) as a sideloadable IPA. This shell
   has **no backend** — RAW decode there uses a WebAssembly LibRaw port (`vendor/libraw/`), and AI
   masking features are unavailable (gated on `window.Capacitor`/`window.__TAURI__`).
2. **The desktop app** — `desktop/`, a Tauri 2 (Rust) native shell for macOS/Windows. It embeds
   the **same** `chromasmith-22.html` as its WebView content (staged via `build-desktop.sh` into
   `desktop/dist/`) but adds a real native backend: RAW decode via `rawler` (not the WASM
   decoder), a SQLite photo catalog (`catalog.rs`), and a full local AI stack (face
   detection/recognition/clustering, subject segmentation, CLIP text search, depth, pet detection)
   running through the ONNX Runtime C API directly.

**Core mental model:**
- The GLSL/WebGL2 grading pipeline (`FXR` class) is the single source of truth for what a photo
  looks like, shared byte-for-byte between web, iOS, and desktop — there is no second rendering
  implementation to keep in sync.
- Native code (Rust) exists only where the browser genuinely cannot do the job: fast/reliable RAW
  decode, a real indexed database for 100k+ photo libraries, and ML inference that needs a
  vendored ONNX Runtime binary.
- Editing is **non-destructive**: masks, curves, HSL bands and adjustments are all state
  (`fxState`) that re-renders through the same pipeline; undo/redo covers geometry, curves, HSL
  and masks.
- "Single-file" describes the **app code**, not bulk data — LUT presets and ONNX models are kept
  out of the inlined HTML on purpose (see §3) because the file is parsed on every cold load.

---

## 2. Architecture & Data Flow

### Backend (desktop only — Rust / Tauri 2, `desktop/src-tauri/`)

- **RAW decode** (`raw_decode.rs`): `rawler` decodes RW2 to raw Bayer sensor data only; this app
  does its own black-level/WB/demosaic in Rust, then hands linear 16-bit camera RGB to the
  **existing, already-calibrated JS DCP pipeline** unchanged (`bakeDcpLUT` in
  `chromasmith-22.html`). Chosen because WKWebView's `SharedArrayBuffer` support (needed by the
  WASM decoder) could not be made reliable in the native shell — verified two independent ways
  per the Cargo.toml comment.
- **Catalog** (`catalog.rs`): `rusqlite` (bundled SQLite) backs an indexed photo catalog for
  100k+-photo libraries — chosen because the app's existing flat-JSON persistence pattern
  (`albums.json`, `registry_*.json`) rewrites its entire file on every write and doesn't scale.
  Commands are `async fn` + `tauri::async_runtime::spawn_blocking` (per `ROADMAP.md`'s N3.1
  correction — a plain sync `#[tauri::command]` runs on the dispatching thread in Tauri 2, it does
  **not** get a worker pool for free).
- **IPC**: standard Tauri `#[tauri::command]` functions (58 of them across `main.rs` alone,
  `grep -c '#\[tauri::command\]' desktop/src-tauri/src/main.rs`) registered in one
  `tauri::generate_handler![...]` block in `main()` (`desktop/src-tauri/src/main.rs:2002`), called
  from JS via `window.__TAURI__.invoke(...)` in `desktop/library-ui.js` /
  `desktop/desktop-native.js`. Long-running native work also pushes progress back to JS via Tauri
  **events**, not just command return values (see `bgwork.rs`).
- **Other Rust modules and what they own** (`desktop/src-tauri/src/`):
  - `sam.rs` — MobileSAM/SAM2 tap-to-select subject masks, via `ort-sys` + `libloading` calling
    the ONNX Runtime **C API directly**, deliberately bypassing the `ort` crate's own
    Session/Environment wrapper. Cargo.toml records why: `ort` 2.0.0-rc.12's `load-dynamic`
    feature has a confirmed, reproducible **hang bug** in its dylib-handle caching on this
    platform; the raw C API has none of it and was proven end-to-end before writing `sam.rs`.
  - `arcface.rs` — ArcFace `w600k_r50` face embeddings (groups photos of the same person).
  - `scrfd.rs` — SCRFD-500M face detection.
  - `faceparse.rs` — SegFormer face-parsing (excludes eyes/lips/hair from a skin mask).
  - `clip.rs` — CLIP ViT-B/32 natural-language photo search; uses `tokenizers` with
    `default-features = false, features = ["onig"]` because CLIP's pretokenizer regex needs
    lookahead (`\s+(?!\S)`) that Rust's own `regex` crate can't express.
  - `depth.rs` — Depth Anything V2 Small (Depth Range mask, depth blur/tilt-shift).
  - `petdetect.rs` — RT-DETR r18vd (cat/dog/bird/horse detection).
  - `rawdenoise.rs` — RawNIND UtNet2 RAW noise reduction (GPL-3.0, the reason the whole desktop
    app is GPL-3.0).
  - `ingest.rs` — card ingest (uses `libc`'s `statfs` for capacity/free space).
  - `lens_correct.rs` — Lensfun-based distortion/vignette/TCA correction (pure-Rust port, no
    system `liblensfun`; pre-alpha crate, API may shift).
  - `still_decode.rs` — non-RAW still formats (EXR/HDR/TGA/DDS/QOI/PNM/BMP/ICO/GIF, plus JPEG XL
    via `jxl-oxide`); deliberately **not** AVIF (macOS ImageIO / Chromium already decode it
    natively client-side).
  - `library.rs`, `bgwork.rs`, `dcp_store.rs`, `formats.rs`, `fastthumb.rs`, `gainmap.rs`,
    `merge.rs`, `subject.rs`, `tiff_meta.rs`, `videothumb.rs`, `diag.rs`, `platform/` — library
    browsing, background job orchestration, DCP camera-profile storage, format sniffing, fast
    thumbnailing, HDR gain-map handling, stacking/merge (HDR/focus/astro/panorama/collage),
    subject detection glue, TIFF metadata, video poster thumbnails, diagnostics logging, and the
    macOS/Windows platform shims (`objc2`/`objc2-app-kit` on macOS, `windows` crate on Windows).
- **Vendored models** (`desktop/src-tauri/vendor/<name>/`, ~1.1GB, gitignored — see
  `LICENSES-MODELS.md`): SAM 2.1 Hiera-Tiny (Apache-2.0), EdgeSAM/MobileSAM (**non-commercial**),
  face-parsing SegFormer (**non-commercial**), SCRFD-500M, ArcFace `w600k_r50`, CLIP ViT-B/32
  (MIT), RawNIND UtNet2 (GPL-3.0), Depth Anything V2 Small (Apache-2.0), RT-DETR r18vd
  (Apache-2.0), plus a vendored ONNX Runtime dylib (MIT) — vendored because no x86_64-apple-darwin
  prebuilt exists via `ort`'s download-binaries feature and the dev machine is Intel.

### Frontend & Rendering (`chromasmith-22.html`, single file, ~18K+ lines)

- **`class FXR`** (`chromasmith-22.html:5143`) is the WebGL2 renderer, the one and only rendering
  implementation shared by all three shells. It compiles its shader programs in `_compileAll()`
  via a shared `_prog(vs,fs)` helper (`:5153`), each one a `#version 300 es` GLSL ES string. The
  programs, in the order they're compiled: `progs.lut` (`:5207`), `progs.src` (`:5888`),
  `progs.blur` (`:5946`), `progs.deconvUpdate`/`progs.deconvMix` (`:5982`/`:6001`, deconvolution
  sharpen), `progs.lumdown` (`:6016`), `progs.blur_hal` (`:6046`, halation-specific blur),
  `progs.lens` (`:6072`), `progs.nr` (`:6150`, noise reduction), `progs.comp` (`:6219`, final
  composite), `progs.dof` (`:6483`, depth-of-field/tilt-shift).
- **Per-frame pipeline** (documented in full in `CLAUDE.md` §3): lut pass (V-Log input transform →
  sharpen/clarity → look LUT → HSL mixer → basic adjustments → local-adjustment masks → tone
  curves) → emit pass (halation/bloom emission map) → blur passes (per-channel Gaussian, σ_R ≫
  σ_G ≫ σ_B) → comp pass (screen-blend bloom+halation → grain → film artifacts → print LUT →
  saturation/vibrance → vignette). Order is load-bearing and calibrated against Dehancer as
  ground truth — see §4's invariants.
- **Tiled export** (`renderTiled`) processes huge images in overlapping tiles with a halo ≥3σ so
  peak GPU memory stays small and seams are invisible; the 1:1 loupe reuses the same mechanism.
- Heavy JS (not GLSL) hot paths run in a **pixel worker** (`_cpuRun`), built from the real
  `bakeDcpLUT`/`exportSharpen` functions via `Function.prototype.toString` — never hand-copied —
  so the worker can never silently drift from the main-thread implementation.
- **Canvas-to-DOM overlay mapping during zoom/pan**: two different mechanisms, used for two
  different overlay kinds, and mixing them up is how a real bug shipped.
  - **Mask/crop overlays** (`#fx-mask-overlay` etc.) live **inside `#fx-zoom-wrap`** as CSS
    siblings of `#fx-canvas` (`mskOverlayBox()`, `chromasmith-22.html:14140-14146`), so they ride
    the *same* `transform: scale(fxZoom) translate(...)` the canvas gets in `_applyZoom()`
    (`:15009-15022`) for free, by construction. This replaced an earlier version that read
    `getBoundingClientRect()` per frame, which lagged the transform by one frame during an active
    zoom/pan and visibly "moved the mask" relative to the photo.
  - **Pointer input → canvas pixel** (clicks, brush strokes, WB eyedropper) goes through
    `fxPointerToCanvasPx()` (`:10349-10358`), which reads `getBoundingClientRect()` on whichever
    element is actually visible — `#fx-canvas-bd` (the Borders/Canvas-matte composite) when a
    frame is on, otherwise `FX.cv` directly — because `applyPreviewBorders` sets `FX.cv` to
    `display:none` when compositing a border, and a `display:none` element reports an all-zero
    rect (`FX.cv.width / rect.width` → `Infinity`, every pick/stroke previously landed on
    garbage — the real "pick color does nothing when the photo has a border" bug). `_fxDisplayMap`
    (`:10348`) records which canvas + offset is live so this resolves correctly either way.
  - Rule of thumb: an overlay that must track zoom/pan pixel-perfectly belongs inside
    `#fx-zoom-wrap` riding the transform; anything converting a live pointer event to an image
    pixel must go through `fxPointerToCanvasPx()`, never a raw `getBoundingClientRect()` call.

### Color space pipeline

- **Working space for grading is gamma-encoded sRGB** (the `img` texture bound into `progs.lut`
  is sRGB-encoded 8-bit, or scene-linear floats when `usingSceneLinear` is set — see below); the
  look LUT, HSL mixer, basic adjustments, masks, and tone curves in the lut pass all operate on
  that encoded signal directly, matching how the calibration was fitted against Dehancer.
- **The emit pass (`progs.src`, `:5893-5945`) converts to linear light before computing
  halation/bloom emission**: `vec3 lin=vec3(s2l(c.r),s2l(c.g),s2l(c.b))` (`:5899-5902`, sRGB EOTF,
  same `s2l`/`l2s` pair reimplemented per-shader-program rather than shared — see the multiple
  `float s2l(...)` definitions at `:5335,5899,6238,10943`). All downstream emission math
  (luminance, saturation, the warm/backing/yellow-driver terms, the bloom hue gate) runs in
  linear light.
- **The blur passes operate on that linear-light emission buffer directly** — the per-channel
  Gaussian blur (σ_R ≫ σ_G ≫ σ_B) never re-encodes back to sRGB between the emit and comp passes,
  so energy conservation (the "AREA-NORMALIZED separable Gaussian" comment at `:5947`) is correct
  in the physically-meaningful linear domain, not gamma space.
- **The comp pass (`:6224+`) screen-blends the linear bloom/halation back onto the graded sRGB
  image**, meaning it round-trips through `s2l`/`l2s` again (`:6238-6241`) at the blend boundary,
  then continues in sRGB for grain, film artifacts, the print LUT, and saturation/vibrance —
  matching CLAUDE.md §3's documented stage order (grain before print, saturation/vibrance after
  print).
- **RAW / scene-linear path** (`usingSceneLinear`, `:6594`, ROADMAP.md's R1): when a RAW carries
  real measured highlight headroom above 1.0 (`_sceneLinearPresent`), the pipeline keeps a
  separate linear buffer (`img._sceneLinear`) and gates a tonemap step (`tonemapOn`, `:6806`) on
  top of the normal sRGB path — PNG/JPEG sources and RAWs with no measured headroom never set
  this and are unaffected. The Oklab-based skin-tone/mask color math (`_ok_s2l`/`_ok_l2s`,
  `:5177-5197`) uses its own local sRGB↔linear pair feeding the standard OKLab matrices, kept
  separate from the emit-pass `s2l`/`l2s` deliberately (different call sites, same formula, not
  shared to avoid a cross-shader-program dependency).

### Data lifecycle, end to end

```mermaid
flowchart TD
    subgraph Desktop shell
        A1[RW2/RAW file on disk] --> A2["rawler decode (raw_decode.rs)\nblack-level / WB / demosaic in Rust"]
        A2 --> A3["linear 16-bit camera RGB\nhanded to JS"]
        C1[Photo catalog] <-->|rusqlite, async cmds| A2
    end
    subgraph Web/iOS shell
        B1[RAW/JPEG file] --> B2["vendor/libraw WASM decode\n(needs SharedArrayBuffer via COI)"]
    end
    A3 --> D
    B2 --> D
    D["bakeDcpLUT (DCP camera profile,\nJS worker, byte-exact w/ main thread)"] --> E[WebGL2 texture upload]
    E --> F["FXR.render(): lut pass -> emit pass ->\nblur passes -> comp pass"]
    F --> G["Preview: devicePixelRatio-capped\ncanvas, CSS-fit"]
    F --> H["Export: renderTiled(), overlapping\ntiles with halo, full resolution"]
    H --> I[PNG/JPEG/TIFF written to disk\nor native share sheet (iOS)]
    subgraph Desktop-only AI
        A3 -.-> J["sam.rs / scrfd.rs / arcface.rs / clip.rs /\ndepth.rs / petdetect.rs (ort-sys direct C API)"]
        J -.-> K[Mask data / face clusters / search index]
        K -.-> F
    end
```

---

## 3. Environment Setup & Asset Manifest

### Web app (no build step)

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```
- RAW support needs cross-origin isolation (`SharedArrayBuffer`); GitHub Pages can't set
  COOP/COEP headers, so `coi-serviceworker.min.js` (first `<head>` script) shims it client-side.
- macOS gotcha: sandboxed preview servers can't read `~/Documents` (TCC) — serve a copy from
  `/tmp/` instead.

### iOS shell (`ios/`, Capacitor 8 + CocoaPods)

```bash
npm run build:www   # ./build-ios.sh — stages chromasmith-22.html -> www/index.html + vendor/
npm run sync         # build-ios.sh + npx cap sync ios
```
- `build-ios.sh` (repo root) never points `webDir` at the repo root — `calib/` must not ship.
- `.github/workflows/ios-ipa.yml` builds an **unsigned** `Chromasmith.ipa` on a macOS CI runner
  on every push touching the app (this dev machine has no Xcode). Sideloaded via Flarestore.
- CocoaPods, not SPM — SPM can't be patched; `patches/@capacitor+ios*.patch` (via patch-package)
  adds COOP/COEP headers in `WebViewAssetHandler` so SharedArrayBuffer works in WKWebView.

### Desktop shell (`desktop/`, Tauri 2)

```bash
./build-desktop.sh   # stages chromasmith-22.html into desktop's dist/ (see script for exact steps)
# then: cd desktop/src-tauri && cargo build / cargo tauri dev, per the desktop/ tooling
```
- `desktop/src-tauri/Cargo.toml`: `edition = "2021"`, `tauri = "2"`. **No `rust-toolchain.toml`
  exists** (confirmed: `find . -iname "rust-toolchain*"` returns nothing) and CI
  (`.github/workflows/desktop-dmg.yml`) uses `dtolnay/rust-toolchain@stable` — i.e. this project
  intentionally does not pin a Rust version, it always builds against whatever `stable` currently
  is. The version actually verified working on this dev machine: `rustc 1.97.0 (2d8144b78
  2026-07-07)` / `cargo 1.97.0`. If a future `stable` breaks the build, that's a real regression to
  investigate, not a config-drift symptom — there is no older pinned toolchain to fall back to.
- **Node**: no `engines` field in `package.json` and no `.nvmrc`. CI pins differ by workflow —
  `.github/workflows/export-gate.yml` and `desktop-dmg.yml` both use **Node 20**
  (`actions/setup-node@v4`, `node-version: 20`); `.github/workflows/ios-ipa.yml` uses **Node 22**.
  Use Node 20 locally to match the two workflows that actually run this repo's test suite
  (`export-gate.yml` runs `npm test`); Node 22 only matters if you're touching the iOS build.
- `.github/workflows/desktop-dmg.yml` builds the macOS `.dmg` on a `v*` git tag → GitHub Release.
  **macos-13 (x86_64) is required** — the vendored `libonnxruntime.dylib` is Intel-only. The dmg
  is packaged with `hdiutil`, not by touching `tauri.conf.json`'s deliberate `targets:["app"]`.
- Native RAW decode replaces the WASM path entirely on desktop (see §2).

### Obtaining the ~1.1GB vendored AI models on a clean clone

`desktop/src-tauri/vendor/` is **1.1GB total, but most of it IS committed to git** — this
contradicts `LICENSES-MODELS.md`'s framing ("they are not in git"); verified directly with
`git ls-files desktop/src-tauri/vendor`. What's actually true, file by file:

| Vendor dir | Committed to git? | Size |
|---|---|---|
| `vendor/clip/{vision_model,text_model}.onnx` | ✅ committed | 335MB + 242MB |
| `vendor/arcface/w600k_r50.onnx` | ✅ committed | 166MB |
| `vendor/faceparse/model_quantized.onnx` | ✅ committed | 85MB |
| `vendor/onnxruntime/libonnxruntime.dylib` | ✅ committed | 28MB |
| `vendor/depth/model_quantized.onnx` | ✅ committed | 26MB |
| `vendor/sam/edge_sam_{encoder,decoder}.onnx` | ✅ committed | 21MB + 15MB |
| `vendor/rtdetr/model_quantized.onnx` | ✅ committed | 21MB |
| `vendor/scrfd/scrfd_500m_bnkps.onnx` | ✅ committed | 2.4MB |
| `vendor/sam2/{encoder,decoder}.onnx` | ❌ gitignored (`vendor/sam2/*.onnx`) | ~155MB total |
| `vendor/rawdenoise/*.onnx` | ❌ gitignored (`vendor/rawdenoise/*.onnx`) | ~30MB each |

So **a plain `git clone` already gets everything except SAM2 and the RawNIND denoiser** — those
two are excluded specifically because `encoder.onnx` alone (~134MB) is over GitHub's 100MB hard
push limit and this repo has no Git LFS configured (see `.gitignore:57-63`). Fetch the two missing
ones exactly as their own `README.md` documents (verified against the real file contents):

```bash
# SAM2.1 Hiera-Tiny (optional — EdgeSAM in vendor/sam/, already committed, still works standalone
# without this; losing it only disables the higher-quality tap-to-select tier)
cd desktop/src-tauri/vendor/sam2
curl -sL "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/encoder.onnx" -o encoder.onnx
curl -sL "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/decoder.onnx" -o decoder.onnx

# RawNIND UtNet2 RAW denoiser (GPL-3.0 weights)
cd ../rawdenoise
curl -sL "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel" -o rd.dtmodel
python3 -c "import zipfile; zipfile.ZipFile('rd.dtmodel').extractall('.')"
mv rawdenoise-nind/model_linear.onnx rawdenoise-nind/model_bayer.onnx .
rm -rf rd.dtmodel rawdenoise-nind
```

Without SAM2, `sam2_encode`/`sam2_points` fail with a clear "SAM2 encoder path not set" error —
not a silent no-op. Without the RawNIND weights, RAW denoise is simply unavailable; nothing else
depends on it. `libonnxruntime.dylib` (the C API runtime everything above calls into via
`ort-sys`+`libloading`, §2) is already committed, so no separate fetch is needed for it — it's
only pinned to v1.20.0 because Microsoft dropped Intel-Mac prebuilts after that release (see
`vendor/onnxruntime/README.md`).

### Asset manifest — where things live

| What | Where | Notes |
|---|---|---|
| App code | `chromasmith-22.html` | The entire product; bump `const BUILD='YYYY-MM-DDx'` near the top of `<script>` every session that edits it |
| Built-in LUTs (102 of 113) | `vendor/luts/<key>.bin` | Raw 33³ RGB bytes, 107,811B each; fetched + IndexedDB-cached on demand, **not** inlined |
| Built-in LUTs (11 "User Looks") | inline `LUT_PRESETS` base64 in `chromasmith-22.html` | Deliberately inline — must survive a bare `file://` open, which can't `fetch()` |
| LUT master list | `LUT_META` in `chromasmith-22.html` (`:4337`) | Authoritative key list, not `LUT_PRESETS` |
| ONNX models (desktop AI) | `desktop/src-tauri/vendor/<name>/` | ~1.1GB, gitignored; each has its own README with source URL/date/size; see `LICENSES-MODELS.md` |
| LibRaw WASM decoder | `vendor/libraw/` | index.js, worker.js, .wasm — web/iOS RAW path only |
| DCP camera profiles | `vendor/dcp/` | 14 Panasonic DC-S9 Adobe DCP profiles, runtime copies |
| MP4 demux/mux | `vendor/mediabunny/` | MPL-2.0, lazy-`import()`ed like libraw |
| Calibration source (.cube) | `calib/LUT LIBRARY/` (46) + `calib/dehancer/cubes/` (67) | = 113 keys in `LUT_META`; sideload-ready |
| Calibration ground truth | `calib/dehancer halation x2.png`, `calib/IMG_5774_2x.PNG` | Not needed to run the app, only to re-derive constants |
| Test fixtures/goldens | `test/fixtures/`, `test/golden/`, `test/baselines/` | `test/output/` is gitignored scratch |
| Wireframes (design source) | `chromasmith-design/project/` | `Editor (Developer) View.dc.html`, `Library View.html`, `design.md`, `UI_SPEC.md` — literal source of truth for UI fidelity work |
| RAW/JPEG/TIFF test captures | gitignored `photos-src/` | Supply your own |

**Payload discipline**: before inlining any new bulk asset into `chromasmith-22.html`, check
`gzip -9 -c chromasmith-22.html | wc -c` — the file is parsed in full on every cold web load, iOS
launch, and desktop `dist/` read. The 102-preset split to `vendor/luts/` was a 5.8× transfer cut
(17.7MB/10.2MB gzipped → 3.02MB/1.76MB gzipped for the preset payload specifically).

---

## 4. Architectural Invariants & The Graveyard

Real, load-bearing rules — not style preferences. Breaking any of these has shipped a real bug.

### Hard invariants

- **Never put a backtick `` ` `` or `${` inside a GLSL `//` comment.** The GLSL lives inside a JS
  template literal; a stray backtick truncates the shader source and throws a page-breaking
  `SyntaxError`. Has bitten the project **twice**. Always reload the live page after touching
  shader source, even for a comment-only change.
- **A GLSL compile/link failure does not white-screen the app.** The affected program just
  renders as if the whole feature were switched off — reads as a logic bug, not a build error. It
  happened for real: a uniform named `half` (a reserved word in GLSL ES) silently killed the
  `lut` program, so **every mask did nothing** while the app looked completely healthy. Other
  reserved words that read as innocent identifiers: `input`, `output`, `filter`, `sample`, `cast`,
  `union`, `this`, `double`. Rule: after any shader edit, run `node test/export_harness.mjs` and
  watch for `[console.error] GLSL compile error` — never judge a shader change by "the page still
  loads."
- **Saturation/vibrance run AFTER the print LUT, on purpose.** Pulling saturation to 0 must
  collapse the printed pixel to its luma, not re-tint an already-grey pixel. Verified against
  Dehancer's own `*lut print 0 sat*` reference renders.
- **Grain runs BEFORE the print LUT, on purpose** — it's modeled as being in the negative; the
  print stock then modulates it.
- **GLSL functions must be declared before use** — `maskAdjust` once referenced `s2lp` before its
  definition and blacked out the whole pipeline.
- **Mask persistence must go through `_mskToSnap`/`_mskFromSnap`, never a raw JSON clone.**
  `Uint8ClampedArray` serializes to `{"0":…,"1":…}` via `JSON.stringify` — huge and lossy on the
  way back. Every persistence path (session save, Library sidecar, copy/paste recipe, undo
  history) must go through the snap helpers.
- **`lutcache` (IndexedDB) is a separate object store from `luts`.** `lutLibList()` does a bare
  `getAllKeys()` on `luts` to feed the "My library" optgroup — if the 102 cached built-ins shared
  that store they'd all render as the user's own uploaded LUTs.
- **`ort-sys` + `libloading`, never the `ort` crate's own Session wrapper**, on this platform —
  confirmed hang bug in `ort` 2.0.0-rc.12's `load-dynamic` dylib-handle caching (see `sam.rs`
  top-of-file comment and the Cargo.toml comment above the `ort-sys` dependency).
- **A `#[tauri::command]` must be `async fn` + `spawn_blocking` to actually leave the dispatch
  thread.** A plain sync command in Tauri 2 runs on the thread that dispatched it — confirmed via
  Tauri's own IPC docs, not assumed, after `grep -c "async fn" catalog.rs` returned 0 despite an
  earlier "fix."
- **`overflow-x:hidden` on `html`/`body` silently disables `position:sticky`** on every descendant
  (makes `body` a scroll-clipping context). Use `overflow-x:clip` instead.
- **`column-count` establishes a multicol context even at `1`.** `.fx-panel` had `column-count:2`
  globally, `1` under `fx-deskb`, and a *definite block-size* under `deskx` — so any panel taller
  than the window silently fragmented into 2–4 side-by-side columns with `scrollTop` pinned at 0
  (measured: `scrollWidth 937` vs `clientWidth 319` on Masks at 1440×820). Use `columns:initial`
  to leave the formatting context entirely, don't just set `column-count:1`.
- **Before toggling `display`/`visibility` on any container you didn't just create, read its
  full children list first.** Real incident (commit `c088091`, 2026-09-09): widening the docked
  Library filmstrip past 150px correctly revealed the Library/Develop tab pair, but *also*
  revealed the entire Collections/By-Date navigation tree, because both lived inside the same
  `#lib-side` wrapper and only the tabs were checked. Fix scoped the toggle to the leaf, not the
  shared parent — see §7 for the current state of that fix.

### The graveyard (real, dated process lessons — do not re-derive these blind)

- **`validate_v22.py`'s gap-only metric structurally cannot see interior flooding** (pink-flood,
  yellow-bleed) — the most visible defects to a human eye. Always render-and-look at the full
  chart before trusting a point-sample number; `calib/scorecard.py` is the fast all-requirements
  gate that replaced blind optimization loss-chasing.
- **`export_harness.mjs` intermittently renders an all-zero RGBA(0,0,0,0) canvas** — a
  SwiftShader/driver WebGL **context loss** event (`contextLost:true`, glError 37442), not an app
  bug. It used to report `ok` and exit 0 on this, which read exactly like a shader regression and
  was "the single most expensive false lead" in a prior work phase. The harness now throws a
  BLANK RENDER error and retries the whole run once automatically.
- **`video_harness`'s post-video byte-exact check fails ~40% of runs on a clean tree** —
  unattributed, suspected to be the seeded-`Math.random` per-combo reset interacting with
  timing-dependent render counts before the still capture.
- **Seeded-`Math.random` goldens are order-dependent** — every `FX.render` without an explicit
  `opts.seed` consumes a number from the stream, so adding one live preview render during harness
  setup used to shift three unrelated grain goldens with zero app-code change.

---

## 5. Working with Claude Code (CLAUDE.md Playbook & Token Hygiene)

- **CLAUDE.md is a thin index**; subsystem deep-dives live in `docs/*.md` and `calib/CLAUDE.md`,
  loaded on demand rather than carried in every turn. Load the relevant one before touching that
  subsystem: `docs/skin-tone.md` before `mskRebuild`/`skinUniformity`/AI-mask work, `docs/raw-dcp.md`
  before `loadRw2`/`bakeDcpLUT`/`raw_decode.rs`, `docs/lut-workflows.md` before `chartToLUT`, etc.
- **Blast-radius check before any visibility/display toggle**: read the full children list of a
  container you didn't just create — don't just confirm the one element you want is somewhere
  inside it. This is now written into `CLAUDE.md` §6.15 as a direct result of the `c088091`
  incident (§4 above).
- **State-matrix testing for any resizable/breakpoint-driven UI, scoped to the real parent that
  could leak** (`CLAUDE.md` §6.16). Assert structure (Playwright ARIA snapshot,
  `toMatchAriaSnapshot()`) at min/threshold/max — `test/library_dock_states.mjs` does this at
  90/150/280px scoped to `#lib-side` specifically (the container that leaked), not just the
  `.lib-side-tabs` pair alone — snapshotting only the leaf would not have caught the bug.
  **Hand-author the expected snapshot from the spec/wireframe; never auto-generate it from current
  code**, or you just codify whatever bug already shipped.
- **Wireframe fidelity work must copy literal values, not re-derive them from memory** — this is
  the `wireframe-transplant` skill's core rule, and it exists because a prior diff tool
  (`test/wireframe_diff.mjs`) existed unused for 7 commits before anyone wired it into the
  workflow (see `test/wireframe_inventory.mjs`'s own top comment, which was written specifically
  to close the gap a 13-pair hand-written check couldn't: it can't see an element the app has that
  the wireframe doesn't, a missing element, a control-count mismatch, or a wrong row order).
- **Never judge a shader change by "the page still loads"** — see §4's GLSL invariants; run
  `node test/export_harness.mjs` and read the console output every time.
- **Token efficiency**: prefer `npm run ui:test -- --json` / reading `test/output/` JSON over
  round-tripping screenshots through the model for layout questions — the UI audit and perf
  harnesses exist specifically because "reading JSON is far cheaper than round-tripping
  screenshots through a model" (verbatim rationale in `CLAUDE.md`'s testing section). Baselines
  live in `test/baselines/`, never `test/output/` (gitignored scratch).
- **Truncate test-runner output to the assertion diff, never the full log.** `npm test` chains
  eight scripts (§6); a failing `export_harness` or `perf_bench` run can print per-fixture
  timings, full Playwright traces, or Rust panic backtraces that are mostly noise once you know
  which assertion failed. Pull the specific failing case (recipe name, budget name, golden path)
  and its expected-vs-actual line into context; don't paste the whole stdout, especially not
  `cargo test`'s full backtrace unless the failure is a Rust panic whose location isn't already in
  the one-line summary.
- **Don't ask Claude Code to retrospectively explain a failed attempt.** Feed it the current error
  diff and exact repro steps (which script, which fixture/recipe, the assertion that failed) and
  let it re-derive the cause from the live code, the same way this handover's own process lessons
  were found — by reading the loop / running the harness, not by re-litigating what went wrong in
  a prior turn. This matters doubly here because several of this repo's own documented bugs (the
  `column-count` multicol issue, the GLSL reserved-word `half` bug) were invisible from reasoning
  about a description and only surfaced by driving the real page — the same is true of debugging a
  test failure after the fact.
- **Never trust a comment's stated complexity class.** `_boxFilterJS` was documented as an
  O(w·h) prefix sum and was actually a naive O(w·h·r) window sum, costing ~5.5s of blocked main
  thread per "Refine edges" press. Read the loop when a hot path feels slow.

---

## 6. Testing, Tooling & Verification Guide

Full script list, `package.json`:

```jsonc
"export:test":            "node test/export_harness.mjs",              // golden PNG diff, real chromium
"export:golden":          "node test/export_harness.mjs --golden",     // regenerate goldens — only when intended
"video:test":              "node test/video_harness.mjs",              // ~40% flaky on a clean tree, see §4
"lint:ai":                "node test/lint_ai_origin.mjs",              // source-level: no raw origin==='ai' outside mskIsAI()
"lint:formats":           "node test/lint_formats.mjs",
"lint:library-content":   "node test/lint_library_content.mjs",
"mask:test":              "node test/mask_raster.mjs",                 // raster mask byte-exact round-trip
"wireframe:test":         "node test/wireframe_inventory.mjs",         // Library full-inventory structural diff
"wireframe:icons":        "node test/wireframe_inventory.mjs --icons-baseline",
"behaviour:test":         "playwright test --config=playwright.config.mjs",
"ui:test":                "node test/ui_audit.mjs",                    // desktop layout invariants gate
"ui:baseline":            "node test/ui_audit.mjs --baseline",
"library:responsive-test":"node test/library_responsive_qa.mjs",
"editor:wireframe-test":  "node test/editor_wireframe_diff.mjs",       // Editor vs Editor (Developer) View.dc.html
"editor:inventory":       "node test/editor_wireframe_inventory.mjs",
"editor:inventory-icons": "node test/editor_wireframe_inventory.mjs --icons-baseline",
"editor:responsive-test": "node test/editor_responsive_qa.mjs",
"visual:test":            "node test/visual_baseline.mjs",
"visual:baseline":        "node test/visual_baseline.mjs --baseline",
"visual:scorecard":       "node test/visual_scorecard.mjs",
"perf:test":              "node test/perf_bench.mjs",                  // 7+ hot-path timing budgets
"perf:baseline":          "node test/perf_bench.mjs --baseline",
"scorecard":              "calib/export_scorecard.py",                 // fast halation PASS/FAIL
"lib:test":               "node test/library_perf.mjs",                // grid virtualization + hash-cluster perf
"preview":                "node test/preview_server.mjs",              // serves Library from SOURCE, not dist/
"test":                   "lint:ai && lint:formats && export:test && scorecard && mask:test && perf:test && ui:test && lib:test"
```

Note `npm test` does **not** include `behaviour:test`, `wireframe:test`, `editor:wireframe-test`,
`library:responsive-test`, or `video:test` — those are separate gates you must run explicitly for
UI-fidelity or behavioural work; don't assume `npm test` green covers them.

**What the key gates actually check** (from their own top comments):

- **`test/ui_audit.mjs`** — loads the real `chromasmith-22.html` at `?deskx=1`, walks every tool
  section at three window sizes, asserting: no panel fragmentation (the `column-count` bug in
  §4), no control painted before its own label, no overlapping siblings, a 28px pointer-target
  floor (18px for checkboxes/swatches), an 11px font floor, 4.5:1 text contrast. Plus a separate
  375×812 phone pass (no `?deskx=1` — under 700px is a different shell, see `CLAUDE.md` §4);
  `CS_UI_NO_MOBILE=1` skips it.
- **`test/editor_wireframe_diff.mjs`** — loads the literal wireframe
  (`chromasmith-design/project/Editor (Developer) View.dc.html`) and the real app side by side at
  the same viewport, in both themes, and reports a computed-style mismatch table. Existed for
  Library (`test/wireframe_diff.mjs`) for a long time before the Editor got equivalent coverage —
  every "Editor matches the wireframe" claim before this file was a code read, never a driven
  comparison.
- **`test/wireframe_inventory.mjs`** — deliberately supersedes the 13-pair hand-written
  `wireframe_diff.mjs` check: walks both trees and compares "visible atoms" by shape/text/geometry
  rather than class name, because the two codebases use different naming schemes.
- **`test/perf_bench.mjs`** — every budget anchored to a real pre-optimisation measurement:
  `_boxFilterJS` ×6 @2048×1365 (was 1996ms), retained undo history with a brush mask (was 9.5MB
  for a 512×384 mask), renders during a 30-event slider drag (was 1 — no feedback at all),
  `getUISnapshot`, fraction of look thumbnails rendered on gallery build (was all 113, one rAF
  each), retained `_presetLutCache` (was unbounded, 48.7MB after scrolling "All"), worst frame gap
  during a 65³ DCP bake (was a 1157ms whole-second freeze on every RAW load). Three of the seven
  carry a **correctness guard** alongside timing (`_boxFilterJS` diffed against a reference impl,
  the worker DCP bake diffed against the main thread's — max|Δ|=0 over 823,875 entries, the lazy
  gallery asserts *something* rendered) — a faster-but-wrong version would be strictly worse than
  the slow one and invisible on a stopwatch alone.
- **`test/library_perf.mjs`** — Library grid budgets against a synthetic folder
  (`?libtest=1&libn=N`): DOM node count (was 17,914 → 1,995 at 1,000 entries via virtualization)
  and `clusterByHash` perceptual-hash clustering (was O(n²) BigInt bit-counting, ~42s at n=5,000
  — now SWAR popcount on parsed Int32Arrays, gated to agree with the original exactly over 83,436
  pairs including deliberate near-duplicates at every Hamming distance 0–8).
- **`test/mask_raster.mjs`** — exists because **no export golden contains a raster mask** (every
  recipe uses analytic shapes); asserts byte-exact round-trips, legacy plain-`Array` mask
  loading, and that painting can't corrupt a history entry.
- **`test/export_harness.mjs`** — loads the real file in Playwright/Chromium with software
  (SwiftShader) GL so output doesn't depend on host GPU, drives it through the app's own
  `applyUISnapshot`/`processToCanvas`, diffs against `test/golden/`. Watch console output for
  `[pageerror]` and `GLSL compile error` on every run.

**Two known-flaky tests on this machine** (measured, not guessed — see `CLAUDE.md`'s own flaky
section and §4 above): `export_harness`'s blank-render/context-loss retry, and `video_harness`'s
~40% post-video byte-exact failure rate. Re-run before bisecting either as a regression.

**`test/editor_ux_spec.json`** is not a test script but the checklist those scripts assert
against — a stable-ID backlog of every Editor UX ask, each carrying the `check` name (script or
manual probe) that will close it. See §7 below for its current open items; consult it before
starting any Editor UX work so you don't re-report or re-diagnose something already tracked.

**Never run `--golden` or `--baseline` on unverified code.** Both flags overwrite the ground
truth the gates check against — `export_harness --golden` would happily bake a blank-render
failure into all 18 goldens if the blank-render guard weren't there specifically to stop it, and
`perf_bench --baseline` / `ui_audit --baseline` will silently normalize a real regression into the
new "expected" number if run before the change is confirmed correct.

---

## 7. Known Tech Debt & High-Priority Backlog

### #0 — `test/editor_ux_spec.json`: the live Editor UX backlog (check this FIRST)

Stable-ID spec tracking the Editor-vs-wireframe alignment pass (see `HANDOVER_EDITOR.md`). Each
entry has `category`, `status` (`open`/`fixed`/`backlog`), `source` (verbatim user ask),
`wireframeRef`, and `check` (the test that will assert it once written). **Update status in place
as work lands — never delete entries.** Current count: 44 items, 29 fixed, 12 open, 3 backlog. Open
items as of this handover:

| ID | Category | Ask |
|---|---|---|
| E1 | bug | Scrolling/zooming buggy with full-res enabled — wheel/pan paths never set `_fxPreviewInteracting` (`chromasmith-22.html:14930,14969-14972`), unlike sliders (`:9779-9788`); fix is extending the existing rAF+interacting pattern to wheel/pan |
| E2 | bug | Reset sometimes doesn't reset the photo — **could not reproduce** 2026-09-09 via the real gear-menu path; `editor_wireframe_behaviour.mjs`'s reset-restores-defaults check passes |
| E3 | bug | Reset shouldn't need a confirmation dialog, since undo can already fix it |
| E4 | bug | Shrinking the app window squeezes photos instead of shrinking them |
| E6 | bug | (tooling-found, 2026-09-08) docked Library filmstrip issue |
| E7 | bug | (tooling-found, 2026-09-08) intermittent failure, ~half of runs |
| 3.1.5 | topbar | Gamut warning button doesn't work |
| 3.1.8 | topbar | Remove the three-dot menu; move those options under a new Tools button |
| 3.1.9 | topbar | Move export and all FX controls to the right |
| 3.1.10 | topbar | Title isn't centered |
| 3.4.6 | looks-panel | BUG: Highlight Response slider doesn't affect the photo |
| 3.4.10 | looks-panel | Arrow keys while a preset is selected should change the preset |

Read the full `note` field on each ID in `test/editor_ux_spec.json` before starting — several
(E1, E2) already carry a diagnosed root cause or a "could not reproduce" write-up; don't
re-diagnose from scratch. The three `backlog`-status items are deferred by design, not omissions.

### #1 — Docked Library filmstrip / `#lib-side` coupling (freshly touched, watch closely)

The most recent commits (`72a0c67`, `a59bc59`, `c088091`, `eaffa4b`, `5e9c843`, `ad18d27`) are all
in this area. Real coupling, confirmed via `git show c088091 --stat` and the commit message:
`desktop/library-ui.js`'s `#lib-side` wrapper holds **both** the always-visible Library/Develop
tab pair (`.lib-side-tabs`, `.lib-side-tab`) **and** the Collections/By-Date/Recents/Favorites/
Drives navigation tree (`#lib-collections`, `#lib-folders-header`, `#lib-tree`,
`#lib-collections-post`) in one shared container. The bug (widening the docked filmstrip past
150px leaked the whole nav tree, not just the tab pair) was fixed by unconditionally showing
`#lib-side` while docked and unconditionally hiding the nav-tree children while docked, and
removing the old width-threshold JS/CSS (`lib-dock-wide`/`lib-dock-icons`) entirely. A live
regression test now exists: `test/library_dock_states.mjs` (Playwright ARIA-snapshot state matrix
at 90/150/280px, scoped to `#lib-side`) plus `test/library_flag_state_leak.mjs` (per
`eaffa4b`, E5 flag-state leak). **Safest next step if this area is touched again**: extract the
tab pair into its own top-level sibling element (not a child of `#lib-side`) so "always visible
while docked" and "hidden while docked" are structurally two different containers instead of one
container with conditional children — the current fix is correct but still relies on every future
edit remembering which children of `#lib-side` are dock-visible and which aren't. There is also an
untracked scratch file at the repo root, `test/_verify_filmstrip_fix.mjs` (per `git status`) —
check whether it should be folded into the permanent suite or deleted before it goes stale.

### #2 — N2.3 part 2: dedicated CPU worker for concurrent RAW-load + export

From `ROADMAP.md`'s Open Items: a user can drag in a new RAW while a previous export is still
rendering in the background (export doesn't block the drop zone). Both `bakeDcpLUT` (RAW load)
and `exportSharpen` (export) currently share one `_cpuWorker` queue. Measured with a throwaway
two-worker prototype against the real functions: worst case (bake + a 24MP sharpen dispatched to
the single worker at the same instant) **2639ms** vs **1605ms** split across two workers — about
**1034ms** of added latency before a newly-loaded photo becomes usable. Verdict in the roadmap:
cheap to build, real win, narrow trigger — reuse that probe's methodology to re-verify on real
hardware before picking it up, since the original numbers came from a SwiftShader-class CPU path.

### #3 — R16: draggable panel workspace / unified Library+Edit view

Listed in `ROADMAP.md`'s RapidRAW competitive-review section as size M, not yet started. Removes
the mode switch between the grid and editor views and persists panel order — the largest
still-open UX item from that review. Sequencing note in the roadmap: R2 should land before R4 (R4
depends on R1's remaining gap and is the "real" version of R2's stand-in); R3/R10/R15 are called
out as session-sized wins with no dependencies. R5 (a Naga-based shared shader kernel) was
investigated and explicitly **closed as rejected** — its spike concluded no second shader copy
exists to unify, since the desktop shell already reuses the same WebGL2/GLSL through its WebView.

Also worth knowing about, not urgent: `ROADMAP.md` documents that `R15` (JXL/AVIF export) was
checked for real and rejected as not cheap enough to ship (CLI-export half was delivered
separately), and `R13`'s N-way panorama stitching remainder (3+ photos) needs either pairwise
feature-matching or homography+seam-finding work neither built nor validated yet.

---

## 8. Day 1 Kickoff Prompt

Paste this as the first message in a fresh Claude Code session in this repo:

```
Read CLAUDE.md (root) fully, then HANDOVER.md (this file) section 7. Before touching any code:

1. Run `npm test` and `npm run ui:test` from a clean tree and confirm both are green on main —
   this establishes your baseline. Do NOT run `--golden` or `--baseline` on anything yet.
2. Read desktop/library-ui.js's #lib-side handling (grep for "lib-side", "filmstrip", "dock")
   and test/library_dock_states.mjs, test/library_flag_state_leak.mjs — these are the freshest
   commits in the repo (c088091, eaffa4b) and the #1 backlog item in HANDOVER.md §7: the tab
   pair and the nav tree still share one #lib-side wrapper, held apart only by conditional
   children rather than structurally separate containers.
3. Check whether test/_verify_filmstrip_fix.mjs (currently untracked per git status) should be
   folded into the permanent Playwright suite (playwright.config.mjs's testMatch) or deleted.
4. Tell me what you find before making any change — I want your read on whether the #lib-side
   extraction (splitting the tab pair into its own top-level sibling) is worth doing now or
   whether the current conditional-children fix plus its state-matrix test is durable enough to
   leave alone.

Follow CLAUDE.md's process lessons (§6) throughout: render-and-look before point-samples, read a
container's full children before toggling its visibility, and never judge a shader change by
"the page still loads" — always run `node test/export_harness.mjs` after any GLSL edit.
```
