# RAW review recipe parity — safe renderer plan

Linked work: CHR-276, CHR-267 and CHR-269. This is remaining work, not an implementation/parity claim.

## Established boundary

Quick Look now develops sensor data through the native RAW profile pipeline. Selected preparation produces only fit-size proxies. RAW face review is being switched to the same provenance. Camera thumbnails may still be used for small Library/People browsing; they are not proof of developed review colours. Native fit preparation remains full-sensor work, so it does not yet solve cold latency or peak transient memory.

## Isolation requirement

Do not call `applyUISnapshot` on the active Editor to render another photo. It can change the current item's geometry/healing/inpaint/masks, native decode settings, DOM controls, LUT resources and asynchronous loading. Locking history and restoring a snapshot does not isolate these effects. `detailRender` currently follows this stateful pattern and is not a safe standalone Quick Look renderer. Copying live FX textures can also transfer the wrong photo's masks/depth.

## Executable sequence

1. Extract parameter resolution from `getFXParams` into a function whose explicit inputs are control values, recipe state, immutable target resources and source metadata. Preserve the live Editor wrapper and all numerical transforms. Avoid serializing heavyweight mask rasters on every live render.
2. Create a per-target render context from a saved sidecar. Load LUT/print resources without changing live selects or `fxState`. Source identity includes file signature, native RAW recipe and saved creative recipe. Capture developed full-source dimensions/orientation as well as proxy dimensions for correct effect scale and raster coordinates.
3. Give masks, depth, heal/inpaint and geometry explicit target ownership. Apply geometric transforms exactly once, and map normalized masks/native detail regions against the developed source. Missing or stale raster resources remain unavailable; never borrow the active photo's textures.
4. Reuse the renderer/cache discipline from frozen still export, with bounded offscreen outputs and stale-generation guards. Snapshot/restore transactions are not substitutes for immutable resources.
5. Replace Quick Look and Compare/Survey target rendering only after parity and isolation checks pass. Until then, distinguish developed RAW base from saved creative rendering in review UI; do not check CHR-276 pixel parity.

## Required evidence

- Editor current item, snapshot, history, native globals and texture/resource identity remain exactly unchanged before/after another target is rendered, including delayed LUT/raster work and rapid photo changes.
- Compare target outputs to Editor outputs at matched source, dimensions, colour space, recipe and effect seed. Use actual camera RAW plus saved white balance/exposure, LUT/print, local masks, crop/rotate and healing examples. Record pixel/error distributions; set the numerical tolerance from repeatability and resampling baselines before accepting parity.
- Test source/recipe/raster invalidation, cancelled asynchronous work, unavailable resources and image-count/byte cache bounds. Measure warm presentation separately from cold preparation and native 100% detail.
- Existing RAW browser mocks verify IPC and races only. Existing detail fixture PNGs stored under RAW filenames do not establish real RAW or photographic colour parity.

## Storage and usage

Reuse the single task checkout, shared Cargo/browser and canonical small RAW fixtures. No speculative model install or library-wide proxy generation. Implement and validate one dependency at a time with targeted Luna ownership; run required UI gates once for the final combined slice and preserve known failures separately.
