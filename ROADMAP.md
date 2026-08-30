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

**Still open — 4 items, each independent** (revised 2026-08-16; items 10 and 11's keystone half
shipped, 6's Clarity half shipped, and 13 is now DONE in its real form — see below). Nothing here
blocks anything else:

| # | item | size | note |
|---|---|---|---|
| ~~6~~ | ~~Per-mask Sharpness / Noise~~ | — | ✅ **Substantively complete.** Texture is bipolar (negative softens, positive sharpens) and Clarity shipped, so these would be the same operator under new names. True edge-aware per-mask NR is a different, larger item |
| ~~11~~ | ~~Auto-horizon~~ | — | ✅ **Done** — `autoHorizon`, a real Hough transform. 0.30° worst error on ground truth. ⚠️ Read the KNOWN LIMITATION in CLAUDE.md before touching it |
| ~~13~~ | ~~16-bit / HDR from RAW~~ | — | ✅ **Done, in its real form.** Measured on a real RW2: a full 16-bit RENDER pipeline buys ≤1/255 (sensor noise already dithers 8-bit quantisation) and is NOT what gates HDR. `CIRAWFilter` was measured to do nothing for this camera's RAWs (`raw_headroom_probe.rs`); headroom comes from the DCP LookTable's own extended-range values instead (`applyDcpLUT`'s `hrOut`, `write_gainmap_heic_from_map`). See CLAUDE.md's "HDR from RAW" section — including the gamma-encoding bug it took two attempts to find. |
| ~~15~~ | ~~Auto-match a series to a reference~~ | — | ✅ **Done** — `matchSeriesToReference`. Solves exposure in stops + WB after brightness equalisation, per photo, into `adjustOverride`. See CLAUDE.md |

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

**All 15 Library items are now closed.** 11, 12 and 14 were already built when checked (the
previous revision of this file listed them as open without verifying); 2 and 15 shipped
2026-08-15, along with two latent bugs the check surfaced:

2. **Star ratings** — this had been recorded as shipped and **never was**. `ratingFilter` and a
   `lib-rating` id were already referenced by the saved-views capture and the filter map, both
   pointing at a state key and a DOM element that did not exist. Now real: `starsHtml`/`setRating`
   mirroring `flagsHtml`/`setLabel`, click-to-set (clicking the current star clears, or 1★ is a
   trap), `0`-`5` on the keyboard in the grid **and in compare** (which is what actually completes
   item 14), a rating filter and a Rating sort key.
15. **Thumbnail decode tiering** — worth doing only because of WHICH files are slow, and that is
   the opposite of the obvious guess. Measured cold (`examples/thumb_timing.rs`):

   | file | full decode | embedded preview |
   |---|---|---|
   | `__TM4202.jpg` | 803.8 ms | ~17 ms |
   | `__TM5132.jpg` | 515.9 ms | ~8 ms |
   | `P_TM5168.RW2` | 174.5 ms | n/a (already embedded) |

   JPEGs are the slow case, not RAWs: `image::open` decodes all 24MP before downsizing to 360px,
   while the RAW path already reads the camera's preview. A 6-wide pool therefore needs ~27s to
   fill a 200-photo JPEG folder. `get_thumbnail_fast` returns the camera's own embedded preview
   (256x171 here) for the first paint and the real decode is queued on idle.

⚠️ **Two latent bugs found while verifying, both in code that looked done:**
- `syncFilterControls`' id map used `lib-type`/`lib-tag`/… where every real id ends in `-filter`,
  so **7 of its 8 lookups returned null**. Applying a saved view updated state but left every
  dropdown showing the previous view — exactly the failure that function's comment says it exists
  to prevent. Item 12 was written but broken.
- `test/ui_audit.mjs`'s token check stripped `/* */` before `//`, so a `/*` inside a string
  (`'video/*,.mp4'`) opened a phantom comment running **3,940 lines**. The check silently never
  scanned lines 7644-11584. Replaced with a region-aware scanner (JS rules inside `<script>`, CSS
  rules elsewhere); see its comment for the two ways a naive fix breaks.

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
6. **Full colour labels** — the LR five, with 6-9/0 shortcuts.
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
non-skin. Fix: shift-click to add several samples (LR's Color Range does exactly this),
gate = `max` over samples, or fit a small covariance ellipse over the picks. This is the single
biggest quality win available to the tool we just shipped.
*Touches:* `colRangeWeight` (lut shader), `mskG` packing → an array of samples (UBO or a tiny
1D sample texture), `mskCrEyedropperClick`, `mskMeasureSrcV`'s JS mirror.

### 2. ✅ DONE — Per-mask **Amount** (opacity)
Every per-mask slider is independent, so dialling a mask back means scaling eight sliders by
hand. C1's own advice for over-strong uniformity is "turn the value down, or erase the
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

## Tier 2 — capability gaps against LR / C1

### 8. ✅ DONE — Colour Range and Luminance Range as first-class mask *types*
We added a colour gate as a *modifier* on shape masks. Both range gates deserve to be masks in
their own right (`+ Colour Range`, `+ Luminance Range`) with no shape at all — that is how users
coming from LR expect to find them, and the machinery is already written.
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

### 13. The 16-bit SOURCE path — M/L  *(revised twice, 2026-08-15 — measured)*

⚠️ **This item's real value is HDR, not precision.** Gain-map HDR export already ships
(`gainmap.rs`, ISO 21496-1 — the same thing LR does), but it is only offered when the
SOURCE file carries headroom, and measured on this machine:

| file | headroom | HDR export offered |
|---|---|---|
| `P_TM5168.RW2` (Lumix) | 1.0000 | **no** |
| `__TM3719.RW2` (Lumix) | 1.0024 | **no** |
| `IMG_1320.HEIC` (iPhone) | 1.3697 | yes |
| `IMG_8008.HEIC` (iPhone) | 1.4015 | yes |
| `__TM4202.jpg` | 1.0000 | no |

So HDR works on iPhone photos and **not on the user's own RAWs**. Core Image's
`kCIImageExpandToHDR` finds no headroom in an RW2 because a RAW carries linear sensor data, not
an encoded HDR rendition — the highlight range above SDR white is there in the file and is thrown
away by this app's own 8-bit truncation before anything can use it.

LR produces HDR from RAW precisely because it keeps that range. Doing the same here means
the source path below — which is why 16-bit, HDR-from-RAW and heavy-grade gradient quality are
one piece of work rather than three.

**✅ HEIC/HEIF done.** They were absent from `library.rs`'s `IMAGE_EXTS` and `ingest.rs`'s
`media_kind`, so an iPhone shoot read as an empty folder and a card import would have been
silently partial. Now listed, importable, thumbnailed via `sips` (ImageIO — the same decoder
WKWebView already uses to display them in the editor), and EXIF-dated via kamadak-exif's HEIF
support. Chromium genuinely cannot decode HEIC, so the web build now says so and names where it
does work. JXL/AVIF still open, and both would need a real vendored WASM decoder.

**⚠️ 16-bit EXPORT on its own is not the win it looks like.** Measured before building anything:

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

### ❌ REJECTED (2026-08-15, user decision)

- **Display-P3 / wide-gamut ICC export** — every film look, print profile and calibration constant
  in `calib/` is fitted against sRGB primaries, so a wide-gamut pipeline would change all 113 of
  them with no colour-managed reference to verify against. Gain-map HDR already ships and delivers
  a larger visible gain on the same displays (range rather than gamut). Revisit only as a
  final-stage export conversion, never as a pipeline change.

- **Undo for Delete** — `trash_file` hands the file to the macOS Trash, which is already
  recoverable in Finder. An in-app `restore_from_trash` duplicates an OS affordance.
- **JXL / AVIF decode** — would mean vendoring a WASM decoder for formats that neither the user's
  camera nor their phone produces. HEIC (which they do produce) shipped instead.

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

---

## Launch screen + GPU/CPU offload — backlog (added 2026-08-30)

### N1 — Load-screen redesign — ✅ DONE (2026-08-30)

Shipped from an approved wireframe storyboard (four scenarios: first launch, warm relaunch, new
photos found, drive disconnected — each with the exact on-screen copy per frame). Superseded the
stale contract this section used to document; current shape:

- `#boot-splash-spinner` is **gone** — the logo and a progress bar are always shown together, from
  the static HTML itself (`chromasmith-22.html`'s `#boot-splash-progress` starts `display:flex`,
  not `none`), so there's never a bare-spinner or text-only frame, even for a phase that resolves
  in under a second.
- `#boot-splash-bar` now has an indeterminate mode (`.boot-bar-indet`, a CSS sweep animation) for
  when a phase's total is genuinely unknown yet (mid-walk), and switches to the old width-driven
  determinate mode once a real total arrives — `updateBootSplashProgress`
  (`desktop/library-ui.js`) toggles the class, doesn't replace the element.
- New `cache` phase (`STAGE_LABELS.cache = 'Loading cached thumbnails'`) backed by a real
  operation, `prefetchThumbnails()` — warms the in-memory thumb cache for the folder about to be
  shown BEFORE `renderGrid()` runs, capped by entry count + a wall-clock budget so a cold folder
  can't block boot the way whole-catalog thumbnail generation used to. Runs only on the boot's own
  initial `openFolder(path, {prefetchThumbs:true})` call, not on ordinary folder clicks.
- True first launch (no root ever added) now shows an in-app empty state with two explicit
  actions — "Add photos" / "Add a folder" (`renderLibraryNoRoot`) — instead of popping the OS
  folder picker unprompted.
- A folder whose volume is offline stays fully browsable from the cache instead of blocking:
  every card renders with a drive-disconnected badge (`OFFLINE_BADGE_HTML`, driven by
  `CatalogEntry.offline`, already computed per-row), and a persistent status bar
  (`renderLibOfflineBar`) names what's true.
- The watchdog (`bumpBootSplashWatchdog`) and the `window._lastCatalogRegisterPromise` dismissal
  await were left untouched, per this section's own original warning.
- Covered end to end by `test/library_perf.mjs` (first-launch buttons, offline badges + status
  bar, and a check that the cache-warm phase actually runs before first paint, not after), plus a
  `?libnoroot=1`/`?liboffline=1` LIBTEST harness addition so those paths are exercisable without a
  real catalog behind them.

### N1a — Offline edit queue + apply-on-reconnect (deferred, not started)

N1's approved wireframe described the offline status bar as: edits made while a drive is
disconnected are queued locally and automatically applied to the original files once it
reconnects. That line was **not** built — the status bar currently says the honest, narrower
thing instead ("Reconnect to edit or export the originals"), because the queueing mechanism is a
real, separate feature with real data-loss risk if rushed, not a copy change:

- **Today**, opening a photo for editing reads the real file from disk (RAW decode, `raw_decode.rs`
  et al.) — there is no path that edits a CACHED preview instead, so "edit while offline" doesn't
  work at all yet, cached thumbnail or not.
- Building this needs, at minimum: (1) a real decode source for a cached-only photo (the offline
  thumbnail tier is a small JPEG preview, not enough to grade — would need either a higher-res
  cached proxy or accepting a degraded offline edit preview), (2) a persisted queue of
  edits-made-while-offline distinct from the ordinary `.xmp` sidecar write path, (3) reconnect
  detection (the existing `refreshVolumes` 4s poll already used for the Drives panel/offline
  badges) wired to replay the queue against the real files, and (4) conflict handling if the
  original changed on another machine while disconnected.
- Not estimated (size unknown until the cached-proxy-quality question above is resolved) — surface
  again once there's real user demand for offline editing specifically, not just offline browsing.

### N2 — Use the GPU alongside the CPU

The premise needed one correction: the render pipeline is already fully GPU (WebGL2, 5 shader
programs, tiled export) — not "relying completely on CPU". What's genuinely CPU-only: all ONNX
inference (SAM/SAM2/CLIP/faceparse/arcface/scrfd/subject — no execution provider was ever
appended), the RAW decode's per-pixel cleanup passes (rayon-parallel, but ~6 separate full-frame
traversals), and one JS pixel worker (not a pool).

| # | status | finding |
|---|---|---|
| N2.0 | ✅ measured | See N2.1 — the SAM test timing comparison doubled as the baseline measurement rather than a separate harness, since it isolated the exact cost in question |
| N2.1 | ✅ **DONE — CoreML EP, opt-in (`CS_COREML=1`), NOT the default** | Appended via `sam.rs`'s existing `libloading` pattern (the symbol/flags aren't in `ort-sys`'s generated bindings, so declared by hand against ONNX Runtime's public `coreml_provider_factory.h`, fetched and verified, not guessed) in `create_session`/`create_session_from_path` — the latter is shared by every other model file, so one fix covers all of them. **Measured on this dev machine (Intel i5-8257U, Iris Plus, no ANE): `sam::tests` (2 cold session creations) went from 2.77s to 54.38s with the EP appended — a ~20x regression**, all compilation overhead (CoreML compiles the ONNX graph to a CoreML program before first use), paid once per model per process launch. Severe enough to turn a "tap to select, should feel instant" first use into a ~50s hang. Correctness was fine (SAM mask output identical, `inside=1.000 outside=0.000` either way) — this is purely a startup-latency problem on hardware with no ANE to make the trade worthwhile. Very likely a real win on Apple Silicon (a real ANE, and Apple's own CoreML compiler is tuned for it) — hence opt-in via `CS_COREML=1` rather than shipped as a default, until measured on that hardware too |
| N2.2 | not started | Cleanup-pass fusion in `raw_decode.rs` — merge the pointwise per-pixel traversals (shadows NR, false-colour, defringe are candidates; leave wavelet/PPG alone, they're neighbourhood-dependent). Needs an exact byte-comparison gate against a real RW2, this is calibrated colour |
| N2.3 | not started | Pool sizing (`cores - 2` in `main.rs`) + a JS worker pool (today: one `_cpuWorker`, `bakeDcpLUT` and `exportSharpen` queue behind each other) — only worth doing if a real measurement shows the queueing costs anything |

❌ **Rejected**: a WGSL/WGPU renderer port for speed — already rejected elsewhere in this file
(two-shader-copy drift risk), and RapidRAW's own headline win was deleting a JPEG-over-IPC round
trip this app never had. R5 remains the only sanctioned route to a second backend, spike-gated.

---

## RapidRAW competitive review — backlog (added 2026-08-28)

Source: a review of [CyberTimon/RapidRAW](https://github.com/CyberTimon/RapidRAW) (README, releases
through v1.6.2 / 2026-08-21, their WGPU renderer blog post) against this codebase. Full working
notes: `~/.claude/plans/can-you-review-rapidraw-virtual-glacier.md`. Nothing below is scheduled;
work starts the week of 2026-09-01.

### Findings worth keeping (these change how you'd approach the items)

- **The stacks are nearly the same underneath.** Both are Rust + Tauri 2 + rawler + Lensfun + ONNX
  — `desktop/src-tauri/Cargo.toml` already cites them for the native RAW decode. The divergence is
  only (a) render surface and (b) pixel precision.
- ⚠️ **Most of their "20fps → 120fps" win was NOT WGPU-vs-WebGL.** It was deleting a per-frame
  JPEG-encode-over-the-Tauri-bridge round trip, which **we never had** — we render in-page. Our
  starting architecture resembles their *new* one more than their old one. **Measure our real
  slider latency (`npm run perf:test` already budgets renders-per-30-event drag) before assuming a
  port is the fix**; stage caching (re-run only the tail of the chain on a slider drag) may be most
  of the win.
- **"Every other RAW editor is native" is weak evidence.** darktable (OpenCL), RawTherapee/ART
  (CPU/SIMD), Lightroom/Capture One/DxO (Metal/DirectX) are all native — and all **desktop-only**,
  so they never made a trade. Our WebGL2 choice is what buys web *and* iOS, which none of them have.
- **How the apps that ship BOTH desktop and mobile do it: one kernel source, machine-translated.**
  Dehancer publishes [`dehancer-gpulib-cpp`](https://github.com/dehancer/dehancer-gpulib-cpp), a C++
  GPU SDK compiling one kernel set to Metal/CUDA/OpenCL by build flag. Lightroom shares a C++ core
  with per-platform GPU backends. Darkroom sidesteps it entirely — Apple-only Swift+Metal, one
  backend for iPhone/iPad/Mac. **Nobody hand-maintains two shader implementations**, and neither
  should we.
- **How they "calibrate" 2,500 cameras: they don't test them.** rawler/dnglab ships the per-camera
  colour matrices camera vendors publish in the DNG spec — the same well Lightroom's Adobe Standard
  draws from. Correct-*ish* colour per body, for free, from published data. Our S9 path (real DCPs
  + LookTables + a fitted residual) is strictly better for that one body and doesn't generalise.
- **Licensing.** RapidRAW is **AGPL-3.0** — ideas and published algorithms are fair game, source is
  not. Spektrafilm profiles are **CC BY-SA 4.0** (attribution + share-alike on derivatives).
- **Scene-referred, in plain terms:** display-referred means anything brighter than white is thrown
  away *before* our film curve sees it. Film's signature is the highlight roll-off — with the
  highlights already flat, the curve has nothing to roll off, so you get a white blob where film
  gives a soft shoulder. Only pays when the source has headroom (RAW yes, 8-bit JPEG mostly no).

### Rejected / excluded, with the reason

- ❌ **A second, hand-written WGSL renderer for desktop only.** Two copies of the calibrated model
  kept pixel-identical forever — the drift risk CLAUDE.md guards against for the DCP bake, except
  across two languages where the `toString` generation trick doesn't apply. *Superseded by* the
  Naga single-source item below, which is a different proposition.
- ❌ **A full 16-bit render pipeline as the route to better highlights.** Already measured (ROADMAP
  item 13): ≤1/255 on render. Bit depth was never the gap; **headroom** is. Don't refit this as a
  precision problem.
- ❌ **Chasing camera breadth by hand-calibrating bodies.** Use rawler's embedded matrices as the
  fallback instead (item below).
- ❌ **Lifting any RapidRAW source.** AGPL-3.0.

### Items

| # | item | size | note |
|---|---|---|---|
| R1 | **Scene-referred float pipeline** | L | The one architectural gap with a real image-quality consequence. Float FBOs through the lut→comp chain + a tone-map at the end. Hard constraint: all 18 `test/golden/` PNGs byte-exact at defaults |
| R2 | **AgX (or filmic) as an optional input transform** | M | The cheap partial win — most of R1's *visible* benefit without the precision rebuild. Slots in beside `useVlog` |
| R3 | **Spektrafilm profiles as presets — tier (a)** | S | Bake the 35 stocks × 11 papers to `.cube` into `vendor/luts/` + `LUT_META`. Purely additive, zero engine change, every Dehancer-matched look untouched. ⚠️ Bakes to display space — their colour, not their roll-off. CC BY-SA 4.0 → credit in `LICENSES-MODELS.md` |
| R4 | **Spektrafilm live in-shader — tier (b)** | L | Real roll-off. **Depends on R1** — do not start first |
| R5 | **Naga single-source shaders** (WGSL → WGPU desktop + generated GLSL ES 3.0 for web/iOS) | L | Author once, generate both; the same mechanism wgpu's own `webgl` feature uses. Generation at dev time, generated GLSL committed into `chromasmith-22.html`, so no build step for the user. ⚠️ **Spike first:** port only the `comp` pass and require all 18 goldens byte-exact from *each* backend. Our runtime template-literal assembly (`mskAnyTex`, `GLSL_OKLAB`) moves to a dev-time step |
| R6 | **Deconvolution sharpening** | M | Models the lens/sensor PSF and inverts it — recovers real detail instead of unsharp-mask's faked edge contrast, halos and noise gain. More compute; rings if over-driven, so it needs a conservative cap |
| R7 | **Depth mask + depth-driven lens blur / tilt-shift** | M | Depth Anything V2 as a fourth ONNX model, same pattern as `sam.rs`/`faceparse.rs`. Gives a distance-band mask *and* post-hoc shallow depth of field |
| R8 | ✅ **DONE (tier 4 of 5) — rawler colour-matrix fallback for un-profiled bodies** | M | See write-up below. Shipped the base tier of RawTherapee's resolution order (#4: rawler's built-in per-body matrix); #1 (F1's on-disk `.dcp` resolver) and #3 (embedded `ColorMatrix2`) remain open, #2 (DC-S9 fitted profile) already existed |
| R9 | **Virtual copies** | M | A persisted second edit record against the same path, appearing in the grid as its own card with its own rating/flags/export. ⚠️ **Not** what Compare mode does (`compareState`, `desktop/library-ui.js:3471`) — Compare already shows one photo under two treatments (Live/Original/history step/Style) but is a transient viewer that persists nothing. Touches the sidecar format + `catalog.rs` |
| R10 | **CLIP auto-tagging** | S | ⚠️ We already run CLIP ViT-B/32 (`clip.rs`, `catalog_clip_embed`/`catalog_clip_search`) for natural-language search. This is only surfacing those embeddings as visible, filterable per-photo keywords — a labelling + UI layer, **not** new inference |
| R11 | **Dehaze, colour wheels (lift/gamma/gain), parametric curves** | S each | Conventional controls we simply don't have (we have point curves + 8-band HSL) |
| R12 | **HDR merge (deghost + auto-align), focus stacking** | M–L | Native Rust, reusing `raw_decode.rs` |
| R13 | **Astro stacking, panorama stitching, collage** | L | Lowest priority of the merge family |
| R14 | **Camera tethering** (libgphoto2, live view + remote control) | L | macOS/Linux only — Windows has a driver conflict even for them |
| R15 | **JXL / AVIF export; headless CLI export** | S each | `image` crate features + an export-format entry; the CLI is an argv path into Tauri commands that already exist |
| R16 | **Draggable panel workspace + unified Library/Edit view** | M | Removes the mode switch between grid and editor; persists panel order |

### Sequencing note

R1 is the spine — R4 depends on it and R2 is its cheap stand-in. R3, R10 and R15 are the
session-sized wins that need nothing else. R5 is the biggest single bet in the file and is gated
on its own spike, so it can be evaluated cheaply before it becomes a commitment.

## Format widening — backlog (added 2026-08-28)

Pass 1 shipped 2026-08-28 (commit `b193b38`): the RAW/still extension registry consolidated from
8 duplicated lists into one (`chromasmith-22.html`'s `FMT_*` arrays ↔ `desktop/src-tauri/src/
formats.rs`, enforced by `test/lint_formats.mjs` + `formats.rs`'s own tests), RAW support widened
8 → 32 formats via `rawler`'s content sniffing, and a new desktop-only still path
(`still_decode.rs` + `decode_image_v1`) added EXR/HDR/TGA/DDS/QOI/FF/PNM*/JXL. See CLAUDE.md and
the commit message for the full account. What's below is what that session deliberately deferred
— full design reasoning (resolution order, path-traversal handling, the ForwardMatrix survey,
sequencing) lives in `/Users/tareqameer/.claude/plans/and-these-as-well-validated-wadler.md`;
re-read it before starting F1/F2, since it has the load-bearing detail this table compresses away.

### Findings worth keeping

- **The Adobe camera-profile survey already answered the "is this worth building" question.**
  Sampled 436 of 4352 `.dcp` files under `/Library/Application Support/Adobe/CameraRaw/
  CameraProfiles`: 99.8% carry ForwardMatrix1, 0% missing LookTable. `Camera/*` profiles are
  412/412 fine; `Adobe Standard/*` is missing ProfileToneCurve on 201/210 (`parseDCP` needs an
  identity-curve tolerance for that bucket, not a hard fail). **Verified, not guessed** — see the
  plan file's §4 table for the exact counts. This means F1 is low-risk, not exploratory.
- **The Panasonic PhotoStyle table for auto-profile detection is now grounded in real files**
  (verified against the user's own RW2s via ExifTool + Lightroom): tag `0x0089` value `1` →
  `Standard` (covers "Custom" too — that's Standard + an in-camera Real-Time LUT this pipeline
  doesn't reproduce), `3` → `Natural`, `17` → `VLog`, `22` → `Leica Monochrome`. No unresolved
  values remain for the DC-S9. Other makes (Canon PictureStyle, Nikon PictureControl, Fuji
  FilmMode, Sony CreativeStyle) need their own tables, each gated on having real files to verify
  against — don't guess a mapping the way the DC-S9 one almost was.
- **`rawler` does not expose makernotes** (`exif.rs:61`/`:165`, commented out) — F2 needs its own
  small Panasonic-IFD read, not a rawler API.
- **`bakeDcpLUT` is compiled into the pixel worker via `Function.prototype.toString`**
  (CLAUDE.md §2) and `perf_bench.mjs` asserts worker/main-thread agreement to **max|Δ|=0**. Any
  new parameter F2's sky-gate fix or F1's DCP selection touches inside that function must be a
  plain argument threaded through `_cpuRun`, never a captured module-scope constant — this is the
  single highest-risk edit in the backlog. Run `npm run perf:test` immediately after, in isolation.

### Items

| # | item | size | note |
|---|---|---|---|
| F1 | ✅ **DONE — Adobe camera-profile resolver** — reads `Camera/<model>/*.dcp` and `Adobe Standard/*.dcp` in place | M | See write-up below |
| F1a | ✅ **DONE — Sky-gate residual → DC-S9 only** | S | `dcpFit(iso,cameraPrefix)` now returns a `sky` flag alongside `ev`/`gr`/`gb`, gated on the SAME `cameraPrefix==='Panasonic DC-S9'` check — plain data threaded through the existing `fit` argument, not a new `bakeDcpLUT` parameter (CLAUDE.md's own warning: this function is compiled into the pixel worker via `toString`, so a captured constant would silently desync). `bakeDcpLUT`'s residual `gate` computation is now `fit.sky?...:0` (collapses to the same no-op every other hue/sat/value combination already takes, rather than wrapping the whole block). DC-S9 unaffected (`sky:true`, byte-identical — `npm run scorecard` 18/18 unchanged, worker/main-thread DCP bake agreement still max|Δ|=0 over 823,875 entries); every other camera (Sony RX100M5, and now any ARW via R8) stops getting an S9-specific blue-sky correction it was never fitted against. ⚠️ Also fixed a latent truthiness bug found while unit-checking this: the old guard was `cameraPrefix&&cameraPrefix!=='Panasonic DC-S9'`, so a **falsy** `cameraPrefix` (null — "no bundled profile for this camera") fell through to the **S9** branch, the opposite of correct. Unreachable today (the one caller throws before `dcpFit` on a null prefix) but would have been a real bug the moment R8 replaces that throw with a fallback path — fixed to a plain `cameraPrefix!=='Panasonic DC-S9'` check |
| F1b | **`parseDCP` tolerate missing ProfileToneCurve** | S | 201/210 `Adobe Standard/*.dcp` lack tag 50940 and `parseDCP` currently throws on that — identity curve instead of a hard fail |
| F2 | ✅ **DONE (V-Log-only half) — Auto-detect RAW profile from EXIF (PhotoStyle)** | S | See write-up below. Full per-photo style table (`rawProfile()` → `it.rawProfile`, `getUISnapshot`/⌘Z wiring, `list_dcp_profiles`-gated) remains a bigger follow-on — needs F1 shipped first, since "does this style exist for this camera" is F1's own lookup |

### F1 — Adobe camera-profile resolver (real .dcp files, read in place, verified against 3 brands + path-traversal tests)

**Shipped**: new `dcp_store.rs` (`list_dcp_profiles`, `read_dcp_file`), wired through
`resolveDcpSource()` (chromasmith-22.html) into both `desktop-native.js` DCP call sites
(`open()` and `chromasmithDenoiseHigh`). Resolution order: bundled `vendor/dcp/` (unchanged,
always wins) → `~/Library/…/CameraProfiles/Camera/<Make Model>/` (user-installed) →
`/Library/…/CameraProfiles/Camera/<Make Model>/` (system) →
`/Library/…/CameraProfiles/Adobe Standard/<Make Model> Adobe Standard.dcp` (generic fallback).

⚠️ **The two real trees have different shapes — confirmed by listing both directly, not
assumed from either one's naming convention.** `Camera/` is a real per-camera subfolder holding
several style `.dcp` files; `Adobe Standard/` is a **flat** directory with one file per camera
directly at its root, no subfolder, no per-style variants. The first implementation draft
assumed both were subfolder-shaped and would have silently found zero Adobe Standard profiles
ever (`read_dir` on a non-existent subfolder just fails and moves on) — caught by writing a
real-file test for the flat tree specifically, not by reading the code twice.

**Path-traversal hardening** (done first, per the plan): every candidate path component
(`make`, `model`, and their joined `prefix`) is rejected outright on `/ \ .. NUL` or excessive
length *before* touching a `Path`, then the resolved path is independently re-checked to still
live under its declared root after canonicalization — two checks, not one, since canonicalize
alone doesn't stop a `..`-shaped component from being accepted structurally first. Tests:
`rejects_path_traversal_in_make_and_model`, `rejects_unknown_source`.

**Security backstop generalized, not just re-verified**: `main.rs`'s `effective_dcp_mode` used a
fixed `KNOWN_DCP_MAKES = ["panasonic", "sony"]` allowlist — which would have silently downgraded
every F1-resolved Canon/Nikon/Fujifilm/etc. LUT request back to `linear16`, since those brands
were never in the list. Replaced with a positive assertion: the requested `dcp:<prefix>:<style>`
key must itself start with the file's own decoded make (case-insensitive) — scales to any brand
while still catching the actual bug class (applying one camera's matrix to a different camera's
pixels). 5 new tests, including one asserting Canon specifically now works
(`any_brand_now_scales_not_just_the_old_2_entry_allowlist`).

**F1b (`parseDCP` tolerates a missing ProfileToneCurve)** shipped alongside it, since F1's own
Adobe Standard fallback is exactly the tree where this bites: verified directly against a real
file (`Apple iPad13,1 back camera Adobe Standard.dcp`) that it has no tag 50940 and previously
threw; now parses with an identity curve (`[0,0,1,1]` — two control points, the straight line
y=x through `bakeDcpLUT`'s interpolation) and confirmed a real `Camera/`-tree profile with a
genuine 256-point curve is unaffected (regression-checked directly, not assumed).

**Real-world resolution verified across three brands with a throwaway probe** (not committed —
matches the "manual open in the packaged app" coverage gap this kind of IPC-backed feature always
has): Canon EOS R5 → 6 real styles from `system-camera`; Nikon Z 6 → 22 real styles including
firmware "v2" variants; Fujifilm X-T4 → falls through to `adobe-standard` (no per-camera set
installed) with the correct single "Standard" style; a nonexistent camera → `None`, no error.

⚠️ **Honesty about colour, unchanged from the original design**: a resolver-found profile is
Lightroom-*ish*, not Lightroom-*matched* — single ForwardMatrix, no `dcpFit` residual (that stays
DC-S9-only, per F1a). The log line already said this; nothing new needed there.

**Deferred, not in this pass**: the per-camera dynamic style dropdown (today's `DCP_PROFILES`
union list stays hardcoded; a disk-resolved camera whose selected style doesn't exist falls back
to that camera's own "Standard" — the same retry the bundled path already does). F1's own note in
this file already flagged this as the smaller, separable half.

*Touches:* new `dcp_store.rs`; `chromasmith-22.html` (`resolveDcpSource`, `getDcpLUT`'s new
`source` param, `parseDCP`'s tone-curve tolerance); `desktop/desktop-native.js` (both DCP call
sites); `main.rs` (`effective_dcp_mode` generalized, `list_dcp_profiles`/`read_dcp_file`
registered).

### R8 — Colour-matrix fallback for un-profiled cameras (verified against real conversion math, not assumed)

**Shipped**: `raw_decode::srgb_rgba` (the desktop "None (LibRaw sRGB)" / un-DCP'd-camera path —
confirmed via trace that this, not a thrown error, is what a Sony ARW already hits today, since
`desktop-native.js`'s `open()` defaults to `mode='srgb'` and only switches to `'lut'` when a
bundled DCP prefix matches) now applies this shot's own camera→XYZ→sRGB colour matrix before the
gamma curve, instead of gamma-only on raw camera-native RGB. The matrix is `xyz_to_cam`, a field
this pipeline already extracted from rawler's `camera.color_matrix` for the High-tier denoiser —
newly threaded through to `DecodedRaw` and `srgb_rgba`'s signature. All-zero sentinel (no matrix
available) is an exact no-op, reproducing prior behaviour byte-for-byte — verified by a dedicated
regression test.

**How wrong the old behaviour was, concretely**: a camera's raw R/G/B filter response does not
remotely match sRGB's primaries, so gamma-correcting camera-native values directly (the old
`srgb_rgba`) is not merely "less accurate" than a real profile — it renders in the wrong colour
space outright. Visually confirmed on a real ARW (`TM_00522.ARW`): a pink/rose-coloured poodle
rendered as flat washed-out beige before this fix, with genuine colour restored after.

⚠️ **A real implementation bug was caught by writing the neutral-grey regression test itself,
not assumed to be correct from the math** — worth recording since it's the standard trap here.
Composing `XYZ_TO_SRGB_D65 * inverse(xyz_to_cam)` directly and applying it to a real ARW's
extracted matrix sent a neutral (equal-channel) grey patch to RGB(255,119,240) — wildly
non-neutral. Root cause, confirmed against dcraw's own published `cam_xyz_coeff` source: a raw
`ColorMatrix2`/`xyz_to_cam` isn't pre-scaled so a neutral camera reading maps to a neutral output;
dcraw's real code row-normalizes the composed matrix (each row divided by its own sum) before use.
Added that step; the same real matrix then reproduced exact neutral-preservation
(verified: `real_camera_matrix_keeps_neutral_grey_neutral`, `spread<=3` on real hardware numbers).

**Tests** (`raw_decode.rs::srgb_rgba_tests`): the byte-identical no-matrix regression, the
neutral-preservation property against the real xyz_to_cam this session's own decode extracted for
a real Sony ARW (not a hand-transcribed camconst TOML value — those may be transformed/normalized
internally by rawler before exposure, so only a value pulled through the actual code path is
trustworthy), and a saturated-colour check proving the matrix multiply is actually wired in.

**What this is not**: not chromatic adaptation to the shot's own illuminant, not a fitted profile
— it's exactly RawTherapee's/darktable's own "standard"/base tier (see the prior-art note on R8's
original entry, still accurate). Real per-camera colour instead of wrong-space colour; a real
fitted DCP (F1, or a hand-fit like the DC-S9's) is still strictly better where one exists.

*Touches:* `raw_decode.rs` (`XYZ_TO_SRGB_D65`, `srgb_rgba`, `DecodedRaw.xyz_to_cam`),
`rawdenoise.rs` (`mat3_inv` made `pub(crate)` for reuse), `main.rs` (both `srgb_rgba` call sites).

### F2 — Auto-detect V-Log from Panasonic PhotoStyle (root cause + real location, not where expected)

**Shipped**: `lens_correct::panasonic_photo_style(bytes) -> Option<u32>`, wired through
`main.rs::peek_raw_camera`'s `CameraIdent.photoStyle` → `desktop-native.js`'s
`NativeLibRawShim.metadata()` → `chromasmith-22.html`'s `loadRw2()`, which sets `#sel-input` to
`'vlog'` when `photoStyle===17`. Desktop-only (browser/wasm libraw never parses makernotes).

⚠️ **Where the tag actually lives took real tracing to find, and is worth recording precisely.**
The obvious approach — patch RW2's magic number (0x0055→0x002A, the same trick
`exif_lens_model_fallback` already uses) and ask kamadak-exif for `Tag::MakerNote` — silently
returns `None` on a real file ExifTool confirms carries `PhotoStyle: V-Log`. Traced with a debug
probe dumping every field kamadak-exif *does* parse (67 standard Exif tags, `ifd_num=In(0)`) and
cross-checking against `exiftool -v3`: **RW2's own container has NO MakerNote tag at all** — its
`ExifIFD` (reached via tag `0x8769`) has 30 ordinary tags and nothing at `0x927c`. What DOES carry
PhotoStyle is a **complete standalone JPEG preview embedded under RW2's own tag `0x002e`**
("JpgFromRaw" in ExifTool's Panasonic.pm) — a real `\xff\xd8\xff\xe1…` file with a normal,
non-magic-broken EXIF structure of its own, which is where the real MakerNote (194 entries,
signature `"Panasonic\0\0\0"` + a little-endian mini-IFD, offsets relative to the blob's own
start) actually sits. kamadak-exif parses this fine via `read_from_container` once handed just
those bytes — no patching needed, since it's a genuine JPEG.

Verified against **all four documented values on real files**, not just the one that started
this (`exiftool "-PhotoStyle#"` for raw numeric ground truth): 1=Standard (`__TM2153.RW2`),
3=Natural (`__TM3238.RW2`), 17=V-Log (`P_TM5168.RW2`), 22=Leica Monochrome (`P_TM2125.RW2`,
ExifTool itself only labels this "Unknown (22)" — CLAUDE.md's mapping was the one that named it).
Tests: `lens_correct::tests::photo_style_reads_real_files` (skips gracefully per-file if a
machine lacks a given fixture, same pattern as `focal_length_fallback_reads_real_rw2`) and
`photo_style_declines_garbage_without_panicking` (every offset is `bytes.get(...)`-bounded).

⚠️ **The documented multi-photo-batch limitation applies as designed, not as an oversight**:
`#sel-input` is one global control (CLAUDE.md: batch effects apply identically to every loaded
photo), so a mixed V-Log/Standard batch has whichever V-Log file loads *last* win for the whole
batch — this only ever sets `'vlog'`, never back. A real fix needs the same per-photo
`adjustOverride` machinery `matchSeriesToReference` uses; out of scope for this S-sized first pass.

*Touches:* `desktop/src-tauri/src/lens_correct.rs` (`panasonic_photo_style`, 2 tests),
`desktop/src-tauri/src/main.rs` (`CameraIdent.photo_style`, `peek_raw_camera`),
`desktop/desktop-native.js` (`metadata()`), `chromasmith-22.html`'s `loadRw2`.
| F3 | **Desktop file-dialog `add_filter` parity** | S | The plan flagged this as unverified: if `desktop/src-tauri` has a native open-dialog with its own extension filter (separate from the HTML `accept=`), it needs the same FMT_ALL widening or it'll silently exclude formats the app now opens |
| F4 | **EXR/HDR real headroom instead of clamp** | M | `still_decode.rs`'s `hdr_to_srgb8` currently clamps >1.0 to white with a logged note — reuse the RAW path's existing `hrOut`/`HR_MAX_STOPS` headroom channel (already threaded through export, `chromasmith-22.html:~8300`) instead, so an EXR's actual dynamic range survives into the HDR gain-map export path |
| F5 | **Linear/demosaiced-DNG passthrough** | S | `raw_decode.rs`'s photometric check now rejects linear DNG (iPhone ProRAW, Foveon→DNG conversions) with a named error instead of a crash — but it's a common real file, not an edge case. When `photometric` is RGB, skip demosaic and take the pixels directly |
| F6 | **ICO/DDS frame picker** | S | `still_decode.rs` reports a frame count today but always takes the first/largest; a picker UI is a follow-on, not a blocker |
| F7 | **Hands-on desktop verification pass** | S | Nothing in Pass 1 was click-tested in the built `.app` — no harness drives the new Tauri commands (`decode_image_v1`, widened `decode_raw_v2` inputs). Open one real file per newly-supported family (at minimum: a Fuji RAF, a Nikon NEF, a JXL, an EXR, a DDS) and confirm the Library thumbnail and the editor agree |
| F8 | **Regenerate `desktop/dist/` and `ios/App/App/public/`** | S | Pass 1 didn't run `build-desktop.sh`/`build-ios.sh` — those build outputs are still the pre-widening HTML. Cheap, just wasn't done this session |
| F9 | ✅ **DONE — ARW purple left-edge band; DC-S9 native decode corrected to true sensor resolution** | S | See write-up below. `npm test` + `cargo test --bin chromasmith` pass. Structural fix accepted on DNG-spec + dimension-match reasoning; a real ARW (`TM_00522.ARW`, a dark indoor shot) decoded before/after didn't visually reproduce a purple line either way — the file may just be too dark for a raw-linear dump to show it, since the real defect likely only becomes obvious after the app's own WB/exposure/tone-curve grading, which this quick Rust-side check doesn't replicate. Re-open the file that originally showed the line in the rebuilt app (F8) for a true confirmation |

### F9 — ARW purple left-edge band (root cause + fix)

**Symptom:** a Sony `.ARW` showed a purple/coloured vertical line down the left of the decoded
photo. Not "formats work not implemented" — Pass 1's 8→32 format widening exposed a real gap:
`decode_and_demosaic` (`raw_decode.rs:198–199`) always took the frame at `raw_image.width`/
`height`, the *full sensor readout*, and never read rawler's `RawImage::crop_area`/`active_area`
(`rawimage.rs:226,228`). Sony bodies carry masked optical-black columns along the sensor edge;
left in, they demosaic and grade like real image data — exactly a coloured band. RW2 never
surfaced this because the vendored DC-S9 profile carries no static `crop_area`, so it went
unnoticed until a body that does was opened.

**Fix shipped:** `raw_decode.rs` now reads `crop_area` (falling back to `active_area`) and crops
the final interleaved RGB16 buffer to it, *after* demosaic and before the cleanup passes —
cropping the raw Bayer buffer first would change PPG's edge interpolation and require re-deriving
the CFA pattern for the new origin (real bodies do shift phase: rawler's own `sony/a500.toml`
ships an odd `crop_area = [8, 7, 8, 3]`). Post-demosaic the buffer is plain RGB, so no such concern
applies. `RawImage::cropped_cfa()` — the obvious-looking helper — is `todo!()` in rawler 0.7.2 and
would have panicked; not used.

⚠️ **This also corrects the DC-S9's own native decode**, from 6016×4016 (full sensor readout,
including its own masked border) to 6000×4000 — Panasonic's published resolution for this camera.
rawler resolves this from the RW2 file's own embedded tags, independent of the static camera
TOML. **User-confirmed to apply uniformly** rather than exempting RW2, after establishing this
isn't a guess: 6000×4000 matches Panasonic's spec sheet, and — independently — the project's own
`calib/nr_validate.py` already documented "CS-bin is 6016×4016, LR-TIFF is 6000×4000 — they don't
pixel-align" as a known, worked-around mismatch. The native decode now simply agrees with what
the calibration tooling always treated as ground truth. Calibrated colour constants (DCP/LUT/
sky-gate) are per-pixel-value transforms, not position-dependent, so they remain valid against the
cropped frame — only the discarded border pixels are affected. Follow-up, not blocking: a few
`calib/*.py` diagnostic probes (`nr_stage_montage.py`, `tune_hybrid_fast.py`) hardcode patch
coordinates in the old 6016×4016 space and will need a coordinate-offset update if re-run against
a fresh decode.

*Touches:* `raw_decode.rs:198–199` (crop-rect capture) and the crop insertion just before
`DemosaicOut` construction (after the u16 pack step).

### Sequencing note

F1 unblocks F1a/F1b/F2's full form and is the biggest single item — but it's now low-risk per the
ForwardMatrix survey, not exploratory. F2's V-Log-only half is independent and worth doing even if
F1 slips. F3/F7/F8 are cheap and independent of everything else — good session-filler alongside a
bigger item. F4/F5/F6 are each self-contained follow-ups with no ordering constraint between them.
F9 is done in code; F7's "open one real file per family" pass should now include an ARW specifically
to confirm it visually.
