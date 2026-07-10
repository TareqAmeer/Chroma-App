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

    Ok(DecodedRaw {
        width: out_w as u32,
        height: out_h as u32,
        iso,
        rgb16,
    })
}
