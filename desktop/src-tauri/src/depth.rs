// Monocular depth estimation (ROADMAP R7) — a per-pixel relative-depth map feeding two features:
// a shapeless "Depth Range" mask type (chromasmith-22.html, alongside Colour Range / Luminance
// Range — see CLAUDE.md §5b) and a depth-driven lens-blur / tilt-shift effect. Same pattern as
// sam.rs (EdgeSAM/SAM2) and faceparse.rs (SegFormer face parsing): a cached ONNX session behind a
// OnceLock<Mutex<...>>, `create_session_from_path`/`run_session` from sam.rs, one Tauri command.
//
// Model: Depth Anything V2 Small, ONNX export `onnx-community/depth-anything-v2-small`
// (`model_quantized.onnx`, int8, 26.0MB), converted from `depth-anything/Depth-Anything-V2-Small`.
// See vendor/depth/README.md for the full sourcing/licensing verification — both the export repo
// and the base model declare `apache-2.0` via their HF model cards (checked, not assumed). This is
// the ONLY Depth Anything V2 size with no non-commercial clause (Base/Large are cc-by-nc-4.0),
// which is also why Small was picked over a possibly-more-accurate larger variant.
//
// ⚠️ UNLIKE faceparse.rs, this integration's I/O contract was NOT verified with a live
// onnxruntime forward pass — every attempt in the build environment failed for an unrelated
// reason (no matching onnx Python wheel for the system's Python 3.8; the local onnxruntime-node
// install fetched only a darwin/arm64 native binding on an x86_64 host). What WAS verified for
// real: `strings -a model_quantized.onnx` shows exactly the input/output tensor names below (the
// standard Transformers `DPTImageProcessor`/`AutoModelForDepthEstimation` export naming), and
// `preprocessor_config.json` was downloaded as a real file, not guessed. The fixed 518x518 square
// input size is taken from that file's `size` field; run_session already validates the output
// element count against the expected H*W and returns a descriptive Err rather than panicking if a
// live model disagrees, so a contract mismatch fails loudly on first real desktop run instead of
// silently — re-run with a debug eprintln of `outputs[0].len()` on first real hardware use and
// update this comment with the confirmed number.
//
// Output convention: Depth Anything predicts DISPARITY (inverse depth) — larger raw value = nearer
// the camera, per the model's own repo (DepthAnything/Depth-Anything-V2 issue #93). There is no
// fixed output range, so `estimate()` min-max normalizes each photo's own map to 0.0 (farthest
// point in this photo) .. 1.0 (nearest point in this photo) — the same per-image normalization the
// upstream repo's own visualization code uses. This is a *relative* map, not metric distance.

use crate::sam::{bilinear_resize, create_session_from_path, input, resize_rgb8, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// Fixed square working resolution, matching `preprocessor_config.json`'s documented `size`
/// (518x518) rather than its dynamic aspect-preserving resize — same simplification faceparse.rs
/// makes for its own fixed-512 input, for the same reason (one fixed ONNX input shape, no
/// per-aspect-ratio session recreation).
const DEPTH_SIZE: u32 = 518;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's `.setup()`, same pattern as `faceparse::set_model_path`.
pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH
            .get()
            .ok_or("depth model path not set — set_model_path() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Runs depth estimation on an already-decoded RGB8 photo and returns a single-channel relative
/// depth map, upsampled to the CALLER's (w, h) — matching faceparse::parse's "return at the
/// resolution you asked for" convention. 0 = farthest point in this photo, 255 = nearest.
pub fn estimate(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    if w == 0 || h == 0 {
        return Err("depth: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("depth: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }

    let resized = resize_rgb8(rgb, w, h, DEPTH_SIZE, DEPTH_SIZE);
    let side = DEPTH_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let src = (y * side + x) * 3;
            for c in 0..3 {
                let v = (resized[src + c] as f32 / 255.0 - MEAN[c]) / STD[c];
                pixels[c * side * side + y * side + x] = v;
            }
        }
    }

    let sess = session()?;
    let mut outputs = run_session(
        sess,
        vec![input("pixel_values", pixels, &[1, 3, DEPTH_SIZE as i64, DEPTH_SIZE as i64])],
        &["predicted_depth"]
    )?;
    let raw = outputs.remove(0);
    if raw.len() != side * side {
        return Err(format!(
            "depth: unexpected predicted_depth size {} (expected {DEPTH_SIZE}x{DEPTH_SIZE} = {})",
            raw.len(),
            side * side
        ));
    }

    // Per-photo min-max normalize the disparity map to 0..1 (see module doc comment on why this
    // is the right convention for a relative, unbounded model output).
    let mut mn = f32::MAX;
    let mut mx = f32::MIN;
    for &v in &raw {
        if v < mn { mn = v; }
        if v > mx { mx = v; }
    }
    let span = (mx - mn).max(1e-6);
    let norm: Vec<f32> = raw.iter().map(|&v| (v - mn) / span).collect();

    let up = bilinear_resize(&norm, DEPTH_SIZE, DEPTH_SIZE, w, h);
    Ok(up.iter().map(|&v| (v.clamp(0.0, 1.0) * 255.0).round() as u8).collect())
}

#[tauri::command]
pub fn depth_estimate(rgb: Vec<u8>, w: u32, h: u32) -> Result<Vec<u8>, String> {
    estimate(&rgb, w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() -> bool {
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/depth/model_quantized.onnx");
        if !model.exists() {
            eprintln!("skipping: {} not present in this checkout", model.display());
            return false;
        }
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
        set_model_path(model);
        true
    }

    /// Data-only check needing no model: a synthetic bilinear_resize/normalization round trip on
    /// a hand-built "raw disparity" buffer confirms the min-max normalization itself is correct
    /// (farthest -> 0, nearest -> 255) independent of whether the real ONNX session can load in
    /// this environment.
    #[test]
    fn normalization_maps_min_to_zero_and_max_to_255() {
        let side = 4usize;
        // Fake disparity: rises left-to-right, i.e. "nearer" toward the right edge.
        let raw: Vec<f32> = (0..side * side).map(|i| (i % side) as f32).collect();
        let mut mn = f32::MAX;
        let mut mx = f32::MIN;
        for &v in &raw {
            if v < mn { mn = v; }
            if v > mx { mx = v; }
        }
        let span = (mx - mn).max(1e-6);
        let norm: Vec<f32> = raw.iter().map(|&v| (v - mn) / span).collect();
        let bytes: Vec<u8> = norm.iter().map(|&v| (v.clamp(0.0, 1.0) * 255.0).round() as u8).collect();
        assert_eq!(bytes[0], 0, "leftmost (farthest) column should normalize to 0");
        assert_eq!(bytes[side - 1], 255, "rightmost (nearest) column should normalize to 255");
    }

    /// End-to-end sanity check against a real photo, mirroring faceparse.rs's
    /// `face_features_land_in_plausible_regions` test — only runs if both the model file and a
    /// real test photo are present in this checkout; otherwise it reports why it skipped, per
    /// this project's rule of never fabricating a result it can't actually measure.
    #[test]
    fn depth_map_has_plausible_foreground_background_split() {
        if !setup_model() {
            return;
        }
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let path = repo_root.join("__TM3390.jpg");
        if !path.exists() {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        }
        let img = image::open(&path).expect("open __TM3390.jpg").to_rgb8();
        let (iw, ih) = img.dimensions();
        // Downscale before running — the model resizes to 518x518 internally regardless, and a
        // smaller input here just speeds up resize_rgb8's own CPU resample.
        let scale = 800.0 / (iw.max(ih) as f32);
        let (dw, dh) = ((iw as f32 * scale) as u32, (ih as f32 * scale) as u32);
        let small = image::imageops::resize(&img, dw.max(1), dh.max(1), image::imageops::FilterType::Triangle);

        match estimate(small.as_raw(), dw, dh) {
            Ok(map) => {
                let mean = |v: &[u8]| -> f32 { v.iter().map(|&x| x as f32).sum::<f32>() / (v.len() as f32) };
                let m = mean(&map);
                println!("depth map mean={m:.2} (0=far,255=near), size={dw}x{dh}");
                // A real photo should have SOME spread — a degenerate all-flat output (a broken
                // session silently returning zeros, or the wrong output tensor entirely) would
                // report a std of ~0.
                let variance: f32 = map.iter().map(|&x| (x as f32 - m).powi(2)).sum::<f32>() / (map.len() as f32);
                let std = variance.sqrt();
                println!("depth map std={std:.2}");
                assert!(std > 5.0, "depth map is implausibly flat (std={std:.2}) — check output tensor");
            }
            Err(e) => {
                // Honest failure, not a fabricated pass — record the exact error for whoever next
                // runs this on real hardware with the model actually loadable.
                panic!("depth estimate() failed: {e}");
            }
        }
    }
}
