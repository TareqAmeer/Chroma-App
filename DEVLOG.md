

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

## 2026-10-05 — CHR-267 thumbnail prefetch handoff

- Coalesced boot-prefetch and mounted-card thumbnail requests by path/mtime. If boot stops waiting on a slow native IPC, it stops dispatching additional background work while the visible card can reuse the original in-flight decode.
- Added a delayed-request browser regression proving the thumbnail eventually paints from one native request. Files: `desktop/library-ui.js`, `test/library_perf.mjs` (CHR-267).
- Verification: desktop build and syntax/whitespace checks pass; hung-request and handoff browser scenarios pass. Existing Library performance suite still fails three DOM-node budget cases (8,176 > 8,000 and 6,093 > 6,000 twice); remaining cull UI, reject/grouping, warm-RAW latency targets, and 50k performance criteria remain in progress.

## 2026-10-06 — CHR-277 granular copy, styles, and preview

- Added remembered per-control and group selections for selective paste, style save, and apply; v2 manifests remain compatible with older category-based styles, and RAW decode fields re-open the current RAW when an applied recipe changes decode-time settings.
- Added searchable styles, Favorites and Recent filters, favorites and folder grouping, hover/focus preview with Escape restore and no history/recipe mutation, plus field-aware 0–100 strength blending. Crop and retouch remain opt-in when saving.
- Files: `chromasmith-22.html`, `test/editor_snap_lists_check.mjs`, `test/editor_wireframe_behaviour.mjs`, `test/selective_styles.mjs`. Verification: selective fields/legacy manifests/strength unit test; editor snapshot and HTML gates; Chromium style picker and batch paste tests pass. Library performance audit retains the existing DOM-node budget failures (8,176/8,000 at 200 photos and 6,093/6,000 at 1,000/5,000); export throughput and relaunch scope checks pass.

## 2026-10-06 — CHR-175 / CHR-233

- Added Lightroom/darktable/digiKam-informed batch rename previews and apply, including RAW+JPEG pairs, sidecars, and album path updates. Files: `desktop/library-ui.js`, `desktop/src-tauri/src/catalog.rs`, `desktop/src-tauri/src/ingest.rs`, `desktop/src-tauri/src/library.rs`, `desktop/src-tauri/src/main.rs` (CHR-175).
- Removed 19 unused Tauri command registrations after reviewing current `origin/main`; retained the OAuth callback fallback used for cold-launch handling. Audit: `docs/native-command-audit.md` (CHR-233).
- Verification: source review only; no tests or build run.

## 2026-10-06 — CHR-245 Red-eye and pet-eye correction

- Added non-destructive manual human/pet eye corrections with movable/resizable regions, per-eye selection and toggles, Lightroom-style pupil/darken controls, undo/history, session restore, selective copy/paste, preview/loupe and still export support.
- Added reviewable human eye proposals from the existing SCRFD landmarks; used the GEGL red-eye operation for human pixels and darktable's documented local channel-mixer approach for pet reflection modes. Files: `chromasmith-22.html`, `test/editor_snap_lists_check.mjs`.
- Verification: `git diff --check`, editor HTML check, and WebKit smoke passed. Chromium-dependent editor gates could not run because the Playwright Chromium executable is missing; human/pet flash fixture verification remains outstanding.


### 2026-10-06 — Publish missing app worktree changes
- Integrated CHR-245 red-eye/pet-eye and its native detector, the CHR-267 Quick Look cache/prefetch slice, applicable CHR-113/115/116/117 mobile fixes, and unpublished Windows QA fixes; preserved newer main behavior and original local work.
- Modified chromasmith-22.html, desktop/library-ui.js, desktop/src-tauri/src/{main,platform/windows,winvideothumb}.rs, design/surfaces.json and focused tests; recorded the 16-worktree audit in docs/worktree-integration-2026-10-06.md and corrected the Windows export-harness launch backend.
- Verified Windows native compilation, 30 byte-identical baseline exports, focused feature/state/drag tests, unified layout, scroll anchoring and shortcut registry; broad gates retain baseline failures and real native/flash-photo acceptance remains for user review. Promo, homepage and packaging stays local.


### 2026-10-06 — Prevent stranded feature worktrees
- Updated AGENTS.md to permit task-owned feature-branch commits and require verified publication through a clean main integration checkout, with current-main conflict resolution and relevant checks.
- Added remote-publication confirmation, explicit blocked-publication reports, and separation of unrelated drafts/promo assets; preserved the local checkout's existing instruction edits.
- Verified both instruction copies and git diff whitespace; Linear issue ID unresolved because the targeted worktree search returned unrelated tickets, so no issue was guessed or updated. Documentation-only change.
