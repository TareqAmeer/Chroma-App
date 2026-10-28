# Mask accuracy, speed and UI pass — 2026-10-28

Owner request: make sky, subject and subject identification more accurate, consider Foreground and Objects masks,
improve performance, quality and UI, at least 30 significant improvements, each applied and tested.

## Research basis (prior art, checked before building)
- **SAM single vs multi-mask** (Kirillov et al. 2023, official `SamPredictor` notebook): `multimask_output=True` is for a
  *single ambiguous click*; for a box or several points the authors recommend the single-mask token (output 0), because the
  3 multimask heads are trained to return whole/part/sub-part and arg-max IoU often picks a part. SAM 2 keeps the same rule.
- **Detector-prompted SAM** ("Grounded-SAM", Ren et al. 2024): detector box → SAM box prompt is the standard way to turn
  detections into instance masks; adding the box centre as a positive point is unnecessary when the box is tight.
- **Lightroom masking** (Adobe help, Select Subject / Sky / Background / Objects / People / Landscape): one click, no
  scribble, for Subject, Sky and Background; Objects lists detected things to pick; masks re-run per photo.
- **Guided upsampling** (He et al., "Guided Image Filtering", TPAMI 2013, §joint upsampling): a low-res mask is upsampled
  with the full-res photo as the guide so edges follow the photo instead of the model's 256/576/1024 px grid.
- **Otsu's method** (1979) for an automatic two-class split of a histogram — used for the Foreground depth threshold.
- **Sky segmentation clean-up** (Liba et al. 2020, "Sky Optimization"): the coarse probability decides confident sky / not
  sky; small isolated sky blobs low in the frame (windows, reflections) are removed; a refined band follows the skyline.
- **Grain at reduced scale**: averaging k×k independent noise samples cuts the standard deviation by k, so a render with k
  grain cells per pixel must attenuate grain by ~1/k to look like the export viewed at that size.

## The list (each item ships with a check)
Zoom parity (bugs reported alongside):
1. Halation/bloom size matches the export at every zoom (crop renders used the whole-photo width, not the zoomed width).
2. Zoomed glow runs at photo density past 1:1 so the blur cap matches the export (no extra truncation when deep-zoomed).
3. Fit-preview grain matches the export viewed at the same size (was ~2.3× too strong zoomed out).
4. Blurry left strip after zooming in (debugger agent; regression test).

Subject identification / Objects:
5. Objects: detector reports all 80 COCO classes (bench, car, bicycle, chair, umbrella, …), not only people and 4 pets.
6. Readable names for every class ("Potted plant", "Teddy bear"); no "undefined" chip for an unknown label.
7. Cross-class duplicate removal (one dog labelled dog and cat becomes one chip).
8. Size and confidence filters per group (people/animals 0.45, objects 0.55, ignore boxes under 0.25% of the frame), capped
   at 12 chips, largest first within each group.
9. Chips grouped People / Animals / Objects / Sky, with counts.
10. Detected-chip masks use SAM 2.1 boxes once its encode is ready (more accurate), EdgeSAM otherwise.
11. ~~Box prompts use SAM's single-mask output~~ — **rejected by measurement**: on the 7-photo labelled dog set EdgeSAM's
    single-mask channel scored 0.923 mean IoU vs 0.922 for the current best-score pick (no gain). Replaced by item 33.
12. A single click keeps the most **stable** multimask candidate (SAM's stability score) instead of the model's own best
    score. Measured: SAM 2.1 mean IoU 0.777 → 0.963, worst 0.003 → 0.922; EdgeSAM 0.633 → 0.795. Boxes and multi-point
    scribbles keep the score (multi-point SAM 2.1: score 0.966 vs stability 0.955, worst 0.921 vs 0.623).
13. Clicking a chip reuses the raster already computed for its hover preview (no second inference, identical result).
14. Person / animal chips get hair/fur edges: the matting model's alpha is used inside the SAM box mask's uncertain band.

Subject / Background / Foreground:
15. Auto Subject picks the general matting model (ISNet) when the photo's main subject is not a person; MODNet (portrait
    model) only when a person is detected.
16. Auto Subject names the mask after what it found ("Dog", "Person", "Subject").
17. Background is one click: complement of Auto Subject (no scribble needed); scribble path kept for the AI mask.
18. New Foreground mask: nearest depth layer, threshold by Otsu on the depth histogram, edges snapped to the photo.
19. Foreground/Objects tiles in the create grid with icons and tooltips.

Sky / Landscape:
20. Sky chip in Detected uses the landscape model when installed (same raster as the committed mask).
21. Sky: isolated sky blobs in the lower half that do not touch the main sky (windows, reflections) are removed.
22. Sky: small non-sky holes fully inside the sky (noise, thin cloud gaps mis-scored) are filled.
23. Landscape categories (water, vegetation, mountains, buildings, ground) get the same photo-matched edge as Sky.
24. Landscape and sky masks are guided-upsampled to the mask texture size (2048) instead of 1024 bilinear.

Quality of every AI raster:
25. AI masks (SAM, matte, landscape, foreground) stored at the 2048 mask texture size with guided upsampling.
26. Tiny speckles (< 0.02% of the frame) removed from AI masks before storing.

Performance:
27. One cached RGB copy of the photo at AI resolution shared by detect, SAM encode, matte, landscape and depth (was rebuilt
    by each).
28. Detection, SAM encode and the landscape pass are pre-warmed in the background when the Masks panel opens, so the first
    Sky / Landscape / chip click is instant.
29. Hover-preview raster cache is bounded (LRU of 8) so a busy photo cannot pin hundreds of MB.

UI:
30. Detected row shows a spinner while running and a Retry link on failure instead of silently vanishing.
31. Chips are keyboard-navigable (arrow keys) and announce "Dog 2 — preview" to screen readers.
32. Specific empty-result messages ("No sky found in this photo", "Nothing in front stands out from the background").

Added during the work:
33. Auto Subject, Background, Foreground and Landscape masks re-run on the target photo on copy/Update (Lightroom sync
    behaviour) instead of being refused as "unsupported AI".
34. Landscape category buttons preview their selection on hover, like Detected chips.
35. Every new SAM result (scribbles too, not only chips) is stored at mask texture size with the guided upsample; an
    older model-size mask that carries manual Paint/Erase keeps its size so the brush delta still lines up.

## Measurements
- Candidate choice, labelled dog set (7 photos, `tools/sam_eval/`, boxes from the outline bounds):
  | prompt | EdgeSAM score | EdgeSAM ch0 | SAM 2.1 score | SAM 2.1 stability |
  |---|---|---|---|---|
  | tight box | 0.922 | 0.923 | **0.979** | 0.976 |
  | single click | 0.633 | 0.726 | 0.777 (worst 0.003) | **0.963** (worst 0.922) |
  | 2–6 clicks | 0.825 | 0.824 | **0.966** | 0.955 |
- Zoom parity (`test/zoom_effect_parity.mjs`, 4800 px synthetic edge): before the fix a 200 % crop's halation reached
  zero 19 px from the edge vs the export's 26 px, 300 % at 9 px; 50 % spread 2× too wide. After: within resampling
  error at every zoom. Fit grain sd was 4.3 vs 1.8 for the export viewed at Fit size (2.4×), 4.23 vs 1.14 at 960 px.
- Guided upsample: 9× lower edge error than bilinear on a sub-pixel diagonal edge (unit test).

36. Auto Subject / Background build the subject from detected people and animals (SAM 2.1 boxes + agreeing matte
    edges); the whole-image matte is the fallback. Real app, 6 labelled dog photos: mean IoU 0.79 vs ISNet 0.61 and
    MODNet 0.61; the small distant dog 0.95 vs ISNet 0.00.
37. Edge matting only applies when the matte covers ≥70% of SAM's interior — a matte of a different subject erased a
    small dog chip (1459 px → 8) in the real app.
38. A click right after opening a photo waits for the in-flight SAM encode instead of failing "not ready yet".

39. Detected-chip clicks land at once with SAM's edge; the hair/fur matte edge replaces it in place a few seconds
    later (first matte on a photo took 5–10 s in the real app before the chip appeared).
- Real app (labelled set, after the fixes): Detected chip IoU 0.86–0.98 (was 0.00 before the matte gate), single
  click 0.92–0.99, Auto Subject 0.86–0.98 on single-subject photos.

## Completeness check
- Mask entry points come from the running app: the create grid (`#msk-create-grid .msk-tile` → data-kind), the Detected
  row (`#msk-scene .msk-chip`), and the Landscape row (`#msk-landscape-row button`). `test/mask_detect_objects.mjs` scans
  those lists from the DOM and fails if any entry lacks a test case.
- Every native command touched (`scene_detect`, `sam_box`, `sam2_box`, `sam_points`, `sam2_points`) is covered by cargo
  tests on its pure helpers; JS helpers by `test/unit/` tests.
- Real-app check at the end: rebuilt desktop app, a dog photo, a landscape and a people photo, each mask type created and
  screenshotted in dark theme at the default panel width.
