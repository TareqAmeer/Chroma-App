# The four tabs

(moved from CLAUDE.md §4, 2026-09-11)

- **Effects & Export** — load image, pick an **Input profile** (Standard or **V-Log (Lumix)** —
  converts V-Log/V-Gamut→Rec.709 before the look LUT), a preset/LUT, a **Print profile**
  (Kodak/Fuji print, applied as a 2nd 3D LUT AFTER the film look + halation), basic
  adjustments, **Tone Curves** (master+R/G/B point-curve editor), **Color Mixer** (8-band HSL),
  **Local Adjustments** (up to 8 masks — radial/linear/brush/sky/AI plus shapeless **Colour Range**
  and **Luminance Range**; each carries Amount, Texture, an optional **Skin Tone** colour-range gate
  + uniformity (docs/skin-tone.md), a live thumbnail, and can be reordered/renamed/muted/soloed; raster (brush/
  sky/AI) masks store at up to 2048px and have an edge-aware **Refine** button — a guided filter
  that snaps their edges to the photo's own boundaries), grain/**Film Artifacts** (dust/scratches/
  light leak + Reshuffle)/halation (incl. **No remjet** strong mode)/bloom/vignette/
  borders, **Canvas** (aspect-ratio matte around image+borders — ratio chips/zoom/bg color or
  blurred-photo fill via `canvasCompose()`, shared by preview & export; order: photo → borders
  → canvas), crop/rotate/straighten, export at full res. Plus: one-tap Looks gallery, WB
  eyedropper, auto-enhance, undo/redo (⌘Z/⌘Y, covers geometry, curves, HSL and masks too),
  split before/after, live histogram, zoom/pan, 1:1 loupe, session save, EXIF readout, batch
  export with progress + cancel.
  - **Multi-photo batches**: dropping several images loads them all into `fxImages[]`; a
    **filmstrip** of thumbnails appears below the preview (`buildFilmstrip()`/`fxSelectImage()`) so
    you can click any loaded photo to preview/crop/rotate it (`fxCurIdx` — NOT always index 0;
    `curItem()`/`curGeom()` follow it). Effects/adjustments apply to every photo identically
    (shared `fxState`/sliders); geometry (crop/rotate/flip/straighten) is also shared across the
    batch, broadcast from whichever photo is currently selected (`broadcastGeom()` reads
    `curItem()`, not `fxImages[0]` — a photo-specific edit must propagate from the photo actually
    being edited). An **All photos / Current photo** export-scope toggle appears once >1 photo is
    loaded (`fxExportScope`).
  - **Mobile (≤700px) is app-shaped, not web-shaped**: the photo fills the screen; tapping a
    tool icon slides up a bottom sheet (`body.sheet-open`, 42vh — ⚠️ Chrome will NOT
    interpolate a height transition from 0 to `min()`/`calc()`, use a plain length +
    `max-height` cap) and `fxPreviewMaxH()` measures the LIVE wrap for re-fits. Global
    `user-select:none` (inputs exempt), tabs hidden behind the ⋯ action-bar sheet
    (`fxMoreMenu`), big ＋ empty state (`fxPickPhotos`), `toast()` pills, slider value
    bubbles + double-tap-to-reset, swipe-to-switch photos, long-press-to-compare, dbl-tap
    zoom, export overlay (`_expOverlay`), looks gallery relocated to a horizontal preset
    rail under the preview (`relocatePreviewTools`). Haptics via `hapt()` (native-gated).
  - ⚠️ **`exportFX()`'s Phase-1 render loop wraps EACH photo in its own try/catch.** Before this,
    one bad/oversized/corrupt photo mid-batch threw out of the loop straight to the outer catch —
    every photo rendered *before* it was silently discarded (`saveFiles` never ran) with only an
    error logged, so a batch export could "lose" photos with no obvious cause. Now a per-photo
    failure is logged and skipped; the rest of the batch (and anything already rendered) still
    saves. The final `updateWork()/renderPreview()` preview-refresh call is *also* separately
    try/caught, so a failure restoring the on-screen preview after export can never be confused
    with (or mask) a real export failure.
- **Match & Refine** — before/after pair → fits a `.cube` LUT empirically (no model
  assumptions). Optional starting `.cube`/`.xmp`. Emits a per-colour HSL summary.
- **Colour Copy** — per-channel histogram match from a reference image → `.cube`/`.xmp`.
- **Collage** (`#panel-collage`, all `cl*` functions, state in the `CL` object) — combine several
  photos into one image. Sections (`data-clsec`, side nav built from `CL_SECTIONS`): **Photos** (drop/add
  to a tray; drag onto a slot to place, between slots to swap) → **Canvas size** (`CL_ASPECTS`: 1:1,
  4:5, 5:4, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9) → **Layout** (`clTemplates(n)`: for n photos always a
  horizontal strip + vertical stack, plus hand-built arrangements for 2–6 and an auto grid above 6;
  layouts are trees of rows/columns, and the dividers between cells are draggable) → **Borders &
  background** (colour + `CL_SWATCHES`, spacing, outer margin, corner radius — all stored as
  thousandths of the short side so preview and export scale identically) → **Selected photo** (zoom
  100–400%, drag to reframe, Replace / Reset / Clear slot) → **Export** (long side 1600–4000px,
  Shuffle, Start over).
  - ⚠️ Collage is **2D canvas only — photos are placed as loaded, with no look/grain/grade applied**.
    It does not go through `FXR`. To collage graded photos, export them from Effects first.
  - Preview and export share one geometry: `clLayoutRects()` + the same cover-scale/clamped-offset
    maths, so what you frame is what exports.
  - ⚠️ `clExport()` saves via a plain `<a download>` JPEG (q 0.95), **not** `capShareFiles()` — unlike
    the Effects export it has no native share-sheet path, so it may not save inside the iOS shell.
    Unverified; flagged, not fixed.
- **Guide** — in-app how-to + FAQ (mirrors the README).
