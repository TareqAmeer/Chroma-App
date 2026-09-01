# Root Cause Investigation Report: UI/UX Bugs, State Handling, and Biometric AI Architecture

## 1. Executive Summary

This investigation provides a comprehensive diagnostic analysis of four critical system areas in the Chromasmith architecture:
1. **Status Bar Progress Calculation (Stuck at 0%)**: Analysis of why the UI activity indicator and status readout fail to reflect real-time background progress during scanning, indexing, and thumbnail operations.
2. **Tag Editor & Popover Layout/Positioning**: Examination of DOM placement, viewport positioning, and CSS rules causing the Info/Tag panel and popovers to render as detached absolute overlays rather than docked sidebar elements.
3. **Multi-Select & Batch Tagging State Flow**: Trace of selection state arrays (`state.selected`) vs. single-photo focus (`state.openedPath` / `state._kbCursor`), identifying structural gaps where batch tag edits fail to propagate across multi-photo selections.
4. **Biometric Identity Recognition Pipeline (DogFaceNet & SigLIP)**: Evaluation of the Rust ONNX runtime architecture (`clip.rs`, `scrfd.rs`, `arcface.rs`, `catalog.rs`) to establish a two-stage biometric pipeline (SigLIP zero-shot classification trigger $\rightarrow$ DogFaceNet biometric embedding generation) for animal identity recognition.

---

## 2. Analysis of Why Previous Fixes Failed

Prior maintenance attempts focused on adjusting timer constants, increasing prefetch budgets, or adding watchdog fallback triggers. These fixes failed to resolve the core defects for the following technical reasons:

* **Prefetch Budget Adjustments (`PREFETCH_BUDGET_MS`)**:
  - *Attempt*: Increased thumbnail prefetch timeout budget to allow slow background batches to complete.
  - *Failure Reason*: Prefetch timers control network/disk batch timeouts in `library-ui.js` (`_thumbPump`), but do not fix the fundamental IPC payload mismatch or the calculation logic in `activityFrac()`. When `total = 0` is emitted during initial phase passes (e.g., directory walk or uncounted worker passes), adjusting prefetch timers leaves `done / total` evaluating to `0 / 0` (`0%`).

* **Watchdog / Splash Screen Fallbacks (`bumpBootSplashWatchdog`, `chromasmithForceLibraryReady`)**:
  - *Attempt*: Added watchdog timers to forcibly hide the boot splash screen and unblock the UI if catalog scanning takes too long.
  - *Failure Reason*: Watchdog triggers force UI visibility state mutations asynchronously, but do not address the missing IPC progress events from background tasks (such as `thumbnail_run`, `clip_embed_run`, or `ingest_progress`). The status bar relies on real-time event streams; unblocking the window frame leaves the underlying event listener receiving unpopulated or reset progress structs.

* **Progress Event Rate Throttling & Mutex Locks**:
  - *Attempt*: Added progress emission locks or attempt to report per-item progress inside parallel iterator closures.
  - *Failure Reason*: In Rust, `dyn FnMut(ScanProgress)` callbacks inside Rayon `par_iter()` loops lack `Send`/`Sync` bounds. Wrapping progress in local mutexes or suppressing progress events to avoid thread contention caused sub-phases to report progress only once at batch boundaries (e.g., `done = 0` at start, `done = N` at end), causing the UI progress bar to remain stuck at `0%` throughout 99% of the execution time.

---

## 3. Primary & Secondary Root Causes

### 3.1 Status Bar Progress Calculation (Stuck at 0%)

#### Primary Root Causes
1. **Zero-Total Calculation Guard in `activityFrac()` (`library-ui.js`)**:
   - In `library-ui.js:5642`:
     ```javascript
     function activityFrac() {
       if (activity.kind === 'import' && activity.total) return activity.done / activity.total;
       if (activity.total) return activity.done / activity.total;
       return 0;
     }
     ```
     During initial phase transitions (e.g., directory enumeration `walk` in `catalog.rs`), `ScanProgress` is emitted with `total: 0`. Because `activity.total` evaluates to `0` (falsy), `activityFrac()` returns `0`, forcing `pct = Math.round(0 * 100) = 0%`.
2. **Phase Reset Asymmetry in Sequential Scanning Pipeline**:
   - Multi-stage operations (`scan_run` $\rightarrow$ `metadata_run` $\rightarrow$ `sidecar_run` $\rightarrow$ `hash_run` $\rightarrow$ `clip_embed_run`) emit independent `ScanProgress` structs. Each phase resets `done` to `0` and recalculates `total` for that specific phase only.
   - When transitioning between phases, `done` resets to `0` while `total` represents only the sub-batch count, creating repeated drop-backs to `0%` across long multi-stage background tasks.

#### Secondary Contributing Causes
1. **Mismatched Ingest Event Payload Schema**:
   - In `ingest.rs:314`, `ScanProgress` is defined with fields `{ scanned: usize, current: String }`, omitting `phase`, `done`, and `total`.
   - When `ingest-progress` events arrive in `library-ui.js:5816`:
     ```javascript
     window.__TAURI__.event.listen('ingest-progress', (ev) => {
       const p = ev.payload || {};
       const done = p.total && p.done >= p.total ? p.total : p.done;
       activityUpdate('import', { stage: p.total && done >= p.total ? 'done' : 'copy', done, total: p.total || 0, current: p.current || '' });
     });
     ```
     `p.done` and `p.total` resolve to `undefined` (defaulting to `0`), causing the import progress readout to display `0 / 0` (`0%`).
2. **Background Operations Unlinked from Shared Activity Pill**:
   - Independent background routines (`thumbnail_run`, `focus_run`, background AI indexing) do not continuously emit `catalog-scan` or `job-progress` IPC events during background background execution, or their JS caller fails to invoke `libActivityJob(job, patch)`. Consequently, the bottom status bar (`#lib-activity`) receives no events and remains hidden or zeroed.

---

### 3.2 Tag Editor & Popover Positioning

#### Primary Root Causes
1. **Detached Absolute DOM Mounting (`library-ui.js`)**:
   - In `library-ui.js:3959-3970`, `renderInfoPanel()` creates `#lib-info` dynamically and appends it to `#lib-main` or `document.body` with hardcoded absolute inline styling:
     ```javascript
     el.style.cssText = 'position:absolute;right:12px;top:56px;width:232px;z-index:38;padding:10px 12px;...';
     ```
   - `#lib-info` is not embedded as a flex block inside the right-hand sidebar DOM tree (below camera metadata). Instead, it floats independently at fixed viewport offsets (`right: 12px; top: 56px`).
2. **Static Viewport Coordinates vs. Dynamic Bounding Anchors**:
   - General popovers (`.lib-act-pop`, `#lib-filters-pop`, context menus) rely on hardcoded CSS positioning (`right: 0` or absolute pixel offsets) rather than dynamically recalculating positions relative to target scroll containers or anchor elements via `getBoundingClientRect()`.
   - As `#lib-main` scrolls, absolute overlays maintaining static container offsets float disconnected from the selected grid cards.

#### Secondary Contributing Causes
1. **CSS Z-Index & Container Scope Collisions**:
   - Appending `#lib-info` to `#lib-main` subjects the panel to `#lib-main`'s overflow clipping (`overflow-y: auto`) and stacking context (`z-index: 38`), causing popover truncation when scrolling long photo grids.
2. **Dual-View Layout Divergence (Library View vs. Single Photo Editor View)**:
   - Single Photo Editor View (`#fx-overlay` / `chromasmith-22.html`) uses a separate sidebar column structure (`#fx-sidebar`) that does not share DOM nodes with Library View's `#lib-info`. As a result, opening the Info panel in Single Photo Editor View spawns the same floating overlay `#lib-info` over the editing canvas instead of populating the editor's tool panel.

---

### 3.3 Multi-Select & Batch Tagging State Flow

#### Primary Root Causes
1. **Single-Path Bias in Info Panel Rendering (`renderInfoPanel`)**:
   - In `library-ui.js:3952`:
     ```javascript
     const path = state._kbCursor || state.openedPath
       || (state.selected.size ? [...state.selected][0] : null);
     ```
   - When multiple photos are selected (e.g., `state.selected.size = 5`), `renderInfoPanel()` extracts only the first path (`[...state.selected][0]`).
   - Tag addition (`addKeywordToPhoto(path, v)`) and tag removal (`removeKeywordFromPhoto(path, kw)`) accept a single `path` string and issue IPC calls (`invoke('set_keywords', { path, keywords })`) for that single photo only, completely ignoring the remaining items in `state.selected`.

#### Secondary Contributing Causes
1. **Lack of Multi-Selection Keyword Intersection/Union State**:
   - `renderInfoPanel()` reads keywords from a single sidecar entry (`state.sidecars.get(path)`). It does not compute the union or intersection (mixed state / indicator) across all paths in `state.selected`.
2. **IPC Endpoint Granularity (`set_keywords`)**:
   - The Tauri IPC invocation in `library.rs` (`set_keywords`) takes a single photo `path: String`. There is no dedicated batch IPC endpoint (e.g. `batch_set_keywords(paths: Vec<String>, add: Vec<String>, remove: Vec<String>)`), requiring front-end code to issue sequential single-photo IPC calls or `Promise.all` wrappers.

---

### 3.4 Biometric Identity Recognition Pipeline (DogFaceNet & SigLIP)

#### Architecture Overview
The existing AI stack in Rust (`src-tauri/src/`) consists of:
* `clip.rs`: SigLIP ViT image/text encoder (256x256 RGB input, `[0.5, 0.5, 0.5]` normalization, SentencePiece tokenizer, Sigmoid output scoring) for zero-shot photo tagging and semantic search.
* `scrfd.rs`: SCRFD face detector for locating human faces and facial landmarks (KPS).
* `arcface.rs`: ArcFace ONNX model for generating 512-dim normalized feature vectors for human face recognition, stored in `photo_faces`.

#### Technical Pipeline for Pet Biometrics ("DogFaceNet")

```
┌──────────────────────────┐
│  Decoded RGB Image       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐      Tag: "dog" / "cat"
│  SigLIP (clip.rs)        │ ───────────────────────────┐
│  Zero-Shot Tagging       │  (Sigmoid Score > 0.5)     │
└──────────────────────────┘                            │
                                                        ▼
                                       ┌──────────────────────────────────┐
                                       │  Pet Face Detector ONNX          │
                                       │  (Detects animal facial bounding)│
                                       └────────────────┬─────────────────┘
                                                        │ Bounding Box + KPS
                                                        ▼
                                       ┌──────────────────────────────────┐
                                       │  DogFaceNet Embedding Generator  │
                                       │  (Outputs normalized 128/512-dim)│
                                       └────────────────┬─────────────────┘
                                                        │
                                                        ▼
                                       ┌──────────────────────────────────┐
                                       │  SQLite: photo_pet_faces         │
                                       │  (Clustered via DBSCAN/Cosine)   │
                                       └──────────────────────────────────┘
```

#### Structural Changes Required in Rust
1. **Zero-Shot Trigger Hook (`catalog.rs` / `clip.rs`)**:
   - When `suggest_tags` identifies animal terms (`"dog"`, `"cat"`, `"pet"`) clearing the Sigmoid threshold (`> 0.5`), flag the photo for animal biometric indexing.
2. **Secondary ONNX Model Integration (`dogfacenet.rs`)**:
   - Add a dedicated ONNX inference module (`dogfacenet.rs`) wrapping:
     - Animal Face Alignment: Crop bounding region around detected pet face.
     - Biometric Feature Extractor: Pass cropped RGB to DogFaceNet ONNX model to extract L2-normalized feature embeddings.
3. **Database Schema Extension**:
   - Add `photo_pet_faces` table to SQLite catalog schema:
     ```sql
     CREATE TABLE photo_pet_faces (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
         species TEXT NOT NULL, -- 'dog', 'cat'
         x0 REAL, y0 REAL, x1 REAL, y1 REAL,
         embedding BLOB,
         pet_id INTEGER REFERENCES pets(id)
     );
     ```
4. **Clustering & Identification**:
   - Adapt DBSCAN clustering (`catalog.rs` reconciliation logic) to cluster pet face embeddings and surface pet profiles in the UI.

---

## 4. Proposed Validation Protocol

To verify future implementations without regressions, the following validation protocol must be performed:

### 1. Automated Test Suites
* **Backend Unit Tests**:
  - Run `cargo test --manifest-path desktop/src-tauri/Cargo.toml` to verify:
    - SigLIP multi-tag thresholding (`sigmoid_thresholding_allows_multiple_tags_simultaneously`).
    - Progress struct serialization for `catalog-scan` and `ingest-progress`.
    - Keyword tree hierarchy calculations in `catalog.rs`.
* **Frontend Performance & Integration Harness**:
  - Run `npm test` (`lib:test`, `export:test`, `mask:test`, `perf:test`, `ui:test`) to confirm non-blocking event loops and render performance.

### 2. Manual & Playwright Visual UI Checks
* **Status Bar Progress Verification**:
  - Trigger a folder scan and verify via Playwright script that `#lib-activity` updates continuously from `1%` to `100%` without freezing at `0%` or `- 0%`.
  - Assert that `ingest-progress` correctly populates `done` and `total` text nodes in `#imp-prog-txt`.
* **Tag Editor Docking & Popover Inspection**:
  - Inspect `#lib-info` DOM position in browser developer tools to confirm it renders inside the right sidebar container hierarchy (`#lib-sidebar-info`) rather than floating at `position: absolute; top: 56px`.
  - Scroll `#lib-main` and verify that `#lib-info` stays docked within the sidebar.
* **Multi-Select Batch Tagging Verification**:
  - Multi-select 3 photos (`state.selected.size = 3`).
  - Add a keyword (e.g., `"test-batch-tag"`) in the Info panel.
  - Assert via SQLite query (`SELECT * FROM photo_keywords`) that all 3 selected photos received the keyword sidecar mutation.
