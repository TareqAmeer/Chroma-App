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
    /// EXIF camera make (e.g. "Panasonic") — used by main.rs to decide whether a requested
    /// DCP LUT is even applicable (the bundled profiles are Panasonic DC-S9 only; applying
    /// them to a different sensor's data would silently produce wrong colors, not an error).
    pub make: String,
    /// Whether auto lens-profile distortion correction was ACTUALLY applied on this decode
    /// (ground truth from lens_correct::correct_distortion's return value) — not merely
    /// requested. False whenever auto_lens was off, or on but no profile matched.
    pub lens_applied: bool,
    /// interleaved RGB, u16 per channel, linear (no gamma), camera-white-balanced — same shape
    /// as libraw-wasm's imageData().data under dcpSettings.
    #[serde(skip)]
    pub rgb16: Vec<u16>,
}

pub fn decode_rw2_bytes(bytes: &[u8], auto_lens: bool, native_nr: bool) -> Result<DecodedRaw, String> {
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

    // 5.5) Optional automatic lens-profile correction (distortion) — see lens_correct.rs.
    // Graceful no-op when the camera/lens pairing has no match in the bundled DB. `lens_applied`
    // reports the REAL outcome of THIS decode (not a separate DB probe) back to main.rs/JS, so
    // the UI can show ground truth ("Applied ✓" / "not applied") instead of a guess that could
    // drift from what the decode actually did.
    let mut lens_applied = false;
    if auto_lens {
        let lens_model = metadata
            .exif
            .lens_model
            .clone()
            .or_else(|| metadata.lens.as_ref().map(|l| l.lens_model.clone()))
            .or_else(|| crate::lens_correct::exif_lens_model_fallback(bytes))
            .unwrap_or_default();
        let ratio = |r: &rawler::formats::tiff::Rational| if r.d != 0 { r.n as f32 / r.d as f32 } else { 0.0 };
        let focal_len = metadata.exif.focal_length.as_ref().map(ratio).unwrap_or(0.0);
        if !lens_model.is_empty() && focal_len > 0.0 {
            lens_applied = crate::lens_correct::correct_distortion(
                &mut rgb16, out_w, out_h, &metadata.make, &metadata.model, &lens_model, focal_len,
            );
        }
    }

    // 6/7) Native (Rust) noise reduction — user-toggleable (default on) via the "RAW Noise
    //    Reduction" switch in the Noise Reduction panel. Both passes run on true-linear data,
    //    before any tone curve, which is why they can't live in the WebGL NR sliders (see each
    //    function's doc comment) — but that also means the toggle can't be live, only apply on
    //    the next decode. Off entirely reproduces the untouched decode, for comparison or if a
    //    photo needs its own manual grain/detail instead.
    if native_nr {
        denoise_shadows_rgb16(&mut rgb16, out_w, out_h);
        denoise_chroma_wavelet_rgb16(&mut rgb16, out_w, out_h, iso);
    }

    Ok(DecodedRaw {
        width: out_w as u32,
        height: out_h as u32,
        iso,
        make: metadata.make.clone(),
        lens_applied,
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
            // CHROMA-ONLY blend, luma preserved. Blending RGB toward the local average (the old
            // behaviour) smeared LUMA detail — measured against a real Lightroom reference
            // (calib/nr_validate.py): in ISO-12800 shadows CS kept only 48% of the luma noise
            // where Lightroom keeps 98%, i.e. we destroyed the fine dark-fur texture the user
            // saw as "waxy". Lightroom removes shadow COLOR blotches while keeping luminance
            // grain. So: convert the pixel and the neighbourhood-average to Y/Cb/Cr, blend only
            // the chroma toward the average, and reconstruct with the pixel's ORIGINAL luma.
            let (ar, ag, ab) = (sr / n, sg / n, sb / n);
            let cb_p = -0.168_736 * r - 0.331_264 * g + 0.5 * b;
            let cr_p = 0.5 * r - 0.418_688 * g - 0.081_312 * b;
            let cb_a = -0.168_736 * ar - 0.331_264 * ag + 0.5 * ab;
            let cr_a = 0.5 * ar - 0.418_688 * ag - 0.081_312 * ab;
            // Isolated-saturated-detail protection (same fix as denoise_chroma_wavelet_rgb16,
            // needed here too — this pass runs FIRST and already blends a small saturated
            // highlight, e.g. a metal tag, toward its 7x7 neighbourhood before the wavelet pass
            // even sees it). Large orig-vs-local-avg chroma excess = real isolated color, not
            // noise (chroma noise is small-magnitude by construction) — reduce the blend weight.
            // Thresholds are ~4x lower than the wavelet pass's: this is a tight 7x7 average, not
            // a broad low-pass, so orig-vs-local excess is naturally smaller for the same real
            // color edge (measured: saturating the wavelet's threshold here left this pass still
            // draining ~40% of the gap, because its own excess rarely crossed the higher bar).
            const ISO_LO: f32 = 0.0004 * 65535.0;
            const ISO_HI: f32 = 0.003 * 65535.0;
            let excess = (cb_p - cb_a).hypot(cr_p - cr_a);
            let ti = ((excess - ISO_LO) / (ISO_HI - ISO_LO)).clamp(0.0, 1.0);
            let iso = ti * ti * (3.0 - 2.0 * ti);
            let weight = weight * (1.0 - iso);
            let cb = cb_p * (1.0 - weight) + cb_a * weight;
            let cr = cr_p * (1.0 - weight) + cr_a * weight;
            // reconstruct with the ORIGINAL luma (luma untouched — no detail loss)
            row[i] = (luma + 1.402 * cr).round().clamp(0.0, 65535.0) as u16;
            row[i + 1] = (luma - 0.344_136 * cb - 0.714_136 * cr).round().clamp(0.0, 65535.0) as u16;
            row[i + 2] = (luma + 1.772 * cb).round().clamp(0.0, 65535.0) as u16;
        }
    });
}

/// Chroma-only wavelet denoise on LINEAR 16-bit camera RGB, ISO-gated — the fix for the
/// "green and red blotches in ISO 12800 sand where Lightroom shows uniform bluish gray" gap.
///
/// Why the existing passes couldn't do this:
/// - `denoise_shadows_rgb16` only fires below 15% linear luma and blurs all 3 channels — the
///   blotchy sand is a MIDTONE, and blurring RGB equally softens luma detail.
/// - the WebGL Color-NR slider runs after the DCP tone curve (amplified noise) and its spatial
///   blur has a small fixed reach, while high-ISO chroma noise forms LARGE low-frequency
///   "packets" (RawPedia/darktable both call this out — it's why they use wavelets for chroma).
///
/// Algorithm (the darktable/RawTherapee-recommended shape): split into Y/Cb/Cr, run an à-trous
/// (undecimated, B3-spline 1-4-6-4-1) wavelet decomposition on Cb and Cr ONLY, attenuate each
/// detail level, keep the residual low-pass, reconstruct, convert back. Luma is never touched,
/// so sharpness and the fine "film-like" luma grain survive — only the colored mottling drains
/// out, which is exactly Lightroom's Color-NR rendition. A plain large box blur is NOT
/// equivalent: it bleeds strong colors across edges (documented failure mode) — the wavelet's
/// per-level attenuation with a preserved low-pass keeps real color transitions intact.
///
/// `levels`/`strength` scale with ISO: 0 below ISO 1600 (no cost for clean files), moderate at
/// 3200-6400, strong at ≥12800 where the packets are coarsest.
fn denoise_chroma_wavelet_rgb16(rgb: &mut [u16], w: usize, h: usize, iso: u32) {
    // Diagnostic escape hatch for A/B validation via the dump_rw2 example (CS_NO_CHROMA_NR=1
    // reproduces the pre-wavelet decode exactly). Not a user-facing setting.
    if std::env::var_os("CS_NO_CHROMA_NR").is_some() {
        return;
    }
    let (levels, strength): (usize, f32) = match iso {
        0..=1599 => {
            eprintln!("[chroma-nr] ISO {iso} < 1600 — skipped");
            return;
        }
        1600..=3199 => (3, 0.6),
        // Strength lowered from 0.85: measured against Lightroom (nr_validate.py), 0.85 over-
        // cleaned chroma (CS kept less chroma than LR) and drained highlight saturation to 0.84
        // ("muted colors"). 0.70 keeps more real color while still killing the noise.
        3200..=6399 => (5, 0.70),
        // `keep = 1 - strength*(1 - lvl/levels*0.12)` is steeply nonlinear near strength=1: at
        // the finest level, strength 0.85 keeps 15% of the chroma signal, but 0.97 keeps only
        // 3% — a ~5x cut, not a proportionally-small step. That's why the previous fix here
        // (bumping strength 0.99->0.97 for the 6400+ bracket) barely moved the measured
        // over-smoothing (nr_scorecard.py: 0.67x -> 0.65x vs Lightroom, i.e. no real change).
        // ISO 12800 genuinely has more low-frequency chroma "packets" than 5000, but the fix
        // for that is MORE WAVELET LEVELS (reaching coarser noise), not a harder per-level cut
        // that also destroys real color saturation. Keep the proven strength (0.85, same as
        // 5000 — measured 0.96x, comparable to Lightroom) and add levels instead.
        6400..=15999 => (8, 0.78),
        _ => (9, 0.78),
    };
    eprintln!("[chroma-nr] ISO {iso} -> levels={levels} strength={strength} ({w}x{h})");
    let npx = w * h;
    // RGB u16 -> Y/Cb/Cr f32 planes (BT.601, chroma zero-centered).
    let mut yv = vec![0f32; npx];
    let mut cb = vec![0f32; npx];
    let mut cr = vec![0f32; npx];
    yv.par_iter_mut().zip(cb.par_iter_mut()).zip(cr.par_iter_mut()).enumerate().for_each(|(i, ((py, pcb), pcr))| {
        let r = rgb[i * 3] as f32;
        let g = rgb[i * 3 + 1] as f32;
        let b = rgb[i * 3 + 2] as f32;
        *py = 0.299 * r + 0.587 * g + 0.114 * b;
        *pcb = -0.168_736 * r - 0.331_264 * g + 0.5 * b;
        *pcr = 0.5 * r - 0.418_688 * g - 0.081_312 * b;
    });

    // Separable à-trous convolution with the B3-spline kernel [1,4,6,4,1]/16, hole spacing 2^lvl.
    fn atrous_smooth(src: &[f32], w: usize, h: usize, step: usize) -> Vec<f32> {
        const K: [f32; 5] = [1.0 / 16.0, 4.0 / 16.0, 6.0 / 16.0, 4.0 / 16.0, 1.0 / 16.0];
        let mut tmp = vec![0f32; src.len()];
        // horizontal
        tmp.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
            let base = y * w;
            for x in 0..w {
                let mut acc = 0f32;
                for (k, kv) in K.iter().enumerate() {
                    let off = (k as i64 - 2) * step as i64;
                    let sx = (x as i64 + off).clamp(0, w as i64 - 1) as usize;
                    acc += src[base + sx] * kv;
                }
                row[x] = acc;
            }
        });
        // vertical
        let mut out = vec![0f32; src.len()];
        out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
            for x in 0..w {
                let mut acc = 0f32;
                for (k, kv) in K.iter().enumerate() {
                    let off = (k as i64 - 2) * step as i64;
                    let sy = (y as i64 + off).clamp(0, h as i64 - 1) as usize;
                    acc += tmp[sy * w + x] * kv;
                }
                row[x] = acc;
            }
        });
        out
    }

    // Per chroma plane: decompose, attenuate the detail (finest levels hardest — that's where
    // per-pixel color speckle lives; coarser levels get progressively gentler so broad, REAL
    // color gradients survive), keep the final low-pass untouched. Returns the final low-pass
    // residual too (needed below to detect isolated saturated details).
    let denoise_plane = |plane: &mut Vec<f32>| -> Vec<f32> {
        let mut current = std::mem::take(plane);
        let mut rebuilt = vec![0f32; npx];
        for lvl in 0..levels {
            let smooth = atrous_smooth(&current, w, h, 1usize << lvl);
            // detail_lvl = current - smooth; attenuated by strength, with only a SLIGHT ease-off
            // at the coarsest level (large low-frequency color "packets" — the dominant
            // complaint at high ISO — live in the coarser levels, so they must be hit almost as
            // hard as fine speckle, not protected the way a real color gradient would be).
            let keep = 1.0 - strength * (1.0 - lvl as f32 / levels as f32 * 0.12);
            rebuilt.par_iter_mut().enumerate().for_each(|(i, o)| {
                *o += (current[i] - smooth[i]) * keep;
            });
            current = smooth;
        }
        // residual low-pass carries the true colors
        rebuilt.par_iter_mut().enumerate().for_each(|(i, o)| *o += current[i]);
        *plane = rebuilt;
        current
    };
    // Keep the ORIGINAL chroma so highlights/isolated-detail can be protected below.
    let cb_orig = cb.clone();
    let cr_orig = cr.clone();
    let cb_lowpass = denoise_plane(&mut cb);
    let cr_lowpass = denoise_plane(&mut cr);

    // Highlight protection. Bright highlights have high SNR (little chroma noise to remove) and
    // sit near the RGB gamut edge, where smoothing chroma then clamping back into gamut visibly
    // DESATURATES real color — measured vs Lightroom (nr_validate.py): CS drained ISO-5000
    // highlight saturation to 0.85 where LR keeps ~1.0 (LR barely denoises highlight chroma:
    // it retains 90% there). So blend the denoised chroma back toward the original as luma
    // rises (smoothstep 0.6->0.9), leaving shadow/mid fully denoised but highlight color intact.
    const HL_LO: f32 = 0.60 * 65535.0;
    const HL_HI: f32 = 0.90 * 65535.0;
    // Isolated-saturated-detail protection. The highlight gate above only fires on ABSOLUTE
    // brightness, so a small saturated object that's merely bright RELATIVE to a much darker
    // surround (a gold dog-tag against near-black fur at high ISO) gets none of it — its true
    // luma never crosses 60%. The wavelet's coarse levels (spacing up to 2^(levels-1) px) then
    // pull chroma from a huge neighbourhood that's almost entirely neutral fur, diluting the
    // tag's gold toward grey/blue ("gold reads as silver" — reported, confirmed against a
    // Lightroom reference: CS-NR-off matches LR's tag color almost exactly, CS-NR-on doesn't).
    // Fix: compare each pixel's ORIGINAL chroma magnitude to its final wavelet LOW-PASS (the
    // broad-neighbourhood chroma average) — a big excess means "isolated saturated feature",
    // not noise (chroma noise speckle is small-magnitude by construction), so blend back toward
    // the original chroma the same way highlights are protected.
    // NOTE: linear-domain chroma magnitude is tiny relative to the 16-bit range (measured on
    // a real ISO-12800 gold-tag patch: bright-pixel |chroma| excess ~0.006-0.015 of 65535,
    // NOT the 0.05-0.16 first guessed) — the DCP tone curve hasn't stretched shadows yet here.
    const ISO_LO: f32 = 0.0015 * 65535.0;
    const ISO_HI: f32 = 0.012 * 65535.0;
    rgb.par_chunks_mut(3).enumerate().for_each(|(i, px)| {
        let y = yv[i];
        let t = ((y - HL_LO) / (HL_HI - HL_LO)).clamp(0.0, 1.0);
        let hl = t * t * (3.0 - 2.0 * t); // smoothstep: 0 below 0.6 luma, 1 above 0.9
        let excess = (cb_orig[i] - cb_lowpass[i]).hypot(cr_orig[i] - cr_lowpass[i]);
        let ti = ((excess - ISO_LO) / (ISO_HI - ISO_LO)).clamp(0.0, 1.0);
        let iso = ti * ti * (3.0 - 2.0 * ti);
        let protect = hl.max(iso);
        let b = cb[i] * (1.0 - protect) + cb_orig[i] * protect;
        let r = cr[i] * (1.0 - protect) + cr_orig[i] * protect;
        px[0] = (y + 1.402 * r).round().clamp(0.0, 65535.0) as u16;
        px[1] = (y - 0.344_136 * b - 0.714_136 * r).round().clamp(0.0, 65535.0) as u16;
        px[2] = (y + 1.772 * b).round().clamp(0.0, 65535.0) as u16;
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
