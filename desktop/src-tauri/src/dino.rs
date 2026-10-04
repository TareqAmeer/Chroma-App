// Pet identity embeddings — DINOv2 ViT-S/14 (Meta, Apache-2.0), exported from timm's
// `vit_small_patch14_dinov2.lvd142m` at a 224x224 input (see vendor/dinov2/README.md).
//
// Why not the models already here: ArcFace is a HUMAN face model — on a dog's face it scores
// strangers, gravel and passers-by as alike as the dog itself — and CLIP ViT-B/32 is tuned for
// "what is this" not "which one is this". Measured on the user's own confirmed photos of three
// dogs (164 crops), matching the right dog across different days: CLIP 94%, DINOv2-S 99%, and
// DINOv2-S is also faster on this Intel Mac (~0.13s vs ~0.19s a crop). MegaDescriptor (the
// wildlife re-ID model) scored no better at 27x the cost.

use crate::sam::{create_session_from_path, input, resize_rgb8, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const SIZE: u32 = 224;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];
pub const DIM: usize = 384;

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH.get().ok_or("DINOv2 model path not set — set_model_path() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Unit-length 384-dim embedding of an RGB8 crop (any size; squashed to 224x224, as measured).
pub fn embed_image(rgb: &[u8], w: u32, h: u32) -> Result<Vec<f32>, String> {
    if w == 0 || h == 0 || rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("dino: bad image {w}x{h} ({} bytes)", rgb.len()));
    }
    let r = resize_rgb8(rgb, w, h, SIZE, SIZE);
    let side = SIZE as usize;
    let mut px = vec![0f32; 3 * side * side];
    for i in 0..side * side {
        for c in 0..3 {
            px[c * side * side + i] = (r[i * 3 + c] as f32 / 255.0 - MEAN[c]) / STD[c];
        }
    }
    let mut out = run_session(session()?, vec![input("pixel_values", px, &[1, 3, SIZE as i64, SIZE as i64])], &["embedding"])?;
    let mut e = out.remove(0);
    if e.len() != DIM {
        return Err(format!("dino: unexpected embedding length {}", e.len()));
    }
    let n = e.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 0.0 {
        e.iter_mut().for_each(|x| *x /= n);
    }
    Ok(e)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_dog_scores_far_above_a_different_scene() {
        crate::sam::set_dylib_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(crate::platform::ort_lib_dev_path()));
        set_model_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/dinov2/model.onnx"));
        // Synthetic: a brown blob on green, its mirror image, and a flat blue field.
        let (w, h) = (160u32, 120u32);
        let img = |mirror: bool, blue: bool| -> Vec<u8> {
            let mut v = Vec::with_capacity((w * h * 3) as usize);
            for y in 0..h {
                for x in 0..w {
                    let xx = if mirror { w - 1 - x } else { x };
                    let d = ((xx as f32 - 60.0).powi(2) + (y as f32 - 60.0).powi(2)).sqrt();
                    let px = if blue { [90, 140, 220] } else if d < 40.0 { [140, 90, 50] } else { [60, 150, 60] };
                    v.extend_from_slice(&px);
                }
            }
            v
        };
        let a = embed_image(&img(false, false), w, h).unwrap();
        let b = embed_image(&img(true, false), w, h).unwrap();
        let c = embed_image(&img(false, true), w, h).unwrap();
        assert_eq!(a.len(), DIM);
        let dot = |x: &[f32], y: &[f32]| x.iter().zip(y).map(|(p, q)| p * q).sum::<f32>();
        assert!(dot(&a, &b) > dot(&a, &c), "mirror {} vs blue {}", dot(&a, &b), dot(&a, &c));
    }
}
