// Landscape category segmentation (Lightroom-style Landscape mask: sky / water / vegetation /
// mountains / buildings / ground). Same shape as depth.rs and faceparse.rs: a cached ONNX session
// behind a OnceLock<Mutex<..>>, helpers from sam.rs, one framed Tauri command (landscape_run).
//
// Model: openmmlab/upernet-convnext-tiny (UperNet + ConvNeXt-T, trained on ADE20K, 150 classes),
// licence MIT (HF model card, mmseg code is Apache-2.0). Exported from the HF checkpoint with
// torch.onnx.export at a FIXED 576x576 input (UperNet's pyramid-pooling head needs the stride-32
// map divisible by 6, so 512 fails to export; 576 = 18*32 works) then ONNX Runtime dynamic int8
// quantization: 237MB -> 60MB, 97.7% pixel agreement with fp32 on test/fixtures/chr246-real/power-lines.jpg.
// See vendor/landscape/README.md for the export recipe and licence caveats (ADE20K dataset terms).
//
// Output logits are [1,150,576,576] (the head upsamples to input size). We softmax per pixel at a
// reduced 144x144 grid, sum probabilities per category group, then bilinear-upsample to the
// caller's (w, h) — soft alpha, like faceparse.rs. ADE20K ids below are from the checkpoint's
// own config.json id2label (printed during export), not a quoted table.

use crate::sam::{bilinear_resize, create_session_from_path, input, resize_rgb8, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const LS_SIZE: u32 = 576;
const NUM_CLASSES: usize = 150;
const GRID: usize = 144; // LS_SIZE / 4
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Group order is the wire order of the response and the JS `LANDSCAPE_GROUPS` order.
pub const GROUPS: [(&str, &[usize]); 6] = [
    ("sky", &[2]),
    ("water", &[21, 26, 60, 109, 113, 128]), // water, sea, river, swimming pool, waterfall, lake
    ("vegetation", &[4, 9, 17, 66, 72]),     // tree, grass, plant, flower, palm
    ("mountains", &[16, 34, 68]),            // mountain, rock, hill
    ("buildings", &[1, 25, 48, 79, 84, 61]), // building, house, skyscraper, hovel, tower, bridge
    ("ground", &[13, 6, 11, 29, 46, 52, 91, 94]), // earth, road, sidewalk, field, sand, path, dirt track, land
];

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn model_present() -> bool {
    MODEL_PATH.get().map(|p| p.exists()).unwrap_or(false)
}

pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH
            .get()
            .ok_or("landscape model path not set — set_model_path() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// One soft 0..255 mask per GROUPS entry, each at the caller's (w, h).
pub fn parse(rgb: &[u8], w: u32, h: u32) -> Result<Vec<Vec<u8>>, String> {
    if w == 0 || h == 0 {
        return Err("landscape: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("landscape: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }
    let resized = resize_rgb8(rgb, w, h, LS_SIZE, LS_SIZE);
    let side = LS_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let src = (y * side + x) * 3;
            for c in 0..3 {
                pixels[c * side * side + y * side + x] = (resized[src + c] as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    let sess = session()?;
    let mut outputs = run_session(
        sess,
        vec![input("pixel_values", pixels, &[1, 3, LS_SIZE as i64, LS_SIZE as i64])],
        &["logits"],
    )?;
    let logits = outputs.remove(0);
    if logits.len() != NUM_CLASSES * side * side {
        return Err(format!("landscape: unexpected logits size {} (expected {NUM_CLASSES}x{side}x{side})", logits.len()));
    }
    // Sample the logits on a GRID x GRID lattice (every 4th pixel) before softmax: 16x cheaper and
    // the soft bilinear upsample afterwards restores smooth edges.
    let step = side / GRID;
    let mut probs: Vec<Vec<f32>> = GROUPS.iter().map(|_| vec![0f32; GRID * GRID]).collect();
    let mut exps = [0f32; NUM_CLASSES];
    for gy in 0..GRID {
        for gx in 0..GRID {
            let px = (gy * step + step / 2) * side + (gx * step + step / 2);
            let mut mx = f32::MIN;
            for c in 0..NUM_CLASSES {
                mx = mx.max(logits[c * side * side + px]);
            }
            let mut sum = 0f32;
            for c in 0..NUM_CLASSES {
                let e = (logits[c * side * side + px] - mx).exp();
                exps[c] = e;
                sum += e;
            }
            let inv = 1.0 / sum.max(1e-12);
            for (gi, (_, ids)) in GROUPS.iter().enumerate() {
                probs[gi][gy * GRID + gx] = ids.iter().map(|&c| exps[c] * inv).sum();
            }
        }
    }
    Ok(probs
        .iter()
        .map(|p| {
            bilinear_resize(p, GRID as u32, GRID as u32, w, h)
                .iter()
                .map(|&v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
                .collect()
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real inference on a fixture photo; skips (with a message) when the model or photo is absent.
    #[test]
    fn landscape_groups_cover_a_real_photo() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let model = root.join("vendor/landscape/model_quantized.onnx");
        let photo = root.join("../../test/fixtures/chr246-real/power-lines.jpg");
        if !model.exists() || !photo.exists() {
            eprintln!("skipping: model or photo missing");
            return;
        }
        crate::sam::set_dylib_path(root.join(crate::platform::ort_lib_dev_path()));
        set_model_path(model);
        let img = image::open(&photo).expect("open").to_rgb8();
        let (iw, ih) = img.dimensions();
        let s = 800.0 / (iw.max(ih) as f32);
        let (dw, dh) = (((iw as f32 * s) as u32).max(1), ((ih as f32 * s) as u32).max(1));
        let small = image::imageops::resize(&img, dw, dh, image::imageops::FilterType::Triangle);
        let masks = parse(small.as_raw(), dw, dh).expect("parse");
        let cov: Vec<(&str, f32)> = GROUPS
            .iter()
            .zip(masks.iter())
            .map(|((n, _), m)| (*n, m.iter().filter(|&&v| v > 127).count() as f32 / m.len() as f32))
            .collect();
        println!("landscape coverage {cov:?}");
        let sky = cov[0].1;
        assert!(sky > 0.2, "power-lines.jpg is ~half sky, got {sky}");
    }
}
