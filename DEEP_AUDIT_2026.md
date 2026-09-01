# Deep Architectural Audit & Microscopic Benchmark 2026

## Part 1: Exhaustive Internal Double-Check

### 1. Hidden Concurrency & IPC Traps

In Tauri 2.x, any `#[tauri::command]` function declared as synchronous (`fn` instead of `async fn`) runs directly on the main IPC/webview dispatch thread. If a command performs disk I/O, Rayon parallel iterations, or CPU-heavy image processing, it freezes the entire IPC event loop and causes UI stuttering.

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
* **Issue Explanation:** `get_meta_batch` is declared as a synchronous command (`pub fn`). When invoked by the frontend to read metadata for dozens or hundreds of files, `paths.into_par_iter()` executes Rayon work synchronously on the IPC dispatch thread, completely blocking incoming IPC messages and UI event processing until all files finish.
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
      let mode = json["mode"].as_str().unwrap_or("linear16");
  ```
* **Issue Explanation:** `decode_raw_v2` handles RAW demosaicing and color space conversion. Declared as a synchronous `fn`, it runs multi-megabyte rawler decoding and PPG demosaicing directly on Tauri's IPC thread, freezing user interaction while decoding large RAW files.
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
      let token = json["token"].as_str().ok_or("missing token")?.to_string();
  ```
  ```rust
  #[tauri::command]
  fn sam_points(token: String, points: Vec<SamPointIn>) -> Result<tauri::ipc::Response, String> {
      let guard = SAM_EMBED.lock().unwrap();
      let cache = guard.as_ref().ok_or("sam_points: no photo encoded yet — call sam_encode first")?;
  ```
* **Issue Explanation:** EdgeSAM feature embedding and point mask inference run heavy neural network matrix operations inside synchronous commands, stalling interactive slider updates and UI events.
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

### 2. Unhandled Panics & Silenced Errors

#### Bug 2.1: `parse_framed` Panics on Short Byte Slices
* **File Path:** `desktop/src-tauri/src/main.rs`
* **Line Numbers:** 140–146
* **Exact Code Snippet:**
  ```rust
  if bytes.len() < 4 {
      return Err("framed body too short".into());
  }
  let jlen = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
  ```
* **Issue Explanation:** `bytes[0..4].try_into().unwrap()` assumes `try_into()` will never fail. While `bytes.len() >= 4` is checked prior, using `.unwrap()` on raw slice conversion can cause a process-wide panic if invariants shift during refactoring or slice slicing.
* **Exact Proposed Fix Code:**
  ```rust
  let jlen = match bytes[0..4].try_into() {
      Ok(arr) => u32::from_le_bytes(arr) as usize,
      Err(_) => return Err("invalid header byte conversion".into()),
  };
  ```

#### Bug 2.2: `store_dcp_lut` Unwrapped Chunk Slice Conversion
* **File Path:** `desktop/src-tauri/src/main.rs`
* **Line Numbers:** 160–164
* **Exact Code Snippet:**
  ```rust
  let lut: Vec<f32> = payload
      .chunks_exact(4)
      .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
      .collect();
  ```
* **Issue Explanation:** Even though `chunks_exact(4)` yields 4-byte slices, calling `.unwrap()` inside an iterator mapping over network/IPC payload data risks crashing the host process if slice assumptions fail.
* **Exact Proposed Fix Code:**
  ```rust
  let mut lut = Vec::with_capacity(payload.len() / 4);
  for chunk in payload.chunks_exact(4) {
      let arr: [u8; 4] = chunk.try_into().map_err(|_| "invalid float alignment chunk")?;
      lut.push(f32::from_le_bytes(arr));
  }
  ```

#### Bug 2.3: ONNX Model Execution Panics in `clip.rs` and `arcface.rs`
* **File Path:** `desktop/src-tauri/src/clip.rs` & `desktop/src-tauri/src/arcface.rs`
* **Line Numbers:** `clip.rs:276`, `arcface.rs:302`
* **Exact Code Snippet:**
  ```rust
  // clip.rs:276
  let emb = embed_image(&rgb, w, h).expect("clip embed_image run");
  ```
  ```rust
  // arcface.rs:302
  let emb = embed(&rgb, w, h, &kps).expect("embed run");
  ```
* **Issue Explanation:** If an input image is corrupted, zero-sized, or has unexpected dimensions, the ONNX Runtime session execution fails. `.expect(...)` triggers a panic that crashes the Tauri application instead of returning a controlled error Result.
* **Exact Proposed Fix Code:**
  ```rust
  // Refactored to bubble error cleanly:
  let emb = embed_image(&rgb, w, h).map_err(|e| format!("CLIP embedding inference error: {e}"))?;
  ```

---

### 3. WebGL & Memory Leaks

#### Bug 3.1: Undisposed WebGL Context and Textures in Color Space Detection
* **File Path:** `chromasmith-22.html`
* **Line Numbers:** 8231–8255
* **Exact Code Snippet:**
  ```javascript
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const gl=c.getContext('webgl2');
  if(gl&&vf){
    gl.getExtension('EXT_color_buffer_float');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
    const tx=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tx);
    // ...
    const ft=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,ft);
    // ...
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    const pr=gl.createProgram();
    // ...
    const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
    // ...
  }
  ```
* **Issue Explanation:** Every time HDR/color space capability detection runs, temporary WebGL textures (`tx`, `ft`), framebuffers (`fb`), shaders, programs (`pr`), and buffers (`b`) are allocated on a detached canvas context without cleanup (`deleteTexture`, `deleteFramebuffer`, `deleteProgram`, `deleteBuffer`, `loseContext`). WebGL contexts are kept alive by the browser until garbage collected, exceeding browser hardware context limits.
* **Exact Proposed Fix Code:**
  ```javascript
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const gl = c.getContext('webgl2');
  if (gl && vf) {
    let tx = null, ft = null, fb = null, pr = null, b = null;
    try {
      gl.getExtension('EXT_color_buffer_float');
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
      // ... setup textures, framebuffers, programs ...
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Float32Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
      // ... compute stats ...
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

### 4. Race Conditions & Event Listener Leaks in State

#### Bug 4.1: Unhandled Promise Rejection in Folder Listing
* **File Path:** `desktop/library-ui.js`
* **Line Number:** 2357
* **Exact Code Snippet:**
  ```javascript
  const entries = await invoke('list_dir', { path });
  ```
* **Issue Explanation:** If `list_dir` fails due to operating system permission denial, broken symlinks, or missing directories, the unhandled rejection halts execution of the calling function, leaving UI loading indicators frozen indefinitely.
* **Exact Proposed Fix Code:**
  ```javascript
  let entries = [];
  try {
    entries = await invoke('list_dir', { path });
  } catch (err) {
    console.error(`Failed to list directory "${path}":`, err);
    showToastNotification(`Unable to read folder: ${err}`);
    return;
  }
  ```

#### Bug 4.2: Accumulation of Uncleaned Progress Listeners
* **File Path:** `desktop/library-ui.js`
* **Line Numbers:** 6073–6089 & 6330–6366
* **Exact Code Snippet:**
  ```javascript
  let scanUnlisten = null;
  scanUnlisten = await window.__TAURI__.event.listen('scan-progress', (ev) => {
    // ... update progress UI ...
  });
  // If scan is aborted or fails before completion:
  if (scanUnlisten) scanUnlisten();
  ```
* **Issue Explanation:** If an error occurs between attaching `listen('scan-progress')` and entering the completion block, `unlisten()` is skipped. Repeated scans accumulate stale progress callbacks, leading to duplicate DOM updates and memory leaks.
* **Exact Proposed Fix Code:**
  ```javascript
  let scanUnlisten = null;
  try {
    scanUnlisten = await window.__TAURI__.event.listen('scan-progress', (ev) => {
      updateScanProgressUI(ev.payload);
    });
    await invoke('catalog_scan', { volumeId: root.volume_id });
  } catch (err) {
    console.error("Scan error:", err);
  } finally {
    if (typeof scanUnlisten === 'function') {
      scanUnlisten();
    }
  }
  ```

---

## Part 2: RapidRAW Microscopic Benchmark

### 1. Slider Cancellation Pipeline

RapidRAW eliminates slider input lag by combining:
1. A dedicated background thread listening on an `mpsc::channel`.
2. A `try_recv()` drain loop that discards intermediate jobs when a newer job arrives in the queue.
3. A `tokio::sync::oneshot` channel returning binary buffers directly to the requesting caller.

#### RapidRAW's Worker Code (`/tmp/rapidraw/src-tauri/src/lib.rs`):
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

            let state = app_handle.state::<AppState>();
            let responder = job.responder;
            match process_preview_job(
                &app_handle,
                state,
                job.adjustments,
                job.is_interactive,
                job.target_resolution,
                job.roi,
                job.request_analytics,
                job.compute_waveform,
                job.active_waveform_channel.as_deref(),
            ) {
                Ok(bytes) => {
                    let _ = responder.send(bytes);
                }
                Err(e) => {
                    log::error!("Preview worker error: {}", e);
                }
            }
        }
    });
}
```

#### Adaptation Code for Our Codebase (`desktop/src-tauri/src/main.rs`):

```rust
use std::sync::mpsc::{Sender, Receiver, channel};
use tokio::sync::oneshot;

pub struct RawDecodeJob {
    pub path: String,
    pub mode: String,
    pub auto_lens: bool,
    pub payload: Vec<u8>,
    pub responder: oneshot::Sender<Result<Vec<u8>, String>>,
}

pub struct RawWorkerState {
    pub tx: std::sync::Mutex<Option<Sender<RawDecodeJob>>>,
}

pub fn init_raw_decode_worker() -> Sender<RawDecodeJob> {
    let (tx, rx): (Sender<RawDecodeJob>, Receiver<RawDecodeJob>) = channel();
    std::thread::spawn(move || {
        while let Ok(mut job) = rx.recv() {
            // Instantly skip superseded slider positions
            while let Ok(newer_job) = rx.try_recv() {
                job = newer_job;
            }
            let res = raw_decode::decode_raw_v2_run(&job.path, &job.payload, &job.mode, job.auto_lens);
            let _ = job.responder.send(res);
        }
    });
    tx
}

#[tauri::command]
async fn decode_raw_v2(
    request: tauri::ipc::Request,
    state: tauri::State<'_, RawWorkerState>,
) -> Result<tauri::ipc::Response, String> {
    let body = request.body().to_vec();
    let (json, payload_slice) = parse_framed(&body)?;
    let mode = json["mode"].as_str().unwrap_or("linear16").to_string();
    let auto_lens = json["autoLens"].as_bool().unwrap_or(false);
    let path = json["path"].as_str().ok_or("missing path")?.to_string();

    let (tx_resp, rx_resp) = oneshot::channel();
    let job = RawDecodeJob {
        path,
        mode,
        auto_lens,
        payload: payload_slice.to_vec(),
        responder: tx_resp,
    };

    {
        let guard = state.tx.lock().map_err(|_| "Worker lock poisoned")?;
        let worker_tx = guard.as_ref().ok_or("Worker thread not running")?;
        worker_tx.send(job).map_err(|e| format!("Failed to queue decode job: {e}"))?;
    }

    match rx_resp.await {
        Ok(Ok(bytes)) => Ok(tauri::ipc::Response::new(bytes)),
        Ok(Err(err)) => Err(err),
        Err(_) => Err("Decode job superseded by newer request".to_string()),
    }
}
```

---

### 2. Binary IPC Transport & Object URL Revocation

RapidRAW returns raw binary JPEG bytes directly from Rust commands using `tauri::ipc::Response::new(bytes)`. On the frontend,ArrayBuffers are converted to Blobs, wrapped in Blob URLs, and managed via explicit lifetime tracking to prevent memory leaks.

#### RapidRAW Rust Binary Export (`/tmp/rapidraw/src-tauri/src/lib.rs`):
```rust
#[tauri::command]
async fn generate_preview_for_path(
    path: String,
    js_adjustments: Value,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    tokio::task::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        let context = get_or_init_gpu_context(&state, &app_handle)?;
        let bytes = render_preview_to_jpeg(&context, &path, &js_adjustments)?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| format!("Task execution failed: {}", e))?
}
```

#### RapidRAW Frontend Revocation Logic (`/tmp/rapidraw/src/hooks/useImageProcessing.ts`):
```typescript
const blob = new Blob([buffer], { type: 'image/jpeg' });
const url = URL.createObjectURL(blob);

if (currentPath !== selectedImagePathRef.current || jobId < latestRenderedJobIdRef.current) {
  URL.revokeObjectURL(url);
  return;
}

setEditor((state) => {
  const prevUrl = state.finalPreviewUrl;
  if (prevUrl && prevUrl.startsWith('blob:') && !globalImageCache.isProtected(prevUrl)) {
    setTimeout(() => {
      if (!globalImageCache.isProtected(prevUrl)) {
        URL.revokeObjectURL(prevUrl);
      }
    }, 250);
  }
  return { finalPreviewUrl: url };
});
```

#### Exact Proposed Code for Our `get_thumbnail` Command & Frontend Integration:

##### Rust Command (`desktop/src-tauri/src/library.rs`):
```rust
#[tauri::command]
pub async fn get_thumbnail(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let jpeg_bytes = extract_or_generate_thumbnail(&path)?;
        Ok(tauri::ipc::Response::new(jpeg_bytes))
    })
    .await
    .map_err(|e| format!("Thumbnail task error: {e}"))?
}
```

##### Frontend Ingestion & Revocation (`desktop/library-ui.js`):
```javascript
const thumbnailBlobCache = new Map();

async function fetchAndDisplayThumbnail(imagePath, imgElement) {
  try {
    const arrayBuffer = await window.__TAURI__.core.invoke('get_thumbnail', { path: imagePath });
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const newBlobUrl = URL.createObjectURL(blob);

    if (thumbnailBlobCache.has(imagePath)) {
      const oldUrl = thumbnailBlobCache.get(imagePath);
      setTimeout(() => URL.revokeObjectURL(oldUrl), 500);
    }

    thumbnailBlobCache.set(imagePath, newBlobUrl);
    imgElement.src = newBlobUrl;
  } catch (err) {
    console.error(`Failed to load thumbnail for ${imagePath}:`, err);
  }
}
```
