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
calib/                      Calibration & analysis tooling (Python). Not needed to RUN the
                            app — only to re-derive/verify the film-effect constants.
  *.py                      Models, optimizers, validators, chart generators
  *.json                    Fitted parameter sets
  requirements.txt          Python deps (numpy/Pillow/scipy)
  README.md                 Tooling notes
  IMG_5774_2x.PNG           Clean base test chart (4800×6400)
  dehancer halation x2.png  Dehancer halation-only reference (the calibration ground truth)
  LUT LIBRARY/              The 11 shipped looks as .cube files (sideload-ready)
  DCP Camera Profiles/      Source Adobe DCPs for the DC-S9
  fujify/                   Fujifilm-look recreation pipeline (scripts + notes)
```

**Not bundled** (gitignored; supply your own): original RAW/JPEG/TIFF captures, the venv,
and the proof/validation PNGs the scripts emit. The app's 11 presets are embedded as
base64 inside `chromasmith-22.html` (`LUT_PRESETS`), so the app is self-contained without
`calib/`.

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
  file** so users can spot a stale Pages/Safari cache. Current: `2026-06-17e`.
- **Local preview gotcha (macOS):** sandboxed preview servers can't read `~/Documents` (TCC).
  Serve a copy from `/tmp/` instead.

### Calibration tooling

```bash
python3 -m venv .calibvenv && source .calibvenv/bin/activate
pip install -r calib/requirements.txt
python calib/scorecard.py        # FAST halation PASS/FAIL table (run first/always)
python calib/render_chart.py     # render a model + side-by-side vs the Dehancer reference
python calib/optimize_hal.py     # autonomous dense-loss optimizer (background-able)
```

---

## 3. App architecture (`chromasmith-22.html`)

Everything is in one file. Key pieces:

- **`FXR` class** — the WebGL2 renderer. 5 shader programs: `lut`, `src`, `blur`,
  `blur_hal`, `comp`. Pipeline per frame:
  1. **lut pass** — LUT lookup + `basicAdjust()` (exposure/contrast/WB/etc.) +
     sharpen/clarity unsharp mask (applied to source pixels BEFORE the LUT). ⚠️ **Saturation
     & vibrance are NOT applied here** — they moved to the comp pass (see below).
  2. **emit pass** — computes the halation/bloom *emission* map from the graded image.
  3. **blur passes** — per-channel Gaussian blur of the emission (σ_R ≫ σ_G ≫ σ_B).
  4. **comp pass** — screen-blends bloom+halation, then **grain** (value-noise, see §6b), then
     (if a Print profile is selected) a 2nd 3D LUT `printLut` via `usePrint`/`setPrintLUT`, then
     **saturation/vibrance** (`adjSat2`/`adjVib2`), then vignette. Order mirrors Dehancer:
     negative → halation → **grain** → **print** → **grade (sat/vib)** → vignette.
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

---

## 4. The four tabs

- **Effects & Export** — load image, pick a preset/LUT, a **Print profile** (Kodak/Fuji
  print, applied as a 2nd 3D LUT AFTER the film look + halation — see §8), basic
  adjustments, grain/halation (incl. **No remjet** strong mode — see §5)/bloom/vignette/
  borders, crop/rotate/straighten, export at full res. Plus: one-tap Looks gallery, WB
  eyedropper, auto-enhance, undo/redo (⌘Z/⌘Y, covers geometry too), split before/after,
  live histogram, zoom/pan, 1:1 loupe, session save, EXIF readout, batch export with
  progress + cancel.
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
  and bilinear-interpolate → grain CLUMPS of a controllable size (white noise has no size).
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
  of `LUT LIBRARY/` so the 11-film-look list stays clean). `gen_print_presets.py` then bakes
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
- The fitted correction constants are **ISO-dependent** (dual-gain sensor): `dcpFit(iso)` —
  `x=log2(ISO/100); ev=-0.819-0.1732x; gb=1.0714-0.0214x; gr=0.9709;
  black=max(0,0.0397-0.00714x)`. Validated in `calib/dcp_pipeline.py`.
- ⚠️ DNG/DCP gotchas: LookTable layout is `[val][hue][sat]`; V axis is sRGB-encoded when
  `LookTableEncoding=1`; rawpy 0.21 mis-decodes the DC-S9 (wrong white level) — the Python
  harness reads a dump produced by the app's own wasm decode in-browser.
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
7. The app preset list must mirror `calib/LUT LIBRARY/` (11 looks); a LUT with a real
   non-`_composed` source (astia/classic_neg/velvia) beats its composed recreation.

---

## 11. Zone geometry (2× pixel coords, for re-measurement)

Zone 2 bars (x=2400–4799): 100% white y840–986, 80% grey y1020–1166, 60% y1200–1346,
40% y1380–1526, 20% y1560–1706, warm(255,190,110) y1760–1906, cool(110,180,255) y1920–2066.
Gap ≈34px. Measure interiors ≥40px from any edge.
Zone 7 full-width lines/blocks at x=3600: white line y5240, warm(255,160,80) y5360,
cool(110,180,255) y5480, red(255,80,80) y5600. **Always use the 2×/4800×6400 PNGs.**
