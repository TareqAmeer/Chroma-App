# Comprehensive Architectural Audit & Competitive Benchmark 2026

## Part 1: Internal Bug & Bottleneck Audit

### Issue 1: Main Thread Blocking via Synchronous IPC Commands (Rayon & Synchronous CPU/IO Tasks)
* **Severity:** Critical
* **Location:**
  * `desktop/src-tauri/src/library.rs` (`get_thumbnail`: line 315, `get_meta`: line 863, `get_meta_batch`: line 887, `list_dir`: line 4316)
  * `desktop/src-tauri/src/main.rs` (`decode_raw_v2`: line 662, `sam_encode`: line 188, `sam_points`: line 221, `denoise_raw_high`: line 871)
  * `desktop/src-tauri/src/catalog.rs` (`catalog_query`: line 2929, `catalog_add_root`: line 716, `catalog_roots`: line 729)
* **The Bug/Issue:**
  Numerous CPU-intensive or disk IO IPC commands are declared as synchronous Rust functions without `async fn` or `tauri::async_runtime::spawn_blocking`. In Tauri 2.x, synchronous `#[tauri::command]` functions run directly on the IPC/webview dispatch thread. When `decode_raw_v2` demosaics a RAW image or `get_meta_batch` invokes `paths.into_par_iter()`, it locks the IPC dispatch thread. Even though Rayon's global thread pool is capped at `(cores - 2)` in `main.rs:1849`, synchronous invocations stall Tauri's IPC event loop, causing severe UI input stuttering and unresponsive user interactions during batch metadata reads or RAW decoding.
* **Recommended Fix:**
  Convert all synchronous CPU/IO commands to `pub async fn` and wrap blocking logic inside `tauri::async_runtime::spawn_blocking`. For example:
  ```rust
  #[tauri::command]
  pub async fn get_meta_batch(paths: Vec<String>) -> Result<Vec<PhotoMeta>, String> {
      tauri::async_runtime::spawn_blocking(move || {
          paths.into_par_iter().map(get_meta).collect()
      }).await.map_err(|e| e.to_string())
  }
  ```

---

### Issue 2: WebGL Memory Leak & Context Resource Accumulation
* **Severity:** Critical
* **Location:** `chromasmith-22.html` (Color space detection test: lines 8231-8255)
* **The Bug/Issue:**
  In `chromasmith-22.html` (lines 8231–8255), a WebGL2 canvas context (`c.getContext('webgl2')`) and associated textures (`tx`, `ft`), framebuffers (`fb`), shaders (`sh`), and buffers (`b`) are allocated to test HDR color space headroom. None of these WebGL resources are deleted (`gl.deleteTexture`, `gl.deleteFramebuffer`, `gl.deleteShader`, `gl.deleteBuffer`, `gl.getExtension('WEBGL_lose_context').loseContext()`) after readback. Repeated execution of this check or reloading color spaces accumulates undisposed WebGL contexts and GPU memory buffers, leading to browser WebGL context loss errors (`GL_OUT_OF_MEMORY`).
* **Recommended Fix:**
  Clean up all created WebGL resources in a `finally` block and trigger context loss:
  ```javascript
  try {
    // ... WebGL texture & buffer creation and rendering ...
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

### Issue 3: Unhandled Async Promise Rejections in Core UI Workflows
* **Severity:** Moderate
* **Location:** `desktop/library-ui.js` (lines 2357, 2786, 3323, 6341)
* **The Bug/Issue:**
  Several asynchronous IPC invocations in `library-ui.js` lack `try / catch` error boundaries. For instance:
  - Line 2357: `const entries = await invoke('list_dir', { path });`
  - Line 2786: `const page = await invoke('catalog_query', { q: ... });`
  - Line 3323: `const outPath = await invoke('collage_output_path', ...);`
  - Line 6341: `const res = await invoke('ingest_copy', { files, options: opts });`
  If any of these commands fail (e.g. disk permission denied, corrupt volume, missing folder), the unhandled promise rejection causes UI lockups or silent failure where loading spinners stay indefinitely.
* **Recommended Fix:**
  Wrap all top-level async IPC calls in proper `try / catch` blocks with user-facing error notifications:
  ```javascript
  try {
    const entries = await invoke('list_dir', { path });
    // Process entries
  } catch (err) {
    console.error("Failed to list directory:", err);
    showToastNotification(`Directory access error: ${err}`);
  }
  ```

---

### Issue 4: Event Listener Leakage and Event Loss on Startup
* **Severity:** Moderate
* **Location:**
  * `desktop/library-ui.js` (`scan-progress`: line 6075, `ingest-progress`: line 6332)
  * `desktop/src-tauri/src/main.rs` (lines 2323-2349)
* **The Bug/Issue:**
  1. Temporary event listeners (`scan-progress`, `ingest-progress`) created inside UI functions registers new listeners via `window.__TAURI__.event.listen` on every operation. If an operation is cancelled or interrupted early, `unlisten()` may not be invoked, resulting in duplicate callbacks and memory growth.
  2. On app cold launch, OS open-file events (`open-file-path`, `adobe-oauth-callback`) emitted from Rust during startup fire before the frontend JavaScript bundle initializes and attaches event listeners, causing early launch events to be lost.
* **Recommended Fix:**
  1. Store active unlisten callbacks globally or ensure cleanup in `finally` blocks.
  2. Continue utilizing state-holding queues (like `take_pending_open_path` in `main.rs:1416`) for all startup events so the frontend pulls pending events on initialization instead of relying solely on early `emit`.

---

## Part 2: RapidRAW Competitive Benchmark

### 1. RAW Processing & Dedicated Preview Worker Pipeline
* **Architectural Difference:**
  RapidRAW delegates heavy image processing and RAW demosaicing to a dedicated, single-threaded preview background worker in Rust using Tokio channels (`tokio::sync::oneshot` and `mpsc`). When rapid adjustment changes occur, RapidRAW sends job cancellation tokens across channel boundaries, terminating out-of-date jobs instantly. Our implementation processes RAW decodes inside synchronous IPC calls or inline spawn blocks, allowing stale render requests to queue up and burn CPU cycles.
* **Code Reference:**
  - RapidRAW: `/tmp/rapidraw/src-tauri/src/lib.rs` (`apply_adjustments` worker dispatch with oneshot channel) and `/tmp/rapidraw/src-tauri/src/image_loader.rs` (`cancel_token` checking `AtomicUsize` generation).
  - Ours: `desktop/src-tauri/src/main.rs` (`decode_raw_v2`) and `desktop/src-tauri/src/raw_decode.rs`.
* **Performance Impact:**
  RapidRAW achieves superior interactive slider responsiveness. Rapid slider movement cancels previous pending preview renders immediately. In our codebase, dragging sliders queues multiple back-to-back full decode jobs.
* **Recommendation:**
  Implement a dedicated worker thread with an atomic generation counter / cancellation channel for RAW preview generation. When a new render request arrives, invalidate the previous generation counter so running demosaic operations abort early.

---

### 2. GPU Rendering & Pipeline: WGPU vs. WebGL2
* **Architectural Difference:**
  RapidRAW leverages native Rust `WGPU` (`/tmp/rapidraw/src-tauri/src/gpu_processing.rs`) for full 32-bit floating-point image processing, tone mapping, color transformations, and compute shaders directly on the GPU in native code. Our pipeline relies on WebGL2 in the browser webview (`chromasmith-22.html`).
* **Code Reference:**
  - RapidRAW: `/tmp/rapidraw/src-tauri/src/gpu_processing.rs` (WGPU pipeline, WGSL shaders for demosaic & tone mapping).
  - Ours: `chromasmith-22.html` (WebGL2 fragment shaders).
* **Performance Impact:**
  Native WGPU bypasses browser WebGL overhead, avoids browser context loss, provides direct access to 16-bit / 32-bit float texture formats across all platforms, and reduces memory copy costs between CPU and webview.
* **Recommendation:**
  Evaluate transitioning core rendering and tone mapping to a native WGPU pipeline in Rust, sending rendered frame buffers or OffscreenCanvas targets directly to Tauri windows.

---

### 3. IPC Binary Data Transport & Image Buffering
* **Architectural Difference:**
  RapidRAW streams processed image buffers directly as raw binary responses using `tauri::ipc::Response::new(bytes)`, which transfers binary data directly into ArrayBuffers on the frontend. In frontend state management, RapidRAW uses object URLs (`URL.createObjectURL(blob)`) backed by a strict LRU cache (`ImageLRUCache.ts`) that explicitly calls `URL.revokeObjectURL()` when items are evicted.
* **Code Reference:**
  - RapidRAW: `/tmp/rapidraw/src-tauri/src/lib.rs` (`Response::new(bytes)`) and `/tmp/rapidraw/src/utils/ImageLRUCache.ts`.
  - Ours: `desktop/src-tauri/src/library.rs` and `desktop/library-ui.js`.
* **Performance Impact:**
  Binary IPC response avoids JSON base64 string encoding overhead (which adds ~33% size and CPU serialization tax). RapidRAW's explicit `URL.revokeObjectURL()` prevents memory leaks in long-running photo editing sessions.
* **Recommendation:**
  Standardize all image buffer IPC returns on `tauri::ipc::Response` (as already used in `get_thumbnail`) and adopt an explicit Blob URL LRU cache with auto-revocation in `library-ui.js`.
