# Handover: CHR-121 — General RAW Processing Time

## Objective

Reduce the time required to process a RAW photo from source file to a fully usable, color-correct editor image. Preserve the existing rendered color, brightness, dynamic range, detail, edit behavior, and export quality exactly.

Do not optimize by lowering RAW quality, changing the camera profile, switching to a lossy intermediate, or exporting from a reduced-resolution proxy.

## Current evidence

Measured on a 6000×4000 Panasonic RW2:

- Fresh RAW open: **10.43s** total; native RAW decode: **10.06s**.
- Batch cache of one RAW: **25.50s**; native decode/write: **24.82s**.
- Persistent full PNG reopen: previously **4.58s**.
- Native RGBA cache reopen: previously **3.41s**, because ~96MB crossed IPC and became a JS/canvas allocation.
- In-memory reopen: approximately **0.97s**.

The current cached-reopen work separates the display tier from the full-quality tier:

- Batch caching creates both a full-quality PNG and a 2560px lossless display proxy.
- The display proxy is loaded through the Tauri asset protocol.
- The editor first shows the display proxy, then asynchronously promotes the full-quality PNG.
- Latest observed persistent reopen: approximately **1.4s** to visible preview and **~2.1s** more for full-quality promotion.
- Same-session cached reopen is approximately **0.94s** before promotion.

The current remaining bottleneck is browser image decode plus first WebGL texture/FBO setup. The WebGL GPU texture path must use `crossOrigin = 'anonymous'` for Tauri asset URLs; otherwise `texImage2D` throws `SecurityError`.

## Existing implementation locations

- `desktop/library-ui.js`
  - RAW open lifecycle and `rawPerf()` timings.
  - `loadAssetImage()`.
  - Display proxy loading and prefetch maps.
  - `startFullPromotion()`.
  - Persistent cache lookup and promotion gating.
- `desktop/src-tauri/src/library.rs`
  - Full decode cache path.
  - Display proxy generation and cache path.
- `desktop/src-tauri/src/main.rs`
  - `cache_raw_decode` batch-cache command.
  - Tauri command registration.
- `chromasmith-22.html`
  - `FXR.setImage()` WebGL upload.
  - `geomCanvas()` identity-image fast path.
  - `renderPreview()` and GPU buffer allocation.
- `desktop/src-tauri/tauri.conf.json`
  - Asset protocol scope for `$HOME/**` and `/Volumes/**`.

## Required investigation

Measure each stage separately before changing code:

1. User click to handler entry.
2. Sidecar/recipe lookup.
3. Display proxy path lookup.
4. Native image decode into browser memory.
5. First WebGL texture upload.
6. First WebGL FBO/working-buffer allocation.
7. First visible frame.
8. Full-quality asset decode.
9. Full-quality texture upload and promotion.
10. Export readiness.

Use `window.__rawPerfLog` and `diagnostics/cli.py`; do not infer the bottleneck from code structure alone.

## Candidate optimizations, in priority order

1. Retain a bounded decoded display-image cache in the frontend, keyed by path + RAW recipe key + source mtime/size. Evict by memory budget, not only item count.
2. Prewarm only the next visible/navigation candidates, with one bounded worker and no contention with the active open.
3. Reuse the WebGL preview context and GPU allocations where dimensions permit instead of recreating the full working-buffer chain for every photo.
4. Separate display-size GPU resources from full-resolution export resources. Allocate full-resolution resources only when promotion, zoom, mask, or export actually requires them.
5. Investigate native decode/asset protocol scheduling and whether the display proxy can be decoded before the click without blocking the Library UI.
6. Add a tile or region cache only if measurements show that full-resolution texture upload remains the dominant cost after display-tier prewarming.

## Quality gates

Every optimization must prove:

- Full-quality export still uses the full-resolution source.
- Display proxy and full cache originate from the same finished color-managed decode.
- No change in RGB values, brightness, white balance, profile behavior, or dynamic range.
- Geometry, masks, zoom, LUTs, grain, halation, and export remain correct after promotion.
- Export is disabled or safely deferred until full-quality promotion completes.
- No stale image can be promoted after the user navigates to another photo.
- No IPC transfer of 50–100MB RGBA buffers is reintroduced.

Existing proxy comparison evidence: independently resized full PNG versus display proxy had mean absolute channel difference **0.092/255**, maximum channel difference **4/255**, and mean brightness difference **0.009**.

## Validation commands

```bash
node --check desktop/library-ui.js
git diff --check
npm run perf:test
npm run lib:test
python3 diagnostics/app_control.py stop
python3 diagnostics/app_control.py start --automation
python3 diagnostics/cli.py start --duration 30s
```

For live validation, open the same cached RAW at least three times: after relaunch, after display prewarm, and after full-quality promotion. Record the complete `window.__rawPerfLog` and verify the final WebGL source dimensions are 4000×6000 for the test image.

## Handover instruction

Work hypothesis-first. Do not make another proxy-format change until the stage timings prove format/codec cost is dominant. The target is a visible cached reopen in the low hundreds of milliseconds while preserving full-quality rendering and export. If a change improves visible time but delays or compromises full-quality readiness, it is incomplete.
