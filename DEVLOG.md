

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

## 2026-10-06 — CHR-275 temporary brush erase

- Added Lightroom Classic-style Alt/Option-drag erasing during mask brush painting, with live eraser cursor feedback; persistent Erase mode remains available.
- Scoped the modifier to brush painting so AI scribble exclusion and color-range sampling retain their existing Alt behavior. Files: `chromasmith-22.html`, `test/mask_raster.mjs`.
- Added raster regression checks for temporary erase and persistent Erase mode. `node --check test/mask_raster.mjs`, editor HTML validity, and `git diff --check` pass; browser raster test is blocked because the Playwright Chromium executable is missing.
- Published in integration commit `243829061138566e0b0f499e225ac44fab676fdc`; `git ls-remote origin refs/heads/main` confirmed the same hash. Re-ran `node test/mask_raster.mjs` on main (24/24 PASS).

## 2026-10-06 — CHR-278 Recursive folder view

- Migrated the old global Include Subfolders preference into a legacy default plus per-volume/folder overrides; folder navigation now applies its saved recursive scope before querying the catalog.
- Added visible recursive status/count wording and `test/library_recursive_folders.mjs`; files: `desktop/library-ui.js`, `test/library_recursive_folders.mjs`, `DEVLOG.md`.
- Verified JavaScript syntax, focused Chromium preference/query/status flow, and `git diff --check`; 50k catalog performance remains covered by catalog paging and needs a dedicated large-fixture measurement before claiming that criterion.
- Published in integration commit `243829061138566e0b0f499e225ac44fab676fdc`; `git ls-remote origin refs/heads/main` confirmed the same hash. Focused Chromium regression and Library content lint passed on main.

- CHR-275 follow-up: published interrupted-stroke cleanup in `51bacef4` (feature commit `b51f55bb`); clears held erase/cursor state on blur, visibility changes, paint-mode exit and pointer cancellation. Modifier rebinding remains open because the shortcut registry lacks modifier-only hold actions; Chromium run remains unavailable.
- CHR-250: published the source-derived format and profile inventory in `d0f2ea9c`; `git ls-remote origin refs/heads/main` confirmed publication. `npm run lint:formats` passes; camera sample decoding remains explicitly unknown, and focused Rust decoder-table execution is blocked by missing Windows build assets/locked Cargo artifacts.

## 2026-10-06 — CHR-205 verified catalog snapshot primitive

- Added a versioned catalog snapshot directory using rusqlite's SQLite Online Backup API, with manifest version/schema/photo count, BLAKE3 checksum, integrity and foreign-key verification, staging, and atomic same-parent publication.
- Scope explicitly excludes originals and regenerated caches; this is catalog-only and does not capture sidecars, preferences, other stores, or implement restore/activation. Files: `desktop/src-tauri/src/catalog_backup.rs`, `desktop/src-tauri/src/main.rs`, `desktop/src-tauri/Cargo.toml`.
- Added focused WAL snapshot, verification, destination-collision, and corruption tests (`cargo test --manifest-path desktop/src-tauri/Cargo.toml --bin chromasmith catalog_backup::tests`: 2 passed). Lightroom's documented catalog-only backup policy and SQLite's official online backup API inform the design; full backup/restore acceptance remains outstanding.
- CHR-205 snapshot primitive integrated as `234080d5`; feature commit `1e53e1c6` remains task-scoped. The branch's focused tests passed 2/2; on the integrated checkout, rerun was blocked by the existing Windows `onig_sys` C toolchain build failure. Focused `rustfmt --check desktop/src-tauri/src/catalog_backup.rs` and `git diff --check` pass.
- Remote verification hashes: CHR-275 and CHR-250 are contained in `origin/main` commit `21a11eea030847bae332199df431f22d666a765b`; CHR-205 is contained in `origin/main` commit `7515a979fa1aed05037410bd30ec454c1f44189a`.
- CHR-268 Survey slice published in integration commit `ffd7a9d7d04b8ce2f6bc57403a48a7b75af68d8a` after rebasing over concurrent People/Pets commits; focused Survey browser regression, source/test syntax, Library content lint, and whitespace checks pass on the integrated tree. `git ls-remote origin refs/heads/main` confirmed the same hash.
### 2026-10-06 — CHR-208 saved import metadata recipes (first slice)
- Added named local recipes for the existing folder/name/sequence options plus creator, copyright, caption, job/project ID, and keywords. Ingest applies only non-empty IPTC/XMP fields, merges recipe keywords with the copied sidecar, preserves unknown XMP, and carries matching sidecars into both the primary and optional second copy; duplicate skipping and selected-file filtering remain in the same ingest path.
- Updated `desktop/library-ui.js`, `desktop/src-tauri/src/ingest.rs`, `desktop/src-tauri/src/library.rs`, and added `test/import_recipes.mjs`; Rust fixture coverage checks escaped fields, existing keywords, an unknown Camera Raw field, the second copy, and duplicate skipping.
- Verified `node --check desktop/library-ui.js`, `node test/import_recipes.mjs`, and `cargo test import_recipe_metadata_merges_xmp_and_keeps_duplicate_and_backup_rules`. Follows Lightroom's Apply During Import metadata-preset pattern and Photo Mechanic's optional IPTC ingest template ([Lightroom](https://helpx.adobe.com/in/lightroom-classic/desktop/import-photos/photo-video-import-options.html), [Photo Mechanic](https://camerabits.freshdesk.com/support/solutions/articles/48000207409-ingesting-photos)); Job ID maps to IPTC Core's `photoshop:TransmissionReference` ([IPTC](https://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2023.1.html)). Remaining CHR-208 work: starting editor-recipe application, a metadata/naming preflight summary, selectable location export policy, and mixed-format export round-trip validation.
- CHR-208 integrated as `26d7d60e`; focused recipe browser regression, Library content lint, JavaScript checks, whitespace checks, and the integrated Rust ingest regression (1/1) pass. Remote verification: `origin/main` at `26d7d60eb3eb3f3215ef34bffa2ebec69ebeeeff` contains feature commit `c15a2e72`. Rust `cargo fmt --check` remains noisy from pre-existing formatting differences across the touched Rust files; no broad reformat was applied.

## 2026-10-06 — CHR-265 Compact and Comfortable density (first slice)
- Added token-source semantic gaps for Comfortable (8px control stack / 20px panel sections) and Compact (4px / 12px), regenerated HTML tokens, and wired a persisted shared Appearance choice into Editor spacing plus Library filter/sidebar spacing. Compact retains a 28px minimum Library tree target. Capture One's documented “Icons Only (Compact)” tool-tab option informed the compact-versus-comfortable choice; values remain app tokens rather than copied product measurements.
- Files: design/tokens.json, tools/scripts/token-layout.json, generated chromasmith-22.html, desktop/library-ui.js, test/editor_density_check.mjs. Focused browser density/persistence test, token gates, JS syntax, and whitespace checks pass. Comfortable was selected as default after reviewing same-size two-mode screenshots of the Editor Look panel only.
- Gate status: npm run editor:gates has the same 10 baseline failures after changes (inventory, responsive, wireframe-diff, token-check, icon-check, motion-token-check, hover-focus-matrix, surface-coverage, components-check, catalog-visual); forced-colors check passes. UI audit findings observed: MENU 2→0, TAP 5→1, CONTRAST remains 1, PARITY 5→0 (count change is recorded without attributing unrelated categories to spacing edits). Library flows pass; responsive QA reports 5 search-floor/export-clip findings. Remaining: all-panel screenshots attached to Linear, full theme × density × breakpoint coverage, and complete Library side-panel rollout/review.
- Publication verification: CHR-265 feature commit `f3b4b1c1b7da3373d18e22596c4c40aee0fea39f` is contained in `origin/main` at `64c7e09706fd38276f74d0f364724f923c31a65e`; `git ls-remote origin refs/heads/main` matched after push. Integrated token gates, Library flows, JS syntax, and whitespace checks pass. Integrated browser runs could not launch because this checkout lacks the Playwright Chromium executable; the named feature worktree's focused browser test passed. HTML validation helper invocation was unavailable at the attempted path.
## 2026-10-06 — CHR-209 desktop install and release foundations
- Added streamed SHA-256 checksum sidecars to the macOS DMG and Windows x64 installer artifacts; release uploads publish both files and GitHub-generated change notes accompany the platform installation guidance.
- Added a desktop install, manual-update, local-model disk-space, checksum, and recovery guide; linked it from the Windows and Mac download rows and removed the unmeasured installer-size claim. Files: .github/workflows/desktop-release.yml, README.md, docs/desktop-install-and-update.md, tools/scripts/write-sha256.mjs.
- Verified helper syntax and checksum output against Windows Get-FileHash, parsed the release workflow YAML, and passed git diff --check. Signing/notarization, Apple Silicon-native packaging, in-app updates, clean-machine upgrade fixtures, and exact installed-size measurements remain incomplete pending credentials and native validation.
- Publication verification: feature commit `02e7f87a0e28085db8c3d60c15cf18694f648a2b` is contained in `origin/main` at `19da0f7e8c987374fc649e015e6dc39b090aa3f9`; `git ls-remote origin refs/heads/main` matched after push. Publication record is committed separately after verification; Linear remains In Review for signing, native packaging, auto-update, and clean-machine upgrade validation.
### 2026-10-06 — CHR-195 actionable first edit
- Replaced the passive welcome tour with actions for opening a local photo, browsing the existing desktop Gallery, and loading the bundled sample. The guide advances on successful photo load, applied look, visible original compare, and successful export; it is skippable/replayable, describes Google Photos as optional, and exposes advanced tools by explicit choice instead of export.
- Reused the existing picker, Gallery empty-state folder action, and export reveal pill; followed digiKam’s credited first-run welcome-image pattern ([source](https://www.digikam.org/contribute/splashscreens/)). Kept the sample credit (“Photo by Tareq Ameer”) visible and documented that the bundled WebP has no separate image-license metadata; no broader license is claimed. Files: `chromasmith-22.html`, `docs/onboarding-sample.md`, `test/onboarding_first_edit.mjs`.
- Focused Playwright onboarding coverage passes for open/folder/sample routes, edit-step progression, advanced-tab visibility, export reveal, sample-source immutability, and dark/light laptop dialog fit. `npm run editor:fast-check`, `node --check test/onboarding_first_edit.mjs`, and `git diff --check` pass. Native Tauri picker/export reveal remain unverified in this browser harness; broader first-run native/profile validation remains open.
- Publication verification: CHR-195 feature commit `210d85d782e5bd1c0be325e13756c15a1e500996` is contained in `origin/main` at `5084e9ef0b8b564cc070ceebc73d60a33b5a9f98`; `git ls-remote origin refs/heads/main` matched after push. Integrated JS syntax and whitespace checks pass; browser/Editor fast checks could not launch because the clean integration checkout lacks Playwright Chromium (the feature-worktree focused tests passed).

## 2026-10-06 — CHR-269 face close-up review (bounded slice)
- Added a dedicated single-photo Faces close-ups contact sheet in the Library, reusing the existing catalog face boxes and cached 360px face crops; the existing People editor retains its stack-wide tagging behavior. The new panel is manual review only and explicitly says eye openness and face sharpness are not scored.
- Files: `desktop/library-ui.js`, `test/library_assisted_culling.mjs`. The focused browser regression verifies every mock face appears, the photo query is scoped with `stack:false`, and the People editor still uses `stack:true`.
- Focused Playwright regression, `node --check desktop/library-ui.js`, `npm run lint:library-content`, `node test/library_flows.mjs`, and `git diff --check` pass. Product patterns reviewed in [RapidRAW's culling documentation](https://www.getrapidraw.com/docs/interface/library-view) and [Adobe's Lightroom Classic release notes](https://helpx.adobe.com/ie/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html); no RapidRAW source code was copied (its repository is AGPL-3.0). Closed-eye/expression inference, blur-quality validation, culling ranking, durable jobs, labeled precision/recall, and bulk confirmation remain incomplete pending suitable model/data and broader work.
- Publication verification: CHR-269 feature commit `7527d254abdd18f421ca671ac00a13aba54a6da7` is contained in `origin/main` at `fbbb8af83179d00f233541b0927abced5da54d59`; `git ls-remote origin refs/heads/main` matched after push. Integrated Library syntax/content lint and whitespace checks pass; the feature worktree's face-panel and four Library flow browser regressions pass. Integrated browser rerun was unavailable because the clean checkout lacks Playwright Chromium.
## 2026-10-06 — CHR-246 Heal/Clone determinism (first slice)
- Preserved a Feather value of 0 in new retouch recipes and render it as a crisp circular spot mask; preview and export continue through the same `healApply` → `geomCanvas` path.
- Resolve automatic donor sampling into the existing normalized per-spot source fields on first render, so preview-size changes and export reuse the same location. Used GIMP's documented source/destination Heal model and darktable's per-shape opacity/retouch conventions as behavior references ([GIMP Heal](https://developer.gimp.org/api/3.0/libgimp/func.heal.html), [darktable retouch](https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/retouch.md)). Files: `chromasmith-22.html`, `test/heal_recipe_regression.mjs`.
- Focused browser regression verifies zero Feather, hard-edge cloning, normalized donor locking across raster sizes, recipe snapshot and session serialization; existing heal quality and undo/redo/geometry probes pass. Editor HTML validity and `git diff --check` pass. Snapshot-list browser gate could not run because this fresh worktree has no generated `desktop/dist/index.html`; AI inpainting, editable operation lists/handles, brush-drawn spots, reviewed sensor-dust sync, and 100% real-image acceptance remain open.
- Publication verification: CHR-246 feature commit `2b722ab8fbe045649be9948b21f09c090281af2a` is contained in `origin/main` at `70108b9a61d14dc056ad0c810b326a05b43fbc3f`; `git ls-remote origin refs/heads/main` matched after push. Integrated HTML validity, test syntax, and whitespace checks pass; focused Playwright rerun could not launch because the clean checkout lacks Chromium (feature-worktree regression passed).
## 2026-10-06 — CHR-263 inpainting model decision (research slice)
- Recorded a provisional hold on remote generation, bundling/distributing models, and in-app generative inpainting until a prompt-capable artifact, locality/privacy, hardware/storage, and candidate-persistence contract are reviewed.
- Added sourced distinctions between erase and diffusion model families, a re-entry checklist, and a non-legal-summary note in `docs/ai-inpainting-model-decision.md` and `LICENSES-MODELS.md`.
- Verification: reviewed all six cited primary project/model pages and ran `git diff --check`; model selection, legal review, implementation, and product acceptance remain open.
