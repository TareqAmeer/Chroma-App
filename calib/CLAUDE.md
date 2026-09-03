# Halation/bloom calibration, grain model, Fujify, zone geometry

Deep-dive reference for `calib/` work — halation calibration science, calibration tooling, the grain model, Fujify preset recreation, and chart zone geometry. Not needed to run the app; load this when tuning FXR.CAL constants.

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

## 11. Zone geometry (2× pixel coords, for re-measurement)

Zone 2 bars (x=2400–4799): 100% white y840–986, 80% grey y1020–1166, 60% y1200–1346,
40% y1380–1526, 20% y1560–1706, warm(255,190,110) y1760–1906, cool(110,180,255) y1920–2066.
Gap ≈34px. Measure interiors ≥40px from any edge.
Zone 7 full-width lines/blocks at x=3600: white line y5240, warm(255,160,80) y5360,
cool(110,180,255) y5480, red(255,80,80) y5600. **Always use the 2×/4800×6400 PNGs.**

---

