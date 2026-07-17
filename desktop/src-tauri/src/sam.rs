// AI tap-to-select (Masks panel): EdgeSAM point-prompt segmentation via ONNX Runtime.
//
// Models are vendor/sam/edge_sam_{encoder,decoder}.onnx (NTU S-Lab 1.0, non-commercial — see
// vendor/sam/README.md), exported from huggingface.co/spaces/chongzhou/EdgeSAM/weights. Swapped
// in from the original MobileSAM implementation (Phase 2 of the AI-select plan) once Phase 1
// confirmed the raw-FFI ORT path works on real Intel Mac hardware. The encoder is a same-shape
// drop-in (both output [1,256,64,64] for a 1024x1024 padded input) but the DECODER CONTRACT
// DIFFERS from MobileSAM's — verified against the actual downloaded .onnx files via onnxruntime
// (onnx.load() for I/O names/shapes, a real inference run against a real photo for sane output),
// not guessed, and cross-checked against EdgeSAM's own
// segment_anything/onnx/predictor_onnx.py (SamPredictorONNX.predict/postprocess_masks):
//   - Decoder takes only 3 inputs: image_embeddings, point_coords, point_labels. No mask_input /
//     has_mask_input / orig_im_size — EdgeSAM's ONNX graph does NOT upscale the mask itself.
//   - Decoder always returns MULTIMASK output: scores [1,4] + low-res mask logits [1,4,256,256]
//     (no single-mask mode). Caller must argmax the scores to pick the best of the 4 channels.
//   - Caller must upsample the winning 256x256 channel to the original image resolution in TWO
//     bilinear steps, exactly mirroring predictor_onnx.py's postprocess_masks: (1) 256x256 →
//     1024x1024 (full padded canvas), (2) crop to the unpadded (input_h, input_w) region, then
//     bilinear-resize that crop to (orig_h, orig_w). This is NOT equivalent to a single direct
//     resize from 256x256 to (orig_h, orig_w) — cv2/PIL bilinear sampling uses a scale-dependent
//     half-pixel offset, so collapsing the two steps into one shifts every sample position and
//     produces a visibly different (softer/misaligned) mask boundary.
//
// ⚠️ THIS CALLS THE ONNX RUNTIME C API DIRECTLY (via ort-sys + libloading), NOT the `ort` crate's
// high-level Session/Environment API. `ort` 2.0.0-rc.12's `load-dynamic` feature has a confirmed,
// reproducible bug on x86_64-apple-darwin: its internal `G_ORT_LIB` cache (a OnceLock wrapping
// the loaded dylib handle) hangs indefinitely the SECOND time anything touches it — e.g.
// `Session::builder()` called after `ort::init_from()` already loaded the library successfully
// once. Traced this precisely by patching debug prints directly into `ort`'s own source: the
// first load completes fully (dlopen + OrtGetApiBase + GetVersionString all succeed), then a
// second, independent call path re-enters the same loading function and deadlocks in the
// OnceLock's internal std::sync::Once. Reproduced in a fully isolated project with ONLY `ort` as
// a dependency (no Tauri/rawler/etc.), on both this dev sandbox AND the project's real Intel Mac
// — so it's a genuine `ort` bug on this platform, not an environment quirk. Older `ort` 2.x
// release candidates either fail to compile against a current Rust toolchain (rc.5-rc.9) or
// require a newer onnxruntime than has an Intel Mac build (rc.10, rc.11 want 1.22.x/1.23.x; only
// 1.20.0 has an x86_64-apple-darwin release). `ort` 1.x is entirely yanked from crates.io.
//
// The raw C API — dlopen, OrtGetApiBase, GetApi(17), CreateEnv, CreateSessionFromArray, Run — has
// none of this bug: proven end-to-end (including running the real MobileSAM encoder against a
// real photo, in the same sandbox where the `ort` crate hangs) before writing this file. See
// ensure_ort() below for the one-time setup and run_session() for the shared inference helper.
use ort_sys::{
    OrtAllocatorType, OrtApi, OrtApiBase, OrtEnv, OrtLoggingLevel, OrtMemType, OrtMemoryInfo, OrtSession, OrtSessionOptions,
    OrtStatusPtr, OrtValue, ONNXTensorElementDataType
};
use std::ffi::{CStr, CString};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static ENCODER_BYTES: &[u8] = include_bytes!("../vendor/sam/edge_sam_encoder.onnx");
static DECODER_BYTES: &[u8] = include_bytes!("../vendor/sam/edge_sam_decoder.onnx");

/// EdgeSAM's img_size — the model pads to this square canvas internally; callers resize so the
/// image's LONGEST side equals this before feeding it in. Also the decoder's low-res mask output
/// side length is SAM_SIZE/4 = 256 (see decode_point()'s two-stage upsample).
const SAM_SIZE: u32 = 1024;
/// Side length of the decoder's low-res mask logits output (SAM_SIZE / 4).
const MASK_SIZE: u32 = 256;
/// EdgeSAM's decoder always emits this many candidate masks; the highest-scoring one is used.
const NUM_MASK_CANDIDATES: usize = 4;
/// ONNX opset / OrtApi ABI version this file's struct layouts (via ort-sys 2.0.0-rc.12) target.
const ORT_API_VERSION: u32 = 17;

static DYLIB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's app `.setup()` (which has the Tauri AppHandle needed to resolve a
/// bundled resource path) before any SAM command can run.
pub fn set_dylib_path(path: PathBuf) {
    let _ = DYLIB_PATH.set(path);
}

/// Owns the loaded dylib + the OrtApi function-pointer table + one shared OrtEnv. Kept alive for
/// the process lifetime (never released) — this is a single-purpose desktop app, not a library
/// meant to be unloaded/reloaded, so there's no dangling-pointer risk in skipping cleanup.
struct OrtHandle {
    api: *const OrtApi,
    env: *mut OrtEnv,
    #[allow(dead_code)] // kept only to hold the dylib open for the process lifetime
    lib: libloading::Library
}
unsafe impl Send for OrtHandle {}
unsafe impl Sync for OrtHandle {}

unsafe fn check(api: *const OrtApi, status: OrtStatusPtr, what: &str) -> Result<(), String> {
    if !status.0.is_null() {
        let msg = ((*api).GetErrorMessage)(status.0);
        let s = CStr::from_ptr(msg).to_string_lossy().into_owned();
        return Err(format!("{what}: {s}"));
    }
    Ok(())
}

fn ort_handle() -> Result<&'static OrtHandle, String> {
    static H: OnceLock<Result<OrtHandle, String>> = OnceLock::new();
    H.get_or_init(|| unsafe {
        let path = DYLIB_PATH.get().ok_or_else(|| "SAM dylib path not set — set_dylib_path() must run before any AI Select use".to_string())?;
        let lib = libloading::Library::new(path).map_err(|e| format!("dlopen({}): {e}", path.display()))?;
        let base_getter: libloading::Symbol<unsafe extern "C" fn() -> *const OrtApiBase> =
            lib.get(b"OrtGetApiBase").map_err(|e| format!("OrtGetApiBase symbol: {e}"))?;
        let base = base_getter();
        if base.is_null() {
            return Err("OrtGetApiBase() returned null".into());
        }
        let api: *const OrtApi = ((*base).GetApi)(ORT_API_VERSION);
        if api.is_null() {
            return Err(format!("GetApi({ORT_API_VERSION}) returned null — onnxruntime dylib too old"));
        }
        let logid = CString::new("chromasmith-sam").unwrap();
        let mut env: *mut OrtEnv = std::ptr::null_mut();
        check(api, ((*api).CreateEnv)(OrtLoggingLevel::ORT_LOGGING_LEVEL_WARNING, logid.as_ptr(), &mut env), "CreateEnv")?;
        Ok(OrtHandle { api, env, lib })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// A loaded inference session. Like OrtHandle, deliberately never released (process-lifetime).
struct SamSession(*mut OrtSession);
unsafe impl Send for SamSession {}
unsafe impl Sync for SamSession {}

fn create_session(bytes: &'static [u8]) -> Result<SamSession, String> {
    let h = ort_handle()?;
    unsafe {
        let mut opts: *mut OrtSessionOptions = std::ptr::null_mut();
        check(h.api, ((*h.api).CreateSessionOptions)(&mut opts), "CreateSessionOptions")?;
        let mut session: *mut OrtSession = std::ptr::null_mut();
        let res = check(
            h.api,
            ((*h.api).CreateSessionFromArray)(h.env, bytes.as_ptr() as *const _, bytes.len(), opts, &mut session),
            "CreateSessionFromArray"
        );
        ((*h.api).ReleaseSessionOptions)(opts);
        res?;
        Ok(SamSession(session))
    }
}

fn encoder() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| create_session(ENCODER_BYTES).map(Mutex::new)).as_ref().map_err(|e| e.clone())
}

fn decoder() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| create_session(DECODER_BYTES).map(Mutex::new)).as_ref().map_err(|e| e.clone())
}

/// One named f32 input tensor for run_session() — owns its own data so the OrtValue created from
/// it stays valid for the lifetime of the Run() call (CreateTensorWithDataAsOrtValue does NOT
/// copy the data, it wraps the pointer directly).
struct NamedInput {
    name: CString,
    data: Vec<f32>,
    shape: Vec<i64>
}
fn input(name: &str, data: Vec<f32>, shape: &[i64]) -> NamedInput {
    NamedInput { name: CString::new(name).unwrap(), data, shape: shape.to_vec() }
}

/// Runs a session with the given named f32 inputs, returning the named f32 outputs requested (in
/// the same order as `output_names`). Shared by encode() and decode_point() — both this model
/// family's I/O is entirely f32 tensors, so one helper covers both.
fn run_session(sess: &Mutex<SamSession>, mut inputs: Vec<NamedInput>, output_names: &[&str]) -> Result<Vec<Vec<f32>>, String> {
    let h = ort_handle()?;
    let sess = sess.lock().map_err(|_| "SAM session lock poisoned".to_string())?;
    unsafe {
        let mut mem_info: *mut OrtMemoryInfo = std::ptr::null_mut();
        check(h.api, ((*h.api).CreateCpuMemoryInfo)(OrtAllocatorType::OrtArenaAllocator, OrtMemType::OrtMemTypeDefault, &mut mem_info), "CreateCpuMemoryInfo")?;

        let mut input_values: Vec<*mut OrtValue> = Vec::with_capacity(inputs.len());
        let mut input_name_ptrs: Vec<*const std::os::raw::c_char> = Vec::with_capacity(inputs.len());
        // Best-effort cleanup even on an early error — collect what we created so far and release
        // it before returning. Simpler than a scope-guard given the small, fixed set of resources.
        let cleanup = |mem_info: *mut OrtMemoryInfo, values: &[*mut OrtValue]| {
            for &v in values {
                if !v.is_null() {
                    ((*h.api).ReleaseValue)(v);
                }
            }
            if !mem_info.is_null() {
                ((*h.api).ReleaseMemoryInfo)(mem_info);
            }
        };

        for inp in inputs.iter_mut() {
            let mut value: *mut OrtValue = std::ptr::null_mut();
            let byte_len = inp.data.len() * std::mem::size_of::<f32>();
            let res = check(
                h.api,
                ((*h.api).CreateTensorWithDataAsOrtValue)(
                    mem_info,
                    inp.data.as_mut_ptr() as *mut _,
                    byte_len,
                    inp.shape.as_ptr(),
                    inp.shape.len(),
                    ONNXTensorElementDataType::ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT,
                    &mut value
                ),
                "CreateTensorWithDataAsOrtValue"
            );
            if let Err(e) = res {
                cleanup(mem_info, &input_values);
                return Err(e);
            }
            input_values.push(value);
            input_name_ptrs.push(inp.name.as_ptr());
        }

        let output_name_cstrings: Vec<CString> = output_names.iter().map(|n| CString::new(*n).unwrap()).collect();
        let output_name_ptrs: Vec<*const std::os::raw::c_char> = output_name_cstrings.iter().map(|c| c.as_ptr()).collect();
        let mut output_values: Vec<*mut OrtValue> = vec![std::ptr::null_mut(); output_names.len()];

        let run_res = check(
            h.api,
            ((*h.api).Run)(
                sess.0,
                std::ptr::null(),
                input_name_ptrs.as_ptr(),
                input_values.as_ptr() as *const *const OrtValue,
                input_values.len(),
                output_name_ptrs.as_ptr(),
                output_name_ptrs.len(),
                output_values.as_mut_ptr()
            ),
            "Run"
        );
        if let Err(e) = run_res {
            cleanup(mem_info, &input_values);
            cleanup(std::ptr::null_mut(), &output_values);
            return Err(e);
        }

        let mut results = Vec::with_capacity(output_values.len());
        let mut extract_err = None;
        for &ov in &output_values {
            if extract_err.is_some() {
                break;
            }
            let mut data_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
            match check(h.api, ((*h.api).GetTensorMutableData)(ov, &mut data_ptr), "GetTensorMutableData") {
                Ok(()) => {
                    let mut count_bytes: usize = 0;
                    // Element count via GetTensorShapeElementCount isn't in this minimal binding
                    // set — instead callers pass back exactly as many values as they know the
                    // fixed output shape requires (encode()/decode_point() both know their output
                    // sizes ahead of time from the model's documented contract), so we just hand
                    // back the raw pointer's data reinterpreted for the caller-known length via a
                    // sentinel: read GetTensorTypeAndShape → GetTensorShapeElementCount.
                    let mut shape_info: *mut ort_sys::OrtTensorTypeAndShapeInfo = std::ptr::null_mut();
                    if check(h.api, ((*h.api).GetTensorTypeAndShape)(ov, &mut shape_info), "GetTensorTypeAndShape").is_ok() {
                        let _ = check(h.api, ((*h.api).GetTensorShapeElementCount)(shape_info, &mut count_bytes), "GetTensorShapeElementCount");
                        ((*h.api).ReleaseTensorTypeAndShapeInfo)(shape_info);
                    }
                    let slice = std::slice::from_raw_parts(data_ptr as *const f32, count_bytes);
                    results.push(slice.to_vec());
                }
                Err(e) => extract_err = Some(e)
            }
        }

        cleanup(mem_info, &input_values);
        cleanup(std::ptr::null_mut(), &output_values);

        if let Some(e) = extract_err {
            return Err(e);
        }
        Ok(results)
    }
}

/// A cached image embedding — the expensive part of a SAM query, reusable across every tap on
/// the same photo. `orig_w`/`orig_h` are needed by decode_point() to convert a normalized
/// (0..1) tap position into the model's resized-pixel coordinate space, and to size the
/// returned mask raster.
pub struct Embedding {
    pub data: Vec<f32>, // [1,256,64,64], row-major
    pub orig_w: u32,
    pub orig_h: u32
}

fn resize_rgb8(rgb: &[u8], w: u32, h: u32, new_w: u32, new_h: u32) -> Vec<u8> {
    use image::{imageops::FilterType, ImageBuffer, Rgb};
    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
        ImageBuffer::from_raw(w, h, rgb.to_vec()).expect("SAM resize: RGB buffer size mismatch");
    image::imageops::resize(&img, new_w, new_h, FilterType::Triangle).into_raw()
}

/// Encodes an already-decoded RGB8 image (interleaved, row-major, no alpha) into a SAM
/// embedding. Resizes so the longest side is exactly `SAM_SIZE` (`resize_longest_image_size` in
/// Meta's export) — the ONNX graph itself handles pixel normalization and zero-padding to a
/// square 1024x1024 canvas, so this only ever hands it raw 0..255 values.
pub fn encode(rgb: &[u8], w: u32, h: u32) -> Result<Embedding, String> {
    if w == 0 || h == 0 {
        return Err("SAM encode: zero-sized image".into());
    }
    let scale = SAM_SIZE as f32 / w.max(h) as f32;
    let new_w = ((w as f32 * scale).round().max(1.0)) as u32;
    let new_h = ((h as f32 * scale).round().max(1.0)) as u32;
    let resized = resize_rgb8(rgb, w, h, new_w, new_h);

    let mut pixels = vec![0f32; (new_w as usize) * (new_h as usize) * 3];
    for i in 0..(new_w as usize * new_h as usize) {
        pixels[i * 3] = resized[i * 3] as f32;
        pixels[i * 3 + 1] = resized[i * 3 + 1] as f32;
        pixels[i * 3 + 2] = resized[i * 3 + 2] as f32;
    }

    let sess = encoder()?;
    let mut outputs = run_session(sess, vec![input("image", pixels, &[1, 3, new_h as i64, new_w as i64])], &["image_embeddings"])?;
    Ok(Embedding { data: outputs.remove(0), orig_w: w, orig_h: h })
}

/// Bilinear-samples `src` (row-major, `src_w`x`src_h`) at floating-point pixel-center coordinates,
/// using the same half-pixel convention as cv2.resize(INTER_LINEAR)/PIL — `src_x = (dst_x+0.5) *
/// (src_w/dst_w) - 0.5` — so this matches EdgeSAM's own postprocess_masks() sample-for-sample.
fn bilinear_resize(src: &[f32], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<f32> {
    let (sw, sh) = (src_w as f32, src_h as f32);
    let (dw, dh) = (dst_w as f32, dst_h as f32);
    let mut out = vec![0f32; (dst_w as usize) * (dst_h as usize)];
    for dy in 0..dst_h {
        let sy = (((dy as f32 + 0.5) * sh / dh) - 0.5).clamp(0.0, sh - 1.0);
        let y0 = sy.floor() as u32;
        let y1 = (y0 + 1).min(src_h - 1);
        let fy = sy - y0 as f32;
        for dx in 0..dst_w {
            let sx = (((dx as f32 + 0.5) * sw / dw) - 0.5).clamp(0.0, sw - 1.0);
            let x0 = sx.floor() as u32;
            let x1 = (x0 + 1).min(src_w - 1);
            let fx = sx - x0 as f32;
            let get = |x: u32, y: u32| src[(y * src_w + x) as usize];
            let top = get(x0, y0) * (1.0 - fx) + get(x1, y0) * fx;
            let bot = get(x0, y1) * (1.0 - fx) + get(x1, y1) * fx;
            out[(dy * dst_w + dx) as usize] = top * (1.0 - fy) + bot * fy;
        }
    }
    out
}

/// Runs the decoder for a SINGLE point prompt (one tap), returning a full-original-resolution
/// binary mask — one byte per pixel, row-major, 255 = selected / 0 = not, already thresholded
/// at SAM's standard mask_threshold=0.0 on the raw logit.
///
/// `norm_x`/`norm_y` are the tap position as a 0..1 fraction of the ORIGINAL image (matching
/// this app's existing mask-geometry convention — see chromasmith-22.html's mskA cx/cy). A lone
/// point is paired with an implicit (0,0)/label=-1 padding point, matching MobileSAM's convention
/// (segment_anything's prompt encoder expects that pairing for a single click — see
/// vendor/sam/README.md; EdgeSAM shares the same prompt-encoder/mask-decoder architecture).
pub fn decode_point(embed: &Embedding, norm_x: f32, norm_y: f32, positive: bool) -> Result<Vec<u8>, String> {
    let scale = SAM_SIZE as f32 / embed.orig_w.max(embed.orig_h) as f32;
    let px = norm_x.clamp(0.0, 1.0) * embed.orig_w as f32 * scale;
    let py = norm_y.clamp(0.0, 1.0) * embed.orig_h as f32 * scale;
    // The unpadded region of the SAM_SIZE square canvas that the resized image actually occupies
    // — needed to crop the upsampled mask back out of the zero-padded square (see bilinear_resize
    // doc comment above and predictor_onnx.py's postprocess_masks).
    let input_w = ((embed.orig_w as f32 * scale).round().max(1.0)) as u32;
    let input_h = ((embed.orig_h as f32 * scale).round().max(1.0)) as u32;

    let sess = decoder()?;
    let mut outputs = run_session(
        sess,
        vec![
            input("image_embeddings", embed.data.clone(), &[1, 256, 64, 64]),
            input("point_coords", vec![px, py, 0.0, 0.0], &[1, 2, 2]),
            input("point_labels", vec![if positive { 1.0 } else { 0.0 }, -1.0], &[1, 2]),
        ],
        &["scores", "masks"]
    )?;
    let masks = outputs.remove(1);
    let scores = outputs.remove(0);

    if scores.len() != NUM_MASK_CANDIDATES || masks.len() != NUM_MASK_CANDIDATES * (MASK_SIZE * MASK_SIZE) as usize {
        return Err(format!(
            "SAM decoder output size mismatch: {} scores, {} mask values (expected {NUM_MASK_CANDIDATES} candidates of {MASK_SIZE}x{MASK_SIZE})",
            scores.len(),
            masks.len()
        ));
    }
    let best = scores.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i).unwrap_or(0);
    let low_res = &masks[best * (MASK_SIZE * MASK_SIZE) as usize..(best + 1) * (MASK_SIZE * MASK_SIZE) as usize];

    // Two-stage upsample matching EdgeSAM's own postprocess_masks exactly: low-res → full padded
    // square → crop to the unpadded input region → original resolution. See the module doc
    // comment for why this can't be collapsed into a single resize.
    let full_square = bilinear_resize(low_res, MASK_SIZE, MASK_SIZE, SAM_SIZE, SAM_SIZE);
    let mut cropped = vec![0f32; (input_w as usize) * (input_h as usize)];
    for y in 0..input_h {
        for x in 0..input_w {
            cropped[(y * input_w + x) as usize] = full_square[(y * SAM_SIZE + x) as usize];
        }
    }
    let full_res = bilinear_resize(&cropped, input_w, input_h, embed.orig_w, embed.orig_h);

    Ok(full_res.iter().map(|&v| if v > 0.0 { 255u8 } else { 0u8 }).collect())
}
