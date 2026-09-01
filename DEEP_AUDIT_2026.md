# Deep Architectural Audit & Microscopic Benchmark 2026

## Part 1: Exhaustive Internal Double-Check

### 1. Hidden Concurrency & IPC Traps

In Tauri 2.x, any `#[tauri::command]` function declared as synchronous (`fn` instead of `async fn`) runs directly on the main IPC/webview dispatch thread. As documented in `catalog.rs:1777`, executing CPU-bound or disk I/O tasks inside synchronous commands stalls the IPC event loop.

#### Bug 1.1: `get_meta_batch` Blocks IPC Dispatch Thread via Rayon
* **File Path:** `desktop/src-tauri/src/library.rs`
* **Line Numbers:** 887–890
* **Exact Code Snippet:**
  ```rust
  #[tauri::command]
  pub fn get_meta_batch(paths: Vec<String>) -> Vec<PhotoMeta> {
      paths.into_par_iter().map(get_meta).collect()
  }
  ```
* **Issue Explanation:** `get_meta_batch` is declared as synchronous (`pub fn`). Reading metadata for batch paths executes Rayon parallel work directly on the IPC dispatch thread.
* **Exact Proposed Fix Code:**
  ```rust
  #[tauri::command]
  pub async fn get_meta_batch(paths: Vec<String>) -> Result<Vec<PhotoMeta>, String> {
      tauri::async_runtime::spawn_blocking(move || {
          paths.into_par_iter().map(get_meta).collect()
      })
      .await
      .map_err(|e| format!("Task execution failed: {e}"))
  }
  ```

#### Bug 1.2: `decode_raw_v2` Demosaicing Runs Synchronously on IPC Thread
* **File Path:** `desktop/src-tauri/src/main.rs`
* **Line Numbers:** 662–666
* **Exact Code Snippet:**
  ```rust
  #[tauri::command]
  fn decode_raw_v2(request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
      let (json, payload) = parse_framed(request.body())?;
  ```
* **Issue Explanation:** RAW demosaicing and color space processing inside `decode_raw_v2` run synchronously on Tauri's IPC thread during photo opens.
* **Exact Proposed Fix Code:**
  ```rust
  #[tauri::command]
  async fn decode_raw_v2(request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
      let body = request.body().to_vec();
      tauri::async_runtime::spawn_blocking(move || {
          let (json, payload) = parse_framed(&body)?;
          let mode = json["mode"].as_str().unwrap_or("linear16");
          let auto_lens = json["autoLens"].as_bool().unwrap_or(false);
          let raw_path = json["path"].as_str().ok_or("missing path")?;
          let out_bytes = raw_decode::decode_raw_v2_run(raw_path, payload, mode, auto_lens)?;
          Ok(tauri::ipc::Response::new(out_bytes))
      })
      .await
      .map_err(|e| format!("Async decode task join error: {e}"))?
  }
  ```

#### Bug 1.3: `sam_encode` and `sam_points` Block IPC Dispatch
* **File Path:** `desktop/src-tauri/src/main.rs`
* **Line Numbers:** 188–191, 221–225
* **Exact Code Snippet:**
  ```rust
  #[tauri::command]
  fn sam_encode(request: tauri::ipc::Request) -> Result<(), String> {
      let (json, payload) = parse_framed(request.body())?;
  ```
* **Issue Explanation:** EdgeSAM neural network feature encoding runs inside synchronous commands, stalling the IPC event loop during object selection.
* **Exact Proposed Fix Code:**
  ```rust
  #[tauri::command]
  async fn sam_encode(request: tauri::ipc::Request) -> Result<(), String> {
      let body = request.body().to_vec();
      tauri::async_runtime::spawn_blocking(move || {
          let (json, payload) = parse_framed(&body)?;
          let token = json["token"].as_str().ok_or("missing token")?.to_string();
          let w = json["width"].as_u64().ok_or("missing width")? as u32;
          let h = json["height"].as_u64().ok_or("missing height")? as u32;
          let embedding = sam::encode_image(payload, w, h)?;
          let mut guard = SAM_EMBED.lock().map_err(|_| "Mutex poisoned")?;
          *guard = Some(SamEmbedCache { token, embedding });
          Ok(())
      })
      .await
      .map_err(|e| format!("SAM encode task error: {e}"))?
  }
  ```

---

### 2. Defensive Unwraps on Byte-Slice Conversions

#### Bug 2.1: `parse_framed` Unwrapped Byte-Slice Array Conversion
* **File Path:** `desktop/src-tauri/src/main.rs`
* **Line Numbers:** 144
* **Exact Code Snippet:**
  ```rust
  let jlen = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
  ```
* **Issue Explanation:** While `bytes.len() >= 4` is guarded prior, converting `.unwrap()` to `match` or `map_err` avoids potential panic landmines during future refactorings.
* **Exact Proposed Fix Code:**
  ```rust
  let jlen = match bytes[0..4].try_into() {
      Ok(arr) => u32::from_le_bytes(arr) as usize,
      Err(_) => return Err("invalid header byte conversion".into()),
  };
  ```

#### Bug 2.2: `store_dcp_lut` Unwrapped Chunk Slice Conversion
* **File Path:** `desktop/src-tauri/src/main.rs`
* **Line Numbers:** 162
* **Exact Code Snippet:**
  ```rust
  let lut: Vec<f32> = payload
      .chunks_exact(4)
      .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
      .collect();
  ```
* **Issue Explanation:** Replacing `.unwrap()` on 4-byte chunk slice conversions with explicit Result handling ensures robust error reporting.
* **Exact Proposed Fix Code:**
  ```rust
  let mut lut = Vec::with_capacity(payload.len() / 4);
  for chunk in payload.chunks_exact(4) {
      let arr: [u8; 4] = chunk.try_into().map_err(|_| "invalid float alignment chunk")?;
      lut.push(f32::from_le_bytes(arr));
  }
  ```

---

### 3. WebGL Resource Hygiene in Capability Probe

#### Bug 3.1: Explicit WebGL Object Deletion in One-Time HDR Probe
* **File Path:** `chromasmith-22.html`
* **Line Numbers:** 8218–8255
* **Exact Code Snippet:**
  ```javascript
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const gl=c.getContext('webgl2');
  ```
* **Issue Explanation:** `fxHdrProbe` executes once per session to probe float buffer headroom. Explicitly deleting WebGL textures, framebuffers, and buffers in a `finally` block ensures clean memory practice.
* **Exact Proposed Fix Code:**
  ```javascript
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const gl = c.getContext('webgl2');
  if (gl && vf) {
    let tx = null, ft = null, fb = null, pr = null, b = null;
    try {
      gl.getExtension('EXT_color_buffer_float');
      // ... probe execution ...
    } finally {
      if (tx) gl.deleteTexture(tx);
      if (ft) gl.deleteTexture(ft);
      if (fb) gl.deleteFramebuffer(fb);
      if (pr) gl.deleteProgram(pr);
      if (b) gl.deleteBuffer(b);
      const loseExt = gl.getExtension('WEBGL_lose_context');
      if (loseExt) loseExt.loseContext();
    }
  }
  ```

---

## Part 2: RapidRAW Microscopic Benchmark

### 1. Interactive Adjustment Queue Draining
RapidRAW's worker drains pending intermediate slider adjustments in an `mpsc::channel` using `try_recv()`, ensuring fast responsiveness during interactive slider dragging.

#### RapidRAW Worker Pattern (`/tmp/rapidraw/src-tauri/src/lib.rs`):
```rust
fn start_preview_worker(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    let (tx, rx): (Sender<PreviewJob>, Receiver<PreviewJob>) = mpsc::channel();

    *state.preview_worker_tx.lock().unwrap() = Some(tx);

    std::thread::spawn(move || {
        while let Ok(mut job) = rx.recv() {
            // Drain queue: discard intermediate slider updates and keep only the latest job
            while let Ok(latest_job) = rx.try_recv() {
                job = latest_job;
            }
            // Process latest job ...
        }
    });
}
```

### 2. Binary IPC Responses
RapidRAW returns binary JPEG byte buffers directly using `tauri::ipc::Response::new(bytes)`.

```rust
#[tauri::command]
async fn generate_preview_for_path(
    path: String,
    js_adjustments: Value,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    tokio::task::spawn_blocking(move || {
        let bytes = render_preview_to_jpeg(...)?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| format!("Task execution failed: {}", e))?
}
```
