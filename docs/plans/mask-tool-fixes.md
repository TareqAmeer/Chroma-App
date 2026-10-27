# Mask tool fixes — research, measurements and plan (2026-10-27, rev 2)

Reported on the "Dog 2" AI mask (photo `__TM6636.RW2`):

1. With the overlay on, the mask's adjustments (Exposure +50) don't show on the photo.
2. AI selection spills far past the dog (door, bushes, pavement), from Select Subject and from manual scribbles.
3. Objects starts in Rectangle mode, a rectangle appears to do nothing, Scribble + Rectangle both look selected, and Paint sits beside them unselected.
4. Paint and Erase should share brush settings.
5. Default brush size should be 8 (currently 25).
6. Erase does nothing and makes the controls laggy.
7. Check that the models pick up the whole dog, tail included, across lighting and backgrounds, and whether offline training (on the gaming PC) would help.

Everything below was measured, not guessed, unless marked **unverified**. Evidence came from three
sources: (a) a live audit of every Masks-panel control in the running desktop app (built on the
`test/lib_mask_panel_scan.js` scanner: 102 controls on an AI mask), (b) an offline harness running
the app's own ONNX models with identical preprocessing on your real scribble (257 points) plus
29 library photos, and (c) a web review of EdgeSAM, SAM 2 and Lightroom behaviour.

---

## Findings

### F1 · Overlay hides the edit (confirmed by reading canvas pixels)
In every overlay style, including edge-only, the selected mask's area shows the unadjusted photo:
pixel value ~29 with the overlay on, against 255 with it off. Cause: the `comp` shader
(~L9310) paints the overlay over the pre-adjustment colour and then `return`s, which skips this
mask's adjustments, every later mask, and every later stage. Painting and scribbling switch the
overlay on automatically, so while you work on a mask you never see what it does.

### F2 · The spill comes from our edge clean-up, not the AI model (measured)
On your real scribble, scored against a checked reference outline of the brown dog:

| Stage | Selected outside the dog (% of dog area) | Missed |
|---|---|---|
| EdgeSAM raw output (what the model returns) | **6.6 %** | 2.3 % |
| …after the soft-edge step (`logit_to_soft_alpha`) | 6.6 % | 2.1 % |
| …after `_samMatteCore` edge matting = **what the app shows** | **54.6 %** (weighted 22.5 %) | 4.7 % |
| The mask actually stored in the app | 52.4 % (weighted 21.7 %) | 1.7 % |

The matting step's colour model can't tell a dark dog from a dark wall, window or bushes, so it
pushes the selection out into everything nearby. It is also slow: about 0.45 s at 0.7 MP in Node,
which is about 1.8 s on the main thread at the app's 1365×2048 mask size, on every scribble.

### F3 · Big brush = stray prompts = wrong selections (measured)
The AI only sees points along the centre of the stroke. People aim the ring at the dog, so with
a large ring the centre wanders onto the background. Your scribble: 87 of 257 points (34 %)
landed off the dog. In a simulated test with 6 photos × 3 scribbles each:

| Brush | Off-subject points | EdgeSAM (current) mean IoU / worst | SAM 2.1 mean IoU / worst |
|---|---|---|---|
| 25 (today) | 39 % | 0.57 / **0.00** (selected half the photo) | 0.70 / **0.00** |
| 8 (proposed) | 19 % | 0.85 / 0.47 | **0.95 / 0.79** |

IoU is overlap with the true dog outline; 1.0 is perfect.

Rejected by measurement: building a box from the scribble's bounds. When the scribble doesn't
reach the tail or legs, the box cuts them off (mean IoU 0.46–0.69). Feeding the previous mask back
into SAM 2.1 (`mask_input`) gave one catastrophic result (IoU 0.04) and isn't safe without more work.

### F4 · SAM 2.1 is clearly better, but the app isn't using it
- With the same prompts SAM 2.1 beats EdgeSAM on every photo: IoU 0.96–0.99 against 0.92–0.95
  on clean prompts, and it's far more forgiving of sloppy ones.
- In the live app `_sam2Token` was false, so every scribble used EdgeSAM. SAM 2.1 is meant to
  load in the background and take over, and it hadn't. **Cause not yet found.**
- Rectangle mode is EdgeSAM-only by design.
- Encode cost on this Intel Mac (CPU): EdgeSAM 0.5 s, SAM 2.1 2.6 s. Decode is ~50 ms for either.
- Model mechanics (confirmed from EdgeSAM's source): channel 0 is the single-mask output. EdgeSAM's
  own demo ranks point prompts by stability score and uses channel 0 for boxes. The padding
  point (label −1) is accepted but not required. On SAM 2.1 the padding point helped slightly
  with clean prompts and hurt slightly with sloppy ones (±0.005 IoU), so it's noise. Not a priority.

### F5 · Whole body and tail across your library (26 photos, visual check)
I picked dog photos from the catalog by tag (beach, woods, river, street, park, meadow, selfie,
black-and-white, sun-flare, water) plus random ones, and prompted each with **one click on the
dog's head**. Both models covered the whole body in nearly all of them (contact sheets in the
session scratchpad). Differences:
- SAM 2.1 got tails the current pipeline missed (black-and-white beach dog), and gave crisp edges
  where the current result is blobby.
- The current pipeline added halos into water reflections and grass.

Neither model needs retraining to find a dog's whole body. The failures the user sees are prompt
noise (F3) and post-processing (F2).

### F6 · Live audit of all 102 AI-mask controls
| Area | Result |
|---|---|
| Tool exclusivity | **FAIL**: Paint/Erase can be on alongside Scribble/Rectangle. About half of click sequences end with two tools on. Scribble-after-Rectangle leaves both pressed. Erase state leaks between masks. |
| Rectangle prompt | Works: 1.1–1.3 s, 99 % of the selection inside the box. The "does nothing" report is most likely the tool-state bug (another tool still armed) plus no feedback during the 1 s+ wait. |
| Erase, AI mask, Scribble armed | **FAIL**: the stroke adds 27 positive points, runs the AI (1.9 s), and the selection *grows* 73k → 96k px. This is exactly the "erase does nothing / laggy" report. |
| Erase with Rectangle armed, or on a plain brush mask | PASS |
| Brush stroke at 26 MP | **SLOW**: ~7 fps while painting (mean frame 137 ms, worst 1.3 s). Pointer release 0.5–0.8 s (`renderPreview` 398 ms + history). |
| Adjust slider → render | **SLOW**: 160–190 ms per input, and it **renders twice** per input. `mskRebuild` 51–64 ms. |
| Refine edges / Clear prompts | **SLOW**: 1.06 s / 0.72–0.78 s blocking the UI |
| Scribble select | 1.5–1.9 s end to end, of which ~50 ms is the model. The rest is IPC + upsample + matting (F2). |
| Overlay switch/style/opacity/outline/spotlight/pins, invert, amount, feather, mute, solo, hide-all, add/subtract/intersect, duplicate (+inverted), delete, clear paint, auto-mask | PASS |
| Paint/Erase settings | Separate Erase slot (size 25, flow 100, feather 60). Clicking Paint again turns the brush off; clicking Erase again switches to Paint (inconsistent). |
| Not exercised | Luminance floor/ceiling, Update all AI masks, Remember subject, Import, Rename, colour/depth pickers. Covered in Phase 4. |

### F7 · Prior art
- **Lightroom Select Objects:** Brush and Rectangle modes; Brush is recommended for busy
  backgrounds. "Automatically toggle overlay" hides the tint while adjusting.
- **Unverified from Adobe's own docs:** Lightroom's default mode, overlay opacity, and whether
  Erase has separate settings. You asked for shared Erase settings, so that's what we'll do.
- **ScribblePrompt (MIT 2024):** reports that SAM handles raw scribbles poorly. That supports
  thinning the stroke into a few well-spread points.
- **WebGL:** upload only the changed rectangle (`texSubImage2D`) once per frame, into a texture
  that was fully initialised first.

---

## Plan

### Phase 1 — Tool state, Erase, brush defaults (UI only; fixes #3, #4, #5, #6-correctness)
- One state variable, `mskTool ∈ {null,'scribble','box','paint','erase'}`, and one `mskToolSync()`
  that drives all four buttons (class, `aria-pressed`, label), the cursor/ring and
  `msk-brushing`. Delete the competing setters in `mskAiTapToggle`/`mskAiBoxToggle`/
  `mskPaintToggle`/`mskPaintErase_sync`. Run `node tools/scripts/app-uses.mjs <name> --all` for each
  old variable first.
- Pointer handlers dispatch on `mskTool` only, so a stroke can never be both erase and scribble.
- Objects opens on Scribble. Clicking the active tool turns it off, the same for every tool.
- Erase uses the active slot's size/flow/feather/density (drop slot `E`). Default size 8 (slot A
  and the starting value). Slot B stays 60.
- Show the on-canvas busy pill immediately for a Rectangle drag (it waits 150 ms today).

### Phase 2 — Overlay shows the edit (#1)
- In the shader, record the shown mask's coverage instead of `return`ing. Composite the overlay
  once at the end of `comp`, over the final colour, in every style.
- Auto-hide the overlay while an Adjust slider is held (option in the overlay "…" menu, on by
  default). Default opacity 0.75 → 0.5.
- Follow the `shader-edit` skill. Run `node test/export_harness.mjs` (export never sets `showSel`,
  so goldens must not move).

### Phase 3 — Selection accuracy (#2, #7)
Do these in order, re-running the harness after each step and keeping a step only if it improves
the numbers:
1. **Stop the matting spill.** Turn `_samMatteCore` off by default for AI selections and keep the
   model's own soft edge. If fur edges then look worse, bring matting back only inside a thin band
   (≤ 2 % of the image size) around the model's boundary, never more than a few pixels outward.
   Expected result: spill drops from ~52 % to ~7 % on the dog (F2).
2. **Use SAM 2.1 for scribbles.** Find out why `_sam2Token` stays empty in the live app and fix
   it. Start the SAM 2.1 encode as soon as an AI mask is created (2.6 s on CPU, in the background).
   Use EdgeSAM only until SAM 2.1 is ready.
3. **Cleaner prompts.** Thin the stroke into ≤ 6 points spread by farthest-point sampling (not
   evenly spaced along the stroke). Drop points from the last ~10 % of each stroke, where people
   overshoot. Brush size 8 comes from Phase 1.
4. **Rectangle on SAM 2.1** once it's ready (box IoU 0.974 against EdgeSAM 0.946 on the dog).
5. **Manual edits survive re-scribbling:** store Paint/Erase on AI masks as a separate add/subtract
   layer combined with the AI result.
6. **Offline training: deferred.** F5 shows the models already find whole dogs. If the harness
   still shows systematic misses after steps 1–5 (fur edges, tails on dark backgrounds), the
   gaming-PC route is:
   - fine-tune SAM 2.1-tiny's mask decoder (Apache-2.0, unlike EdgeSAM's non-commercial licence)
     with Meta's training code on a CUDA GPU with 12 GB or more (Windows via WSL2);
   - data: Oxford-IIIT Pet (CC BY-SA), COCO dogs, and ~200 of your own photos auto-labelled with
     SAM 2.1-large, then hand-corrected;
   - export to ONNX and drop it in as `vendor/sam2/decoder.onnx`;
   - accept it only if the held-out library set improves. That's a few days of work.
   - A cheaper alternative to try first: the larger SAM 2.1-small/base+ models, no training.
     Measure their encode time on this Mac before considering them.

### Phase 4 — Performance (#6-lag, F6)
Budgets added to `npm run perf:test` (26 MP photo, this Intel Mac):

| Operation | Today | Budget | Approach |
|---|---|---|---|
| Adjust slider → frame | 160–190 ms, 2 renders | ≤ 50 ms, 1 render | coalesce input to one render per frame; skip `mskRebuild` on slider input |
| Brush stroke frame | 137 ms mean, 1.3 s worst | ≤ 33 ms mean | upload only the dirty rectangle with `texSubImage2D`; reuse stroke buffers (no per-stroke `slice()` / `Float32Array`); render the preview at the screen's resolution while painting |
| Pointer release | 0.5–0.8 s | ≤ 100 ms | defer the thumbnail and history push to idle time; skip the extra full `renderPreview` |
| Scribble → mask | 1.5–1.9 s | ≤ 0.6 s | no matting (Phase 3.1); return the mask at mask resolution from Rust in one resize |
| Refine edges / Clear prompts | 1.06 s / 0.75 s | ≤ 150 ms UI block | move the work to the pixel worker (built via `toString` per §2); Clear prompts shouldn't re-run anything |

---

## Testing — every tool, accuracy and speed

**Accuracy harness (new, `tools/sam_eval/`):** the Python + ONNX scripts used for F2–F5, which
run the shipped models with identical preprocessing plus the app's own JS matting (extracted
like `test/unit/extract.mjs`).
- Labelled set: the dog photo plus 5 library photos with checked outlines (husky with tail, dark
  dog on a sofa, cockapoo on a train, two dogs on grass, tiny distant dog). Add 10 more covering
  night, backlight, black-and-white, water, and black dogs on dark ground.
- Images and outlines stay out of git (your photos). Scripts and score tables are committed.
- Gate for any change to prompts, models or post-processing: mean IoU not worse, worst IoU not
  worse, spill on the dog photo ≤ 10 %.

**Tool audit (repeatable):** the live audit becomes a script driven by
`tools/diagnostics/app_control.py` and `test/lib_mask_panel_scan.js`, in the same order as F6.
For every control the scanner lists on every mask type it records expected → actual →
pass/fail/slow, with timings. It takes a snapshot first and restores it afterwards. Run it once at
the end of each phase (not after every edit).

**Existing gates** at the end only (in the background): `npm run mask:test`, `perf:test`,
`node test/export_harness.mjs`, `editor:gates`, plus `test/probe_mask_brush_ux.mjs` and
`test/mask_box_prompt_ui.mjs`.

## Working efficiently
- Measure offline first. The harness answers "does this change improve selection" in seconds
  without rebuilding the desktop app. Only finished changes go to the live app.
- One desktop rebuild per phase, then the tool audit, then the gates in the background.
- Low-cost subagents (haiku/sonnet) for mechanical work: porting the audit to a script, labelling
  more reference outlines, running the gates. Keep design and shader work in the main session. At
  most two large agents at a time.
- Phases 1 and 2 touch different code (UI state vs shader) and can run in parallel sessions.
  Phase 3 depends on Phase 1 (brush size) and needs the harness. Phase 4 comes last because
  Phase 3.1 removes the biggest cost.

## Completeness check
Done means a scan of the running app, not this list:
- The tool audit script covers **every control `lib_mask_panel_scan.js` reports for every mask
  type** in the Create New Mask menu, default and expanded. Any control without a verdict fails the run.
- Tool exclusivity: on every mask type, every click order over every tool button leaves exactly
  one `aria-pressed="true"`, matching `mskTool`. Objects opens on Scribble.
- Erase on AI, brush and composed masks lowers coverage under the stroke and makes zero AI calls.
- Overlay: for every `MSK_SELVIEW_STYLES` value × outline on/off, the pixels inside the selection
  with Exposure +50 differ from Exposure 0. Export goldens unchanged.
- Brush: Paint ↔ Erase never changes size/flow/feather/density. A fresh session starts at size 8.
- Accuracy harness gate passes. The dog photo shows no selection on the door, window or bushes
  in the real desktop app (screenshot).
- All Phase 4 budgets pass in `perf:test`.
- Fresh-context gap review before closing.

---

## Status after implementation (2026-10-27)

| Phase | Shipped | Deviations from the plan, with the reason |
|---|---|---|
| 1 Tool state | One exclusive tool set (`mskToolActive`/`mskToolSync`); arming Scribble/Rectangle turns the brush off and vice versa; pointer handlers refuse a scribble while the brush is on; Objects opens on Scribble; `mskAiTapToggle(true)` always means Scribble (a leftover Rectangle mode no longer leaks into new AI masks); Erase shares the active slot's settings; default size 8 | Clicking Erase again returns to Paint instead of turning the brush off. That's the existing CHR-275 behaviour, and `mask_raster.mjs` asserts it. |
| 2 Overlay | The overlay is composited after every mask and the curve, over the finished colour, in all six styles plus edge-only; auto-hides while an Adjust slider is held (overlay "…" menu, on by default); opacity 0.5 | Export goldens unchanged |
| 3 Accuracy | No colour matting on AI results; SAM 2.1 staleness is checked against the photo item (RAW img swaps were discarding every SAM 2.1 encode); SAM 2.1 starts whenever EdgeSAM is already encoded; Rectangle uses SAM 2.1 (`sam2_box`, Rust) once ready; manual Paint/Erase is re-applied on top of each new AI result | **Farthest-point sampling rejected:** on your real scribble it picks the stray background points first (IoU 0.00–0.03 against 0.96 for the current even spacing). Even spacing kept. |
| 4 Performance | Brush strokes use the shared interactive render tier (cheap frames plus one settle) instead of a full render every frame; no synchronous full render on stroke release or Clear prompts; the ~1.8 s matting per scribble is gone | Not done: slider-to-frame is bound by the full render cost (~160 ms at 26 MP; it already coalesces per frame, and the "two renders" are the designed interim plus settle). Refine edges is still on the main thread. Dirty-rectangle texture upload isn't done. All three are follow-ups. |

### Live re-audit on the rebuilt app (BUILD 1.1027G)
- Tool exclusivity: 192 clicks over all 24 click orders, never more than one tool pressed. Both AI mask entry points open on Scribble.
- Erase on an AI mask after Scribble: zero AI calls; coverage .505 → .368.
- Overlay with Exposure +50: the adjusted photo shows under the tint in every style. Hides while a slider is held.
- SAM 2.1 now loads on the RAW photo. Your 257-point dog scribble re-run with `sam2_points`: **IoU 0.949, spill 5.1 % (was 52 %), missed 1.3 %**. Rectangle uses `sam2_box`, 100 % inside the box.
- Stroke release 518–798 → 40 ms. Clear prompts 715–776 → 55 ms. Slider 160–191 → 121–159 ms.
- Brush stroke frame time **unverified**: the machine was at load 250–330 from other processes during the run. Re-measure when idle.

### Speed follow-up (2026-10-27, idle machine, load 3–7, Intel Iris Plus 645)
Measured live in the desktop app on the RAW dog photo (one AI mask, borders on, preview 1622×2436).

| | Before | After | What changed |
|---|---|---|---|
| Brush stroke, per frame | 172 ms (p90 203) | **95 ms** (p90 104) | Only the rows a dab touched are re-uploaded (`_mskPaintBand`); full and band uploads compared byte-for-byte: 0 differences |
| Slider drag, per frame | 174 ms | **~105 ms** | Mask textures are no longer rebuilt on every render when nothing changed (per-renderer signature in `mskBuildTex`, ~22 ms each); desktop drafts render at 1 backing px per CSS px (the border composite went 90 → 30 ms) |
| Refine edges | 841 ms frozen | **3 ms** on screen, ~0.6 s in the background | Guided filter runs on the pixel worker (`_mskGuidedFilter` via `_cpuRun`); the result is dropped if the mask changed meanwhile |

What's left: a draft frame is still ~60 ms of GPU work that barely depends on output size. The
main pass samples the 24 MP source texture (sharpen taps, mask gate), which is slow on this Intel GPU.
The next step would be a reduced-resolution source copy for draft frames only.
