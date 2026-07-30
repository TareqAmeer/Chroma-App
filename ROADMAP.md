# Chromasmith — roadmap

15 feature improvements + 5 UX/UI enhancements, ordered by value-per-effort within each tier.
Every item names the concrete gap it closes and the code it would touch. Effort is rough:
**S** ≈ a session, **M** ≈ a few sessions, **L** ≈ a substantial project.

Several items are grounded in measurements taken while shipping the Skin Tone tool
(`test/probe_tm3390.mjs`, `test/probe_skin.mjs`) — those are marked **[measured]** and are the
highest-confidence entries here.

**Status: 8 of 19 done** (item 12 withdrawn — it already existed). ✅ 1 (multi-sample gate),
2 (Amount), 3 (order half), 6 (Texture), 8 (range mask types), 14 (export resize + sharpening),
B (Selection in loupe), D (slider ergonomics). Every one verified against the export gate with all
18 goldens byte-identical, i.e. each is a true no-op at its defaults.

---

## Tier 1 — finish and harden what the mask system already almost does

### 1. ✅ DONE — Multi-sample colour gate (hue *locus*, not a ball) — **[measured]**
`colRangeWeight` centres a symmetric hue×sat kernel on ONE pick. Real skin isn't a ball in that
space: on `__TM3390.jpg`, with the gate centred on the cheek (h 0.044, s 0.373), the lower torso
(222,169,185) gated only **0.32** and the shoulder (209,150,156) **0.31** — both sit on the
magenta side of the hue wheel because of sheen. Widening Range to catch them also drags in
non-skin. Fix: shift-click to add several samples (Lightroom's Color Range does exactly this),
gate = `max` over samples, or fit a small covariance ellipse over the picks. This is the single
biggest quality win available to the tool we just shipped.
*Touches:* `colRangeWeight` (lut shader), `mskG` packing → an array of samples (UBO or a tiny
1D sample texture), `mskCrEyedropperClick`, `mskMeasureSrcV`'s JS mirror.

### 2. ✅ DONE — Per-mask **Amount** (opacity)
Every per-mask slider is independent, so dialling a mask back means scaling eight sliders by
hand. Capture One's own advice for over-strong uniformity is "turn the value down, or erase the
mask with a low-opacity brush" — an Amount slider is the direct answer. Implementation is one
multiply on `w` after the gates, before `skinUniformity`/`maskAdjust`.
*Touches:* one slot in `mskB`/`mskE`, one line in the mask loop, one `_mskRow`.

### 3. ⏳ PARTLY DONE — Mask **reorder** shipped (+ rename/mute); edge-aware refine and higher raster resolution still open — **[measured]** — M
Three related defects in one area:
- **Order matters but can't be changed.** `− Subtract prev` subtracts *the previous mask in the
  list* (`mskE[i].x`, `mskShapeWeight(i-1)`), yet there is no reorder affordance anywhere
  (`grep reorder` → 0 hits). Getting the order wrong means deleting and re-creating masks.
- **Raster masks are 1024px max** (`mskTexDims`, `MAXD=1024`) against a 4000×6000 photo — a ~5×
  upscale, so brush/sky/AI mask edges are soft and blocky at export.
- **No edge-aware refine.** A guided filter using the photo as guide would snap brush/sky/AI
  edges to real boundaries, which matters far more than raw resolution.
*Touches:* `mskRebuild` (drag handles), `mskTexDims`, `mskBuildTex`, a new refine pass.

### 4. Browser-side AI subject / person / skin mask — L
EdgeSAM is desktop-only (`body.deskx #btn-msk-add-ai`), because it needs the native
`sam_encode`/`sam_points` commands in `desktop/src-tauri/src/sam.rs`. Running it in the browser via
`onnxruntime-web` + WASM would make the app's best selection tool available everywhere — and it
is the structural answer to "don't touch my dog or the other people in the frame". Precedent
exists: `vendor/libraw` is already a vendored, sha512-verified WASM decoder, and the app is
offline-first by design so a bundled model fits the architecture.
*Touches:* new `vendor/sam-web/`, an ORT-web path behind `samEnsureEncoded`, drop the `deskx` gate.

### 5. Raise the 4-mask cap — M
`mskAdd` hard-stops at 4 ("Maximum 4 masks") because the lut pass packs masks into `vec4 mskA[4]`
… `mskI[4]` and packs raster masks one-per-RGBA-channel into a single texture. Both are the real
constraints. A uniform buffer object (or a small parameter texture) plus a raster **texture array**
or atlas would take it to 8–16. Portraits with skin + eyes + background + sky already exhaust 4.
*Touches:* all `msk*` uniform declarations and packing, `mskBuildTex`, `mskShapeWeight`.

### 6. ✅ PARTLY DONE — Per-mask **Texture** shipped; Clarity/Sharpness/Noise still open — M
Masks carry exposure/contrast/temp/tint/sat/hue/highlights/shadows/colour-paint, but none of the
*detail* controls — so the most common portrait move of all (soften skin texture locally while
keeping eyes sharp) is impossible. The lut pass already runs a 5-tap unsharp on source pixels for
global `adjSharp`/`adjClarity`; the per-mask version needs that neighbourhood available at the
mask stage, which is the only real design question.
*Touches:* lut shader (a second unsharp, or move masks after a detail pre-pass), `mskC`/new array.

### 7. Frequency-separated lightness evening — M
Deliberately deferred when we shipped Skin Tone. Today, lightness uniformity either contracts
(flattens form) or offsets (preserves form but doesn't close the gap) — the `preserve` slider is a
trade between them, and on `__TM3390.jpg` the lightness gap only closed **12%** at
`preserve = 70`. Blurring the gated luminance and pulling only the LOW-frequency component toward
target would even out a hard tan line while leaving pore and shading detail intact — the actual
pro dodge-and-burn technique. Cost: a blur pre-pass plus widening `renderTiled`'s halo (σ ≈ 80px
at 4000px) so export tiles stay seamless.
*Touches:* new blur pass + FBO, `skinUniformity`, `renderTiled` halo computation.

---

## Tier 2 — capability gaps against Lightroom / Capture One

### 8. ✅ DONE — Colour Range and Luminance Range as first-class mask *types*
We added a colour gate as a *modifier* on shape masks. Both range gates deserve to be masks in
their own right (`+ Colour Range`, `+ Luminance Range`) with no shape at all — that is how users
coming from Lightroom expect to find them, and the machinery is already written.
*Touches:* `mskAdd`, `mskShapeWeight` (a "no shape → 1.0" type), `mskRebuild`.

### 9. Dehaze — S/M
Absent entirely (`grep dehaze` → 0). A dark-channel-prior estimate, or the cheap route: a
haze-weighted contrast + black-point + saturation lift keyed on low local contrast in the
distance. Mountain and lake shots — exactly this photo — are the canonical use case.

### 10. Spot removal / clone / heal — M
Absent (`grep healing` finds only an unrelated comment). Even a plain clone-stamp with a soft
edge would cover dust, blemishes and sensor spots. The brush infrastructure (`mskPaintAt`, raster
masks, resolution-independent painting) is directly reusable for the stamp region.

### 11. Perspective / keystone correction + auto horizon — M
There is crop/rotate/flip/straighten but no keystone (`grep perspective` → 0). The `lens` shader
already does distortion/vignette/CA as a pre-pass on the source, so the geometry slot exists;
this is a homography in that same pass, plus a Hough-style auto-level for the horizon.

### 12. ❌ WITHDRAWN — Auto lens correction already exists
My error: this shipped already. `tg-lens-auto` / `fxLensAutoToggled` own the toggle, LensModel is
read from EXIF (`0xA434`), and the correction itself runs in Rust during RAW decode
(`desktop/src-tauri/src/lens_correct.rs`) as a real geometric remap rather than a shader term —
with `chromasmithLensApplied` reporting the decode's own outcome back into the status line. I
missed it because I grepped for `perspective`/`lensProfile` and not for the toggle id.

The only genuine gap left here is that it is **desktop-only**, since it needs the native decode
path. Browser/iOS see "no effect". Porting it would mean a WASM remap in the browser decode — a
different, larger piece of work; folded into item 13's territory rather than tracked here.

---

## Tier 3 — pipeline and output

### 13. Wider format support in and out; 16-bit — L
There is already a stray `IMG_7522.jxl` in the repo, so the need is real. JPEG XL / AVIF / HEIC
decode (WASM, same vendoring pattern as libraw) plus **16-bit** PNG/TIFF export would make the
RAW→edit→export path credible end to end. Today an 8-bit export throws away most of what the RW2
pipeline and DCP work earn.

### 14. ✅ MOSTLY DONE — Export resize + output sharpening shipped; ICC/P3, watermark and named presets still open — S/M
Export is full-resolution sRGB only. Long-edge resize with output sharpening (the two always go
together), Display-P3 / sRGB ICC embedding, an optional watermark, and named export presets. The
tiled export path already gives a clean place to hook resize.

### 15. Auto-match a series to a reference photo — M
Batch editing shares one `fxState` across photos, which is right for a look but wrong for
exposure/WB drift across a shoot. An "auto-match to reference" that solves per-photo exposure/WB
offsets would fix that — and the **Colour Copy** tab already does per-channel histogram matching,
so the core algorithm is written and just needs to emit per-photo `adjustOverride` values rather
than a LUT.

---

## UX / UI enhancements

### A. Mask panel: thumbnails, rename, solo/mute, drag-reorder — M
Masks are named "Radial 1 / Skin 2" with no visual. You cannot tell which is which without
clicking each and watching the overlay, cannot rename them, cannot temporarily disable one to
judge its contribution, and — per item 3 — cannot reorder them even though `Subtract prev`
depends on order. A small live thumbnail per mask fixes most of this at a glance.

### B. ✅ MOSTLY DONE — **Selection** view now works in the 1:1 loupe; overlay-opacity and edge-only modes still open — S
Known limitation of what we just shipped: `mskShowSelIdx()` is only passed by the two
`renderPreview` calls, so the loupe (`renderFullResCrop`) always shows the normal photo. Judging
a colour range at true export scale is exactly when you'd want it. Also worth adding: an opacity
slider for the red overlay, and an "edge only" outline mode for checking mask boundaries.

### C. Command palette (⌘K) — S
The app has four tabs, ~20 collapsible FX sections, 11 looks, print profiles and a growing mask
menu. A fuzzy palette over tools, presets, looks and toggles would beat hunting through sections,
and it composes well with the existing keyboard shortcuts panel.

### D. ✅ DONE — Slider ergonomics on desktop: numeric entry, keyboard nudge, modified-indicator
Mobile already has value bubbles and double-tap-to-reset; desktop has neither. Add click-to-type
a number, arrow-key nudge (⇧ for coarse), double-click to reset to the pristine default
(`_fxPristineDefault` already exists for section resets), and a subtle dot on any slider that
differs from default so a loaded recipe is legible at a glance.

### E. First-run tour + contextual "why" tips — S
The Guide tab is thorough but it is a wall of text read only by people who already know what
they're looking for. A short first-run tour (load a photo → pick a look → export) plus small
contextual tips on the genuinely non-obvious controls — Preserve modeling, No remjet, Shadow
protect, Input profile, Subtract prev — would carry far more of the design intent than prose.

---

## Notes on sequencing

- **1, 2 and 3** are the natural immediate follow-ups: they finish the tool just shipped, and
  item 1 is backed by hard numbers rather than a hunch.
- **5 (mask cap)** should land before 8, or first-class range masks will make the 4-mask ceiling
  bite immediately.
- **4 (browser SAM)** is the largest single UX unlock in the list, and it subsumes much of the
  manual masking effort items 3 and A exist to make bearable — worth pulling forward if the WASM
  model size proves acceptable.
- **13 (16-bit)** is the one item that changes the pipeline's ceiling rather than its surface; it
  is also the easiest to defer indefinitely, so it needs a deliberate decision rather than drift.
