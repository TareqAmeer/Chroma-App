// Super Resolution (CHR-249) — local 2x / 4x photo enlargement with Real-ESRGAN `realesr-general-x4v3`
// (SRVGGNetCompact, 4.9 MB, BSD-3-Clause). Same pattern as depth.rs: one cached ONNX session
// behind sam.rs's `create_session_from_path` / `run_session`, a model path set from main.rs's
// `.setup()`, framed IPC commands. See vendor/superres/README.md for provenance, licence evidence
// and the exact conversion (the upstream .pth was exported to a dynamic-shape ONNX; no weights were
// modified).
//
// Model contract: input "input" f32 NCHW RGB in 0..1, any H/W; output "output" f32 NCHW at 4x.
// Tiling: the photo is processed in CORE x CORE blocks, each fed with PAD extra pixels of real
// context on every side (clamped at the image border) and only the core of the 4x output kept, so
// seams fall on pixels the network saw with full receptive context. For a 2x result each kept
// block is box-averaged 2x2 right away, so memory never holds a 4x image.

use crate::sam::{create_session_from_path, input, run_session, SamSession};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

const CORE: usize = 96;
const PAD: usize = 12;
/// Hard ceiling on output pixels (a 45 MP photo at 2x is 180 MP — refuse before allocating).
pub const MAX_OUTPUT_PIXELS: u64 = 160_000_000;

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}
pub fn model_available() -> bool {
    MODEL_PATH.get().map(|p| p.exists()).unwrap_or(false)
}
pub fn request_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH.get().ok_or("super-resolution model path not set")?;
        if !path.exists() {
            return Err(format!("super-resolution model not found at {}", path.display()));
        }
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// 2x2 box average of an interleaved RGB f32 block (both dims even) into 8-bit.
fn box_half_to_u8(src: &[f32], w: usize, h: usize, out: &mut [u8], out_stride: usize, ox: usize, oy: usize) {
    let (hw, hh) = (w / 2, h / 2);
    for y in 0..hh {
        for x in 0..hw {
            for c in 0..3 {
                let at = |xx: usize, yy: usize| src[(yy * w + xx) * 3 + c];
                let v = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) * 0.25;
                out[((oy + y) * out_stride + ox + x) * 3 + c] = (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            }
        }
    }
}

/// Runs one tile: reads (tw x th) pixels at (x0,y0) with PAD context (clamped), returns the 4x output
/// of the whole padded region as planar f32 plus its padded geometry.
fn run_tile(rgb: &[u8], w: usize, h: usize, x0: usize, y0: usize, tw: usize, th: usize) -> Result<(Vec<f32>, usize, usize, usize, usize), String> {
    let px0 = x0.saturating_sub(PAD);
    let py0 = y0.saturating_sub(PAD);
    let px1 = (x0 + tw + PAD).min(w);
    let py1 = (y0 + th + PAD).min(h);
    let (pw, ph) = (px1 - px0, py1 - py0);
    let mut data = vec![0f32; 3 * pw * ph];
    for y in 0..ph {
        for x in 0..pw {
            let s = ((py0 + y) * w + px0 + x) * 3;
            for c in 0..3 {
                data[c * pw * ph + y * pw + x] = rgb[s + c] as f32 / 255.0;
            }
        }
    }
    let out = run_session(session()?, vec![input("input", data, &[1, 3, ph as i64, pw as i64])], &["output"])?;
    let o = out.into_iter().next().ok_or("super-resolution: no output")?;
    if o.len() != 3 * pw * ph * 16 {
        return Err(format!("super-resolution: unexpected output size {} for {pw}x{ph}", o.len()));
    }
    Ok((o, pw, ph, x0 - px0, y0 - py0))
}

/// Enlarges an RGB8 photo by `scale` (2 or 4). `progress(done, total)` returns false to cancel.
/// Returns (rgb, out_w, out_h).
pub fn upscale(rgb: &[u8], w: u32, h: u32, scale: u32, progress: &mut dyn FnMut(usize, usize) -> bool) -> Result<(Vec<u8>, u32, u32), String> {
    if scale != 2 && scale != 4 {
        return Err(format!("super-resolution: unsupported scale {scale} (use 2 or 4)"));
    }
    let (wu, hu) = (w as usize, h as usize);
    if wu == 0 || hu == 0 || rgb.len() != wu * hu * 3 {
        return Err(format!("super-resolution: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }
    let (ow, oh) = (wu * scale as usize, hu * scale as usize);
    if (ow as u64) * (oh as u64) > MAX_OUTPUT_PIXELS {
        return Err(format!("super-resolution: {ow}x{oh} output exceeds the {} MP limit — crop or use 2x", MAX_OUTPUT_PIXELS / 1_000_000));
    }
    CANCEL.store(false, Ordering::SeqCst);
    let mut out = vec![0u8; ow * oh * 3];
    let tiles_x = wu.div_ceil(CORE);
    let tiles_y = hu.div_ceil(CORE);
    let total = tiles_x * tiles_y;
    let mut done = 0usize;
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            if CANCEL.load(Ordering::SeqCst) || !progress(done, total) {
                return Err("cancelled".into());
            }
            let (x0, y0) = (tx * CORE, ty * CORE);
            let (tw, th) = (CORE.min(wu - x0), CORE.min(hu - y0));
            let (o, pw, ph, cx, cy) = run_tile(rgb, wu, hu, x0, y0, tw, th)?;
            let (ow4, oh4) = (pw * 4, ph * 4);
            // Extract the core region of the 4x output (interleaved RGB f32).
            let (cw, ch) = (tw * 4, th * 4);
            let mut core = vec![0f32; cw * ch * 3];
            for y in 0..ch {
                for x in 0..cw {
                    let sx = cx * 4 + x;
                    let sy = cy * 4 + y;
                    for c in 0..3 {
                        core[(y * cw + x) * 3 + c] = o[c * ow4 * oh4 + sy * ow4 + sx];
                    }
                }
            }
            if scale == 4 {
                for y in 0..ch {
                    for x in 0..cw {
                        for c in 0..3 {
                            out[((y0 * 4 + y) * ow + x0 * 4 + x) * 3 + c] = (core[(y * cw + x) * 3 + c].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                        }
                    }
                }
            } else {
                box_half_to_u8(&core, cw, ch, &mut out, ow, x0 * 2, y0 * 2);
            }
            done += 1;
        }
    }
    progress(total, total);
    Ok((out, ow as u32, oh as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() -> bool {
        let model = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/superres/realesr-general-x4v3.onnx");
        if !model.exists() {
            eprintln!("skipping: {} not present in this checkout", model.display());
            return false;
        }
        crate::sam::set_dylib_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(crate::platform::ort_lib_dev_path()));
        set_model_path(model);
        true
    }

    #[test]
    fn box_half_averages_2x2_blocks() {
        // 2x2 block of (0, 1/3, 2/3, 1) in channel 0 -> mean 0.5 -> 128
        let src: Vec<f32> = (0..4).flat_map(|i| [i as f32 / 3.0, 0.0, 1.0]).collect();
        let mut out = vec![0u8; 3];
        box_half_to_u8(&src, 2, 2, &mut out, 1, 0, 0);
        assert_eq!(out, vec![128, 0, 255]);
    }

    #[test]
    fn rejects_bad_scale_size_and_oversize() {
        let mut p = |_: usize, _: usize| true;
        assert!(upscale(&[0; 12], 2, 2, 3, &mut p).is_err());
        assert!(upscale(&[0; 11], 2, 2, 2, &mut p).is_err());
        let big = upscale(&[], 20_000, 20_000, 2, &mut p);
        assert!(big.is_err());
    }

    /// Real inference: dimensions are exact, tiling has no visible seams (a smooth ramp stays
    /// monotone across tile borders), and the mean level is preserved.
    #[test]
    fn real_model_2x_is_seamless_and_level_preserving() {
        if !setup_model() {
            return;
        }
        let (w, h) = (200usize, 130usize); // 3x2 tiles, ragged edges
        let mut rgb = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let v = (40.0 + 170.0 * x as f32 / (w - 1) as f32) as u8;
                rgb[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&[v, v, v]);
            }
        }
        let mut p = |_: usize, _: usize| true;
        let (out, ow, oh) = upscale(&rgb, w as u32, h as u32, 2, &mut p).expect("upscale");
        assert_eq!((ow, oh), (400, 260));
        let row = 130usize; // mid row
        let mut max_step = 0i32;
        for x in 1..ow as usize {
            let a = out[(row * ow as usize + x - 1) * 3] as i32;
            let b = out[(row * ow as usize + x) * 3] as i32;
            max_step = max_step.max((b - a).abs());
        }
        assert!(max_step <= 6, "seam/jump in a smooth ramp: max step {max_step}");
        let mean_in = rgb.iter().map(|&v| v as f64).sum::<f64>() / rgb.len() as f64;
        let mean_out = out.iter().map(|&v| v as f64).sum::<f64>() / out.len() as f64;
        assert!((mean_in - mean_out).abs() < 4.0, "level shift {mean_in} -> {mean_out}");
    }

    #[test]
    fn cancel_stops_the_run() {
        if !setup_model() {
            return;
        }
        let rgb = vec![128u8; 200 * 200 * 3];
        let mut calls = 0;
        let mut p = |_: usize, _: usize| { calls += 1; calls < 2 };
        let r = upscale(&rgb, 200, 200, 2, &mut p);
        assert_eq!(r.err().as_deref(), Some("cancelled"));
    }
}
