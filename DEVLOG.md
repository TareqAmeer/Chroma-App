

### 2026-10-05 — CHR-274 / CHR-247 mask refinement slice
- Added non-destructive Feather and signed Edge settings for AI subject/skin/coat rasters, with a cached effective selection in the shared preview/tiled-export mask texture path and exact source reset; new SAM selections clear prior settings.
- Added the visible eight-mask capacity and blocks opening the Add Mask menu at renderer capacity. Files: `chromasmith-22.html`, `package.json`, `test/mask_refinement_math.mjs`.
- Verified refinement math, editor HTML validity, and mask raster round-trip. Remaining CHR-274 work: sky/depth, compact layout and labelled quality fixtures. Remaining CHR-247 work: broader mask capabilities/composition and quality gates.

### 2026-10-05 — CHR-280 Gallery scroll anchoring
- Re-anchored the first visible photo through virtual-grid refreshes and made restoration use the current grid geometry, preventing metadata refreshes and catalog paging from jumping the gallery.
- Changed virtual-grid resize detection to observe the grid itself and remeasure missed initial column/row changes. Files: `chromasmith-22.html`, `desktop/library-ui.js`, `package.json`, `test/library_scroll_anchor.mjs`.
- Added a Chromium regression for a 719-photo gallery; verified column metrics and the same photo/viewport offset across a full grid refresh.
