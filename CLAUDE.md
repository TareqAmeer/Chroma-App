# Chromasmith Halation Calibration — Handoff

## Goal
Calibrate `chromasmith-22.html`'s halation/bloom WebGL effect to match Dehancer film emulation reference PNGs — close enough to be indistinguishable **at a glance**, then refined numerically.

## ✅ RW2 (Panasonic RAW) input — SHIPPED 2026-06-10e
`.RAW` extension also accepted since 2026-06-11c (Panasonic writes RW2 data as `.RAW`
in some modes — same `IIU\0` magic; LibRaw sniffs the real format from content).
Decoder: `libraw-wasm@1.1.2`, vendored at `vendor/libraw/{index.js,worker.js,libraw.wasm}`
(sha512-verified against the npm registry tarball). Lazy `import()` on first RW2 load.
Its wasm uses **SharedArrayBuffer** → needs cross-origin isolation (COOP/COEP), which
GitHub Pages can't set via headers → solved with **`coi-serviceworker.min.js`** (MIT,
gzuidhof v0.1.7, repo root), registered as the first `<head>` script; it auto-reloads
the page once on first visit so `self.crossOriginIsolated===true`. This relaxes the pure
single-file property (3 vendor files + 1 SW file).
- `loadRw2()` in chromasmith-22.html: `raw.open(bytes,{useCameraWb:true,outputColor:1,
  outputBps:8,userQual:3,userFlip:-1})`; **`imageData()` returns an OBJECT**
  `{width,height,colors,bits,data:Uint8Array}` — not a flat array (was an all-black bug).
- Orientation honored (`userFlip:-1`): portrait RW2 decodes as 4016×6016. Export
  auto-format treats `rw2` as lossless → PNG out.
- **Measured perf** (M-series Mac, 24MP ~25MB GH5-class files): decode 13–25 s per file,
  single-threaded feel; phones will be slower and RAM-tight. Verified: LUT presets, FX
  (grain/halation/bloom), PNG + JPEG export all work on RW2-sourced images.
- **DCP camera profiles (2026-06-11b)**: "RAW profile" dropdown (default **Camera
  Standard**, persisted in localStorage) applies Adobe DCPs from `vendor/dcp/` (14
  Panasonic DC-S9 profiles, source: `calib/DCP Camera Profiles/`) so RW2 color ≈
  Lightroom. Decode switches to linear 16-bit camera RGB (`outputColor:0,outputBps:16,
  gamm:[1,1],noAutoBright:true`), then a 65³ LUT baked from the DCP (bake ≈0.4 s,
  cached) is applied per-pixel. Pipeline + fitted constants validated in
  `calib/dcp_pipeline.py` against `calib/TM3617.tif` (LR 16-bit export, Camera
  Standard, zero edits; squint loss 0.053; JS == Python pixel-exact). The fitted
  correction constants absorb Adobe's private BaselineExposure/flare + LR-vs-libraw
  as-shot-WB diff and are **ISO-DEPENDENT** (dual-gain sensor; one constant set fit
  ISO 250 but failed ISO 3200 — user-reported washed-out forest shot, 2026-06-11d).
  Refit jointly on FOUR LR reference pairs (ISO 200/250/2000/3200: `__TM3329`,
  `TM3617`, `__TM4555`, `P_TM2007` .tif+.RW2 in calib/), each within 0.001 of its
  solo-best loss: `x=log2(ISO/100); ev=-0.819-0.1732x; gb=1.0714-0.0214x;
  gr=0.9709; black=max(0,0.0397-0.00714x)` (`dcpFit(iso)` in the HTML, `iso_fit` in
  `calib/dcp_pipeline.py`, `calib/dcp_fit_iso.json`; ISO from `metadata().iso_speed`).
  ⚠️ At high ISO compare PATCH MEANS not single pixels (LR denoises, we don't).
  ⚠️ DNG gotchas: LookTable data layout is **[val][hue][sat]** (NOT the dims order
  hue/sat/val — both 16 so reshape doesn't catch it); V axis is sRGB-encoded when
  LookTableEncoding=1; per-channel tone curve beats hue-preserving. rawpy 0.21
  (LibRaw 0.21.2) **mis-decodes the DC-S9** (wrong white level, zero matrix) — the
  Python harness reads `/tmp/cam16_6016x4016.bin`, a dump produced by the app's own
  wasm decode in the browser (re-dump via fetch POST if needed).
- Caveat for `None` profile: LibRaw demosaic/WB/color ≠ Lightroom's rendering.
  Remaining DCP-path gap vs LR: default noise reduction/sharpening only.
- iPhone RW2: first attempt failed (`Unhandled: [object Object]`), worked on retry —
  almost certainly memory pressure; 2026-06-11a added `errStr()` (readable worker
  errors), per-file try/catch in `loadFXImages`, and `raw.worker.terminate()` after
  each decode (the worker leaked ~0.5–1GB wasm shared memory per file — the likely
  culprit). If it recurs the log now shows the real error.
- Test files: `calib/__TM3329.RW2`, `__TM3617.RW2`, `__TM4555.RW2` (untracked, keep local).
- Local testing gotcha: macOS sandboxed preview servers can't read `~/Documents` (TCC);
  serve a copy from `/tmp/chroma-preview` instead (see `.claude/launch.json`).

## ⚠️ Build stamp
`chromasmith-22.html` has a `const BUILD='YYYY-MM-DDx'` near the top of its `<script>`
(shown in the header + startup log so users can spot a stale GitHub Pages/Safari cache).
**Bump it in every session that edits the file.**

## Repo
`/Users/tareqameer/Documents/GitHub/Chroma-App/`
Active branch: `claude/magical-fermat-VIryB`

## Reference files (all in repo root)
- `dehancer halation x2.png` — Dehancer halation-only reference (4800×6400)
- `dehancer bloom x2.png` — Dehancer bloom-only reference (4800×6400)
- `IMG_5774_2x.PNG` — clean base chart (4800×6400). **Pixel-identical** to Dehancer's
  own base (`dehancer base x2.PNG`, mean|Δ|=0.0000) — there is no base color-grading
  confound, so `our_render` can be diffed directly against `dehancer halation x2.png`.
- `calib/gen_chart.py` — chart geometry definitions

**Always use 2x PNG files (4800×6400) for all measurements.**

---

## STATUS: rule-based halation model + high-pass glow + asymmetric+magenta purple (v22.1b)

`chromasmith-22.html` ships the **rule-based emission model** below, now with
**three** fixes layered on top of v22 for user-reported defects the old point-sample
validation missed: **(1) asymmetric blue-suppression** so purple halates at all,
**(2) high-pass glow** so large saturated blocks no longer self-flood (the "red bar
turns orange" bug), and **(3, v22.1b — new this session) a magenta/purple driver**
(`+bP·min(R,B)`) that closes the remaining purple **strength** shortfall (0.187 →
0.327, matching Dehancer's 0.325) — the one deferred item left over from v22.1.
`calib/validate_v22.py` and `calib/scorecard.py` are synced to the same formulas.
(GLSL emit ~line 612–639, composite high-pass ~line 713–723, `FXR.CAL.halation`
~line 906–921.)

**Verified in a real browser** (static server + WebGL2): all 5 shader programs
compile *and link*, including the composite's `hEmit` sampler and the new `bP`
emit-shader uniform. Doing this caught **two** instances of the same latent-bug
class — a stray backtick inside a GLSL `//` comment that lives inside a JS template
literal, which silently truncates the shader source string and throws
`SyntaxError: missing ) after argument list`, breaking the *entire* live page:
- v22.1: `` `R - bB*B` `` (inherited from a prior session, never caught because that
  session only ran Python renders, never loaded the HTML).
- v22.1b: introduced **by this session itself** while writing the bP doc-comment
  (`` `max(B-R,0)=0` ``) — caught immediately because this session loads the page in
  a real browser **after every shader edit**, not just at the end.

**Lesson reinforced twice now: never put backticks (or `${`) inside a GLSL comment
that lives inside a JS template literal — use double-quotes for inline code/values —
and always reload the live page after touching shader source, even for "just a
comment" edit.**

```javascript
// FXR.CAL.halation — committed v22.1b (only bP is new; all other constants unchanged):
halation:{thr:0.10,knee:0.141,power:1.0,bluesupp:0.9691,
          powL:3.9247,kW:1.0028,kC:0.8860,aG:0.1972,bP:2.10,
          sigmaR:7.5233,sigmaG:3.7617,sigmaB:1.1285,
          gainR:1.2380,gainG:0.0958,gainB:0.0,defAmount:70}
```
(`sigmaR/G/B` are at the 1x/2400px reference width — multiply by 2 for the 2x/4800px
images used in calibration. `bluesupp` doubles as the model's `bB`.)

---

## The rule-based emission model

```
sat   = max(R,G,B) − min(R,G,B)                               // 0 for neutral gray
white = lum ^ powL                                            // steep "brightness toward white"
color = sat · max(R + aG·G − bB·max(B−R, 0) + bP·min(R, B), 0)  // ASYMMETRIC blue-supp + magenta driver
emit  = smoothstep(thr, thr+knee, lum) · (kW·white + kC·color)
blur_c = channel_split_gaussian_blur(emit)                    // per-channel σ_R≫σ_G≫σ_B
glow  = max(blur_c − emit, 0) · (gainR, gainG, gainB)         // HIGH-PASS: spread beyond source
result = screen(base_linear, glow)
```

### Two v22.1 fixes (for user-reported defects)
The original v22 (`color = sat·max(R+aG·G−bB·B,0)` + `glow = blur·gain` screened)
matched at a glance but had two defects the gap-only point-sample harness missed:

1. **Purple didn't halate** (Dehancer purple gap R≈0.325, ours ≈0.000). The
   *symmetric* `−bB·B` term cancels purple's red against its blue (purple is R≈B,
   e.g. 200,0,200 → warmth ≈ R(1−bB) ≈ 0.03R ≈ 0). Fix: **asymmetric**
   `−bB·max(B−R,0)` discounts only the blue *excess over red*. This is **provably
   neutral-safe**: white/gray have `sat=0` so the whole color term is zero
   regardless of warmth; red has `B=0` so `max(B−R,0)=0` — unchanged. Only purple
   (B≈R → warmth jumps from ~0.03R to R) and warm (B<R, small boost *toward*
   Dehancer) change; cool/cyan/blue (B>R) stay suppressed. Result: purple gap R
   0.000 → 0.187 (clearly halates).

2. **Red bar self-flooded to orange** (red block *interior* green Δ = +0.301 vs
   Dehancer +0.004). Screening `blur(emit)·gain` onto the source means a large flat
   colored block, whose interior is fully covered by its own blurred emission, gets
   `gainG·emit` screened back onto its green channel → red shifts orange (also green
   +0.31R, cyan +0.20R, purple +0.10G…). The *only* way the old screen mechanism
   could kill this was `gainG→0`, which turns the soft red-orange halo hard pure-red
   (a regression two full re-optimizations fell into). Fix: **high-pass glow**
   `max(blur(emit) − emit, 0)`. Physics: in a uniform field, light scattered out ≈
   light scattered in, so net halation ≈ 0; halation only appears at gradients/edges.
   In a flat block `blur≈emit` → glow≈0 (interior clean); at gaps/edges `blur>local
   emit` → full halo. This **decouples** gap-halo strength from interior flooding, so
   `gainG` stays nonzero (soft red-orange) *without* flooding. Verified: gap R
   identical, every interior G flood eliminated (red 0.301→−0.004) even at 3×gainG.
   (In the HTML the pre-blur scalar emit lives in the `hsrc` texture; the composite
   shader binds it as `hEmit` and subtracts `max(rawH − emit, 0)`; emit is clamped to
   [0,1] to match the 8-bit texture, and the Python models mirror this.)

### v22.1b fix: magenta/purple driver closes the deferred purple-strength gap
v22.1 fixed purple's *presence* (0.000 → 0.187) but left it under Dehancer's target
strength (0.325) — explicitly deferred to Phase B. This session closed it with one
more provably-surgical term: **`+ bP·min(R, B)`** added to `warmth`, `bP = 2.10`.

**Why bB couldn't be the lever**: this chart's purple swatch is `(200,0,200)` — R
and B are *exactly equal* in both sRGB and linear space, so `max(B−R,0) = 0` and
`bB` (an R/B-*excess* suppressor by construction) has **zero effect on it** — verified
by sweeping `bB` from 0.97 down to 0.0 and observing **bit-identical** purple emission
at every value. bB only ever discounts blue *in excess of red*; purple has no such
excess to discount, so it was never a usable knob for *boosting* purple — a different
driver was required.

**Why purple under-emits**: at `(200,0,200)`, `lum ≈ 0.165` (low — the brightness gate
`smoothstep(thr,...)` ≈ 0.44, about half of red's ≈ 0.89) and `color = sat·warmth =
0.578·0.578 ≈ 0.33` (about a third of red's `1.0·1.0 = 1.0`). Both factors compound to
~16% of red's emission — matching the measured ratio exactly.

**The fix — `min(R, B)`, a "magenta-ness" detector**: provably zero whenever *either*
channel is zero — i.e. for red/orange/yellow/green (`B=0`) and cyan/blue (`R=0`) — and
only activates where R *and* B are both present together (magenta/purple/pink, and
slightly for warm/the (255,80,80) "red" thin-line which carries a small B). This is
the same "two emission terms" philosophy as the brightness/warmth split: a single
existing driver couldn't both leave red/cyan untouched *and* boost purple, because
every existing term that's nonzero for purple is *also* nonzero for some other hue
that must not move. `min(R,B)` is the one expression that isolates "both R and B
present" — exactly the magenta/purple family and nothing else.

**Validated read-only before any edit** (`bP` swept 0→3.0 through the full render):
- Purple gap-R moves smoothly 0.187 → 0.327 (Dehancer 0.325, picked `bP=2.10` for
  closest match — Δ=+0.002, effectively exact).
- Every other color's gap-R *and* interior-flood-G value is **bit-identical** across
  the entire sweep (red/orange/yellow/green/cyan/blue/white all unchanged to 3 dp).
- `calib/scorecard.py` confirms **0 FAIL rows — ALL PASS** (down from v22.1's 1
  deferred FAIL: `z5 purple gap R`). The only secondary movement is a small
  (well-within-tolerance) shift in zone7 warm/red thin-line R — both colors carry
  nonzero B (warm has B≈110, the "red" thin-line is `(255,80,80)` not pure red) so
  `min(R,B)` mildly affects them too; still comfortably PASS (≤0.168 vs the 0.18
  threshold).

### Why two emission terms (this is the physical insight that unlocked the fit)
Real film halation: **any sufficiently bright source** scatters off the film backing
and re-exposes the emulsion in the **backing dye's color** (red-orange), regardless
of the source's own color. So the model needs two drivers:
- **`kW·lum^powL`** (powL≈3.9, steep): a pure-brightness term. White (lum≈1) glows
  strongly; mid-gray (lum≈0.5) glows almost not at all (0.5^3.9≈0.07). This is what
  makes flat gray bars stay neutral instead of self-tinting pink (see below).
- **`kC·sat·max(R+aG·G−bB·max(B−R,0), 0)`**: a saturation/warmth term. Saturated
  colors (red, orange, green, cyan, purple, yellow) have `sat>0` and glow; neutral
  grays have `sat=0` and don't, no matter how bright. Only the blue *excess over red*
  is suppressed (`bB≈0.97`) — so purple (R≈B) halates while cool/cyan/blue stay
  suppressed — and warm is mildly boosted (`aG≈0.20`). This is what makes
  red/green/cyan/purple halate — the old model's biggest miss.

A single driver can't do both: a brightness-only term can't make saturated red
(lum≈0.3) halate; a red-channel-only term makes flat greys self-emit and pink-flood.

### Why the old (v5/v21) red-surplus model was wrong
`emit = bright · clamp(R − bluesupp·B, 0, 1)` keyed almost entirely off the red
channel:
1. **Green/cyan/purple/yellow/teal got ≈0 emission** (their R is low) → no halation
   at all on those colors. Zone 5: green/cyan rendered `R=0.000` vs Dehancer `0.28+`.
2. **Red barely halated** (counter-intuitively — gain was tuned to compensate for
   warm over-prediction, which crushed red along with it).
3. **Gray bars self-emitted and pink-flooded**: a flat 80%-gray bar has `R=0.8`,
   which passes the brightness gate and screens a red-tinted glow back onto itself
   — every gray bar rendered visibly pink/red-tinted versus Dehancer's neutral gray.
   This was **the single most visible defect** (see screenshot comparison in session
   history) and the old point-sample harness never caught it (see process lesson).
4. The resulting halo was **hard saturated red**, not the soft red-orange Dehancer
   shows.

### Calibration method: autonomous dense pixel-loss optimization
Because the base images are pixel-identical, `our_render` can be diffed directly
against `dehancer halation x2.png`. `calib/optimize_hal.py` builds a "glance" loss —
`mean(w(x,y) · |squint(our_render) − squint(dehancer_halation)|)` where `squint` is
a downsample/blur (models "can't tell at a glance") and `w` upweights gaps/edges/
colored blocks (where halation actually lives) — and minimizes it with scipy
Nelder-Mead, **entirely inside one Python process, with zero Claude-token cost per
evaluation** (`python calib/optimize_hal.py`, can run in the background). Result:
`calib/best_params.json`, loss 0.0239 (vs the old model's 0.0287, ~17% better),
visually confirmed against `calib/cmp_rule_*.png` (side-by-side strips vs Dehancer).

### Inner-edge "tiny glow" — investigated, found to be already emergent
Dehancer shows a **two-layered halo profile**: amber/warm right at a bright edge
(measured G/R≈0.75–0.79) fading to deep red further out (G/R≈0.11–0.20) — the "tiny
inner glow at bright edges" cue the user called out as important for realism.

A dedicated 2-component model (`apply_halation_2c` / `render_rule2` in
`calib/halmodel.py`, optimized by `calib/optimize_innerglow.py`) was built and tuned
to add a second, narrower, more-amber glow layer on top of the existing wide
red-orange halo. **It converged to a near-zero gain (`gainGIn≈0.02`, at the lower
search bound)** — i.e., the optimizer itself concluded a separate inner-glow term
adds nothing. Why: the existing **channel-split blur (σ_R ≫ σ_G)** already produces
exactly this two-layer look for free — right at an edge both R and G glows overlap
(amber), but R spreads much further than G, so deeper into the halo only the red
remains (deep red). **No separate term needed; it emerges from the physics already
in the model.**

A first attempt at a dedicated inner-glow term (`sigmaIn=7.78, gainGIn=0.49`) looked
like a good fit to the edge G/R *profile* (error 0.111→0.024) but **visually caused
a yellow-shift regression**: it bled green onto the warm bar's flat interior (G:
0.770→0.881, visibly yellow vs Dehancer's 0.737). This was caught by rendering and
looking — not by the point-sample harness — and is a second instance of the same
*class* of error as the pink-flooding (color bleeding from edges into flat
interiors). A retuned, tightened version (`sigmaIn≤4px`, explicit anti-bleed penalty
sampling 4 bar interiors) still couldn't find a configuration where the inner-glow
contribution was both visible at edges *and* invisible in flat interiors — confirming
it's a genuine non-improvement, not a tuning miss.

---

## ⚠️ Process lesson: render-and-look FIRST, point-samples are not enough

A large amount of prior work (multiple RMSE grid searches, 3 plan revisions) was
done **entirely blind** — never rendering an actual image — relying on
`validate_v22.py`'s point-sample metric, which samples **gaps between bars**, not
**bar interiors**. That metric structurally cannot detect the pink-flooding defect
(which only shows up *inside* flat regions), so it was invisible to every numeric
experiment despite being the single most visible defect to a human eye.

**Going forward:**
1. **Render the full chart and look at it side-by-side with the Dehancer reference
   FIRST** (`calib/render_chart.py` → `cmp_*.png` strips), before any tuning.
   Walk a concrete visual checklist (see Phase-A checklist below).
2. **Sample flat interiors, not just gaps/edges** — that's where flooding/bleeding
   defects live and where point-sample metrics blind-spot.
3. Treat the numeric harness as a **secondary guardrail**, not the primary signal.
4. When a model "fits the profile" numerically, **render it and check for bleed
   into adjacent regions** before trusting the number (this caught the inner-glow
   regression that the profile-fit metric alone would have missed).

### ⚠️ v22.1 process lesson: a FAST scorecard gate, not slow blind optimization
The v22.1 purple/red-flood fixes were *preceded* by a regression spiral: two full
re-optimizations (15 min and 107 min) whose loss silently under-weighted some
requirements, so they "improved the number" while collapsing `gainG→0` (hard pure-red
halo) and weakening edges — discovered only *after* each multi-minute run finished.

The fix that broke the spiral: **`calib/scorecard.py`** — a single human-legible
table covering **every** requirement (per-color gap halo *and* interior flood, gray/
warm/cool/white bars, thin-line R&G, halo softness G/R), computed on three small
crops in **seconds**. Run it BEFORE and AFTER every change; it prints BASELINE vs NEW
side by side with PASS/FAIL per row. Rules now:
- **Never run a long optimization whose loss doesn't encode every requirement** — if
  a requirement isn't in the loss, the optimizer will trade it away.
- **Validate the *mechanism* on a few read-only point computations first.** The
  high-pass fix was proven (interior flood 0.305→0.000 at identical params, gap R
  unchanged) in seconds *before* any file was edited — no optimization needed at all.
- **Gate the HTML edit on the scorecard being all-green-or-improved**, then confirm
  with render-and-look + the harness as secondary.

### Phase-A "glance match" acceptance checklist (validated against `cmp_rule_*.png`)
- [x] Gray bars stay **neutral** (no pink flooding); halo only in gaps/edges.
- [x] White bar: soft red-orange halo in gaps; interior clean.
- [x] Warm bar halo **much stronger** than cool bar halo.
- [x] Cool bar: small but visible halo. Saturated blue: ≈none.
- [x] **Red**: clearly halates.
- [x] Green, cyan/teal, purple, yellow, orange: visible red-orange halation.
- [x] Halo color **red-orange & soft**, not hard saturated red.
- [x] **Tiny inner glow** present just inside bright squares (emergent from σ_R≫σ_G).

---

## Zone geometry (2x pixel coords) — for future re-measurement

### Zone 2 (bars, x=2400–4799)
| Bar | y_top | y_bot | Color |
|---|---|---|---|
| 100% white | 840 | 986 | (255,255,255) |
| 80% gray | 1020 | 1166 | (204,204,204) |
| 60% gray | 1200 | 1346 | (153,153,153) |
| 40% gray | 1380 | 1526 | (102,102,102) |
| 20% gray | 1560 | 1706 | (51,51,51) |
| warm | 1760 | 1906 | (255,190,110) |
| cool | 1920 | 2066 | (110,180,255) |

Gap between consecutive bars ≈ 34px. Measure interiors ~40+px from any edge to avoid
edge-glow contamination (this is the fix to the point-sample blind spot above).

### Zone 7 (thin lines + blocks)
| Source | Line y | Block y_top | Block y_bot | Color |
|---|---|---|---|---|
| white | 5240 | 5252 | 5266 | (255,255,255) |
| warm | 5360 | 5376 | 5387 | (255,160,80) |
| cool | 5480 | 5492 | 5506 | (110,180,255) |
| red | 5600 | 5612 | 5626 | (255,80,80) |

All lines/blocks are **full-width (4800px)**. Measure at x=3600.

---

## Calibration tooling reference (`calib/`)

- `halmodel.py` — shared model module: `s2l/l2s/smoothstep/screen/gauss_blur`,
  `emit_rule` (committed model, **asymmetric** blue-supp), `apply_halation`
  (now defaults to **high-pass** glow; `highpass=False` for legacy screen),
  `render_rule`, `apply_halation_2c`/`render_rule2` (investigated 2-comp variant).
- `scorecard.py` — **the fast validation gate (run this first/always).** Prints every
  requirement (per-color gap halo + interior flood, gray/warm/cool/white bars,
  thin-line R&G, halo softness) as one PASS/FAIL table in seconds, BASELINE vs NEW
  side by side. See the v22.1 process lesson. `python calib/scorecard.py`
- `render_chart.py` — renders a model against `IMG_5774_2x.PNG` and writes
  `cmp_*.png` side-by-side strips vs `dehancer halation x2.png` (`make_comparison`).
  v22.1 render: `cmp_final_*.png`.
- `optimize_hal.py` — the autonomous 8-parameter dense-loss optimizer (scipy
  Nelder-Mead, zero Claude-token cost per eval). Produced `best_params.json`
  (the committed model). Rerun any time: `python calib/optimize_hal.py`
  (run in background — takes several minutes).
- `optimize_innerglow.py` — focused 3-parameter optimizer that investigated (and
  ruled out) a dedicated inner-glow component; includes an anti-bleed penalty
  sampling bar interiors — a useful pattern for future regression-guarding.
- `best_params.json` — **the committed model's parameters** (2x-image sigmas;
  divide by 2 for the HTML's 1x/2400px reference).
- `validate_v22.py` — zone-by-zone point-sample harness, synced to the committed
  formula. Secondary guardrail only — see process lesson above for its blind spot.
- Python venv: `.calibvenv` (numpy 1.24.4, PIL 10.4.0, scipy 1.10.1).

```bash
cd /Users/tareqameer/Documents/GitHub/Chroma-App
source .calibvenv/bin/activate
python calib/scorecard.py           # FAST all-requirements PASS/FAIL table (run first)
python calib/render_chart.py        # baseline render + side-by-side
python calib/optimize_hal.py        # rerun the autonomous optimizer (background-able)
python calib/validate_v22.py        # zone-by-zone point-sample grades
```

---

## Remaining / optional refinement ideas (Phase B — not blocking)
**Deferred from the v22.1 minimal-scope pass** (user chose "fix the 2 clear bugs
only"; these are *strength* shortfalls vs Dehancer, not presence/correctness bugs —
the scorecard still flags them so they're easy to pick up):
- ~~**Purple gap strength**~~ — **FIXED in v22.1b** (this session): added a magenta/
  purple driver `+bP·min(R,B)`, `bP=2.10`. Purple gap-R now 0.327 vs Dehancer's
  0.325 (Δ=+0.002, effectively exact; was 0.187, then 0.000 before v22.1). Scorecard:
  0 FAIL rows — ALL PASS. See "v22.1b fix" write-up above for the full mechanism +
  why `bB`/`kC` couldn't be the lever (bB is provably inert on this exact-R==B
  purple; kC over-pushes green/cyan). No longer a remaining item.
- **gray80 bar gap halo**: ours 0.431 vs Dehancer 0.604 (user point #3, "could be a
  bit stronger"). Driven by the neutral `kW·lum^powL` term; raising it risks the
  white bar / thin-line whites (sat=0 path).
- **cool edge halo** (user point #5, "subtle but stronger"): cool bar gap already
  matches; the ask was a touch more on the *light cool* edge.
- Earlier Phase-B notes still apply: Zone-5 dense-loss weighting, `bB` re-examination.
Any of these can be tuned against `scorecard.py` in seconds, then a tiny re-render.

## How to start Claude Code
```bash
cd /Users/tareqameer/Documents/GitHub/Chroma-App
claude
```
Then tell it: *"Continue halation calibration from CLAUDE.md"*
