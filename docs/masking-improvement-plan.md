# Masking improvement plan — 2026-10-19

Builds on [masking-roadmap.md](masking-roadmap.md) (CHR-247 family). That file tracks what is shipped; this
one sets direction across features, accuracy and UX, informed by the research below.

## Research summary (2026-10-19)

**Competitors.** Lightroom remains the AI-selection benchmark: Subject / Sky / Background / Objects /
People with numbered Person 1/2/3 and per-part selection, plus batch copy that re-runs AI per photo.
Capture One's Magic Brush (luma/chroma-aware) and Refine Mask are praised on tangled edges (branches).
Luminar Neo leads on sky replacement. DxO PhotoLab 10 adds per-person masks and AI depth. ON1 offers
hover-to-select ("Super Select").
*Already have:* Feather/Edge on AI masks, depth range, Add/Subtract/Intersect, per-photo AI re-evaluation.
*Gaps:* per-person separation, landscape classes (water, vegetation, mountains, buildings), luma/chroma-aware
refine brush, hover-to-preview selection, text-prompted selection, true alpha matting at hair.

**Models (local, ONNX).** Verify every licence upstream before shipping.
| Need | Candidate | Licence (reported) | Notes |
|---|---|---|---|
| Hair / alpha matting, salient subject | BiRefNet (+ matting variant) | MIT | ONNX exists; CPU speed to benchmark |
| Fast point/box prompts | MobileSAM | Apache-2.0 | ~36 MB; CPU-viable |
| Point/box + video | SAM 2.1 Tiny / sam2-lite | Apache-2.0 | 117 MB / 74 MB, ~0.9 s on 6 CPU threads |
| Text-prompted / open vocab | Florence-2 | MIT | "select the red car" |
| Text-prompted detection | Grounding DINO (original) | Apache-2.0 | box → SAM |
| Concept segmentation | SAM 3 (Nov 2025) | Meta SAM licence | Likely too heavy for Intel CPU |
| Landscape semantics | SegFormer / OneFormer ADE20K | Per-checkpoint; many non-commercial | Needs licence-clean checkpoint or own training |
| Avoid | RMBG-1.4 | Non-commercial | — |

**What users want / complain about.** Halos at dark hair when exposure drops; missed strands; hard
edges showing under strong adjustments; synced people masks collapsing onto one person; AI masks
failing to sync; AI masking slowness; heavy reliance on brushing to patch AI misses.

## Track A — Accuracy

1. **Labelled quality gate first** (roadmap item 6): 30–50 fixtures (hair, foliage, glasses, backlit,
   multi-person, occluded, complex sky) scored by `test/mask_refinement_quality.mjs`; tolerances fixed
   before any model swap. Done = every model change below reports a before/after table.
2. **Alpha matting pass** — BiRefNet-matting (or SAM → trimap → matting) on the subject boundary band
   only, to kill dark-hair halos. Done = boundary-band MAE beats the current Feather/Edge on hair fixtures.
3. **Halo guard** — edge-aware decontamination (guided filter on the mask, colour-aware) when a masked
   exposure/contrast exceeds a threshold.
4. **Model bench on this Intel Mac** — MobileSAM vs EdgeSAM vs SAM 2.1 Tiny vs BiRefNet: latency, RAM,
   quality score. Pick defaults per task from data, not reputation.

## Track B — Features

1. **People: per-person + parts** — instance split (SAM per detected person), numbered Person N with
   face/body skin, hair, eyes, lips, teeth, clothes. Sync must re-match persons by position/face, not merge.
2. **Landscape masks** — sky, water, vegetation, mountains, buildings, ground from one licence-clean
   semantic model; one click per class.
3. **Text-prompted selection** — Florence-2 or Grounding DINO → box → SAM ("select the bench").
4. **Smart refine brush** — luma/chroma-aware brush (Capture One Magic Brush model) plus an "edge refine"
   brush that re-runs matting where painted.
5. **Lift the 8-mask cap** — atlas/array textures so masks scale with the renderer; per-mask opacity and
   full adjustment inventory (roadmap item 5).
6. **Robust batch/sync** — re-run AI per photo (exists), plus a per-photo result list with
   "needs review" flags when coverage changes sharply.

## Track C — UX/UI

1. **Hover-to-preview** — hovering Subject/Sky/Person N/landscape entries shows the candidate overlay
   before committing (ON1 Super Select).
2. **Auto-detect on open** — background-compute subject/people/sky/depth when a photo loads, so the
   mask menu shows "3 people, sky, water" with thumbnails and selection is instant.
3. **One-click fix-ups** — under each AI mask: "Refine edges", "Add missed area" (brush with SAM
   auto-snap), "Remove spill"; replaces the current ⋯-menu hunting.
4. **Mask list clarity** — thumbnail per mask, visible operation chips (Add/Subtract/Intersect), drag
   reorder, solo/mute inline.
5. **Overlay ergonomics** — keyboard toggle cycling Colour/On image/White-on-black; auto-show overlay
   while brushing; edge-only "marching ants" mode.
6. **Speed feedback** — progress + cancel on any model run over 300 ms; never block the slider.

## Sequencing

- **Phase 1 (foundations):** A1 quality gate, A4 model bench, C3/C4 quick UX wins.
- **Phase 2 (biggest user pain):** A2 matting + A3 halo guard, B4 smart brush, C1 hover preview.
- **Phase 3 (breadth):** B1 people, B2 landscape, C2 auto-detect, B6 sync review.
- **Phase 4 (stretch):** B3 text prompts, B5 cap lift, SAM 3 reassessment if a CPU-viable variant appears.

## Completeness check

Every mask type and entry point is listed from the running app's mask "+" menu and AI panel (scan the
DOM, not this doc); each must appear in the A1 fixture matrix and in C3/C4 UI coverage across both themes
and all panel widths. A fresh-context gap review signs off each phase.

## Progress (2026-10-19)
- CHR-297: procedural fixture harness + baseline (`test/mask_quality_synth.mjs`, `test/mask_quality_baseline.json`); real-photo labels still open.
- CHR-298: licence/size table in [masking-model-bench.md](masking-model-bench.md); measurements pending model downloads.
- CHR-299/300: quick fix-ups bar and mask-list chips + inline mute/solo shipped in the editor.
