// Pet/animal detection — RT-DETR (ResNet-18 backbone), COCO-trained. People-pets wireframes
// screen P: "detection is easy and licensing-clean; identity is hard". This module is ONLY the
// easy half — "there's an animal here, roughly this box, probably this species" — never "which
// individual animal". That job stays exactly where it already was: subject.rs's PerSAM path
// (~77-80% recall, measured on a real multi-year dataset — see that file's own module doc). A
// detection from here becomes a starting point for Teach/Find (an auto pet-person the review
// queue surfaces, per catalog.rs's `catalog_pets_scan`) instead of a hand-scribbled one.
//
// Model, license, and the full verified I/O contract: vendor/rtdetr/README.md. In short —
// Apache-2.0 (chosen over Ultralytics YOLO's AGPL-3.0, which would force open-sourcing this app
// or an enterprise licence for a public commercial .dmg), input `pixel_values` [1,3,640,640]
// rescaled 0..1 with NO mean/std normalization, outputs `logits` [1,300,80] (sigmoid, not
// softmax — independent per-class probabilities) and `pred_boxes` [1,300,4] (center-x,
// center-y, width, height, normalized 0..1 — NOT a corner box). No NMS: RT-DETR is trained
// NMS-free, so taking the top-scoring queries directly is correct, not a shortcut.

use crate::sam::{create_session_from_path, input, resize_rgb8, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const INPUT_SIZE: u32 = 640;
const NUM_QUERIES: usize = 300;
const NUM_CLASSES: usize = 80;
const SCORE_THRESH: f32 = 0.4;

/// The 4 COCO classes this app cares about, verified against the real downloaded `config.json`'s
/// `id2label` (see vendor/rtdetr/README.md) — not assumed from a published class list. Anything
/// else RT-DETR detects (person, car, ...) is simply not this feature's job and is dropped.
const PET_CLASSES: [(usize, &str); 4] = [(14, "bird"), (15, "cat"), (16, "dog"), (17, "horse")];

fn pet_class_name(idx: usize) -> Option<&'static str> {
    PET_CLASSES.iter().find(|(i, _)| *i == idx).map(|(_, name)| *name)
}

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's `.setup()`, same pattern as `faceparse::set_model_path`.
pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH.get().ok_or("pet detector model path not set — set_model_path() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// One detected animal, in the SAME 0..1-fractional-of-the-whole-image convention
/// `catalog::FaceBox` uses (a corner box: x0,y0 top-left, x1,y1 bottom-right) — so the caller
/// (`catalog_pets_scan`) can write it straight into `photo_faces` alongside human faces with no
/// extra conversion.
#[derive(Debug, Clone)]
pub struct PetDetection {
    pub species: &'static str,
    pub score: f32,
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// `rgb` is a full decoded RGB8 image (any size — internally resized to the model's fixed
/// 640×640 input, exactly like `faceparse::parse`'s crop resize). Returns detections sorted by
/// descending score, already filtered to `PET_CLASSES` and `SCORE_THRESH`.
pub fn detect(rgb: &[u8], w: u32, h: u32) -> Result<Vec<PetDetection>, String> {
    if w == 0 || h == 0 {
        return Err("pet detect: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("pet detect: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }

    let resized = resize_rgb8(rgb, w, h, INPUT_SIZE, INPUT_SIZE);
    let side = INPUT_SIZE as usize;
    // NCHW, rescale to 0..1 ONLY — verified `do_normalize: false` in the real
    // preprocessor_config.json (see vendor/rtdetr/README.md). No ImageNet mean/std here, unlike
    // faceparse.rs's model — easy to get wrong by assuming every ONNX vision model normalizes
    // the same way, so this was checked against a real inference run, not assumed.
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let src = (y * side + x) * 3;
            for c in 0..3 {
                pixels[c * side * side + y * side + x] = resized[src + c] as f32 / 255.0;
            }
        }
    }

    let sess = session()?;
    let mut outputs = run_session(
        sess,
        vec![input("pixel_values", pixels, &[1, 3, INPUT_SIZE as i64, INPUT_SIZE as i64])],
        &["logits", "pred_boxes"],
    )?;
    let boxes = outputs.remove(1);
    let logits = outputs.remove(0);
    if logits.len() != NUM_QUERIES * NUM_CLASSES {
        return Err(format!("pet detect: unexpected logits size {} (expected {NUM_QUERIES}x{NUM_CLASSES})", logits.len()));
    }
    if boxes.len() != NUM_QUERIES * 4 {
        return Err(format!("pet detect: unexpected pred_boxes size {} (expected {NUM_QUERIES}x4)", boxes.len()));
    }

    let sigmoid = |x: f32| 1.0 / (1.0 + (-x).exp());
    let mut out = Vec::new();
    for q in 0..NUM_QUERIES {
        // argmax over the 80 classes, but only bother computing sigmoid for classes we keep —
        // this is a fixed small set (4), so the naive scan costs nothing at 300 queries.
        let mut best: Option<(usize, f32)> = None;
        for &(class_idx, _) in PET_CLASSES.iter() {
            let p = sigmoid(logits[q * NUM_CLASSES + class_idx]);
            if best.map(|(_, bp)| p > bp).unwrap_or(true) {
                best = Some((class_idx, p));
            }
        }
        let Some((class_idx, score)) = best else { continue };
        if score < SCORE_THRESH {
            continue;
        }
        let Some(species) = pet_class_name(class_idx) else { continue };
        // cxcywh, normalized 0..1 -> corner box, same normalized 0..1 space (the model's input
        // square maps 1:1 onto the ORIGINAL image's own aspect-agnostic fractional coordinates,
        // since both are 0..1 of "the whole frame" — no letterbox was used, just a stretch
        // resize to 640x640, so no de-letterbox math is needed unlike scrfd.rs's decode).
        let (cx, cy, bw, bh) = (boxes[q * 4], boxes[q * 4 + 1], boxes[q * 4 + 2], boxes[q * 4 + 3]);
        let x0 = (cx - bw / 2.0).clamp(0.0, 1.0);
        let y0 = (cy - bh / 2.0).clamp(0.0, 1.0);
        let x1 = (cx + bw / 2.0).clamp(0.0, 1.0);
        let y1 = (cy + bh / 2.0).clamp(0.0, 1.0);
        out.push(PetDetection { species, score, x0, y0, x1, y1 });
    }
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/rtdetr/model_quantized.onnx");
        set_model_path(path);
    }

    /// Same real-photo regression pattern `faceparse.rs`'s own test uses — a synthetic shape
    /// image can't stand in for a real CNN classifier the way it can for SAM's prompt-based
    /// segmentation. The classic `pjreddie/darknet` `dog.jpg` (dog, bicycle, parked truck) is
    /// NOT committed to this repo (unclear image-specific licensing on an otherwise public-
    /// domain-licensed project — see vendor/rtdetr/README.md) — fetch it locally to exercise
    /// this test; it skips gracefully when absent, exactly like face_features_land_in_plausible_
    /// regions does for __TM3390.jpg.
    ///
    ///     curl -sL https://raw.githubusercontent.com/pjreddie/darknet/master/data/dog.jpg \
    ///       -o desktop/src-tauri/dog_test_fixture.jpg
    #[test]
    fn dog_test_fixture_is_detected_as_a_dog_in_a_plausible_box() {
        setup_model();
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = repo_root.join("dog_test_fixture.jpg");
        if !path.exists() {
            eprintln!("skipping: {} not present in this checkout (see this test's own doc comment)", path.display());
            return;
        }
        let img = image::open(&path).expect("open dog_test_fixture.jpg").to_rgb8();
        let (w, h) = img.dimensions();
        let dets = detect(img.as_raw(), w, h).expect("pet detect run");
        let dog = dets.iter().find(|d| d.species == "dog").expect("must detect a dog");
        assert!(dog.score > 0.7, "dog score should be high-confidence, got {}", dog.score);
        // Verified box on this exact 768x576 fixture (vendor/rtdetr/README.md's transcript):
        // (131,222)-(310,541) pixels -> (0.171,0.386)-(0.404,0.939) fractional. Generous
        // tolerance — this asserts "roughly the dog's actual location", not exact reproduction.
        assert!((dog.x0 - 0.171).abs() < 0.05, "x0 should be ~0.17, got {}", dog.x0);
        assert!((dog.y0 - 0.386).abs() < 0.05, "y0 should be ~0.39, got {}", dog.y0);
        assert!((dog.x1 - 0.404).abs() < 0.05, "x1 should be ~0.40, got {}", dog.x1);
        assert!((dog.y1 - 0.939).abs() < 0.05, "y1 should be ~0.94, got {}", dog.y1);
    }

    #[test]
    fn detect_rejects_a_size_mismatched_buffer_instead_of_panicking() {
        setup_model();
        let err = detect(&[0u8; 10], 100, 100).unwrap_err();
        assert!(err.contains("does not match"));
    }
}
