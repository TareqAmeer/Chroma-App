// Face-feature parsing (ROADMAP item 16) — an automatic EXCLUSION layer on top of the AI subject
// mask (sam.rs). Answers "which pixels inside this person are lips / eyes+brows / glasses / hair",
// so the Skin Tone tool can auto-erase them instead of requiring a hand-painted brush stroke for
// each one.
//
// ⚠️ This does NOT replace SAM and must never be used as the skin selector. Model:
// jonathandinu/face-parsing (SegFormer fine-tuned on CelebAMask-HQ, ONNX contributed by Xenova).
// Its 19 classes are FACE-CENTRIC (skin/neck/nose/ears/lips/eyes/brows/glasses/hair/hat/clothing)
// with NO torso, chest, shoulder or arm class — CelebAMask-HQ is face crops. The complaint that
// started the skin-tone work was chest-vs-face; used as a selector this model would grab the face
// and drop the chest entirely. It is only ever run on a face-region CROP, and only to produce
// exclusion masks for the features SAM's subject mask cannot distinguish from skin.
//
// ⚠️ THE PUBLISHED CLASS TABLE THIS WAS SPECCED AGAINST WAS WRONG. Verified the real contract with
// onnx.load()/onnxruntime against the actual downloaded .onnx (see vendor/faceparse/README.md for
// the full verification transcript) rather than trusting the quoted indices — the same rule
// sam.rs's EdgeSAM/SAM2 integration already follows. Differences that would have silently excluded
// the wrong features had they gone unchecked: glasses is index 3 here (quoted table said 6), hair
// is 13 (quoted 17), lips are 11/12 (quoted 12/13), neck is 17 (quoted 14).
//
// Real config.json id2label (jonathandinu/face-parsing):
//   0 background  1 skin      2 nose      3 eye_g(lasses)  4 l_eye     5 r_eye
//   6 l_brow      7 r_brow    8 l_ear     9 r_ear          10 mouth    11 u_lip
//   12 l_lip      13 hair     14 hat      15 ear_r         16 neck_l   17 neck
//   18 cloth
//
// Preprocessing (preprocessor_config.json, also independently verified): 512x512 RGB, scale to
// 0..1, ImageNet mean/std. Output is [1,19,128,128] — ONE QUARTER of the input resolution, NOT
// 512x512 — SegFormer's decode head does not upsample in the exported graph (confirmed by actually
// running it; the model's declared shapes are dynamic and say nothing about this). Verified visually
// on a real crop from __TM3390.jpg: glasses/nose/lips/hair/ear all land exactly where they should
// once the logits are bilinearly upsampled BEFORE argmax (matching HF's own post-processing order
// — upsampling after a hard argmax would alias the class boundaries).

use crate::sam::{bilinear_resize, create_session_from_path, input, resize_rgb8, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const FP_SIZE: u32 = 512;
/// SegFormer's exported decode head emits logits at 1/4 of FP_SIZE — verified by actually running
/// the model (see module doc comment), not assumed from its declared dynamic shape.
const LOGIT_SIZE: u32 = FP_SIZE / 4;
const NUM_CLASSES: usize = 19;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

// Real CelebAMask-HQ class indices for this model — see the module doc comment for why these
// are NOT the indices originally quoted, and why that would have mattered.
const CLASS_EYES_BROWS: [usize; 4] = [4, 5, 6, 7]; // l_eye, r_eye, l_brow, r_brow
const CLASS_GLASSES: [usize; 1] = [3]; // eye_g
const CLASS_LIPS: [usize; 3] = [10, 11, 12]; // mouth (interior), u_lip, l_lip
const CLASS_HAIR: [usize; 1] = [13]; // hair

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's `.setup()`, same pattern as `sam::set_sam2_model_paths`.
pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH
            .get()
            .ok_or("face-parse model path not set — set_model_path() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// One soft (0..255) alpha mask per feature group, each at the CALLER'S requested (w, h) — the
/// resolution of the crop passed in, matching decode_points()'s "return at the resolution you
/// asked for" convention so the caller never has to resize the result again.
pub struct FaceMasks {
    pub eyes_brows: Vec<u8>,
    pub glasses: Vec<u8>,
    pub lips: Vec<u8>,
    pub hair: Vec<u8>,
    pub w: u32,
    pub h: u32,
}

/// `rgb` is an already-cropped, roughly-square RGB8 region containing a face (the caller derives
/// the crop from the SAM subject mask's bounding box — see chromasmith-22.html's
/// mskFaceAutoExclude). Internally resized to the model's fixed 512x512 input; the returned masks
/// are upsampled back to the CALLER's (w, h), not 512x512.
pub fn parse(rgb: &[u8], w: u32, h: u32) -> Result<FaceMasks, String> {
    if w == 0 || h == 0 {
        return Err("face-parse: zero-sized crop".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("face-parse: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }

    let resized = resize_rgb8(rgb, w, h, FP_SIZE, FP_SIZE);
    let side = FP_SIZE as usize;
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
        vec![input("pixel_values", pixels, &[1, 3, FP_SIZE as i64, FP_SIZE as i64])],
        &["logits"]
    )?;
    let logits = outputs.remove(0);
    let lside = LOGIT_SIZE as usize;
    if logits.len() != NUM_CLASSES * lside * lside {
        return Err(format!(
            "face-parse: unexpected logits size {} (expected {} classes of {LOGIT_SIZE}x{LOGIT_SIZE})",
            logits.len(),
            NUM_CLASSES
        ));
    }

    // Per-pixel softmax over the 19 classes at the model's native 128x128, THEN group-sum THEN
    // upsample — softmax first is what makes the result a genuinely soft alpha (confidence),
    // rather than a hard argmax-then-upsample which would just alias a binary edge.
    let mut group_probs: [Vec<f32>; 4] = [
        vec![0f32; lside * lside], // eyes_brows
        vec![0f32; lside * lside], // glasses
        vec![0f32; lside * lside], // lips
        vec![0f32; lside * lside], // hair
    ];
    for px in 0..(lside * lside) {
        let mut mx = f32::MIN;
        for c in 0..NUM_CLASSES {
            let v = logits[c * lside * lside + px];
            if v > mx {
                mx = v;
            }
        }
        let mut exps = [0f32; NUM_CLASSES];
        let mut sum = 0f32;
        for c in 0..NUM_CLASSES {
            let e = (logits[c * lside * lside + px] - mx).exp();
            exps[c] = e;
            sum += e;
        }
        let inv = if sum > 0.0 { 1.0 / sum } else { 0.0 };
        let group_sum = |classes: &[usize]| -> f32 { classes.iter().map(|&c| exps[c] * inv).sum() };
        group_probs[0][px] = group_sum(&CLASS_EYES_BROWS);
        group_probs[1][px] = group_sum(&CLASS_GLASSES);
        group_probs[2][px] = group_sum(&CLASS_LIPS);
        group_probs[3][px] = group_sum(&CLASS_HAIR);
    }

    let to_u8 = |probs: &[f32]| -> Vec<u8> {
        let up = bilinear_resize(probs, LOGIT_SIZE, LOGIT_SIZE, w, h);
        up.iter().map(|&p| (p.clamp(0.0, 1.0) * 255.0).round() as u8).collect()
    };

    Ok(FaceMasks {
        eyes_brows: to_u8(&group_probs[0]),
        glasses: to_u8(&group_probs[1]),
        lips: to_u8(&group_probs[2]),
        hair: to_u8(&group_probs[3]),
        w,
        h
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
        set_model_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/faceparse/model_quantized.onnx"));
    }

    /// Loads a real photo crop (checked into the repo root for other tests/probes to use) and
    /// asserts the feature groups land in plausible relative positions and sizes — this is a face
    /// model, so a synthetic shape image (as sam.rs's tests use) can't stand in for it the way it
    /// can for subject segmentation. Mirrors the visual check already done in Python
    /// (test/probe outputs, see vendor/faceparse/README.md) but as a standing regression test.
    #[test]
    fn face_features_land_in_plausible_regions() {
        setup_model();
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let path = repo_root.join("__TM3390.jpg");
        if !path.exists() {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        }
        let img = image::open(&path).expect("open __TM3390.jpg").to_rgb8();
        let (iw, ih) = img.dimensions();
        // Same rough head crop used to verify this model in Python.
        let (cx, cy, half) = (1400i64, 3900i64, 900i64);
        let (x0, y0) = ((cx - half).max(0) as u32, (cy - half).max(0) as u32);
        let (x1, y1) = ((cx + half).min(iw as i64) as u32, (cy + half).min(ih as i64) as u32);
        let (cw, ch) = (x1 - x0, y1 - y0);
        let crop = image::imageops::crop_imm(&img, x0, y0, cw, ch).to_image();
        let masks = parse(crop.as_raw(), cw, ch).expect("face-parse run");

        let mean = |m: &[u8]| -> f32 { m.iter().map(|&v| v as f32).sum::<f32>() / (m.len() as f32 * 255.0) };
        let (eb, gl, lp, ha) = (mean(&masks.eyes_brows), mean(&masks.glasses), mean(&masks.lips), mean(&masks.hair));
        println!("mean coverage: eyes_brows={eb:.4} glasses={gl:.4} lips={lp:.4} hair={ha:.4}");

        // The subject wears sunglasses, which occlude the eyes: glasses should be a real presence,
        // hair should cover a substantial share of this crop (it fills the top/sides of frame),
        // and lips are a small but nonzero feature. None should be near-total (>60%) or dominate
        // the frame the way a broken groupby (e.g. reading raw background prob) would.
        assert!(gl > 0.02, "expected glasses to be detected (sunglasses in this photo), got {gl:.4}");
        assert!(ha > 0.05, "expected hair to cover a real share of this crop, got {ha:.4}");
        assert!(lp > 0.0005 && lp < 0.05, "lips should be small but present, got {lp:.4}");
        for (name, v) in [("eyes_brows", eb), ("glasses", gl), ("lips", lp), ("hair", ha)] {
            assert!(v < 0.6, "{name} covers implausibly ({v:.4}) much of the crop — check class indices");
        }
    }
}
