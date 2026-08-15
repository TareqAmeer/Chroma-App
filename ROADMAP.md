# Chromasmith — roadmap

15 feature improvements + 5 UX/UI enhancements, ordered by value-per-effort within each tier.
Every item names the concrete gap it closes and the code it would touch. Effort is rough:
**S** ≈ a session, **M** ≈ a few sessions, **L** ≈ a substantial project.

Several items are grounded in measurements taken while shipping the Skin Tone tool
(`test/probe_tm3390.mjs`, `test/probe_skin.mjs`) — those are marked **[measured]** and are the
highest-confidence entries here.

**Status — the Skin Tone tool is DONE and verified on desktop.** Items 1, 2, 3, 5, 6(Texture), 7,
8, 9, 14 (resize+sharpening+named presets+watermark), 16, A, B, C, D, E shipped; 4 partly. Item 16
(face-parse auto-exclusion) is verified with a real Rust integration test (`cargo test`) against a
real photo — see `desktop/src-tauri/vendor/faceparse/README.md` for the full verification
transcript — but like item 4, the desktop UI round-trip (the new "✂ Auto-exclude face features"
button) still needs a hands-on check in the built app. Everything else below is verified against
the export gate with the untouched goldens byte-identical, i.e. each is a true no-op at its
defaults.

**Still open — 5 items, each independent** (revised 2026-08-15; items 10 and 11's keystone half
shipped, and 6's Clarity half shipped). Nothing here blocks anything else:

| # | item | size | note |
|---|---|---|---|
| 6 | Per-mask **Sharpness / Noise** | S | Texture and Clarity both shipped; these two are what's left |
| 11 | **Auto-horizon** | M | Keystone shipped (E2). This half needs line detection — a Hough pass, which is its own piece of work rather than another slider |
| 13 | JXL / AVIF in, **16-bit out** | L | ⚠️ Revised — HEIC shipped, and the 16-bit bottleneck is the 8-bit SOURCE upload, not the file format. Read the entry before starting |
| 14 | Export **Display-P3 / wide-gamut ICC** | S/M | Colour science, not compositing — see the entry for why the sRGB tag already shipping isn't the same thing |
| 15 | Auto-match a series to a reference photo | M | Colour Copy's histogram matching is the algorithm; it needs to emit per-photo `adjustOverride` instead of a LUT |

✅ **Shipped since this list was written:** 10 (spot removal / clone / heal — see CLAUDE.md's
Retouch section), 11's perspective/keystone homography, 6's per-mask Clarity, plus Library items
5, 6, 7, 9, 10 and 13 below.

To pick one up in a fresh session, quote its number and heading from this file — each entry states
the gap, the files it touches and the functions to reuse. Read `CLAUDE.md` §5b first if the item
touches the skin path.

---

## Library view — UI/UX improvements (2026-07-31)

Prompted by a report that photo thumbnails "still have borders" in the Library grid even after a
border-removal pass. Investigation found the visible frame was never *only* `border` — three other
rules also drew one (`box-shadow:var(--lift-1)`, a `--sur` card background, and a `--bg` letterbox
matte on `.lib-thumb-wrap`); all four are now fixed (`desktop/library-ui.js` lines ~296-450, synced
to `desktop/dist/`, both Tauri build targets, the bundled `.app`, and `/Applications/Chromasmith.app`
— `"Chromasmith copy.app"` is a symlink to the latter so it's covered automatically). Verified with
the `?libtest=1` harness: computed `box-shadow: none`/transparent backgrounds at rest, selection
(`.sel`/`.multi`/`flag-*`) rings and the new hover ring still compute correctly, and `npm test`
stayed bit-exact (no shader touched).

That investigation surfaced a broader gap: the Library grid has accumulated features (grid/list/
compare, filters, collections, cloud import, compare-mode ratings) faster than it's been designed —
it's missing 2-D keyboard nav, in-grid ratings, drag & drop, and re-renders the whole grid on every
keystroke. 15 improvements below, ordered by value-per-effort. All touch only
`desktop/library-ui.js` unless noted.

**Top 5 (highest impact) — ✅ DONE (2026-07-31):**

1. ✅ **2-D keyboard navigation.** Added ↑/↓ (delta = `gridCols()`, read from the resolved
   `grid-template-columns` so it automatically matches grid/list/filmstrip layout), Home/End,
   `shift+arrow` range extension from the last non-shift anchor, `⌘A`/`Ctrl+A` select-all. Reused
   the existing cursor state and `updateCardSelClasses()` — no new selection model.
2. ✅ **Star ratings in the grid/list.** Added `ratingHtml()`/`setRating()` (mirroring
   `flagsHtml()`/`setLabel()`), wired into both card templates, a `0`-`5` keyboard shortcut on the
   keyboard-cursor/selection, a rating filter (`Unrated`/`★1+`…`★5`) and a `Rating` sort key + list
   column. Compare mode's own star row now calls the same `setRating()` instead of duplicating the
   write.
3. ✅ **Drag & drop.** Drop a folder or photos from Finder onto the grid — `list_dir` probes whether
   a single dropped path is a directory (import) or a file (open as a batch), since the browser File
   API can't tell folders from files directly. Drag a card/multi-selection onto the Favorites/
   Flagged/Rejected sidebar rows to apply that exact mutation (`COLL_DROP_MUTATIONS`) — the only
   three smart collections that are actually a per-photo write rather than derived automatically.
4. ✅ **Filter bar cleanup.** The 7 non-search/source selects moved into a `#lib-filters-pop`
   popover behind a "Filters" button with an active-count badge, a "Clear all" button, and removable
   chips (`#lib-filter-chips`) below the bar showing each active filter by its own option text.
5. **Grid rendering — partially done.** `renderGrid()` now builds all cards into a
   `DocumentFragment` and appends once (was one reflow per card), and the plain-text "Loading…"
   states across folder/collection/album opens were replaced with shimmering skeleton cards
   (`libSkeletonHtml()`) so switching folders doesn't flash the grid to empty text and back. Actual
   windowed virtualization (rendering only the visible row range) was judged too invasive to do
   blind — everything from keyboard nav to the flag/rating click handlers looks cards up by
   `data-path` in the live DOM — and is left as a follow-up if a real large-folder profile shows
   it's still needed.

**Remaining (revised 2026-08-15) — 4 of the 10:**

11. **Filmstrip affordances** — `body.deskx` mode hides filters, viewbar, sidebar and footer
    entirely; at minimum surface flags and filename on hover.
12. **Saved filter/sort views** — persist named filter+sort combinations alongside the existing
    smart collections.
14. **Compare mode ↔ grid parity** — ratings, flags and navigation should behave identically in
    both; compare still has its own separate keyboard branch.
15. **Thumbnail decode tiering** — the concurrency pool + viewport priority shipped, but not the
    two-tier decode (low-res proxy first, upgrade on idle).

**Partly open:**

8. **Undo for destructive actions** — Reset-edit is still irreversible, and Delete needs a Rust
   `restore_from_trash`: `trash_file` hands the file to the macOS Trash, so it is recoverable in
   Finder but not in-app. This is the only item in the Library list that needs new Rust.

✅ **Done (2026-08-15):**

5. **Grid virtualization** — the follow-up this list explicitly deferred as "too invasive to do
   blind". A real profile was taken first, which is what made it safe: 200 files = 5,114 DOM
   nodes, 1,000 = 17,914, and 5,000 never loaded at all. Below 400 files the old path runs
   untouched. ⚠️ Profiling also found the *other* half of the problem, which was not the grid:
   `clusterByHash`'s pairwise Hamming allocated two BigInts per comparison and counted bits one at
   a time — 12.5M times at n=5,000, and effectively the whole 41.9s. Guarded by
   `npm run lib:test`.
6. **Full colour labels** — the Lightroom five, with 6-9/0 shortcuts.
7. **Metadata / info panel** — EXIF inspector on `I`. (The *histogram* half of the original entry
   is not built; the panel is metadata only.)
9. **A real empty state** — with card-import and choose-folder CTAs.
10. **`#lib-bottom` as a status bar** — filtered count, per-label tallies, total and selected size.
13. **Batch operations bar** — appears above one selected photo.

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

### 9. ✅ DONE — Dehaze
Took the cheap route named above rather than a dark-channel-prior estimate: a new `Dehaze` slider
in Basic Adjustments (`adjDehaze`, folded into the existing `basicAdjust()` shader function and its
`adjOn` toggle, same as Skin Warmth) gated on a per-pixel **haze weight** —
`smoothstep(0.35,0.85,lum) * (1-smoothstep(0.05,0.35,sat))` — so only BRIGHT+DESATURATED pixels
(a hazy sky, a distant ridge) move; an already-saturated foreground pixel is provably untouched
(verified: identical to 1/255 across dehaze −0.8/0/+0.8 on a synthetic saturated-red foreground
pixel). Three linear terms scaled by that same gate: extra contrast (`×0.35`), a black-point pull
(`−0.22`), and a saturation lift (`×0.7`) — negative values invert all three (adds haze back in).
⚠️ First pass had the contrast term dominate the black-pull term, so positive Dehaze made a bright
hazy patch BRIGHTER instead of cutting through it — caught by rendering a tiny synthetic hazy-vs-
saturated test image directly through `FX.render()` and checking actual RGB deltas before shipping,
not by inspecting the formula. Rebalanced (0.6→0.35 contrast, 0.12→0.22 black-pull) until the sign
matched the stated intent, then re-verified: default (dehaze=0) still a byte-exact no-op.
*Touches:* `basicAdjust()` (lut shader), `adjDehaze` uniform, `ADJ_FIELDS`/`computeAdjustBlock`,
one slider in Basic Adjustments.

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

### 13. Wider format support in and out; 16-bit — L  *(revised 2026-08-15 — measured)*

**✅ HEIC/HEIF done.** They were absent from `library.rs`'s `IMAGE_EXTS` and `ingest.rs`'s
`media_kind`, so an iPhone shoot read as an empty folder and a card import would have been
silently partial. Now listed, importable, thumbnailed via `sips` (ImageIO — the same decoder
WKWebView already uses to display them in the editor), and EXIF-dated via kamadak-exif's HEIF
support. Chromium genuinely cannot decode HEIC, so the web build now says so and names where it
does work. JXL/AVIF still open, and both would need a real vendored WASM decoder.

**⚠️ 16-bit export is NOT the win it looks like, and the reason is upstream.** Measured before
building anything:

- `FXR.setImage` uploads `UNSIGNED_BYTE`. There is exactly one upload path and it is 8-bit.
- The RAW path writes its DCP-corrected result into a `Uint8ClampedArray` before `putImageData`,
  so a **12-14 bit RW2 is already 8-bit before it reaches the GPU**.
- Consequently, switching stills to the float (`RGBA16F`) intermediate — which already exists and
  is already used for video — changes **nothing**: identical output across a shallow gradient, an
  overshoot past white, an overshoot-then-highlight-recovery, and a halation composite. All four
  byte-identical between `RGBA8` and `RGBA16F`.

So writing a 16-bit FILE from this pipeline would store the same 8-bit steps in a wider container.
The real item is **carrying more than 8 bits from the RAW decode to the texture** — a 16-bit
upload path (`RGBA16UI`/`RGBA16F` from the existing `Uint16Array`) — after which the float
intermediate and 16-bit export both become meaningful, in that order. That touches the calibrated
RAW path, so it wants its own session and its own before/after measurement.

⚠️ Whatever measures this next: `getFXParams()` returns a NESTED structure (`adjust`, `halation`,
`grain`…). Setting `P.adjExp` on the returned object does nothing and every configuration comes
back identical — which looks exactly like "the change has no effect". Drive the real UI controls.

### 14. ✅ MOSTLY DONE — Export resize + sharpening + named presets + watermark shipped; ICC/P3 still open — S/M
Named export presets (`exportPresetSaveCurrent`/`exportPresetApply`/`exportPresetDeleteCurrent`)
save/recall just the four export-panel controls — format, quality, resize, sharpening — by name,
mirroring the existing Styles feature's localStorage-flat-list shape (`_STYLES_KEY` →
`_EXPPRESET_KEY`) but deliberately kept separate: a Style is the whole portable edit recipe, this
is only "how the file gets encoded" — the thing that actually differs web-vs-print.

**Watermark** (`applyWatermark`) draws translucent text into the bottom-right corner, drawn
straight onto the FINAL export canvas — deliberately LAST in the chain, after resize/sharpen/
canvas-matte, so its font size (a fixed fraction of the long edge) scales with whatever the actual
output size ends up being rather than the source photo's own resolution. Off by default (true
no-op — the export gate stayed byte-identical). Deliberately skipped on a Lightroom Edit-In
write-back: that path overwrites the ORIGINAL file the user opened from Lightroom, and silently
burning a watermark into it would be a real data-loss footgun, not a stylistic export option.

Still open: Display-P3 / sRGB ICC embedding. Note the "sRGB" half of this already shipped
separately (`embedSRGBTag`, tags every PNG export explicitly sRGB) — what's missing is a real
wide-gamut path: the whole render pipeline is hardcoded sRGB primaries+TRC throughout (`s2l`/`l2s`
and every colour op), so true P3 output needs an actual sRGB→Display-P3 primaries matrix on the
final pixels plus a real embedded Display-P3 ICC profile, not just a metadata tag — a color-science
change, not a compositing one, and correspondingly harder to verify without a colour-managed
reference to diff against.

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

### E. ✅ DONE — First-run tour; contextual "why" tips already existed as hover tooltips
`tourMaybeShow()` shows a single 3-step `_csModal` panel (load a photo → pick a look → export)
once per browser, gated on a localStorage flag AND on `fxImages` being empty at startup — a
session with a photo already loaded (import, restored session, returning reload) is by definition
not a new user and is never re-greeted. `window.chromasmithShowTour()` replays it on demand (Help
menu / the ⌘K palette's "Show welcome tour"), bypassing the once-only flag. Deliberately a single
static panel rather than a per-element spotlight sequence — the layout differs too much between
mobile bottom-sheet, desktop deskx rail and plain desktop for a spotlight to reliably land on a
moving target.

The "contextual tips on non-obvious controls" half turned out to already be fully shipped: Preserve
modeling, No remjet, Shadow protect, Input profile AND Subtract prev all already carry an
explanatory `title=` hover tooltip (`git grep` confirmed all five before writing anything new) —
nothing left to add there.
*Touches:* `tourMaybeShow`, `tourHtml`, `window.chromasmithShowTour`, one `_cpCommands` entry.

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
