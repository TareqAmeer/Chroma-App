// Native RW2 decode for the desktop shell: rawler gives us raw (un-demosaiced) Bayer sensor
// data + metadata; we use rawler's OWN maintained ops for the physically-calibrated steps —
// apply_scaling() (per-CFA black/white-level normalization, the same code dnglab/RapidRAW
// ship on) and PPGDemosaic (Pattern-Pixel-Grouping, far better edge behaviour than the old
// hand-rolled 3x3 bilinear) — then apply camera white balance with LibRaw's documented
// convention and hand linear 16-bit interleaved RGB to the JS DCP pipeline
// (chromasmith-22.html's bakeDcpLUT/applyDcpLUT).
//
// LibRaw scale convention replicated here (dcraw scale_colors, stable for decades):
//   pre_mul normalized so its MINIMUM element is 1.0 (green for Panasonic),
//   scale_mul[c] = pre_mul[c] * 65535/(white - black)
// rawler's apply_scaling gives exactly (v-black)/(white-black) in 0..1 (≡ the 65535 scale),
// so multiplying by min-normalized WB afterwards reproduces libraw's absolute levels with
// no fudge factor. (The old WHITE_LEVEL_MATCH=2.334 eyeball constant is gone; any remaining
// GLOBAL exposure offset vs Lightroom is a fitted constant in the JS dcpFit, refitted against
// this decode — see calib/dcp_dual_fit.py.)
use rawler::decoders::RawDecodeParams;
use rawler::imgop::sensor::bayer::ppg::PPGDemosaic;
use rawler::imgop::sensor::bayer::Demosaic;
use rawler::pixarray::PixF32;
use rawler::rawimage::RawPhotometricInterpretation;
use rawler::rawsource::RawSource;
use rayon::prelude::*;
use serde::Serialize;

#[derive(Serialize)]
pub struct DecodedRaw {
    pub width: u32,
    pub height: u32,
    pub iso: u32,
    /// interleaved RGB, u16 per channel, linear (no gamma), camera-white-balanced — same shape
    /// as libraw-wasm's imageData().data under dcpSettings.
    #[serde(skip)]
    pub rgb16: Vec<u16>,
}

pub fn decode_rw2_bytes(bytes: &[u8]) -> Result<DecodedRaw, String> {
    let source = RawSource::new_from_slice(bytes);
    let decoder = rawler::get_decoder(&source).map_err(|e| format!("no decoder: {e}"))?;
    let params = RawDecodeParams::default();
    let metadata = decoder
        .raw_metadata(&source, &params)
        .map_err(|e| format!("metadata: {e}"))?;
    let mut raw_image = decoder
        .raw_image(&source, &params, false)
        .map_err(|e| format!("decode: {e}"))?;

    // iso_speed_ratings is the standard EXIF ISO tag (what this file actually carries);
    // iso_speed (a different EXIF tag) is absent on the S9 and used to silently default
    // everything to 200, flattening dcpFit's ISO dependence on the native path.
    let iso = metadata
        .exif
        .iso_speed_ratings
        .map(|v| v as u32)
        .or(metadata.exif.iso_speed)
        .unwrap_or(200);

    // 1) Per-CFA black/white-level normalization → f32 in 0..1 (rawler-maintained math).
    raw_image
        .apply_scaling()
        .map_err(|e| format!("black/white scaling: {e}"))?;

    let w = raw_image.width;
    let h = raw_image.height;

    let cfa_config = match &raw_image.photometric {
        RawPhotometricInterpretation::Cfa(config) => config.clone(),
        other => return Err(format!("unsupported photometric interpretation: {other:?}")),
    };
    if !cfa_config.cfa.is_rgb() {
        return Err(format!("CFA pattern '{}' is not RGB — PPG demosaic unavailable", cfa_config.cfa));
    }

    // 2) Camera white balance in Bayer space, LibRaw pre_mul convention: normalize the RGB
    //    multipliers so the smallest is exactly 1.0 (values >1 can push highlights past 1.0 —
    //    that's correct; libraw clips at 65535 and we clip at the final u16 pack, same place).
    let mut wb = raw_image.wb_coeffs; // [R, G, B, G2], may contain NaN
    if wb[0].is_nan() {
        wb = [1.0, 1.0, 1.0, 1.0];
    }
    if wb[3].is_nan() || wb[3] <= 0.0 {
        wb[3] = wb[1]; // G2 follows G when absent
    }
    let dmin = wb[..3].iter().copied().filter(|v| *v > 0.0).fold(f32::MAX, f32::min);
    if dmin > 0.0 && dmin.is_finite() {
        for c in wb.iter_mut() {
            *c /= dmin;
        }
    }

    let mut pixels: Vec<f32> = raw_image.data.as_f32().into_owned();
    let cfa = cfa_config.cfa.clone();
    pixels
        .par_chunks_mut(w)
        .enumerate()
        .for_each(|(row, line)| {
            for (col, v) in line.iter_mut().enumerate() {
                *v = (*v * wb[cfa.color_at(row, col)]).max(0.0);
            }
        });

    // 3) PPG demosaic (rawler's own; internally SIMD/rayon-assisted). ROI = full frame to
    //    keep output dimensions identical to the libraw-wasm decode this app already uses.
    let pix = PixF32::new_with(pixels, w, h);
    let roi = pix.rect();
    let rgb = PPGDemosaic::new().demosaic(&pix, &cfa_config.cfa, &cfa_config.colors, roi);

    // 4) Pack to interleaved u16. Floor already applied; ceiling (1.0) only here — the one
    //    hard clip, mirroring libraw's CLIP at 65535 after scale_colors.
    let out_w = rgb.width;
    let out_h = rgb.height;
    let mut rgb16 = vec![0u16; out_w * out_h * 3];
    rgb16
        .par_chunks_mut(3)
        .zip(rgb.pixels().par_iter())
        .for_each(|(dst, px)| {
            dst[0] = (px[0].clamp(0.0, 1.0) * 65535.0).round() as u16;
            dst[1] = (px[1].clamp(0.0, 1.0) * 65535.0).round() as u16;
            dst[2] = (px[2].clamp(0.0, 1.0) * 65535.0).round() as u16;
        });

    // 5) EXIF orientation. raw_image.orientation is hardcoded Normal in rawler 0.7 (TODO
    //    upstream), so read metadata.exif.orientation. Cameras emit 1/3/6/8 only.
    let orientation = metadata.exif.orientation.unwrap_or(1);
    let (mut rgb16, out_w, out_h) = apply_orientation(rgb16, out_w, out_h, orientation);

    // 6) Shadow denoise — see denoise_shadows_rgb16's doc comment for why this has to happen
    //    HERE (on true-linear data) rather than in the app's own WebGL NR pass, which runs on
    //    the image AFTER the DCP tone curve and so structurally cannot reach this noise.
    denoise_shadows_rgb16(&mut rgb16, out_w, out_h);

    Ok(DecodedRaw {
        width: out_w as u32,
        height: out_h as u32,
        iso,
        rgb16,
    })
}

/// Shadow-only denoise on LINEAR 16-bit camera RGB, run BEFORE the DCP tone curve is ever
/// applied. Fixed strength, not user-adjustable — this is a pipeline-level fix, not a slider.
///
/// ⚠️ Why this can't live in the app's existing WebGL "Noise Reduction" sliders (chromasmith-
/// 22.html's `nr` shader pass): that pass runs on `img` — the canvas the DCP LUT bake (this
/// same struct's `rgb16`, run through `apply_lut_rgba`) already produced. By the time it sees
/// a pixel, the Adobe hue-preserving tone curve's shadow toe has ALREADY nonlinearly stretched
/// whatever tiny sensor fluctuation was there into a much more visible swing — no amount of
/// downstream blur strength undoes an upstream nonlinear amplification. Measured directly
/// against a reported photo (chroma std in a near-black patch): the WebGL pass at 100% still
/// left real noise behind for exactly this reason. Denoising the true-linear signal, before
/// that curve ever touches it, is the only place this can actually be fixed at the source.
///
/// Strongest at true black, tapering to zero by ~15% luma (same gate shape already validated
/// in the WebGL shader) so normal midtone/highlight detail is completely untouched — most of a
/// typical frame never enters the blur loop at all (the per-pixel luma check short-circuits
/// immediately), which is what keeps this affordable to run unconditionally on every RAW open.
/// The existing WebGL sliders are untouched and still work exactly as before, as an additional
/// user-adjustable layer on top of this fixed baseline.
fn denoise_shadows_rgb16(rgb: &mut [u16], w: usize, h: usize) {
    const THRESH: f32 = 0.15 * 65535.0; // luma gate — matches the WebGL NR shader's shadow taper
    const RADIUS: i32 = 3; // 7x7 taps
    const MAX_BLEND: f32 = 0.85; // blend fraction toward the local average AT true black (luma=0)
    let src = rgb.to_vec();
    rgb.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            let i = x * 3;
            let base = y * w * 3 + i;
            let r = src[base] as f32;
            let g = src[base + 1] as f32;
            let b = src[base + 2] as f32;
            let luma = 0.299 * r + 0.587 * g + 0.114 * b;
            if luma >= THRESH {
                continue; // fast path — skip the blur entirely outside true shadows
            }
            let weight = (1.0 - luma / THRESH).clamp(0.0, 1.0) * MAX_BLEND;
            let (mut sr, mut sg, mut sb, mut n) = (0f32, 0f32, 0f32, 0f32);
            for dy in -RADIUS..=RADIUS {
                let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                for dx in -RADIUS..=RADIUS {
                    let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    let si = (sy * w + sx) * 3;
                    sr += src[si] as f32;
                    sg += src[si + 1] as f32;
                    sb += src[si + 2] as f32;
                    n += 1.0;
                }
            }
            row[i] = (r * (1.0 - weight) + (sr / n) * weight).round().clamp(0.0, 65535.0) as u16;
            row[i + 1] = (g * (1.0 - weight) + (sg / n) * weight).round().clamp(0.0, 65535.0) as u16;
            row[i + 2] = (b * (1.0 - weight) + (sb / n) * weight).round().clamp(0.0, 65535.0) as u16;
        }
    });
}

/// Rotate an interleaved u16 RGB buffer per EXIF orientation (1=as-is, 3=180°,
/// 6=90° CW, 8=90° CCW). Rayon over destination rows; ~10ms for 24MP.
fn apply_orientation(src: Vec<u16>, w: usize, h: usize, orientation: u16) -> (Vec<u16>, usize, usize) {
    match orientation {
        3 => {
            let mut dst = vec![0u16; src.len()];
            dst.par_chunks_mut(w * 3).enumerate().for_each(|(y, line)| {
                let sy = h - 1 - y;
                for x in 0..w {
                    let s = (sy * w + (w - 1 - x)) * 3;
                    line[x * 3..x * 3 + 3].copy_from_slice(&src[s..s + 3]);
                }
            });
            (dst, w, h)
        }
        6 | 8 => {
            // output is h wide, w tall
            let mut dst = vec![0u16; src.len()];
            dst.par_chunks_mut(h * 3).enumerate().for_each(|(y, line)| {
                for x in 0..h {
                    // 6 (90 CW):  dst(x,y) = src(y, h-1-x)
                    // 8 (90 CCW): dst(x,y) = src(w-1-y, x)
                    let s = if orientation == 6 {
                        ((h - 1 - x) * w + y) * 3
                    } else {
                        (x * w + (w - 1 - y)) * 3
                    };
                    line[x * 3..x * 3 + 3].copy_from_slice(&src[s..s + 3]);
                }
            });
            (dst, h, w)
        }
        _ => (src, w, h),
    }
}

/// Apply a baked N^3 DCP LUT (the same Float32 data bakeDcpLUT produces in JS, values are
/// sRGB-encoded 0..1) to linear u16 RGB with trilinear interpolation, producing RGBA8 ready
/// for ImageData/putImageData. Mirrors chromasmith-22.html's applyDcpLUT indexing exactly —
/// moved here because 24M pixels × 24 LUT reads was multi-second, UI-blocking work on the JS
/// main thread; with rayon it's tens of milliseconds.
pub fn apply_lut_rgba(rgb16: &[u16], lut: &[f32], n: usize) -> Vec<u8> {
    let nm = n - 1;
    let sc = nm as f32 / 65535.0;
    let px_count = rgb16.len() / 3;
    let mut rgba = vec![0u8; px_count * 4];
    rgba.par_chunks_mut(4)
        .zip(rgb16.par_chunks(3))
        .for_each(|(dst, src)| {
            let fr = src[0] as f32 * sc;
            let fg = src[1] as f32 * sc;
            let fb = src[2] as f32 * sc;
            let r0 = (fr as usize).min(nm - 1);
            let g0 = (fg as usize).min(nm - 1);
            let b0 = (fb as usize).min(nm - 1);
            let rf = fr - r0 as f32;
            let gf = fg - g0 as f32;
            let bf = fb - b0 as f32;
            let idx = |r: usize, g: usize, b: usize| 3 * ((b * n + g) * n + r);
            for c in 0..3 {
                let c000 = lut[idx(r0, g0, b0) + c];
                let c100 = lut[idx(r0 + 1, g0, b0) + c];
                let c010 = lut[idx(r0, g0 + 1, b0) + c];
                let c110 = lut[idx(r0 + 1, g0 + 1, b0) + c];
                let c001 = lut[idx(r0, g0, b0 + 1) + c];
                let c101 = lut[idx(r0 + 1, g0, b0 + 1) + c];
                let c011 = lut[idx(r0, g0 + 1, b0 + 1) + c];
                let c111 = lut[idx(r0 + 1, g0 + 1, b0 + 1) + c];
                let c00 = c000 * (1.0 - rf) + c100 * rf;
                let c10 = c010 * (1.0 - rf) + c110 * rf;
                let c01 = c001 * (1.0 - rf) + c101 * rf;
                let c11 = c011 * (1.0 - rf) + c111 * rf;
                let v = (c00 * (1.0 - gf) + c10 * gf) * (1.0 - bf) + (c01 * (1.0 - gf) + c11 * gf) * bf;
                dst[c] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
            dst[3] = 255;
        });
    rgba
}

/// sRGB-gamma the linear u16 RGB to RGBA8 — the "None (LibRaw sRGB)" no-profile path,
/// previously a 72M-iteration JS loop in desktop-native.js.
pub fn srgb_rgba(rgb16: &[u16]) -> Vec<u8> {
    let g = |v: f32| -> f32 {
        if v <= 0.0031308 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        }
    };
    let px_count = rgb16.len() / 3;
    let mut rgba = vec![0u8; px_count * 4];
    rgba.par_chunks_mut(4)
        .zip(rgb16.par_chunks(3))
        .for_each(|(dst, src)| {
            for c in 0..3 {
                dst[c] = (g(src[c] as f32 / 65535.0) * 255.0).round() as u8;
            }
            dst[3] = 255;
        });
    rgba
}
