# Chromasmith — roadmap

15 feature improvements + 5 UX/UI enhancements, ordered by value-per-effort within each tier.
Every item names the concrete gap it closes and the code it would touch. Effort is rough:
**S** ≈ a session, **M** ≈ a few sessions, **L** ≈ a substantial project.

Several items are grounded in measurements taken while shipping the Skin Tone tool
(`test/probe_tm3390.mjs`, `test/probe_skin.mjs`) — those are marked **[measured]** and are the
highest-confidence entries here.

**Status — the Skin Tone tool is DONE and verified on desktop.** Items 1, 2, 3, 5, 6(Texture), 7,
8, 14 (resize+sharpening+named presets), 16, A, B, C, D shipped; 4 partly. Item 16 (face-parse
auto-exclusion) is verified with a real Rust integration test (`cargo test`) against a real photo
— see `desktop/src-tauri/vendor/faceparse/README.md` for the full verification transcript — but
like item 4, the desktop UI round-trip (the new "✂ Auto-exclude face features" button) still needs
a hands-on check in the built app. Everything else below is verified against the export gate with
the untouched goldens byte-identical, i.e. each is a true no-op at its defaults.

**Still open — 8 items, each independent.** Nothing here blocks anything else, so they can be
picked off in any order and in separate sessions:

| # | item | size |
|---|---|---|
| 6 | Per-mask Clarity / Sharpness / Noise (Texture done) | M |
| 9 | Dehaze | S/M |
| 10 | Spot removal / clone / heal | M |
| 11 | Perspective / keystone + auto horizon | M |
| 13 | JXL / AVIF / HEIC in, 16-bit out | L |
| 14 | Export ICC/P3 + watermark (presets done) | S |
| 15 | Auto-match a series to a reference photo | M |
| E | First-run tour + contextual tips | S |

To pick one up in a fresh session, quote its number and heading from this file — each entry states
the gap, the files it touches and the functions to reuse. Read `CLAUDE.md` §5b first if the item
touches the skin path.

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

### 3. ✅ DONE — Mask reorder, raster resolution and edge-aware refine — **[measured]** — M
All three defects in this area are closed:
- **Order** — ↑/↓ buttons (`mskMove`) plus the `isExclude` eraser mechanism, which makes order
  matter far less than it used to (an eraser subtracts from every mask, not just the one after it).
- **Raster resolution** — `mskTexDims`' `MAXD` raised 1024→2048 for STORED brush/sky masks.
  EdgeSAM/SAM2's own encode input stays at 1024 (split into a separate `samInputDims()`) — the
  model's calibrated input size and the mask's stored crispness are now two different constants.
- **Edge-aware refine** — a "◈ Refine edges" button (`mskRefineEdges`) runs a guided filter
  (He/Sun/Tang 2010, box-filtered via `_boxFilterJS`, r=8) using the photo's own greyscale as the
  guide, and bakes the result straight into `m.px`. Chosen over a per-frame shader pass
  specifically so preview/loupe/every export tile agree for free — no `renderTiled` halo widening
  needed, unlike item 7's blur.
*Touches:* `mskMove`, `mskTexDims`/`samInputDims`, `mskRefineEdges`/`_boxFilterJS`, `mskBuildTex`.

### 4. ⏳ RESCOPED — AI mask now drives + Skin on DESKTOP; browser port dropped
The Skin mask is segmentation-first as of 2026-07-30f: `mskAdd('skin')` builds an AI mask, scribble
selects the subject, colour samples refine inside it. `mskIsAI()` routes the AI plumbing so Skin and
AI Select share one path. Per the user, **desktop is the only target** — the browser/iOS port of the
model is dropped rather than maintained as a worse second path.

Still open here: a dedicated *skin* segmentation (BiSeNet-style face/skin parsing) rather than
subject segmentation, which would separate lips, brows and hair without any brushing at all.

Original note follows — L
EdgeSAM is desktop-only (`body.deskx #btn-msk-add-ai`), because it needs the native
`sam_encode`/`sam_points` commands in `desktop/src-tauri/src/sam.rs`. Running it in the browser via
`onnxruntime-web` + WASM would make the app's best selection tool available everywhere — and it
is the structural answer to "don't touch my dog or the other people in the frame". Precedent
exists: `vendor/libraw` is already a vendored, sha512-verified WASM decoder, and the app is
offline-first by design so a bundled model fits the architecture.
*Touches:* new `vendor/sam-web/`, an ORT-web path behind `samEnsureEncoded`, drop the `deskx` gate.

### 16. ✅ DONE — Face-parse automatic EXCLUSION layer (jonathandinu/face-parsing, not BiSeNet — see below)
⚠️ **It cannot replace SAM.** CelebAMask-HQ classes are face-centric — skin(face/neck), neck, hair,
clothing — with **no torso, chest, shoulder or arm class**. The complaint that started this work is
chest vs face, so used as the selector it would grab the face and drop the chest entirely.

What it is excellent at is the job the colour gate keeps failing: separating lips, eyes, brows,
glasses and hair from skin. So run BOTH — SAM for the subject (shipped), BiSeNet inside the head
region to emit lips/eyes/brows/glasses/hair as an automatic eraser. That removes the two leaks that
still need a hand-drawn eraser today (wet hair, sunglass frames).

⚠️ Verify the real I/O contract with `onnx.load` before trusting any published spec — the class
table supplied for this did NOT match the model actually available: `jonathandinu/face-parsing` is
a SegFormer whose glasses index is 3 (not 6), hair 13 (not 17), lips 11/12 (not 12/13), neck 17
(not 14). Building against the quoted table would have excluded the wrong features.

Also needs a 512x512 face-ish crop — derive it from the top of the SAM subject mask's bounding box
rather than adding a face detector. Integration follows the existing path: vendor under
`desktop/src-tauri/vendor/`, reuse `SamSession` and the `set_*_model_paths` OnceLock pattern in
`desktop/src-tauri/src/sam.rs`, bundle via the `resources` block in `tauri.conf.json`. Size is a
non-issue next to the 128 MB SAM2 encoder already shipped.

### 5. ✅ DONE — Raise the mask cap 4 → 8
Widened every `mskA[4]`…`mskJ[4]` uniform array to `[8]` (and `mskCS[12]`→`[24]`), and added a
SECOND raster texture (`maskTex2`) for slots 4-7 rather than a texture array/atlas — one extra
sampler was the smallest change that didn't touch the uv math every other mask type already
shares. `MSK_MAX=8` is now the single named constant everything else (`mskAdd`'s cap, `mskBuildTex`'s
channel packing) reads from.
*Touches:* `mskA`…`mskJ`/`mskCS` uniform arrays + the lut shader's two mask loops, `mskBuildTex`,
`FX.setMaskTex2`, `mskAdd`.

### 6. ✅ PARTLY DONE — Per-mask **Texture** shipped; Clarity/Sharpness/Noise still open — M
Masks carry exposure/contrast/temp/tint/sat/hue/highlights/shadows/colour-paint, but none of the
*detail* controls — so the most common portrait move of all (soften skin texture locally while
keeping eyes sharp) is impossible. The lut pass already runs a 5-tap unsharp on source pixels for
global `adjSharp`/`adjClarity`; the per-mask version needs that neighbourhood available at the
mask stage, which is the only real design question.
*Touches:* lut shader (a second unsharp, or move masks after a detail pre-pass), `mskC`/new array.

### 7. ✅ DONE — Frequency-separated lightness evening
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

### 14. ✅ MOSTLY DONE — Export resize + sharpening + named presets shipped; ICC/P3 and watermark still open — S/M
Named export presets (`exportPresetSaveCurrent`/`exportPresetApply`/`exportPresetDeleteCurrent`)
save/recall just the four export-panel controls — format, quality, resize, sharpening — by name,
mirroring the existing Styles feature's localStorage-flat-list shape (`_STYLES_KEY` →
`_EXPPRESET_KEY`) but deliberately kept separate: a Style is the whole portable edit recipe, this
is only "how the file gets encoded" — the thing that actually differs web-vs-print. Still open:
Display-P3 / sRGB ICC embedding and an optional watermark. The tiled export path already gives a
clean place to hook both.

### 15. Auto-match a series to a reference photo — M
Batch editing shares one `fxState` across photos, which is right for a look but wrong for
exposure/WB drift across a shoot. An "auto-match to reference" that solves per-photo exposure/WB
offsets would fix that — and the **Colour Copy** tab already does per-channel histogram matching,
so the core algorithm is written and just needs to emit per-photo `adjustOverride` values rather
than a LUT.

---

## UX / UI enhancements

### A. ✅ DONE — Mask panel: thumbnails, rename, solo/mute, drag-reorder
Each mask-list row now carries a small live canvas thumbnail (`_mskThumb`: downsampled raster for
brush/sky/AI, a drawn ellipse/gradient for radial/linear, a flat tint for shapeless Colour/Luminance
Range) plus a Solo toggle (`mskToggleSolo`/`mskSolo`) that isolates one mask's contribution by
riding the exact same Amount=0 slot `muted` already uses — no shader change, and deliberately
**not persisted** (session state only, cleared on reselect) so a saved session never loads with a
mask looking silently disabled. Reorder is now HTML5 drag-and-drop on the rows themselves
(`mskReorder`), generalizing item 3's `mskMove` swap (adjacent-only) to move between any two
indices in one gesture — same two safety rules carried over (index 0 can't keep "subtract prev",
the moved mask stays selected).

### B. ✅ MOSTLY DONE — **Selection** view now works in the 1:1 loupe; overlay-opacity and edge-only modes still open — S
Known limitation of what we just shipped: `mskShowSelIdx()` is only passed by the two
`renderPreview` calls, so the loupe (`renderFullResCrop`) always shows the normal photo. Judging
a colour range at true export scale is exactly when you'd want it. Also worth adding: an opacity
slider for the red overlay, and an "edge only" outline mode for checking mask boundaries.

### C. ✅ DONE — Command palette (⌘K)
`cpOpen()` — a fuzzy (subsequence-match) list built FRESH on every open, not cached, so it always
reflects the live DOM: every tab, every FX section, every Look/LUT and Print profile (read straight
off `#sel-lut`/`#sel-print`'s own `<option>`s, so an entry can never point at a preset that doesn't
exist in this build), every mask-add type, plus the common actions (Export, Undo/Redo, Save/Load
session, Save as Style, toggle theme, shortcuts help). Its own small overlay rather than the shared
`_csModal` — needs arrow-key navigation and live filtering, which the generic modal doesn't do.
Listed in the Keyboard Shortcuts panel for discoverability.
*Touches:* `_cpCommands`, `_cpFilter`, `cpOpen`, one more `document.addEventListener('keydown',…)`.

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
