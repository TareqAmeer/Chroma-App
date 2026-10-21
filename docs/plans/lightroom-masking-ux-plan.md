# Lightroom-parity masking — UI/UX plan (2026-10-20)

Complements [masking-roadmap.md](../masking-roadmap.md), which covers engine and model correctness. This plan covers only what the user sees and touches.

## Where we stand

**Already at or near parity:**
- Add, Subtract and Intersect, plus Invert, Duplicate, Duplicate inverted, Rename, Reorder, Mute and Solo.
- Six overlay styles that match Lightroom's, with adjustable opacity.
- Brush with Size, Flow, Feather, Density, Auto mask and Alt-to-erase.
- Radial and linear on-photo pins.
- Subject, Background, Sky and Depth masks, plus Colour and Luminance range masks.
- Chips for detected people, pets and sky.
- Per-mask Light, Color, Effects and Detail sliders, a tone curve and Amount.
- Mask presets, Copy to all, and Copy + re-evaluate.

**Gaps against Lightroom, ranked by how much a user notices them:**

| # | Gap | Lightroom behaviour |
|---|-----|---------------------|
| 1 | No mask shortcuts | Shift+W opens Masks, O toggles overlay, Shift+O cycles overlay styles, M/J/K/Shift+M pick tools, H hides pins, `[ ]` resizes the brush, Shift+`[ ]` changes feather |
| 2 | A mask is one flat thing, not a mask holding components | Each mask contains a list of components with their own add, subtract or intersect, so one adjustment set can use several shapes |
| 3 | Brush has one preset | A and B brush slots, a separate Erase brush with its own settings, and Shift-drag for straight lines |
| 4 | People has no per-person, per-part checklist | Person 1, Person 2… each with checkboxes for skin, brows, eyes, lips, teeth, hair, clothes, plus "create separate masks" |
| 5 | No object picker | Objects: brush or drag a box around a thing, and AI fills it |
| 6 | Range masks have no in-place eyedropper | Click or drag on the photo to sample a colour or tone, Shift-click to add samples, then a Refine slider |
| 7 | No "AI mask needs update" indicator | A warning badge plus "Update" and "Update all" after pasting or syncing |
| 8 | Eight-mask cap is invisible until you hit it | No practical cap |
| 9 | No direct invert or subtract on a mask row | Hover menu with Invert, Subtract with…, Intersect with… |
| 10 | Edge and Feather refine only appear in places | Since 15.5, Edge and Feather sliders sit on every AI component |
| 11 | No click-to-select on the photo | Clicking a pin or a painted area selects that mask |

Existing advantages to keep: Copy + re-evaluate (already more transparent than Lightroom's), skin-tone uniformity, and Cancel on the AI progress strip. Lightroom's top complaint is AI masks that quietly vanish or reset, so every AI mask should show a visible state: ready, stale or failed.

## Phases (each one is a single shippable slice)

**P1 — Shortcuts and direct manipulation** (gaps 1, 3, 11). Small change, large effect.
- Global shortcuts as listed in gap 1, shown in a shortcut cheat-sheet and in control tooltips.
- A/B and Erase brush slots, each remembering its own size, feather, flow and density. Shift-drag draws straight strokes.
- Clicking a pin or a painted area on the photo selects that mask. *(Shipped: `mskHitTest`/`mskPhotoClick` in edit-pins.js; test `test/mask_photo_click.mjs`, live click verified.)*

**P2 — Masks made of components** (gaps 2, 9). The biggest structural change.

*Status: done (derived-group model).* **Decision:** keep the flat `fxState.masks` array and the existing `composeOp`/`operandId` graph; a "component" is a mask whose operand chain leads to a root mask. Groups are derived at render time (row indent by operand depth), not stored. Why: the shared preview/export/tiled evaluator, save/load, styles, portable copy and undo all already round-trip operand IDs, so a true component array would force a migration of every consumer with no behavioural gain. **Migration:** none needed; every existing mask is a root with zero components and existing Compose-with links already are components, so rendering is byte-identical. **UI shipped:** per-row hover/focus/selected actions (Add to / Subtract from / Intersect with / Invert) that select the row then open the create menu with the new mask attached; "N of 8 masks" counter above the list. Test: `test/mask_list_controls.mjs` (row actions) and `test/mask_components.mjs`. Known limit: components still carry their own adjustment sliders (shared-adjustment container is a later option).
- Each mask becomes a container with an ordered component list, each component tagged add, subtract or intersect.
- Hovering the mask row shows Add, Subtract, Intersect and Invert. Those buttons open the existing create menu and apply the result to this mask.
- Migration: each current mask becomes one mask with one component. The current mask-to-mask "Compose with…" links become components.
- The eight-mask cap now counts masks, not components. Show it in the panel as "5 of 8".

**P3 — Sampling and refinement in place** (gaps 6, 10). *Status: done.* Colour eyedropper (click, Shift-add, chip list with removal, max 8) already existed; added drag-area sampling for Colour and Luminance, a Luminance eyedropper with sample chips (max 5) and Refine (band padding), a Colour Refine slider, and confirmed Feather/Edge (`mskRefineControls`) already render on every AI/sky raster mask. Test: `test/mask_range_sampling.mjs`.
- Range masks get an eyedropper on the photo: click to sample a point, drag to sample an area, Shift-click to add samples up to 5, and remove samples from a list.
- Every AI component shows Edge and Feather sliders. Unlike Lightroom, don't hide them when a brush is added.

**P4 — People and Objects** (gaps 4, 5). These depend on models.
- People panel lists a thumbnail chip per detected person, and each person has a part checklist. Only show parts the face parser actually provides, so unsupported parts are hidden instead of failing.
- "Create separate masks" toggle.
- Objects tool: drag a box, using the existing EdgeSAM box route, or brush, using an EdgeSAM scribble.

**P5 — AI mask state and sync** (gaps 7, 8). *Status: done.* `m.aiState` (ready/stale/failed) drives a row status dot, per-row Update and header "Update all AI masks" (re-evaluates prompted-SAM and sky masks via the Copy + re-evaluate path; desktop only). Static copy to all and Paste edit (masks) mark AI/sky masks stale on targets; Copy + re-evaluate clears the flag. Not covered: auto-detecting stale from crop/source change. **Cancel:** the native SAM call cannot be interrupted (no cancel command in `main.rs`); Cancel flags the job and discards the result when it returns (decoder calls are sub-second; the encode is the long one). A true abort needs a Rust-side cooperative flag, left undone. Test: `test/mask_ai_state.mjs`.
- Each AI mask row shows a status dot: ready, stale (photo, crop or source changed) or failed. Stale and failed rows get an Update button, and the panel header gets Update all.
- Pasting or syncing a mask to other photos marks it stale on each target rather than silently copying the old pixels.

## Process for each phase

1. Mock the surface from the real app markup, keeping every control and only changing the look (redesign-look-only rule). Follow `docs/editor-redesign-plan.md`.
2. Implement in the `src/app/18-script/masks/` section files. Before changing a function, run `app-uses.mjs` on it.
3. Run the focused checks for that phase. Run the full gates once, in the background, at the end of the phase.
4. Commit and push after each slice, and update the Linear ticket.

Housekeeping before starting P1:
- Delete or register the orphan `masks/cont-mskgroup.js.html`, which duplicates the menus.
- Move the mask operations out of `subjects-ai/confirm-reject-a-find-result.js.html`.
- Confirm that Cancel actually stops the native AI call.

## Completeness check

The list of gaps comes from scanning the running app, not from a hand-typed list:
- **Controls:** enumerate every control in the Masks panel through `read_page` on the Editor, in both themes and at every panel width (each resizer's minimum, default and maximum). Diff that list against the Lightroom feature list above. Each phase is done when its rows have a matching control in that scan.
- **Shortcuts:** dump the editor's registered keydown handlers and check every shortcut in P1 against that dump.
- **States:** for every mask type, check these states in the scan: none, creating, ready, stale, failed, muted, solo and capacity full.
- **Review:** each phase plan gets a fresh-context gap review before its implementation starts.

Sources: Adobe Lightroom Classic masking help (checked 2026-10-09 in the roadmap); fstoppers on Lightroom Classic 15.5 Edge/Feather refine and the 2026 Select Subject upgrade; lightroomkillertips on adaptive presets; Adobe Community threads on AI masks disappearing or needing updates; PhotoWorkout on DxO PhotoLab 10 masking.
