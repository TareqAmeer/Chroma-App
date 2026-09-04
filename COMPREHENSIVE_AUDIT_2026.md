# Comprehensive Architectural Audit & Competitive Benchmark 2026

## Part 1: Internal Bug & Bottleneck Audit

### Issue 1: Main Thread Blocking via Synchronous IPC Commands (Rayon & CPU/IO Tasks)
* **Severity:** Critical
* **Location:**
  * `desktop/src-tauri/src/library.rs` (`get_meta_batch`: line 887)
  * `desktop/src-tauri/src/main.rs` (`decode_raw_v2`: line 662, `sam_encode`: line 188, `sam_points`: line 221)
* **The Bug/Issue:**
  In Tauri 2.x, synchronous `#[tauri::command]` functions run directly on the webview/IPC dispatch thread (as documented in `catalog.rs:1777`). While previous refactoring converted `catalog_*` scan functions to `async fn` + `spawn_blocking`, several heavy CPU/IO commands (`get_meta_batch` running Rayon `into_par_iter()`, `decode_raw_v2` doing rawler demosaicing, and `sam_encode`/`sam_points` doing ONNX inference) remain as synchronous `fn` commands, causing IPC event loop stalls during batch operations and RAW photo opens.
* **Recommended Fix:**
  Convert these remaining heavy commands to `pub async fn` and wrap blocking work inside `tauri::async_runtime::spawn_blocking`:
  ```rust
  #[tauri::command]
  pub async fn get_meta_batch(paths: Vec<String>) -> Result<Vec<PhotoMeta>, String> {
      tauri::async_runtime::spawn_blocking(move || {
          paths.into_par_iter().map(get_meta).collect()
      }).await.map_err(|e| e.to_string())
  }
  ```

---

### Issue 2: Defensive Byte-Slice Conversion Cleanups
* **Severity:** Minor / Defensive Cleanup
* **Location:** `desktop/src-tauri/src/main.rs` (`parse_framed`: line 144, `store_dcp_lut`: line 162)
* **The Bug/Issue:**
  Calls to `.unwrap()` during byte-slice array conversions (e.g., `bytes[0..4].try_into().unwrap()`) depend on length preconditions checked earlier in the function. While currently safe from panicking due to explicit guards, replacing `.unwrap()` with `map_err` or pattern matching eliminates landmines for future code modifications.
* **Recommended Fix:**
  Replace `.unwrap()` on slice conversions with safe error mapping:
  ```rust
  let jlen = match bytes[0..4].try_into() {
      Ok(arr) => u32::from_le_bytes(arr) as usize,
      Err(_) => return Err("invalid header byte conversion".into()),
  };
  ```

---

### Issue 3: WebGL Resource Cleanup in One-Time HDR Capability Probe
* **Severity:** Minor / Code Hygiene
* **Location:** `chromasmith-22.html` (`fxHdrProbe`: lines 8218–8255)
* **The Bug/Issue:**
  The `fxHdrProbe` function allocates WebGL textures, framebuffers, programs, and buffers to test HDR float buffer headroom. The probe is gated by `_hdrProbeDone = true` and runs at most once per page session, so resources are reclaimed by browser garbage collection when the page unloads. However, explicitly deleting created WebGL handles (`gl.deleteTexture`, `gl.deleteFramebuffer`, etc.) improves resource hygiene.
* **Recommended Fix:**
  Wrap the probe execution in a `try ... finally` block that explicitly deletes created WebGL objects:
  ```javascript
  try {
    // ... WebGL texture & framebuffer creation ...
  } finally {
    if (gl) {
      if (tx) gl.deleteTexture(tx);
      if (ft) gl.deleteTexture(ft);
      if (fb) gl.deleteFramebuffer(fb);
      if (pr) gl.deleteProgram(pr);
      if (b) gl.deleteBuffer(b);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }
  ```

---

### Issue 4: Spot-Check for Uncaught Async Rejections in UI Callers
* **Severity:** Minor
* **Location:** `desktop/library-ui.js` (line 2357)
* **The Bug/Issue:**
  A direct call to `await invoke('list_dir', { path })` at line 2357 relies on outer caller handling in functions like `pickFolder`. While major UI entry points catch rejections, adding an explicit local `try / catch` ensures unexpected filesystem errors report a user-visible toast notification.
* **Recommended Fix:**
  Add a localized `try / catch` boundary around directory listings:
  ```javascript
  try {
    const entries = await invoke('list_dir', { path });
  } catch (err) {
    console.error("Directory read error:", err);
    showToastNotification(`Unable to open folder: ${err}`);
  }
  ```

---

## Part 2: RapidRAW Competitive Benchmark

### 1. Interactive Slider Preview Worker Architecture
* **Architectural Difference:**
  RapidRAW delegates interactive slider adjustment previews to a dedicated background worker using `mpsc::channel` with a `try_recv()` drain loop. When a user drags a slider rapidly, the worker drains pending intermediate renders and processes only the most recent adjustment job. In our architecture, RAW decoding happens once per photo load, while slider adjustments hit the DCP LUT and tone mapping pipeline.
* **Code Reference:**
  - RapidRAW: `/tmp/rapidraw/src-tauri/src/lib.rs` (`start_preview_worker`)
  - Ours: `desktop/src-tauri/src/main.rs` & `chromasmith-22.html`
* **Performance Impact:**
  Draining superseded interactive jobs prevents backlog lag when users drag adjustments rapidly.
* **Recommendation:**
  Apply the MPSC drain-latest-job pattern specifically to interactive LUT/preset/adjustment preview jobs rather than one-shot RAW image decodes.

---

### 2. Binary IPC Responses & Buffer Lifetime
* **Architectural Difference:**
  RapidRAW utilizes `tauri::ipc::Response::new(bytes)` for streaming binary images directly to frontend ArrayBuffers, paired with explicit `URL.revokeObjectURL()` calls when image previews are evicted from state.
* **Code Reference:**
  - RapidRAW: `/tmp/rapidraw/src-tauri/src/lib.rs` (`Response::new(bytes)`) & `/tmp/rapidraw/src/hooks/useImageProcessing.ts`
  - Ours: `desktop/src-tauri/src/library.rs` (`get_thumbnail`) & `desktop/library-ui.js`
* **Performance Impact:**
  Binary IPC response avoids JSON base64 encoding overhead (~33% payload inflation).
* **Recommendation:**
  Continue standardizing all image IPC commands on `tauri::ipc::Response` binary returns as used in `get_thumbnail`.
