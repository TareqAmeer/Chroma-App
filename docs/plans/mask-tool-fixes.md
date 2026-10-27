# Mask tool fixes — research + plan (2026-10-27)

Reported on the "Dog 2" AI mask (screenshots in the session):

1. With the overlay on, the mask's adjustments (Exposure +50) don't show on the photo.
2. AI selection spills far past the dog (door, bushes, pavement) — from Select Subject *and* from manual scribbles.
3. Objects starts in Rectangle mode, a rectangle drag appears to do nothing, Scribble + Rectangle can both look selected, and Paint sits beside them unselected.
4. Paint and Erase should share the same brush settings.
5. Default brush size should be 8 (currently 25).
6. Erase does nothing and makes the controls laggy.

---

## 1. Overlay hides the adjustments — cause confirmed

In the `comp` shader's mask loop (`chromasmith-22.html` ~L9310), when the loop reaches the
mask being shown it paints the overlay over `c.rgb` and then **`return`s**. `c.rgb` is the
colour *before* that mask's adjustment, and the `return` also skips every later mask and every
stage after the loop. So every overlay style (colour, colour-on-B&W, image-on-B&W/black/white,
white-on-black) shows the photo as if the mask had no effect. Screenshot 1 (image-on-B&W) shows
the dog unbrightened for the same reason.

It's worse than it sounds because painting/scribbling switches the overlay on automatically
(`mskCursorSync`), so while you work on a mask you never see what it does.

How Lightroom does it: the overlay is a translucent tint *over the edited image*, and
"Auto toggle overlay" hides it while a slider is being dragged and brings it back afterwards.

**Fix**
- In the loop, store the shown mask's coverage (`selW`) instead of returning. Keep applying this
  mask's adjustment and all later masks/stages.
- Composite the overlay once, at the very end of `comp`, over the final colour. "Image on B&W /
  black / white" then show the *adjusted* photo inside the selection.
- Auto-hide while any slider in the selected mask's Adjust group is being dragged (pointerdown →
  pointerup), restore after. Add an "Auto-hide overlay while adjusting" option in the overlay
  "…" menu, on by default.
- Lower the default overlay opacity from 0.75 to 0.5 so the adjustment reads through it.
- Follow the `shader-edit` skill (no backticks in GLSL comments, no reserved names like
  `half`), then run `node test/export_harness.mjs` and watch for `GLSL compile error`. Export
  never sets `showSel`, so goldens must not change. If they do, that's a regression.

## 2. AI selection spills past the subject — likely causes (to be proved by measurement)

How a selection gets made now: the scribble is sampled into points (≤6 positive + ≤6 negative,
`samSubsamplePoints`) → `sam_points` (EdgeSAM) or `sam2_points` (SAM 2.1 once it has loaded) →
the decoder returns several candidate masks → **we keep the one with the highest score** →
upsample → edge matting (`_samMatteCore`).

Problems found, most likely cause first:

a. **Wrong candidate choice for multi-point prompts.** Meta's own SAM guidance: multi-mask
   output is for *ambiguous* prompts like a single click. For several points (any scribble) or a
   box, the single-mask output is the better result. EdgeSAM always returns 4 channels
   (channel 0 = single-mask output, 1–3 = multi-mask). We take the argmax over all 4. With a
   dark dog against dark bushes, the top-scoring candidate is usually the big "dog plus
   everything around it" mask. SAM 2.1 returns 3 multi-mask channels and we take the argmax the
   same way.
b. **Possibly missing padding point.** Meta's SAM ONNX decoder expects an extra `(0,0)` point
   with label `-1` when no box is given. Without it, point-only prompts get noticeably worse.
   Need to check against EdgeSAM's `predictor_onnx.py` and the SAM 2.1 export, then test both
   ways.
c. **Every scribble starts from scratch.** SAM's interactive loop feeds the previous result back
   in (`mask_input`, `has_mask_input=1`), and that's what makes extra strokes *refine* the mask.
   SAM 2.1's decoder supports this, but we always send zeros. EdgeSAM's decoder has no mask input.
d. **The brush ring doesn't match what the model sees.** The ring suggests a painted area, but
   SAM only gets up to 6 points along the centre line, spread evenly over the stroke. A long
   stroke that wanders off the dog contributes a positive point on the background.
e. **The rectangle prompt never uses SAM 2.1.** `sam_box` is EdgeSAM only.
f. Manual Paint/Erase on an AI mask writes straight into `m.px`, and the next scribble replaces
   `m.px` entirely, so **manual touch-ups are silently lost** whenever you scribble again.

**Plan (measure first, then change, one variable at a time)**
1. Build `tools/diagnostics/sam_eval` (Rust test or a small binary under `desktop/src-tauri`)
   that takes a photo, a saved prompt (scribble points / box) and a hand-made reference mask,
   then reports IoU and how far the selection spills outside the subject, for each variant.
   Test set: this dog photo plus 4–5 others (pet on a busy background, person, object on a
   table, low-contrast subject). Reference masks drawn once with the Brush and exported.
2. Variants to score: candidate policy (argmax-all vs channel 0 for ≥2 points or a box vs
   stability-score pick), with/without the padding point, point count (all vs 6 vs 3 spread by
   farthest-point sampling), SAM 2.1 with the previous mask fed back in, and scribble → box +
   points.
3. Ship the winning combination. Expected, to be confirmed by the numbers: channel 0 for
   multi-point/box prompts, padding point if the export needs it, previous mask fed back to
   SAM 2.1, and SAM 2.1 for rectangles when it's ready.
4. Keep manual edits separate: store Paint/Erase on an AI mask as an add/subtract layer that's
   combined with the AI result, so re-scribbling keeps them.
5. Scribble feedback: draw the stroke at the real brush width, and sample points only from the
   part of the stroke that stayed inside the photo.
6. Look at Select Subject (`mskAdd('ai')` → auto) separately, through the same eval, since the
   user saw the spill there too.

## 3. Tool state in the Selection group — causes confirmed

- `mskAddObjects()` (L21788) deliberately arms **Rectangle** first. Change it to arm **Scribble**
  (Lightroom's Select Objects also starts on Brush select). Update the log text to match.
- `mskAiTapToggle()` switches to scribble but never redraws the Rectangle button, so both stay
  highlighted. `mskAiBoxToggle()` redraws Scribble but not Paint/Erase. Paint/Erase are synced
  by a third function (`mskPaintErase_sync`), and `mskBrushModeActive()` treats scribble as
  "paint", so the Paint button's look depends on which function ran last.
- Rectangle "does nothing": not reproduced yet. Suspects: the zoom/pan grab handler takes
  pointerdown before the box handler (box mode doesn't set the `msk-brushing` body class that
  scribble/paint use), or the box result only arrives after the EdgeSAM encode, with no
  feedback. **Reproduce live first** (`chromasmith-debugger` subagent, per CLAUDE.md rule 3)
  before fixing.

**Fix**
- Replace `mskAiTapMode` / `mskAiPromptMode` / `mskPaintMode` / `mskPaintErase` with one
  state, `mskTool ∈ {null, 'scribble', 'box', 'paint', 'erase'}`, and one
  `mskToolSync()` that sets the class, `aria-pressed`, label, cursor, ring and
  `msk-brushing` for **all four** buttons. Every toggle and shortcut goes through it.
- Layout on an AI mask: one row of tools, only one active at a time —
  **Select:** Scribble · Rectangle  **Refine:** Paint · Erase — then Clear prompts. Labels stay
  short ("Scribble", "Rectangle"). The "drag on the photo" hint moves to the on-canvas hint.
- Run `node tools/scripts/app-uses.mjs mskAiTapMode --all` (and the same for the other three
  variables) before the refactor, so no caller is missed.

## 4. Paint and Erase share brush settings

`_mskBrushSlots` keeps a separate `E` slot (size 25, flow 100, feather 60), so switching to
Erase swaps size, flow and feather. Change: Erase uses the **active** brush slot's settings
(A or B). Drop slot `E` and its save/restore in `mskBrushSlotSelect`. (Lightroom keeps separate
Erase settings; this deliberately differs, at the user's request.)

## 5. Default brush size 8

`mskBrushSize=25` (L19164) and slot A `size:25` → 8. Slot B (the alternate large brush) stays at
60. The AI scribble ring uses the same size, so it gets thinner too, which also helps 2d.

## 6. Erase does nothing on an AI mask, and makes the controls laggy

Suspected causes, to be confirmed with a live repro first:

- **Two tools run at once.** Choosing Erase (`mskBrushSlotSelect('E')`) turns paint mode on but
  doesn't disarm Scribble. The paint and scribble pointer handlers sit on the same canvas, and
  `stopPropagation` doesn't stop other listeners on the same element. So one erase stroke
  erases pixels **and** adds scribble points. On release, `samRunPoints` replaces the whole
  raster with a fresh AI result, which undoes the erase and runs the model on every stroke
  (the lag). The single `mskTool` state from #3 fixes this by construction.
- **Full-resolution raster.** AI masks are stored at the encoded photo's full size (Brush masks
  use a small raster). Each stroke clones the raster (copy-on-write), takes a `px.slice()`
  baseline, allocates a same-size `Float32Array` cover buffer, and re-uploads the whole texture
  every frame. On a 24 MP photo that's roughly 150 MB of allocation per stroke. Fix: keep the
  manual add/subtract layer from 2f at Brush-mask resolution, upload only the dirty rectangle
  (`texSubImage2D`), and reuse the stroke buffers instead of reallocating them.
- **Composed masks.** "Dog 2" shows a Subject component with Add/Subtract/Intersect. If erase
  writes to the parent while the visible coverage comes from the component, nothing changes.
  Check which raster the stroke writes to when the mask has components.

Done means: erase visibly removes the selection on AI, Brush and composed masks, triggers no AI
call, and a 10-second continuous erase on a 24 MP photo keeps pointer-to-paint latency inside
the `perf:test` brush budget.

---

## Order of work
1. #3 tool state + #4 + #5 + the "two tools at once" part of #6 (UI only, quick, makes everything else testable).
2. #1 overlay compositing + auto-hide (shader, run the export harness).
3. #2 eval harness → measure → ship the winner → keep manual edits separate (also fixes the erase speed in #6).
4. One full gate run at the end (`npm test`, background), plus a live check in the desktop app
   on the dog photo.

## Completeness check
Done means a scan of the running app, not this list:
- **Tool exclusivity:** for every mask type that renders tool buttons (scan
  `#ff-local [id^="btn-msk-"][aria-pressed]` after creating each type from the Create New Mask
  menu, including Objects, Subject, Brush, Skin, Sky), click every tool in turn and assert that
  exactly one button has `aria-pressed="true"` and the canvas cursor/ring matches it.
  Objects must open with Scribble pressed.
- **Overlay:** for every value in `MSK_SELVIEW_STYLES` × outline on/off × every mask type,
  render with Exposure +50 and assert that the pixels inside the selection differ from the
  same render with Exposure 0 (the adjustment shows through). Export goldens unchanged.
- **Brush:** switch Paint → Erase → Paint (A and B slots) and assert size/flow/feather never
  change. A fresh session starts at size 8.
- **AI quality:** eval IoU on the test set improves over the current baseline on every photo,
  and the dog photo shows no selection on the door or bushes. Checked in the real desktop app,
  not only the harness.
- Fresh-context gap review of the finished change before closing.
