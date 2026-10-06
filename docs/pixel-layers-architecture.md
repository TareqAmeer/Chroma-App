# Pixel layers: renderer feasibility and validation plan

**Scope:** CHR-258, architecture foundation only. No renderer, shader, schema, or UI behavior is changed by this note.

## Findings in the current editor

- `FXR` owns a single WebGL renderer and a fixed eight-slot local-mask program (`chromasmith-22.html`, `MSK_MAX`, `mskA` through `mskK`). Raster masks use eight packed channels across two RGBA textures. The shader loops over masks in order and applies their local operators to the current pixel; this is one fused local-adjustment pass, not a general stack of independently evaluated adjustment recipes.
- Local masks already carry a broad set of per-mask controls (tone/color/detail, gates, amount, mute/exclude/intersect). The common mask description is serialized by `getUISnapshot()` through `_mskToSnap`, and restore goes through `applyUISnapshot()`. Raster bytes need the dedicated mask snapshot path; a plain JSON clone is insufficient.
- `fxHistoryPush()` stores the UI snapshot and separately retains raster-mask references. A layer model must preserve this split or prove an equally safe representation for large raster data.
- `getFXParams()` builds one global recipe plus the current `masks` array. `FXR.render()` consumes it for the preview, while `renderTiled()` calls that same renderer per tile and maps each tile into global image UVs. The renderer also has neighborhood filters and deterministic global-UV grain, so a layer executor has to preserve tile halos and coordinate-based effects.
- Existing mask order has semantics: subtract/intersect can reference another slot, eraser masks are subtracted from other selections, and muted masks remain in their slot to avoid silently changing those references. A conversion that removes or renumbers masks can change pixels.

## What reference behavior implies

Capture One describes layers as an ordered stack; visibility toggles a layer, and its master opacity scales the adjustments on that layer. Its current documentation says an image can have up to 16 layers, rather than an unlimited number. A filled layer starts with a full-image mask; an empty layer starts without a mask. That is a useful interaction reference, but the current eight-mask shader slots are not evidence that eight independent adjustment layers are already supported.

The issue's “unlimited layers” criterion conflicts with the parity reference's documented finite cap. Before UI implementation, choose a product limit (16 is the directly documented reference point) or define a resource-aware limit. Keep “many editable layers” distinct from a mathematically unlimited GPU workload.

For an open-source implementation reference, Krita documents a non-destructive layer stack with filter masks attached to one layer and filter layers that affect the layers below them. This is useful evidence for separating a filter operation from its mask/compositing node. Its filter-layer semantics are not identical to Capture One's selected-layer local adjustments, so copy the separation and render-graph concept rather than claiming 1:1 behavior. darktable's documentation describes each processing module as an adjustment-like operation in an ordered pixel pipeline and its blend mask as a grayscale raster describing per-pixel effect strength. These are closer to the existing single-image processing model, and support keeping mask evaluation as shared raster/analytic mask infrastructure instead of creating another mask engine.

## Safe architecture boundary

Do not duplicate the mask engine. A versioned layer record should own a stable ID, name, enabled state, opacity, layer kind, scoped adjustment recipe, and a mask descriptor handled by the existing mask evaluator. Existing masks should migrate to legacy-compatible local-adjustment layer records without changing their order, gates, erasers, raster bytes, or pixels. Keep global adjustments outside the layer stack unless the user explicitly moves them into a layer.

The renderer needs a layer executor that evaluates a layer's scoped operations and composites the result over the accumulated image in bottom-to-top order. For a simple normal-blend layer, a testable starting equation is `mix(accumulated, adjusted, clamp(maskWeight * opacity, 0, 1))`; this is only valid when `adjusted` was evaluated from the correct layer input and in the declared working color space. It must not be implemented as a multiplier on today's mask amount: the current mask loop mutates the running pixel and does not evaluate a separate recipe per layer.

Prefer reusable ping-pong render targets and shared mask-evaluation code over readback to CPU or allocating a full-resolution canvas per layer. Define working color space, global-grade placement, neighborhood-filter inputs, and layer order before coding. An “editable merge” cannot generally preserve a nonlinear stack; define merge as either destructive bake/flatten or a documented editable approximation. Copying semantic/AI masks between photos also needs target-specific recompute semantics, while raster masks need explicit image-coordinate behavior.

**Safe code boundary for this slice:** keep the current mask shader, its eight-slot packing, and the current serialized `masks` format untouched. No single control or shader-only change can satisfy stack opacity/order while preserving preview/export behavior. A safe implementation can begin only after the versioned layer schema and render order are agreed; add runtime layer controls together with the executor and migration rather than persisting UI-only layer rows that do not render as represented.

## Implementation and regression gates

1. **Schema/migration:** version new layer data; convert every legacy mask fixture; compare old and migrated output byte-for-byte at opacity 100 with the same global settings. Confirm old sidecars and undo entries still load.
2. **Mask/opacity/order:** test empty, filled, analytic gradient, brush raster, luminance/color/depth-gated and AI masks; opacity 0/100 endpoints and fractional values; hidden layers; and two non-commuting exposure/curve layers in both orders. Verify overlay shows the effective mask and feather changes remain editable.
3. **State operations:** add, delete, reorder, rename, duplicate, visibility, copy to another photo, undo/redo, snapshot/version, selective copy/paste, and style save/restore. Preserve stable mask references through mute, reorder, and duplication.
4. **Render parity:** compare preview, 1:1 loupe, full export, and tiled export; exercise tile edges with feathered/blurred masks and verify deterministic grain has no seams. Cover HDR/intermediate paths and confirm no GLSL compile/link diagnostics.
5. **Performance:** benchmark a declared machine/GPU on 45 MP with 1, 8, and 10 or the selected maximum layer count. Record preview frame time, export time, GPU memory, and tile size. Reject designs that scale to one full-frame allocation/readback per layer.

## Reference sources

- [Capture One: Overview of Layers and Masks](https://support.captureone.com/hc/en-us/articles/360002601658-Overview-of-Layers-and-Masks) — ordered layers, editable mask types, opacity, and the documented 16-layer limit.
- [Capture One: Opacity slider effect in the Layers tool](https://support.captureone.com/hc/en-us/articles/360002615497-Opacity-slider-effect-in-the-Layers-tool) — opacity applies to all adjustments on the selected layer.
- [Capture One: Selecting Layer types](https://support.captureone.com/hc/en-us/articles/360002622378-Selecting-Layer-types) — empty and filled adjustment-layer behavior.
- [Capture One: Working with multiple Layers](https://support.captureone.com/hc/en-us/articles/360002615097-Working-with-multiple-Layers) — stack visibility and current layer-count guidance.
- [Krita Manual: Layers and Masks](https://docs.krita.org/en/user_manual/layers_and_masks.html) — open-source non-destructive stack, attached filter masks, and composited output.
- [Krita Manual: Basic Concepts](https://docs.krita.org/en/user_manual/getting_started/basic_concepts.html) — filter-layer scope and grayscale transparency masks.
- [darktable Manual: Raster masks](https://docs.darktable.org/usermanual/4.2/en/darkroom/masking-and-blending/masks/raster/) — grayscale raster weight for a module's effect.
- [darktable Manual: pixel pipeline and blending](https://docs.darktable.org/usermanual/development/en/darkroom/masking-and-blending/) — per-module blend/mask behavior in the ordered processing pipeline.
- [Krita source repository](https://invent.kde.org/graphics/krita) — open-source implementation reference; this slice does not copy source code or add a dependency.

## Current readiness

This ticket is a multi-stage renderer and persistence project, not a safe isolated shader slice. This note is the feasibility/test foundation only; no layer stack, migration, UI operation, or 45 MP performance claim is implemented. The export harness baseline could not launch because Playwright's Chromium executable is absent in this worktree; no browser was installed to avoid an unbounded download/build footprint.
