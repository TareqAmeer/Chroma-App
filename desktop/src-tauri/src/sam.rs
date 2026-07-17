// AI tap-to-select (Masks panel): MobileSAM point-prompt segmentation via ONNX Runtime.
//
// Models are vendor/sam/*.onnx (MIT-licensed export from huggingface.co/Acly/MobileSAM — see
// vendor/sam/README.md for the full I/O contract, verified against the ACTUAL downloaded model
// files (`strings` on the .onnx protobufs) plus the export source (Meta's segment_anything
// utils/onnx.py + Acly's onnx_image_encoder.py), not guessed. Embedded via include_bytes! (not
// read from a runtime path) — the ~45MB adds to the binary, but sidesteps the "only works on my
// dev machine" hazard a runtime path lookup would have (this codebase's DIST_DIR already has an
// open TODO for exactly that problem elsewhere; no reason to add a second instance of it here).
//
// Pipeline: encode() runs once per photo (a few hundred ms — expensive relative to a tap, cheap
// relative to opening a RAW), producing a 256x64x64 embedding cached by the caller (main.rs).
// decode_point() runs per tap/click (~10-30ms) against that cached embedding — no re-encoding.
use ort::session::Session;
use ort::value::Tensor;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static ENCODER_BYTES: &[u8] = include_bytes!("../vendor/sam/mobile_sam_image_encoder.onnx");
static DECODER_BYTES: &[u8] = include_bytes!("../vendor/sam/sam_mask_decoder_single.onnx");

/// MobileSAM's ViT-t image_encoder.img_size — the model pads to this square canvas internally;
/// callers resize so the image's LONGEST side equals this before feeding it in.
const SAM_SIZE: u32 = 1024;

static DYLIB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's app `.setup()` (which has the Tauri AppHandle needed to resolve a
/// bundled resource path) before any SAM command can run. Must be set before the first
/// encoder()/decoder() call — ensure_ort_init() panics with a clear message if it wasn't.
pub fn set_dylib_path(path: PathBuf) {
    let _ = DYLIB_PATH.set(path);
}

/// Explicit, one-time ort environment init, pointed at the vendored dylib (`ort`'s
/// `load-dynamic` feature — see Cargo.toml for why: no x86_64-apple-darwin prebuilt exists for
/// `download-binaries`, and this project's actual dev machine is Intel). MUST run before the
/// first Session/Tensor use.
///
/// ⚠️ STILL UNRESOLVED as of this commit: `ort::init_from(path).commit()` here returns `true`
/// (success) instantly, but the very next `Session::builder()` call inside encoder()/decoder()
/// hangs indefinitely in this project's dev sandbox — reproduced with this exact fix in place,
/// not just the earlier lazy-init version. Also reproduced in COMPLETE isolation (a fresh
/// example with nothing but `ort::init_from(dylib).commit()` then `Session::builder()`, no model
/// involved at all) — so this is not specific to the MobileSAM model files. Every plausible
/// code-level fix (explicit vs. lazy init, call ordering) has been tried and none changed the
/// outcome, which points at something below the `ort`/Rust layer entirely — most likely this
/// sandbox's restricted process environment (it's a locked-down CI-style container, not a normal
/// Mac) rather than a real Intel Mac limitation, but that is UNCONFIRMED. Run `cargo run
/// --release --example sam_test -- <photo.jpg> 0.5 0.5 out.png` on the actual dev machine (a real
/// Intel Mac, not this sandbox) — if it ALSO hangs there, the `ort`/onnxruntime approach itself
/// may need to be abandoned in favor of a pure-Rust backend (`ort-tract`, no native dylib at all)
/// rather than continuing to chase this from inside the sandbox.
fn ensure_ort_init() -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| {
        let path = DYLIB_PATH.get().ok_or("SAM dylib path not set — set_dylib_path() must run before any AI Select use")?;
        let builder = ort::init_from(path).map_err(|e| format!("ort::init_from({}): {e}", path.display()))?;
        if !builder.commit() {
            return Err(format!("ort init did not commit (dylib: {})", path.display()));
        }
        Ok(())
    })
    .clone()
}

fn encoder() -> Result<&'static Mutex<Session>, String> {
    static S: OnceLock<Result<Mutex<Session>, String>> = OnceLock::new();
    S.get_or_init(|| {
        ensure_ort_init()?;
        let mut b = Session::builder().map_err(|e| format!("ort session builder: {e}"))?;
        let s = b.commit_from_memory(ENCODER_BYTES).map_err(|e| format!("load SAM encoder: {e}"))?;
        Ok(Mutex::new(s))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn decoder() -> Result<&'static Mutex<Session>, String> {
    static S: OnceLock<Result<Mutex<Session>, String>> = OnceLock::new();
    S.get_or_init(|| {
        ensure_ort_init()?;
        Session::builder()
            .map_err(|e| format!("ort session builder: {e}"))?
            .commit_from_memory(DECODER_BYTES)
            .map_err(|e| format!("load SAM decoder: {e}"))
            .map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// A cached image embedding — the expensive part of a SAM query, reusable across every tap on
/// the same photo. `orig_w`/`orig_h` are needed by decode_point() to convert a normalized
/// (0..1) tap position into the model's resized-pixel coordinate space, and to size the
/// returned mask raster.
pub struct Embedding {
    pub data: Vec<f32>, // [1,256,64,64], row-major
    pub orig_w: u32,
    pub orig_h: u32,
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
    let sess = encoder()?;
    let resized = resize_rgb8(rgb, w, h, new_w, new_h);

    let mut input = vec![0f32; (new_w as usize) * (new_h as usize) * 3];
    for i in 0..(new_w as usize * new_h as usize) {
        input[i * 3] = resized[i * 3] as f32;
        input[i * 3 + 1] = resized[i * 3 + 1] as f32;
        input[i * 3 + 2] = resized[i * 3 + 2] as f32;
    }
    let tensor = Tensor::from_array(([new_h as usize, new_w as usize, 3usize], input))
        .map_err(|e| format!("SAM input tensor: {e}"))?;
    let mut sess = sess.lock().map_err(|_| "SAM encoder lock poisoned".to_string())?;
    let outputs = sess
        .run(ort::inputs!["input_image" => tensor])
        .map_err(|e| format!("SAM encode inference: {e}"))?;
    let (_, embed) = outputs["image_embeddings"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("SAM embedding extract: {e}"))?;
    Ok(Embedding { data: embed.to_vec(), orig_w: w, orig_h: h })
}

/// Runs the decoder for a SINGLE point prompt (one tap), returning a full-original-resolution
/// binary mask — one byte per pixel, row-major, 255 = selected / 0 = not, already thresholded
/// at SAM's standard mask_threshold=0.0 on the raw logit.
///
/// `norm_x`/`norm_y` are the tap position as a 0..1 fraction of the ORIGINAL image (matching
/// this app's existing mask-geometry convention — see chromasmith-22.html's mskA cx/cy). A lone
/// point is paired with an implicit (0,0)/label=-1 padding point — segment_anything's prompt
/// encoder was trained expecting that pairing for a single click (see vendor/sam/README.md).
pub fn decode_point(embed: &Embedding, norm_x: f32, norm_y: f32, positive: bool) -> Result<Vec<u8>, String> {
    let scale = SAM_SIZE as f32 / embed.orig_w.max(embed.orig_h) as f32;
    let px = (norm_x.clamp(0.0, 1.0)) * embed.orig_w as f32 * scale;
    let py = (norm_y.clamp(0.0, 1.0)) * embed.orig_h as f32 * scale;

    let point_coords = Tensor::from_array(([1usize, 2usize, 2usize], vec![px, py, 0.0, 0.0]))
        .map_err(|e| format!("point_coords: {e}"))?;
    let point_labels = Tensor::from_array(([1usize, 2usize], vec![if positive { 1.0 } else { 0.0 }, -1.0]))
        .map_err(|e| format!("point_labels: {e}"))?;
    let mask_input = Tensor::from_array(([1usize, 1usize, 256usize, 256usize], vec![0f32; 256 * 256]))
        .map_err(|e| format!("mask_input: {e}"))?;
    let has_mask_input =
        Tensor::from_array(([1usize], vec![0f32])).map_err(|e| format!("has_mask_input: {e}"))?;
    let orig_im_size = Tensor::from_array(([2usize], vec![embed.orig_h as f32, embed.orig_w as f32]))
        .map_err(|e| format!("orig_im_size: {e}"))?;
    let embed_tensor = Tensor::from_array(([1usize, 256usize, 64usize, 64usize], embed.data.clone()))
        .map_err(|e| format!("image_embeddings: {e}"))?;

    let sess = decoder()?;
    let mut sess = sess.lock().map_err(|_| "SAM decoder lock poisoned".to_string())?;
    let outputs = sess
        .run(ort::inputs! {
            "image_embeddings" => embed_tensor,
            "point_coords" => point_coords,
            "point_labels" => point_labels,
            "mask_input" => mask_input,
            "has_mask_input" => has_mask_input,
            "orig_im_size" => orig_im_size,
        })
        .map_err(|e| format!("SAM decode inference: {e}"))?;
    let (_, masks) = outputs["masks"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("SAM mask extract: {e}"))?;

    let n = (embed.orig_w as usize) * (embed.orig_h as usize);
    if masks.len() < n {
        return Err(format!("SAM mask size mismatch: got {} values, expected {n}", masks.len()));
    }
    Ok(masks[..n].iter().map(|&v| if v > 0.0 { 255u8 } else { 0u8 }).collect())
}
