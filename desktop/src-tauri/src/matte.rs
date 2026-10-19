// Subject matting (masking improvement plan, 2026-10-19): a whole-image alpha matte of the salient
// subject(s), fast and edge-accurate enough for hair. Two tiers, same pattern as depth.rs (a cached
// ONNX session behind a OnceLock<Mutex<..>>, sam.rs's raw ORT helpers, one Tauri command):
//   - MODNet  (vendor/matte/modnet.onnx, 26MB, Apache-2.0, ~0.6s on an old Intel CPU) — default.
//   - ISNet   (vendor/matte/isnet.onnx, 176MB, MIT, ~1.6s) — optional, better on groups of people;
//     NOT bundled by default (over the git push limit), fetch per vendor/matte/README.md.
// Scored on the 22 reviewed real photos (docs/masking-model-bench.md): hair boundary-band MAE
// 0.030 (MODNet) / 0.033 (ISNet) vs 0.353 for the EdgeSAM click mask.
//
// MODNet: dynamic H/W (multiples of 32), input "input" normalised (x-127.5)/127.5, output "output"
// in 0..1. ISNet: fixed 1024x1024, input "input" = x/255 - imagenet mean (std 1), output is
// unbounded so it is min-max normalised per photo (same convention as depth.rs).

use crate::sam::{bilinear_resize, create_session_from_path, input, resize_rgb8, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Model {
    Modnet,
    Isnet,
}

impl Model {
    pub fn parse(s: &str) -> Result<Model, String> {
        match s {
            "modnet" => Ok(Model::Modnet),
            "isnet" => Ok(Model::Isnet),
            other => Err(format!("matte: unknown model '{other}'")),
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Model::Modnet => "modnet",
            Model::Isnet => "isnet",
        }
    }
}

static MODNET_PATH: OnceLock<PathBuf> = OnceLock::new();
static ISNET_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's `.setup()`, same pattern as `depth::set_model_path`.
pub fn set_model_paths(modnet: PathBuf, isnet: PathBuf) {
    let _ = MODNET_PATH.set(modnet);
    let _ = ISNET_PATH.set(isnet);
}

fn path_for(m: Model) -> Option<&'static PathBuf> {
    match m {
        Model::Modnet => MODNET_PATH.get(),
        Model::Isnet => ISNET_PATH.get(),
    }
}

/// Model names whose weights are present on disk, best-quality-first is up to the caller.
pub fn available() -> Vec<&'static str> {
    [Model::Modnet, Model::Isnet]
        .into_iter()
        .filter(|m| path_for(*m).map(|p| p.exists()).unwrap_or(false))
        .map(|m| m.name())
        .collect()
}

fn session(m: Model) -> Result<&'static Mutex<SamSession>, String> {
    static MOD: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    static ISN: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    let cell = match m {
        Model::Modnet => &MOD,
        Model::Isnet => &ISN,
    };
    cell.get_or_init(|| {
        let path = path_for(m).ok_or("matte model path not set — set_model_paths() must run first")?;
        if !path.exists() {
            return Err(format!("matte: {} is not installed ({})", m.name(), path.display()));
        }
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Matte working size for a photo of (w, h): MODNet keeps the aspect ratio with the long side capped
/// at 1024 and both sides snapped down to a multiple of 32; ISNet is a fixed square.
fn work_size(m: Model, w: u32, h: u32) -> (u32, u32) {
    match m {
        Model::Isnet => (1024, 1024),
        Model::Modnet => {
            let s = (1024.0 / w.max(h) as f32).min(1.0);
            let snap = |v: u32| (((v as f32 * s) as u32) / 32 * 32).max(32);
            (snap(w), snap(h))
        }
    }
}

/// Alpha matte (0 = background, 255 = subject) at the CALLER's (w, h).
pub fn estimate(model: Model, rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    if w == 0 || h == 0 {
        return Err("matte: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("matte: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }
    let (sw, sh) = work_size(model, w, h);
    let resized = resize_rgb8(rgb, w, h, sw, sh);
    let (swu, shu) = (sw as usize, sh as usize);
    let mut pixels = vec![0f32; 3 * swu * shu];
    const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
    for y in 0..shu {
        for x in 0..swu {
            let src = (y * swu + x) * 3;
            for c in 0..3 {
                let v = resized[src + c] as f32;
                pixels[c * swu * shu + y * swu + x] = match model {
                    Model::Modnet => (v - 127.5) / 127.5,
                    Model::Isnet => v / 255.0 - MEAN[c],
                };
            }
        }
    }
    let sess = session(model)?;
    let mut outputs = run_session(sess, vec![input("input", pixels, &[1, 3, sh as i64, sw as i64])], &["output"])?;
    let raw = outputs.remove(0);
    if raw.len() != swu * shu {
        return Err(format!("matte: unexpected output size {} (expected {sw}x{sh})", raw.len()));
    }
    let norm: Vec<f32> = match model {
        Model::Modnet => raw.iter().map(|&v| v.clamp(0.0, 1.0)).collect(),
        Model::Isnet => {
            let (mut mn, mut mx) = (f32::MAX, f32::MIN);
            for &v in &raw {
                mn = mn.min(v);
                mx = mx.max(v);
            }
            let span = (mx - mn).max(1e-6);
            raw.iter().map(|&v| (v - mn) / span).collect()
        }
    };
    let up = bilinear_resize(&norm, sw, sh, w, h);
    Ok(up.iter().map(|&v| (v.clamp(0.0, 1.0) * 255.0).round() as u8).collect())
}

#[tauri::command(async)]
pub fn matte_models() -> Vec<String> {
    available().into_iter().map(String::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_size_snaps_to_32_and_caps_long_side() {
        assert_eq!(work_size(Model::Isnet, 4000, 3000), (1024, 1024));
        assert_eq!(work_size(Model::Modnet, 2048, 1365), (1024, 672));
        assert_eq!(work_size(Model::Modnet, 500, 333), (480, 320));
        assert_eq!(work_size(Model::Modnet, 10, 10), (32, 32));
    }

    #[test]
    fn parse_rejects_unknown_model() {
        assert!(Model::parse("modnet").is_ok());
        assert!(Model::parse("isnet").is_ok());
        assert!(Model::parse("birefnet").is_err());
    }

    #[test]
    fn modnet_matte_is_plausible_on_a_real_portrait() {
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/matte/modnet.onnx");
        let photo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/portrait.png");
        if !model.exists() || !photo.exists() {
            eprintln!("skipping: model or fixture not present");
            return;
        }
        crate::sam::set_dylib_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(crate::platform::ort_lib_dev_path()));
        set_model_paths(model, PathBuf::from("/nonexistent/isnet.onnx"));
        assert_eq!(available(), vec!["modnet"]);
        let img = image::open(&photo).expect("open portrait.png").to_rgb8();
        let (w, h) = img.dimensions();
        let a = estimate(Model::Modnet, img.as_raw(), w, h).expect("modnet run");
        assert_eq!(a.len(), (w * h) as usize);
        let fg = a.iter().filter(|&&v| v > 200).count() as f32 / a.len() as f32;
        let bg = a.iter().filter(|&&v| v < 55).count() as f32 / a.len() as f32;
        println!("matte fg={fg:.3} bg={bg:.3}");
        assert!(fg > 0.02 && bg > 0.02, "degenerate matte: fg={fg} bg={bg}");
    }

    /// Manual probe, not run by default: MATTE_PHOTOS=<dir of jpg/png> MATTE_OUT=<dir> cargo test --bin chromasmith
    /// matte_probe_photos -- --ignored --nocapture. Runs every installed model through the app's own
    /// ORT path on each photo (long side capped at 1024, like samInputDims) and writes <name>__<model>.png.
    #[test]
    #[ignore]
    fn matte_probe_photos() {
        let (Ok(dir), Ok(out)) = (std::env::var("MATTE_PHOTOS"), std::env::var("MATTE_OUT")) else { return };
        let v = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/matte");
        crate::sam::set_dylib_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(crate::platform::ort_lib_dev_path()));
        set_model_paths(v.join("modnet.onnx"), v.join("isnet.onnx"));
        std::fs::create_dir_all(&out).unwrap();
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| !n.starts_with('.') && (n.ends_with(".jpg") || n.ends_with(".png"))).unwrap_or(false)).collect();
        files.sort();
        for f in files {
            let img = image::open(&f).expect("open").to_rgb8();
            let (iw, ih) = img.dimensions();
            let sc = (1024.0 / iw.max(ih) as f32).min(1.0);
            let (w, h) = (((iw as f32 * sc) as u32).max(2), ((ih as f32 * sc) as u32).max(2));
            let small = image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle);
            for m in available() {
                let model = Model::parse(m).unwrap();
                let t = std::time::Instant::now();
                let a = estimate(model, small.as_raw(), w, h).expect("estimate");
                let stem = f.file_stem().unwrap().to_string_lossy().replace(' ', "-");
                image::GrayImage::from_raw(w, h, a).unwrap().save(format!("{out}/{stem}__{m}.png")).unwrap();
                println!("{stem} {m} {:.2}s", t.elapsed().as_secs_f32());
            }
        }
    }
}
