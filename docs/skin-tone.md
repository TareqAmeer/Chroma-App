# Skin Tone — the contractive colour operator

Deep-dive on the Skin Tone mask: panel layout, the Oklab-based contraction math, segmentation-first design, auto-seeded samples, and Phase C/D follow-ons (named subjects, per-mask Clarity/Defringe). Load this when touching `mskRebuild`, `skinUniformity()`, `colRangeWeight()`, or the AI-mask panel.

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
C1's Skin Tone tool; LR has no equivalent.

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
  replaces the LR trip: volume detection, date-organised copy with folder/filename
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

### Per-mask Clarity, Defringe, gate weave / film breath (Phase D, 2026-08-15)

One batched shader cycle (§3's reserved-word and compile-silence traps apply):
- **Per-mask Clarity** (`mskJ[i].w`, `srcHPW`) — a SECOND, wider high-pass (radius 3) beside the
  radius-1 one Texture already shares, gated on `mskAnyClarity` so its 4 taps are never paid by
  default. Deliberately a different radius: Texture moves skin *grain*, Clarity moves midtone
  *structure*, and at one radius they would be one control with two names. This is the portrait
  move — soften skin while the eyes keep their Texture.
- **Defringe** (`lnsDefr`, in the lens pass) — desaturates purple/green edge fringes toward local
  luminance, gated on a luminance-gradient so flat lilac or green *subjects* are left alone. Not
  the same thing as the existing CA slider, which geometrically shifts R/B and cannot touch
  local, edge-only fringing.
- **Gate weave + film breath** (`vidWeave`, `vidBreath`, video only) — sub-pixel per-frame offset
  and per-frame exposure jitter, both off by default. ⚠️ Driven by the SAME `fxVideoFrameSeed`
  hash as the grain, with two decorrelated salts for x and y: §12's rejected linear step would
  read as rhythmic judder on a positional offset, and one hash for both axes would slide the
  frame along a diagonal instead of wandering.
- **Perspective / keystone** (`lensPersp`, same pass) — a real homography (both terms in the
  DENOMINATOR), plus fine Rotate and a Scale to hide the wedges a correction opens at the frame
  edge. ⚠️ A shear is NOT a substitute: it straightens converging verticals but leaves the
  spacing wrong, which reads as a stretched building rather than a corrected one. The pole is
  clamped at `d>=0.15` so an over-driven slider stays ugly-but-sane instead of flipping the image
  through infinity. Verified with a synthetic line grid (`top/bottom` lit-pixel counts: 14/14 at
  0, 0/16 at +80, 16/0 at −80, and Scale 40 pulls the lost edge back to 16/18).
  *Auto-horizon is NOT included* — it needs line detection (a Hough pass), which is its own piece
  of work rather than a slider.
- **Film frames (D4)** — `filmFrameCompose`, one function called by BOTH the preview and export
  paths, between the borders and the canvas matte. Two kinds, because neither alone is enough:
  - **Procedural** (`sprocket35`, `sprocket35-wide`, `rollfilm`) — drawn from ISO 1007 / SMPTE
    nominal geometry (35mm width, 24×36mm frame, KS-1870 perforations at 0.187in / 4.7498mm
    pitch). Those are published measurements, i.e. **facts**, so nothing is copied from anyone.
    This is the default because it is the only kind that ADAPTS: a scanned plate is locked to the
    aspect it was scanned at and visibly ovals its sprockets on a 4:3 photo.
  - **Plates** — a real scan composited over the photo, drawn to COVER (cropped, never stretched).
  ⚠️ **Licensing is the binding constraint here, not code.** Most film-border packs — including
  ones advertised as "free" — permit use in media projects but NOT redistribution inside
  software. Exactly one plate is bundled (`vendor/frames/carrier-ragged.png`, **MIT**, from
  romnn/film-borders); `vendor/frames/README.md` records the rule and why FilterGrade's and
  Freepik's are deliberately absent. **Load frame…** takes any PNG the user has a licence to,
  which is what makes commercial packs usable without this repo redistributing them.
  ⚠️ Edge printing goes in the band BETWEEN the perforations and the image. The first version
  centred it in the rebate, which drew the text straight across the sprocket holes — the single
  detail that reads as fake at a glance.
  Not wired into VIDEO export yet (`_videoComposeBorderMatte` precomputes its sizes once per
  clip, so it needs the frame folded into that computation rather than called per frame).

### HDR from RAW (item 13's replacement, 2026-08-16)

Gain-map HDR export (ISO 21496-1, §CLAUDE.md's "HDR (gain map)" section) worked on iPhone HEIC
(measured headroom 1.37-1.40) but not on this camera's own RW2 files (measured 1.0000/1.0024),
because `source_headroom`/`write_gainmap_heic` derive headroom from Core Image's own expand-to-HDR
on the SOURCE FILE, and a RAW carries no encoded HDR rendition for Core Image to expand.

⚠️ **`CIRAWFilter` does not fix this — measured directly, not assumed.**
`desktop/src-tauri/examples/raw_headroom_probe.rs` probed `extendedDynamicRangeAmount` against a
real RW2: the mean level at `EDR=0` and `EDR=1` came back byte-identical (0.02173913 both times),
and the filter's own `inputKeys` came back empty — this camera's files never enter CIRAWFilter's
real RAW path at all. So a RAW's headroom cannot come from Core Image's RAW pipeline.

**It comes from OUR OWN decode instead, and is already computed and already thrown away.** The DCP
LookTable is documented (§7) as "TABLE-INDEX clamps only, values extended-range" — the trilinear-
sampled colour value inside `applyDcpLUT` can genuinely exceed 1.0 before the `Uint8ClampedArray`
write clamps it to 255. `applyDcpLUT` now takes an optional `hrOut` byte array and records that
overshoot, in the SAME per-pixel loop that already runs for every RAW load — free unless a caller
actually supplies it, and verified byte-identical to the old signature otherwise
(`test/probe_hdr_raw.mjs`: 0/3404 RGBA bytes differ across a synthetic extended-range LUT with 561
of 851 pixels carrying real headroom).

The headroom map is threaded through export via the SAME `applyGeomTo` the photo itself uses
(`_hdrHeadroomPngFor`), so it stays pixel-aligned through crop/rotate/flip/straighten by
construction rather than by a second, hand-maintained transform — verified with a known bright
quadrant that lands correctly on the opposite corner after a 180° rotation.

⚠️ **The headroom byte must be sRGB-gamma-ENCODED, and this is load-bearing, not stylistic.**
Found by testing midpoints, not just endpoints: a first version wrote the byte as a raw linear
fraction and measured a written file's headroom at 1.647x where 2.506x was intended (0 and 255
matched by coincidence — gamma's two fixed points). Root cause: `imageWithData:` colour-matches an
untagged 8-bit PNG as sRGB and gamma-DECODES it before `CIColorMatrix` ever sees it. Trying to
disable colour management instead (`kCIImageColorSpace: NSNull`) was tried FIRST and measured to
change nothing; pre-encoding the byte on the JS side to cancel the decode is the verified fix
(`desktop/src-tauri/examples/gainmap_from_map_probe.rs`: norm 0/0.25/0.5/1.0 all land within 0.5%
of their analytic target after the full write+read round trip).

New Rust: `gainmap::write_gainmap_heic_from_map` (CIColorMatrix builds a per-pixel multiplier from
the headroom map, then the SAME `CIMultiplyCompositing` `multiply()` helper the existing HEIC-
source path already uses) and the `write_gainmap_heic_from_map` command, whose framed body is a
4-byte little-endian length prefix + the headroom PNG + the graded PNG. `fxSaveGainMapHeic` and
`fxSyncHdrOption` both now check `it.img._hdrHeadroom`/`_hdrHeadroomPresent` FIRST and fall back to
the existing Core Image source-file path for non-RAW sources (iPhone HEIC etc.), unchanged.

Verified: `cargo test` 41/41, 18/18 export goldens (identity-path SDR render untouched), 21/21
mask, both Rust probes above. Not yet verified: a hands-on click-through in the built app (open a
real RW2, toggle HDR, export, confirm the written HEIC shows extra range) — every LINK in the
chain is independently verified, but the full user-facing round trip has not been driven by hand.

### Retouch: heal / clone (E1, 2026-08-15)

Spot removal is unlike every other tool here: masks and sliders feed the shader, but a healed
blemish has to be **gone before grading starts**. So `healApply` runs as a pre-pass on the SOURCE
image and the existing pipeline treats the result as the photograph — which is what makes a repair
take the same LUT, grain and halation as its surroundings. Patch after grading and the repair
shows up as a suspiciously clean spot in a grainy frame.

- ⚠️ **Ops are normalised against the ORIGINAL image and applied BEFORE `applyGeomTo`**, not
  against `fxWork` the way mask coordinates are. Masks tolerate the `fxWork` convention because a
  radial mask drifting under a re-crop is cosmetic; a heal spot drifting leaves the blemish visible
  AND smears a copy of it nearby. Pinning to the source means crop/rotate/flip/straighten carry
  repairs along for free (verified: rotate 90° keeps them). Both preview (`updateWork`) and export
  reach the image through `geomCanvas`, so there is no second path that could disagree.
- ⚠️ **Heal matches the ANNULUS around the spot, never the disc.** Matching the destination disc
  means matching the blemish being removed, which tints the donor dark and defeats the operation.
  Measured on a textured field (surround 163, blemish 67): disc-matching landed at **97 — worse
  than a plain clone at 149** — while ring-matching lands at 161. `healAutoSource` targets the ring
  for the same reason, or it hunts for a donor resembling the defect.
- ⚠️ **The opaque core is `r*(1-0.65*fe)`, not `r*(1-fe)`.** The latter leaves the patch only half
  opaque at 0.5r, so a spot sized just larger than the blemish shows a visible RING of the original
  through the feather — clearly visible in `test/output/heal_probe.png` before the fix.
- **Heal vs Clone is a real difference, not a label.** With a deliberately wrong donor (what
  shift-drag can produce) on a gradient: heal lands at 141.3 against a 141 target, clone at 203.3.
  Clone skips the colour match on purpose — duplicating a real object wants the donor's own colour.
- `s.heal` is in `getUISnapshot`, and that is load-bearing: `fxHistoryPush` dedupes on the
  snapshot's JSON, so an op absent from it makes consecutive states compare equal, the push is
  skipped, and ⌘Z silently does nothing. An absent key means "leave alone", an explicit null means
  "no repairs" — the latter is what lets undo clear the first spot.
- `test/probe_heal.mjs` measures the above; `test/probe_heal_undo.mjs` covers undo/redo and
  survival through geometry.

### Auto level / auto horizon (ROADMAP 11's second half, 2026-08-15)

`autoHorizon` finds the dominant near-horizontal or near-vertical line and levels it. Accuracy on
ground truth (synthetic frames at known tilts, `test/probe_horizon.mjs`): **worst error 0.30°**
across 13 cases spanning ±8°, with foliage and a soft gradient correctly declined.

- ⚠️ **It is a real Hough transform — voting on line POSITION — not a histogram of per-pixel
  gradient orientations.** That distinction is the whole accuracy of the feature and was measured:
  the orientation-histogram version reported a median edge angle of **−9.7° for a true −8°**
  horizon, a systematic ~1.35× overshoot. On a near-horizontal edge `gx` is small and dominated by
  the rasteriser's own stair-stepping, so `atan2(gy,gx)` is noisiest exactly where this has to be
  precise. Voting on position gives a sharp peak regardless of any single pixel's gradient.
- Candidates are re-scored by **frame span** and by a mild **level prior**, and a near-tie at a
  materially different angle **declines** rather than guessing.
- ⚠️ **KNOWN LIMITATION, measured, do not "fix" it by tuning.** "The strongest long straight line"
  is not always the horizon. On `geneva/__TM5132.jpg` (lake, hazy far shore broken by people) a
  clean diagonal boundary in the water genuinely outscores the true horizon, and the tool returns
  **−7°**, which is wrong. Span weighting, a level prior and an ambiguity test were each tried:
  none separated them, because the diagonal really is the stronger line. Tightening the ambiguity
  threshold far enough to reject it (0.72) also **lost a correct detection** on `__TM4933`, so it
  sits at 0.85. This is a limitation of edge-based auto-level, not a bug — the correction is
  applied to a visible slider and ⌘Z undoes it, which is why a suggestion is acceptable here.

### Match series to a reference (ROADMAP 15, 2026-08-15)

Batch editing shares one `fxState`, which is right for a LOOK and wrong for exposure/WB drift: a
set walked through changing light meters each frame differently, so one shared exposure leaves
half the shoot dark. `matchSeriesToReference` solves a per-photo offset and writes it into that
photo's own `adjustOverride` — the same mechanism the manual "make this photo independent" toggle
uses, so render, export, session and XMP need no knowledge of the feature.

- ⚠️ **Exposure only, plus white balance — never contrast/saturation/look.** Those are what the
  user chose; matching them would flatten the set to one frame's interpretation. Drift is a
  capture problem, not a taste problem.
- ⚠️ **Exposure is solved in STOPS** (`log2(refLum/tgtLum)`), not as a linear difference — the
  slider is exposure compensation, so a frame half as bright needs +1 stop wherever it sits.
  Verified: a synthetic half-brightness frame solves to exactly **+20**, which is +1 stop at the
  slider's ±5-stops-over-±100 mapping, and closes the luminance gap **100%**.
- ⚠️ **White balance is measured AFTER equalising brightness**, or an exposure difference
  masquerades as a colour cast. Verified: a pure ×1.25R/×0.8B cast solves to temp −40 with an
  exposure term of −1.
- Statistics are **trimmed means** (10-90th percentile) on source pixels at 160px — a bright sky
  or black frame edge would otherwise drag the average and make the correction chase the
  background. Matching a photo to itself solves to exactly zero, which is the guard that a
  no-op stays a no-op.
- `test/probe_match_series.mjs` measures all of the above end to end.

### ROADMAP 6 (per-mask detail) is substantively complete

Texture is **bipolar** — its own tooltip says "negative softens, positive sharpens" — so the
"Sharpness" and "Noise" halves of that item would be the same radius-1 operator under two more
names. That is exactly the trap the Texture/Clarity split was designed to avoid (§ Phase D: "at
one radius they would be one control with two names"). A genuinely different per-mask NR would
need an edge-aware filter, which is its own piece of work rather than a slider.

---

