

### 2026-10-05 — CHR-274 / CHR-247 mask refinement slice
- Added non-destructive Feather and signed Edge settings for AI subject/skin/coat rasters, with a cached effective selection in the shared preview/tiled-export mask texture path and exact source reset; new SAM selections clear prior settings.
- Added the visible eight-mask capacity and blocks opening the Add Mask menu at renderer capacity. Files: `chromasmith-22.html`, `package.json`, `test/mask_refinement_math.mjs`.
- Verified refinement math, editor HTML validity, and mask raster round-trip. Remaining CHR-274 work: sky/depth, compact layout and labelled quality fixtures. Remaining CHR-247 work: broader mask capabilities/composition and quality gates.

### 2026-10-05 — CHR-280 Gallery scroll anchoring
- Re-anchored the first visible photo through virtual-grid refreshes and made restoration use the current grid geometry, preventing metadata refreshes and catalog paging from jumping the gallery.
- Changed virtual-grid resize detection to observe the grid itself and remeasure missed initial column/row changes. Files: `chromasmith-22.html`, `desktop/library-ui.js`, `package.json`, `test/library_scroll_anchor.mjs`.
- Added a Chromium regression for a 719-photo gallery; verified column metrics and the same photo/viewport offset across a full grid refresh.
## 2026-10-05 — CHR-276 unified Library + Editor view (layout slice)

- Added an optional, persisted Library + Editor workspace with an adjustable near-50/50 divider; Standard view remains the default, and opening a Library photo keeps both panes visible.
- Added the Settings toggle, keyboard-operable divider, saved pane width, and a Chromium regression covering default mode, pane coexistence, photo selection, resizing, and reload restoration. Files: `chromasmith-22.html`, `desktop/library-ui.js`, `package.json`, `test/library_unified_view.mjs` (CHR-276).
- Verification: desktop bundle build and targeted Chromium test pass. Existing `ui:test` retains two known audit failures (tap target and contrast); `editor:gates` and `lib:test` are blocked by Playwright resolution in the isolated worktree, with other existing baseline gate failures. Full R16 acceptance remains in progress.
