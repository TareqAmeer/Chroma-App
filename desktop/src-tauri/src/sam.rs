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
pub(crate) const SAM_SIZE: u32 = 1024;
/// Side length of the decoder's low-res mask logits output (SAM_SIZE / 4).
const MASK_SIZE: u32 = 256;
/// Side length of the encoder's spatial feature grid — the image embedding is [1,256,64,64], so
/// 64x64 locations of 256 channels each. subject.rs walks this grid directly to build and match
/// per-subject prototypes; it is derived from the model's own output shape, not a free parameter.
pub(crate) const SAM_FEAT_GRID: u32 = 64;
/// How many SAM_SIZE-canvas pixels one feature cell covers (SAM_SIZE / SAM_FEAT_GRID = 16).
/// Needed to map a feature cell back to an image coordinate, and to tell which cells fall in the
/// zero padding rather than the image.
pub(crate) const SAM_PATCH: u32 = SAM_SIZE / SAM_FEAT_GRID;
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
pub(crate) struct OrtHandle {
    pub(crate) api: *const OrtApi,
    pub(crate) env: *mut OrtEnv,
    #[allow(dead_code)] // kept only to hold the dylib open for the process lifetime
    lib: libloading::Library
}
unsafe impl Send for OrtHandle {}
unsafe impl Sync for OrtHandle {}

pub(crate) unsafe fn check(api: *const OrtApi, status: OrtStatusPtr, what: &str) -> Result<(), String> {
    if !status.0.is_null() {
        let msg = ((*api).GetErrorMessage)(status.0);
        let s = CStr::from_ptr(msg).to_string_lossy().into_owned();
        return Err(format!("{what}: {s}"));
    }
    Ok(())
}

pub(crate) fn ort_handle() -> Result<&'static OrtHandle, String> {
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
pub(crate) struct SamSession(pub(crate) *mut OrtSession);
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

// ── SAM 2.1 Hiera-Tiny (Phase 3 background quality upgrade) — see vendor/sam2/README.md for the
// full I/O contract (verified the same way as EdgeSAM's: onnx.load() on the actual downloaded
// files + a real inference run, cross-checked against Meta's sam2/utils/transforms.py). At
// ~155MB combined these are too large for include_bytes! (would bloat link times/binary size),
// so unlike ENCODER_BYTES/DECODER_BYTES above they're loaded from disk via the ORT C API's
// CreateSession (file path) — bundled as Tauri resources, same mechanism main.rs already uses
// for the onnxruntime dylib itself. set_sam2_model_paths() must run before any sam2_* call.
static SAM2_ENCODER_PATH: OnceLock<PathBuf> = OnceLock::new();
static SAM2_DECODER_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_sam2_model_paths(encoder_path: PathBuf, decoder_path: PathBuf) {
    let _ = SAM2_ENCODER_PATH.set(encoder_path);
    let _ = SAM2_DECODER_PATH.set(decoder_path);
}

pub(crate) fn create_session_from_path(path: &std::path::Path) -> Result<SamSession, String> {
    let h = ort_handle()?;
    // ort_sys::os_char is c_char on macOS (only c_ushort/UTF-16 on Windows), so a plain CString
    // is the right ABI here — confirmed by reading ort-sys's own os_char cfg rather than assumed.
    let path_c = CString::new(path.to_str().ok_or_else(|| format!("non-UTF8 model path: {}", path.display()))?)
        .map_err(|e| format!("model path has embedded NUL: {e}"))?;
    unsafe {
        let mut opts: *mut OrtSessionOptions = std::ptr::null_mut();
        check(h.api, ((*h.api).CreateSessionOptions)(&mut opts), "CreateSessionOptions")?;
        let mut session: *mut OrtSession = std::ptr::null_mut();
        let res = check(h.api, ((*h.api).CreateSession)(h.env, path_c.as_ptr(), opts, &mut session), "CreateSession");
        ((*h.api).ReleaseSessionOptions)(opts);
        res?;
        Ok(SamSession(session))
    }
}

fn sam2_encoder() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = SAM2_ENCODER_PATH.get().ok_or("SAM2 encoder path not set — set_sam2_model_paths() must run before any SAM2 use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn sam2_decoder() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = SAM2_DECODER_PATH.get().ok_or("SAM2 decoder path not set — set_sam2_model_paths() must run before any SAM2 use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// One named f32 input tensor for run_session() — owns its own data so the OrtValue created from
/// it stays valid for the lifetime of the Run() call (CreateTensorWithDataAsOrtValue does NOT
/// copy the data, it wraps the pointer directly).
// `data` is a Cow so cached embedding tensors can be passed BY REFERENCE per decode query —
// the SAM2 high-res feature maps are 32×256×256 + 64×128×128 + 1×256×64×64 f32 (~12MB total),
// and cloning all three on every scribble point made each mask query pay a pointless multi-MB
// memcpy. ORT's CreateTensorWithDataAsOrtValue borrows the buffer only for the run, so a
// borrow scoped to run_session is sufficient.
pub(crate) struct NamedInput<'a> {
    name: CString,
    data: std::borrow::Cow<'a, [f32]>,
    shape: Vec<i64>
}
pub(crate) fn input(name: &str, data: Vec<f32>, shape: &[i64]) -> NamedInput<'static> {
    NamedInput { name: CString::new(name).unwrap(), data: std::borrow::Cow::Owned(data), shape: shape.to_vec() }
}

/// Borrowing variant of `input` for large cached tensors (SAM embeddings) — no per-query copy.
pub(crate) fn input_ref<'a>(name: &str, data: &'a [f32], shape: &[i64]) -> NamedInput<'a> {
    NamedInput { name: CString::new(name).unwrap(), data: std::borrow::Cow::Borrowed(data), shape: shape.to_vec() }
}

/// Runs a session with the given named f32 inputs, returning the named f32 outputs requested (in
/// the same order as `output_names`). Shared by encode() and decode_point() — both this model
/// family's I/O is entirely f32 tensors, so one helper covers both.
pub(crate) fn run_session(sess: &Mutex<SamSession>, inputs: Vec<NamedInput>, output_names: &[&str]) -> Result<Vec<Vec<f32>>, String> {
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

        for inp in inputs.iter() {
            let mut value: *mut OrtValue = std::ptr::null_mut();
            let byte_len = inp.data.len() * std::mem::size_of::<f32>();
            let res = check(
                h.api,
                ((*h.api).CreateTensorWithDataAsOrtValue)(
                    mem_info,
                    // ORT only READS inference inputs; the *mut is the C API's signature, not a
                    // real mutation — safe to hand it a pointer derived from a shared borrow.
                    inp.data.as_ptr() as *mut _,
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

pub(crate) fn resize_rgb8(rgb: &[u8], w: u32, h: u32, new_w: u32, new_h: u32) -> Vec<u8> {
    use image::{imageops::FilterType, ImageBuffer, Rgb};
    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
        ImageBuffer::from_raw(w, h, rgb.to_vec()).expect("SAM resize: RGB buffer size mismatch");
    image::imageops::resize(&img, new_w, new_h, FilterType::Triangle).into_raw()
}

/// Per-channel ImageNet-ish normalization EdgeSAM's predictor_onnx.py applies BEFORE feeding the
/// encoder — unlike MobileSAM's export, this graph has no internal normalization/padding, so the
/// caller must do both. Order matters: normalize first, THEN zero-pad (i.e. the padded border is
/// 0 in NORMALIZED space, not raw pixel value 0 — matches `np.pad(..., constant_values=0)` being
/// applied after `(x - pixel_mean) / pixel_std` in preprocess()).
const PIXEL_MEAN: [f32; 3] = [123.675, 116.28, 103.53];
const PIXEL_STD: [f32; 3] = [58.395, 57.12, 57.375];

/// Encodes an already-decoded RGB8 image (interleaved, row-major, no alpha) into a SAM
/// embedding. Resizes so the longest side is exactly `SAM_SIZE` (`resize_longest_image_size` in
/// Meta's export), normalizes, and zero-pads to a fixed 1024x1024 CHW tensor — EdgeSAM's ONNX
/// graph takes a fixed-size input (unlike MobileSAM's, which padded internally and accepted any
/// size ≤1024), confirmed by a real `Run()` shape-mismatch error against a non-square photo
/// before this padding was added.
pub fn encode(rgb: &[u8], w: u32, h: u32) -> Result<Embedding, String> {
    if w == 0 || h == 0 {
        return Err("SAM encode: zero-sized image".into());
    }
    let scale = SAM_SIZE as f32 / w.max(h) as f32;
    let new_w = ((w as f32 * scale).round().max(1.0)) as u32;
    let new_h = ((h as f32 * scale).round().max(1.0)) as u32;
    let resized = resize_rgb8(rgb, w, h, new_w, new_h);

    // CHW, zero-padded to SAM_SIZE x SAM_SIZE, normalized per channel.
    let side = SAM_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..new_h as usize {
        for x in 0..new_w as usize {
            let src = (y * new_w as usize + x) * 3;
            for c in 0..3 {
                let v = (resized[src + c] as f32 - PIXEL_MEAN[c]) / PIXEL_STD[c];
                pixels[c * side * side + y * side + x] = v;
            }
        }
    }

    let sess = encoder()?;
    let mut outputs = run_session(sess, vec![input("image", pixels, &[1, 3, SAM_SIZE as i64, SAM_SIZE as i64])], &["image_embeddings"])?;
    Ok(Embedding { data: outputs.remove(0), orig_w: w, orig_h: h })
}

/// Converts a raw mask logit into a soft 0-255 alpha instead of a hard 0/255 threshold — the
/// model's own decision boundary (mask_threshold=0.0) still marks the edge, but nearby pixels
/// now carry a real feather gradient rather than a binary stair-step, which is what a hard
/// threshold turns into once upsampled from the model's native 256x256 logit resolution to a
/// multi-megapixel photo (blobby, jagged edges — see the "edges not tight to the object" plan
/// item). `k` controls how steep the falloff is; k=4 puts ~90% of the transition within about
/// ±1 logit unit of the boundary, tight enough to still read as a clean selection, not a
/// blurry alpha matte — a dedicated matting model (HQ-SAM/ViTMatte) would be needed to go
/// further than this, e.g. for genuine hair/fur alpha.
fn logit_to_soft_alpha(v: f32) -> u8 {
    let k = 4.0f32;
    (255.0 / (1.0 + (-v * k).exp())).round().clamp(0.0, 255.0) as u8
}
/// Bilinear-samples `src` (row-major, `src_w`x`src_h`) at floating-point pixel-center coordinates,
/// using the same half-pixel convention as cv2.resize(INTER_LINEAR)/PIL — `src_x = (dst_x+0.5) *
/// (src_w/dst_w) - 0.5` — so this matches EdgeSAM's own postprocess_masks() sample-for-sample.
pub(crate) fn bilinear_resize(src: &[f32], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<f32> {
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

/// Runs the decoder for an arbitrary SET of point prompts (a Lightroom-style "brush over the
/// object" scribble, sampled by the caller into positive/negative points along the stroke — see
/// chromasmith-22.html's mskAiScribble* — rather than a single tap), returning a full-original-
/// resolution mask — one byte per pixel, row-major, a soft 0-255 alpha centered on SAM's
/// standard mask_threshold=0.0 decision boundary (see logit_to_soft_alpha), not a hard binary
/// threshold — the frontend runs a further guided-filter edge-snap pass on top of this.
///
/// `points` are `(norm_x, norm_y, positive)` as 0..1 fractions of the ORIGINAL image (matching
/// this app's existing mask-geometry convention — see chromasmith-22.html's mskA cx/cy).
/// EdgeSAM's decoder takes a dynamic number of points with no required padding point (unlike
/// MobileSAM's fixed single-point export) — confirmed against EdgeSAM's own app.py, which calls
/// predict() with exactly the real click points for both single- and multi-point queries.
pub fn decode_points(embed: &Embedding, points: &[(f32, f32, bool)]) -> Result<Vec<u8>, String> {
    if points.is_empty() {
        return Err("SAM decode: no points given".into());
    }
    let scale = SAM_SIZE as f32 / embed.orig_w.max(embed.orig_h) as f32;
    let mut coords = Vec::with_capacity(points.len() * 2);
    let mut labels = Vec::with_capacity(points.len());
    for &(nx, ny, positive) in points {
        coords.push(nx.clamp(0.0, 1.0) * embed.orig_w as f32 * scale);
        coords.push(ny.clamp(0.0, 1.0) * embed.orig_h as f32 * scale);
        labels.push(if positive { 1.0 } else { 0.0 });
    }
    let n = points.len() as i64;
    // The unpadded region of the SAM_SIZE square canvas that the resized image actually occupies
    // — needed to crop the upsampled mask back out of the zero-padded square (see bilinear_resize
    // doc comment above and predictor_onnx.py's postprocess_masks).
    let input_w = ((embed.orig_w as f32 * scale).round().max(1.0)) as u32;
    let input_h = ((embed.orig_h as f32 * scale).round().max(1.0)) as u32;

    let sess = decoder()?;
    let mut outputs = run_session(
        sess,
        vec![
            input_ref("image_embeddings", &embed.data, &[1, 256, 64, 64]),
            input("point_coords", coords, &[1, n, 2]),
            input("point_labels", labels, &[1, n]),
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

    Ok(full_res.iter().map(|&v| logit_to_soft_alpha(v)).collect())
}

// ── SAM 2.1 encode/decode — see the module-level SAM2 doc comment and vendor/sam2/README.md.
// Kept as a separate embedding/query pair (not unified with Embedding/decode_points above)
// because the contracts are genuinely different: 3 cached tensors instead of 1, a DIRECT square
// resize instead of resize-longest-side+pad, different normalization constants, and a decoder
// that (unlike EdgeSAM's) takes mask_input/has_mask_input. The two tiers are invisible plumbing
// to the caller either way — chromasmith-22.html picks sam_points vs sam2_points per mask query,
// not per model internals.

const SAM2_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const SAM2_STD: [f32; 3] = [0.229, 0.224, 0.225];
/// SAM 2.1's low-res mask/iou output always has this many candidates (vs EdgeSAM's 4).
const NUM_SAM2_MASK_CANDIDATES: usize = 3;

pub struct Sam2Embedding {
    pub image_embed: Vec<f32>,     // [1,256,64,64]
    pub high_res_feats_0: Vec<f32>, // [1,32,256,256]
    pub high_res_feats_1: Vec<f32>, // [1,64,128,128]
    pub orig_w: u32,
    pub orig_h: u32
}

/// Encodes a photo for SAM 2.1. Unlike EdgeSAM/MobileSAM's resize-longest-side-then-pad, SAM 2.1
/// resizes DIRECTLY to a square 1024x1024 (distorting aspect ratio — see Meta's SAM2Transforms),
/// so callers don't need the input_w/input_h bookkeeping decode_points() needs; sam2_decode_points
/// below undoes the distortion in point-coordinate space and mask-upsample space independently.
pub fn sam2_encode(rgb: &[u8], w: u32, h: u32) -> Result<Sam2Embedding, String> {
    if w == 0 || h == 0 {
        return Err("SAM2 encode: zero-sized image".into());
    }
    let side = SAM_SIZE as usize;
    let resized = resize_rgb8(rgb, w, h, SAM_SIZE, SAM_SIZE);

    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let src = (y * side + x) * 3;
            for c in 0..3 {
                let v = (resized[src + c] as f32 / 255.0 - SAM2_MEAN[c]) / SAM2_STD[c];
                pixels[c * side * side + y * side + x] = v;
            }
        }
    }

    let sess = sam2_encoder()?;
    let mut outputs = run_session(
        sess,
        vec![input("image", pixels, &[1, 3, SAM_SIZE as i64, SAM_SIZE as i64])],
        &["image_embed", "high_res_feats_0", "high_res_feats_1"]
    )?;
    Ok(Sam2Embedding {
        image_embed: outputs.remove(0),
        high_res_feats_0: outputs.remove(0),
        high_res_feats_1: outputs.remove(0),
        orig_w: w,
        orig_h: h
    })
}

/// Same point-set query as decode_points(), against a SAM2Embedding. `points` are `(norm_x,
/// norm_y, positive)` as 0..1 fractions of the ORIGINAL image, same convention as decode_points.
pub fn sam2_decode_points(embed: &Sam2Embedding, points: &[(f32, f32, bool)]) -> Result<Vec<u8>, String> {
    if points.is_empty() {
        return Err("SAM2 decode: no points given".into());
    }
    // Point coords live in the DIRECT-1024-square-resize pixel space: (x/orig_w, y/orig_h)*1024
    // — independent x/y scale factors, since the encoder resize distorts aspect ratio rather
    // than preserving it (see Meta's SAM2Transforms.transform_coords).
    let mut coords = Vec::with_capacity(points.len() * 2);
    let mut labels = Vec::with_capacity(points.len());
    for &(nx, ny, positive) in points {
        coords.push(nx.clamp(0.0, 1.0) * SAM_SIZE as f32);
        coords.push(ny.clamp(0.0, 1.0) * SAM_SIZE as f32);
        labels.push(if positive { 1.0 } else { 0.0 });
    }
    let n = points.len() as i64;

    let sess = sam2_decoder()?;
    let mut outputs = run_session(
        sess,
        vec![
            input_ref("image_embed", &embed.image_embed, &[1, 256, 64, 64]),
            input_ref("high_res_feats_0", &embed.high_res_feats_0, &[1, 32, 256, 256]),
            input_ref("high_res_feats_1", &embed.high_res_feats_1, &[1, 64, 128, 128]),
            input("point_coords", coords, &[1, n, 2]),
            input("point_labels", labels, &[1, n]),
            input("mask_input", vec![0f32; (MASK_SIZE * MASK_SIZE) as usize], &[1, 1, MASK_SIZE as i64, MASK_SIZE as i64]),
            input("has_mask_input", vec![0.0], &[1]),
        ],
        &["masks", "iou_predictions"]
    )?;
    let masks = outputs.remove(0);
    let iou = outputs.remove(0);

    if iou.len() != NUM_SAM2_MASK_CANDIDATES || masks.len() != NUM_SAM2_MASK_CANDIDATES * (MASK_SIZE * MASK_SIZE) as usize {
        return Err(format!(
            "SAM2 decoder output size mismatch: {} iou scores, {} mask values (expected {NUM_SAM2_MASK_CANDIDATES} candidates of {MASK_SIZE}x{MASK_SIZE})",
            iou.len(),
            masks.len()
        ));
    }
    let best = iou.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i).unwrap_or(0);
    let low_res = &masks[best * (MASK_SIZE * MASK_SIZE) as usize..(best + 1) * (MASK_SIZE * MASK_SIZE) as usize];

    // Single-stage resize is correct here (unlike decode_points' two-stage crop) — the encoder's
    // direct square resize has no padding to crop back out, so independently rescaling x/y
    // un-distorts the aspect ratio in one step.
    let full_res = bilinear_resize(low_res, MASK_SIZE, MASK_SIZE, embed.orig_w, embed.orig_h);
    Ok(full_res.iter().map(|&v| logit_to_soft_alpha(v)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn setup_models() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        set_dylib_path(dylib);
        set_sam2_model_paths(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/sam2/encoder.onnx"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/sam2/decoder.onnx"),
        );
    }

    /// A synthetic photo with an unambiguous, off-center white square on a black background —
    /// a real-world "AI select doesn't select the right thing" bug (coordinate mismatch, crop
    /// error, axis swap) should show up as the returned mask NOT lining up with the square's
    /// known true bounds. Off-center (not a centered square) so a bug that silently centers or
    /// mirrors the query would be caught, not accidentally still line up by symmetry.
    struct SyntheticImage {
        rgb: Vec<u8>,
        w: u32,
        h: u32,
        sq_x0: u32,
        sq_y0: u32,
        sq_x1: u32,
        sq_y1: u32,
    }
    fn make_square_image() -> SyntheticImage {
        let (w, h) = (400u32, 300u32);
        let (sq_x0, sq_y0, sq_x1, sq_y1) = (250u32, 60u32, 350u32, 160u32); // off-center square
        let mut rgb = vec![0u8; (w * h * 3) as usize];
        for y in sq_y0..sq_y1 {
            for x in sq_x0..sq_x1 {
                let o = ((y * w + x) * 3) as usize;
                rgb[o] = 255;
                rgb[o + 1] = 255;
                rgb[o + 2] = 255;
            }
        }
        SyntheticImage { rgb, w, h, sq_x0, sq_y0, sq_x1, sq_y1 }
    }
    /// Fraction of `mask` (row-major, w*h, 0/255) that falls inside vs outside the square's true
    /// bounds — (inside_hit_rate, outside_false_positive_rate). A correct point-select on the
    /// square's center should score high inside, low outside.
    fn score_mask(mask: &[u8], img: &SyntheticImage) -> (f32, f32) {
        let (mut inside_hit, mut inside_total, mut outside_hit, mut outside_total) = (0u32, 0u32, 0u32, 0u32);
        for y in 0..img.h {
            for x in 0..img.w {
                let inside = x >= img.sq_x0 && x < img.sq_x1 && y >= img.sq_y0 && y < img.sq_y1;
                let on = mask[(y * img.w + x) as usize] > 0;
                if inside {
                    inside_total += 1;
                    if on { inside_hit += 1; }
                } else {
                    outside_total += 1;
                    if on { outside_hit += 1; }
                }
            }
        }
        (inside_hit as f32 / inside_total.max(1) as f32, outside_hit as f32 / outside_total.max(1) as f32)
    }

    #[test]
    fn edgesam_point_select_lands_on_square() {
        setup_models();
        let img = make_square_image();
        let embed = encode(&img.rgb, img.w, img.h).expect("EdgeSAM encode failed");
        let cx = (img.sq_x0 + img.sq_x1) as f32 / 2.0 / img.w as f32;
        let cy = (img.sq_y0 + img.sq_y1) as f32 / 2.0 / img.h as f32;
        let mask = decode_points(&embed, &[(cx, cy, true)]).expect("EdgeSAM decode failed");
        let (inside, outside) = score_mask(&mask, &img);
        println!("EdgeSAM: inside={inside:.3} outside={outside:.3}");
        assert!(inside > 0.5, "EdgeSAM mask should cover most of the square (center-tapped), got inside={inside:.3}");
        assert!(outside < 0.2, "EdgeSAM mask should mostly avoid the background, got outside={outside:.3}");
    }

    #[test]
    fn sam2_point_select_lands_on_square() {
        setup_models();
        let img = make_square_image();
        let embed = sam2_encode(&img.rgb, img.w, img.h).expect("SAM2 encode failed");
        let cx = (img.sq_x0 + img.sq_x1) as f32 / 2.0 / img.w as f32;
        let cy = (img.sq_y0 + img.sq_y1) as f32 / 2.0 / img.h as f32;
        let mask = sam2_decode_points(&embed, &[(cx, cy, true)]).expect("SAM2 decode failed");
        let (inside, outside) = score_mask(&mask, &img);
        println!("SAM2: inside={inside:.3} outside={outside:.3}");
        assert!(inside > 0.5, "SAM2 mask should cover most of the square (center-tapped), got inside={inside:.3}");
        assert!(outside < 0.2, "SAM2 mask should mostly avoid the background, got outside={outside:.3}");
    }
}
