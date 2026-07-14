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

pub fn decode_rw2_bytes(bytes: &[u8], auto_lens: bool, native_nr: bool, demosaic_algo: &str) -> Result<DecodedRaw, String> {
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

    // 2.5) Pre-demosaic clip-to-white highlight neutralization (DEFAULT ON; CS_NO_CLIP_WHITE=1
    // is the diagnostic escape hatch reproducing the old decode). Measured on __TM8159's
    // sunlit-water sparkle patch: 12.6% of pixels were PARTIALLY clipped after WB (some
    // channels pinned, others not — sensor clipping on specular sparkles, then min-normalized
    // WB pushes R past full scale first), and those pixels carry strong false chroma (mean
    // Cb -0.066 / Cr +0.087) that the NR passes then smear into the surrounding dark water —
    // the user-reported "green mush on wave reflections" regression, which no NR tuning could
    // fix because NR was spreading the artifact, not creating it. The classic raw-converter
    // fix: when ANY site in a 2x2 Bayer cell reaches clip, whiten the whole cell so demosaic
    // sees neutral white instead of a false color. Validated 2026-07-13: full nr_validate
    // suite PASSes all 7 LR-referenced ISO sets (100-12800) with this on, including the
    // gold-tag saturation gate (0.86, unchanged — the tag is bright but NOT clipped, so the
    // cell test never fires on it); sparkle-patch chroma smear (mean |chroma|) drops 26% with
    // NR on, and luma gradient energy slightly IMPROVES (whitened cells demosaic crisper).
    if std::env::var_os("CS_NO_CLIP_WHITE").is_none() {
        const CLIP: f32 = 0.995; // post-WB clip threshold (pack clamps at 1.0)
        pixels.par_chunks_mut(2 * w).for_each(|rows| {
            let (top, bot) = rows.split_at_mut(w);
            for cx in 0..w / 2 {
                let i0 = 2 * cx;
                let cell = [top[i0], top[i0 + 1], bot[i0], bot[i0 + 1]];
                if cell.iter().any(|v| *v >= CLIP) {
                    top[i0] = 1.0;
                    top[i0 + 1] = 1.0;
                    bot[i0] = 1.0;
                    bot[i0 + 1] = 1.0;
                }
            }
        });
    }

    // 3) Demosaic. Default: PPG (rawler's own; internally SIMD/rayon-assisted). `demosaic_algo`
    // ("" | "ahd" | "vng" | "mhc") is the real per-photo control — the desktop UI's "RAW
    // Processing: Standard / Sparkle-optimized" toggle passes "ahd" here for photos with dense
    // false-color speckle PPG can't fully avoid (measured 2026-07-13: AHD's homogeneity-
    // directed adaptive interpolation cuts __TM8159's sparkle speckle much further than PPG,
    // but increases chroma noise on OTHER photos — see raw_decode.rs's Cargo.toml comment and
    // the project's noise-model plan file — hence a per-photo opt-in, never a global default).
    // CS_DEMOSAIC env var overrides the parameter for calibration/diagnostics only.
    let demosaic_choice = std::env::var("CS_DEMOSAIC").unwrap_or_else(|_| demosaic_algo.to_string());
    let (out_w, out_h, rgb16_f32): (usize, usize, Vec<f32>) = if demosaic_choice.is_empty() {
        let pix = PixF32::new_with(pixels, w, h);
        let roi = pix.rect();
        let rgb = PPGDemosaic::new().demosaic(&pix, &cfa_config.cfa, &cfa_config.colors, roi);
        let mut interleaved = vec![0f32; rgb.width * rgb.height * 3];
        interleaved
            .par_chunks_mut(3)
            .zip(rgb.pixels().par_iter())
            .for_each(|(dst, px)| {
                dst[0] = px[0];
                dst[1] = px[1];
                dst[2] = px[2];
            });
        (rgb.width, rgb.height, interleaved)
    } else {
        use demosaic::{demosaic as demosaic_fn, Algorithm, CfaPattern};
        let algo = match demosaic_choice.as_str() {
            "ahd" => Algorithm::Ahd,
            "vng" => Algorithm::Vng,
            "mhc" => Algorithm::Mhc,
            other => panic!("unknown CS_DEMOSAIC={other} (expected ahd|vng|mhc)"),
        };
        let cfa_pattern = CfaPattern::bayer_rggb(); // confirmed RGGB via dump_cfa on this camera
        let mut planar = vec![0f32; 3 * w * h]; // crate output is planar CHW (R,G,B planes)
        demosaic_fn(&pixels, w, h, &cfa_pattern, algo, &mut planar)
            .expect("demosaic crate failed");
        let mut interleaved = vec![0f32; w * h * 3];
        interleaved.par_chunks_mut(3).enumerate().for_each(|(i, dst)| {
            dst[0] = planar[i];
            dst[1] = planar[w * h + i];
            dst[2] = planar[2 * w * h + i];
        });
        (w, h, interleaved)
    };

    // 4) Pack to interleaved u16. Floor already applied; ceiling (1.0) only here — the one
    //    hard clip, mirroring libraw's CLIP at 65535 after scale_colors.
    let mut rgb16 = vec![0u16; out_w * out_h * 3];
    rgb16
        .par_chunks_mut(3)
        .zip(rgb16_f32.par_chunks(3))
        .for_each(|(dst, px)| {
            dst[0] = (px[0].clamp(0.0, 1.0) * 65535.0).round() as u16;
            dst[1] = (px[1].clamp(0.0, 1.0) * 65535.0).round() as u16;
            dst[2] = (px[2].clamp(0.0, 1.0) * 65535.0).round() as u16;
        });

    // 4.5) False-color suppression (DEFAULT ON; CS_NO_FALSE_COLOR=1 is the diagnostic escape
    // hatch). Fixes the user-reported green speckle on sunlit-water sparkle: PPG demosaic
    // guesses wrong at the extreme-contrast micro-edges the sparkle field is full of,
    // producing 1-3px false-color (usually green) clumps distinct from the clip-to-white
    // artifact above (these sit on bright-but-NOT-clipped pixels). Every other raw converter
    // ships an equivalent pass (dcraw/LibRaw's `-m N`, RawTherapee's "false color suppression
    // steps") — this decode never had one until now.
    //
    // ⚠️ NOT a blanket median — measured (2026-07-13) that a blanket/loosely-gated median
    // strong enough to fully remove the false-color dots ALSO erases genuine small (1-3px)
    // saturated color (a real point light, a small colored highlight): both are, by
    // definition, local chroma outliers and a purely local statistic can't tell them apart.
    // This is edge-GATED: a pixel is only replaced by its 3x3 chroma median where local LUMA
    // CONTRAST is also high (the geometric condition under which PPG actually produces false
    // color — a bright pixel immediately next to a dark one). The thresholds
    // (contrast=0.5, deviation=0.003, 8 passes) were swept against a synthetic safety battery
    // (calib/false_color_gate.py) — isolated dots from dim to pure-saturated-on-black, a 2x2
    // real color cluster — all preserved untouched, while the reproduced false-color-at-edge
    // case is correctly cleaned. Known residual limitation: a solid 3x3 saturated cluster
    // (bigger than the tested 2x2) does still get smoothed — accepted as a real, documented
    // tradeoff after two independent techniques (this gated median AND a from-scratch LMMSE
    // demosaic prototype) both hit the identical wall for larger isolated features; see the
    // project's noise-model plan file for the full investigation.
    if std::env::var_os("CS_NO_FALSE_COLOR").is_none() {
        let contrast_thresh: f32 = std::env::var("CS_FC_CONTRAST").ok().and_then(|v| v.parse().ok()).unwrap_or(0.5);
        let dev_thresh: f32 = std::env::var("CS_FC_DEV").ok().and_then(|v| v.parse().ok()).unwrap_or(0.003);
        let steps: usize = std::env::var("CS_FC_STEPS").ok().and_then(|v| v.parse().ok()).unwrap_or(8);
        suppress_false_color(&mut rgb16, out_w, out_h, contrast_thresh, dev_thresh, steps);
    }

    // 4.6) Contrast-gated hue-targeted defringe (DEFAULT ON; CS_NO_HUE_DEFRINGE=1 is the
    // diagnostic escape hatch). A complementary technique to the median above — that catches
    // spatial OUTLIERS (a pixel that disagrees with its local neighborhood); this catches a
    // specific false-color SIGNATURE (neon-green hue) regardless of how spatially isolated it
    // is, still gated to local hard-contrast regions so ordinary saturated real content
    // (grass, foliage — which sits in flat, low-contrast areas) is structurally left alone.
    // Prototyped in calib/false_color_gate.py / calib/highlight_rolloff.py; validated
    // 2026-07-13: full nr_validate suite PASSES all 7 LR-referenced ISO sets (gold-tag gate
    // unchanged at 0.86) and a synthetic grass patch is correctly untouched. Measured on
    // __TM8159's worst sparkle hotspot: green-dot fraction 6.2%->0.9-1.7%.
    // ⚠️ Known scope limit: only targets the GREEN (60-170°) hue band — chosen because it's far
    // from realistic skin-tone/wood/sky hues, so widening to red/magenta risks false-positiving
    // on much more common real content. Residual red/blue/magenta false-color speckle in the
    // worst scenes is NOT addressed by this pass (see the CS_DEMOSAIC=ahd opt-in toggle for a
    // stronger but riskier alternative for exactly those difficult photos).
    if std::env::var_os("CS_NO_HUE_DEFRINGE").is_none() {
        let contrast_thresh: f32 = std::env::var("CS_HD_CONTRAST").ok().and_then(|v| v.parse().ok()).unwrap_or(0.05);
        hue_defringe_gated(&mut rgb16, out_w, out_h, contrast_thresh);
    }

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
        // Diagnostic escape hatch (mirrors CS_NO_CHROMA_NR inside the wavelet pass): lets the
        // calib harness isolate each pass's contribution — CS_NO_CHROMA_NR only disables the
        // wavelet, so the shadow pass alone had never been isolatable before this. Unset in
        // all normal use; default behavior unchanged.
        if std::env::var_os("CS_NO_SHADOW_NR").is_none() {
            denoise_shadows_rgb16(&mut rgb16, out_w, out_h);
        }
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
            // Full-strength chroma-only blend here — no feature protection in this pass. (An
            // earlier "isolated-saturated-detail" gate lived here too, but it keyed on chroma
            // EXCESS vs the 7x7 average, a quantity high-ISO chroma NOISE also has, so it re-left
            // red/green speckle in the sky/fur. All feature protection now lives in the single
            // luma-guided wavelet pass below, which can tell a real (luma-edge-backed) colored
            // feature from noise; this pass just cleans, luma preserved.)
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
    // Diagnostic escape hatch (same spirit as CS_NO_CHROMA_NR above) for A/B validating
    // calib/derive_iso_table.py's physically-derived (levels, strength) against the hardcoded
    // per-ISO-bracket table below, via dump_rw2 + calib/nr_validate.py. Not a user-facing
    // setting — unset in all normal use, so default behavior is completely unchanged.
    let override_ls = (|| {
        let s: f32 = std::env::var("CS_NR_STRENGTH").ok()?.parse().ok()?;
        let l: usize = std::env::var("CS_NR_LEVELS").ok()?.parse().ok()?;
        Some((l, s))
    })();
    let (levels, strength): (usize, f32) = if let Some(ls) = override_ls {
        ls
    } else {
        match iso {
        0..=1599 => {
            eprintln!("[chroma-nr] ISO {iso} < 1600 — skipped");
            return;
        }
        1600..=3199 => (3, 0.6),
        // Strength lowered from 0.85: measured against Lightroom (nr_validate.py), 0.85 over-
        // cleaned chroma (CS kept less chroma than LR) and drained highlight saturation to 0.84
        // ("muted colors"). 0.70 keeps more real color while still killing the noise.
        //
        // 2026-07-13: tried raising `levels` (5->6..14) to close a separately-diagnosed
        // residual-speckle gap in dense-texture scenes (__TM8159's sunlit-water sparkle field,
        // post clip-to-white fix — see that fix's comment above). Result: NO safe headroom
        // exists on this single global knob. Measured directly on __TM8159's own flat "high"
        // bucket (nr_validate.py's own patch-selection, not the sparkle texture): shipped
        // levels=5 sits at saturation-retention 0.882, already RIGHT AT the muted-color gate
        // (0.88) with zero margin; levels=6 alone drops it to 0.871 (FAILS). The flat highlight
        // patch and the textured sparkle patch pull this one knob in opposite directions —
        // more levels helps the sparkle field's residual chroma variance (Cb std 0.0657->0.0600
        // at levels=10) but muddies flat highlight saturation on the SAME photo. Fixing the
        // sparkle case without this regression needs a texture-aware (not global-constant)
        // mechanism — a median-filter hybrid was prototyped for this in
        // calib/vst_denoise.py/hybrid_wiener_median but isn't production-ready. Left at the
        // proven, safe 5/0.70.
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
        }
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

    #[inline]
    fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
        let t = ((x - a) / (b - a).max(1e-9)).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    // LUMA-GUIDED, CROSS-SCALE chroma denoise (the darktable / LR-style shape).
    //
    // The previous "chroma-excess" protection keyed on |orig_chroma - local_avg|, a quantity
    // high-ISO chroma NOISE has just as much as a real saturated feature — so protecting the
    // gold tag also re-added the red/green speckle in sky and fur (reported regression). The
    // fix discriminates on axes noise does NOT share, measured on this exact frame:
    //   * SCALE — the visible sharp speckle lives in the FINE wavelet levels (measured |Cdet|
    //     at lvl1: sky 183, fur 115, tag only 84). Killing fine chroma detail everywhere
    //     removes the speckle and barely touches the tag (whose colour is in the low-pass +
    //     coarse detail). darktable states the principle directly: "colours do not change a lot
    //     on fine scales", so fine chroma can be attenuated almost fully.
    //   * LUMA-EDGE COINCIDENCE at COARSE levels — the tag's bright rim is a real luminance edge
    //     (coarse |Ydet| ~130-250) whose coarse chroma detail (lvl7 |Cdet| ~125) is its true
    //     gold; the flat sky has no luma structure (coarse |Ydet| ~5) so it never gets
    //     protection and stays clean. Protection is applied ONLY at coarse levels and ONLY where
    //     luma detail is strong, so it can preserve the rim without resurrecting fine speckle.
    //
    // Per-level keep = base(lvl) + coarse_gate(lvl) * luma_gate(|Ydet_lvl|) * (KEEP_PROTECT - base).
    // base ramps fine->coarse so all noise is hit hard as a floor; protection only lifts keep on
    // real coarse luma edges.
    // Base attenuation is scaled by the ISO `strength` (normalized to the 12800 reference of
    // 0.78) so low-ISO files, which carry little chroma noise, are cleaned GENTLER instead of
    // having their sparse real colour detail flattened at the full high-ISO rate.
    let s = strength / 0.78;
    let keep_fine = 1.0 - 0.95 * s; // finest level: ~95% attenuation at 12800 (kills speckle)
    let keep_coarse = 1.0 - 0.80 * s; // coarsest base: strong but lighter than fine
    const KEEP_PROTECT: f32 = 0.98; // at a protected luma edge: retain nearly all real chroma
    // Protection reach (both the coarse-level band and the luma-edge bar) scales with `s`: full
    // width/low bar at s=1 (ISO 12800, where the reported tag defect lives), progressively
    // narrower/stricter below. A single GLOBAL threshold can't serve both: loosening it enough
    // to save the 12800 tag also let ISO 5000 (a different scene, __TM8159) earn coarse
    // protection on subtler shadow luma gradients, leaving more shadow chroma noise than
    // Lightroom there (measured ratio 1.63, over the two-sided gate) — a per-ISO regression the
    // tag-only test on __TM8304 didn't exercise. Scaling by `s` keeps 12800 exactly as validated
    // while making lower ISOs conservative by default.
    let t = ((s - 0.70) / 0.30).clamp(0.0, 1.0); // 0 at ISO~2000, 1 at ISO 12800
    let yedge_lo = 140.0 - 90.0 * t; // 140 at low-s .. 50 at s=1
    let yedge_hi = 300.0 - 160.0 * t; // 300 at low-s .. 140 at s=1
    let coarse_lo = 0.30 - 0.18 * t; // 0.30 at low-s .. 0.12 at s=1
    let coarse_hi = 0.55 - 0.15 * t; // 0.55 at low-s .. 0.40 at s=1

    // Per-level luma detail magnitude — the shared edge guide for BOTH chroma planes.
    let mut luma_detail: Vec<Vec<f32>> = Vec::with_capacity(levels);
    {
        let mut lcur = yv.clone();
        for lvl in 0..levels {
            let lsm = atrous_smooth(&lcur, w, h, 1usize << lvl);
            let mut d = vec![0f32; npx];
            d.par_iter_mut().enumerate().for_each(|(i, o)| *o = (lcur[i] - lsm[i]).abs());
            luma_detail.push(d);
            lcur = lsm;
        }
    }
    let ldiv = if levels > 1 { (levels - 1) as f32 } else { 1.0 };

    // 2026-07-13: attempted a texture-DENSITY gate here (distinguish an isolated real edge,
    // e.g. the gold tag's rim, from a densely-packed field of edges, e.g. sunlit-water
    // sparkle) to suppress over-protection in the latter case without touching the former.
    // REVERTED — not shippable as attempted: a box-averaged binarized edge-density measure
    // using the existing yedge_lo threshold put BOTH the sparkle patch (mean density 0.94)
    // and an ordinary flat highlight patch on a different bucket of the SAME photo (mean
    // 0.67) far above any reasonable separating threshold — the edge-magnitude threshold
    // that's fine for gating protection strength is far too permissive to also gate texture
    // density (ordinary photographic detail already exceeds it almost everywhere). Properly
    // calibrating a real separator needs more reference examples (isolated-feature vs.
    // dense-texture crops across multiple photos) than were available this session — don't
    // reattempt this exact mechanism without that calibration work done first.
    // Diagnostic-only (unset in normal use): scales the luma-edge protection's ceiling for
    // A/B testing whether it's over-protecting texture-dense scenes (many real luma edges,
    // e.g. a sparkle field) the same way it correctly protects a real isolated feature (the
    // gold tag). 1.0 = shipped behavior.
    let protect_scale: f32 = std::env::var("CS_NR_PROTECT_SCALE").ok().and_then(|v| v.parse().ok()).unwrap_or(1.0);
    let denoise_plane = |plane: &mut Vec<f32>| {
        let mut current = std::mem::take(plane);
        let mut rebuilt = vec![0f32; npx];
        for lvl in 0..levels {
            let smooth = atrous_smooth(&current, w, h, 1usize << lvl);
            let lvl_frac = lvl as f32 / ldiv;
            let base_keep = keep_fine + (keep_coarse - keep_fine) * lvl_frac;
            let coarse_gate = smoothstep(coarse_lo, coarse_hi, lvl_frac);
            let ld = &luma_detail[lvl];
            rebuilt.par_iter_mut().enumerate().for_each(|(i, o)| {
                let luma_gate = smoothstep(yedge_lo, yedge_hi, ld[i]);
                let keep = (base_keep + protect_scale * coarse_gate * luma_gate * (KEEP_PROTECT - base_keep)).min(1.0);
                *o += (current[i] - smooth[i]) * keep;
            });
            current = smooth;
        }
        // residual low-pass carries the true (broad) colours, untouched
        rebuilt.par_iter_mut().enumerate().for_each(|(i, o)| *o += current[i]);
        *plane = rebuilt;
    };
    // Keep the ORIGINAL chroma so absolute-highlight protection can restore it below.
    let cb_orig = cb.clone();
    let cr_orig = cr.clone();
    denoise_plane(&mut cb);
    denoise_plane(&mut cr);

    // Absolute-highlight protection. Bright highlights have high SNR (little chroma noise) and
    // sit near the RGB gamut edge, where smoothing chroma then clamping back into gamut visibly
    // DESATURATES real color — measured vs Lightroom (nr_validate.py): CS drained ISO-5000
    // highlight saturation to 0.85 where LR keeps ~1.0. Blend denoised chroma back toward the
    // original as ABSOLUTE luma rises (smoothstep 0.6->0.9). (The relative-luma tag case is now
    // handled inside the wavelet by the luma-guided coarse protection above, not here.)
    const HL_LO: f32 = 0.60 * 65535.0;
    const HL_HI: f32 = 0.90 * 65535.0;
    rgb.par_chunks_mut(3).enumerate().for_each(|(i, px)| {
        let y = yv[i];
        let hl = smoothstep(HL_LO, HL_HI, y);
        let b = cb[i] * (1.0 - hl) + cb_orig[i] * hl;
        let r = cr[i] * (1.0 - hl) + cr_orig[i] * hl;
        px[0] = (y + 1.402 * r).round().clamp(0.0, 65535.0) as u16;
        px[1] = (y - 0.344_136 * b - 0.714_136 * r).round().clamp(0.0, 65535.0) as u16;
        px[2] = (y + 1.772 * b).round().clamp(0.0, 65535.0) as u16;
    });
}

/// Edge-gated false-color suppression — see the call site's doc comment in
/// decode_rw2_bytes for the full rationale and validation history. Operates on interleaved
/// u16 RGB (post-demosaic, pre-orientation). `contrast_thresh`/`dev_thresh` are in normalized
/// 0..1 units (matching calib/false_color_gate.py's Python prototype exactly, so thresholds
/// swept there carry over directly); `steps` is the number of gated-median passes.
fn suppress_false_color(rgb: &mut [u16], w: usize, h: usize, contrast_thresh: f32, dev_thresh: f32, steps: usize) {
    let npx = w * h;
    let mut yv = vec![0f32; npx];
    let mut cb = vec![0f32; npx];
    let mut cr = vec![0f32; npx];
    yv.par_iter_mut().zip(cb.par_iter_mut()).zip(cr.par_iter_mut()).enumerate().for_each(|(i, ((py, pcb), pcr))| {
        let r = rgb[i * 3] as f32 / 65535.0;
        let g = rgb[i * 3 + 1] as f32 / 65535.0;
        let b = rgb[i * 3 + 2] as f32 / 65535.0;
        *py = 0.299 * r + 0.587 * g + 0.114 * b;
        *pcb = -0.168_736 * r - 0.331_264 * g + 0.5 * b;
        *pcr = 0.5 * r - 0.418_688 * g - 0.081_312 * b;
    });

    // Local luma contrast = max-min over a 5x5 window (NOT a box-average diff — measured
    // directly on real false-color pixels that a box-diff badly under-reports contrast near a
    // hard edge, since the demosaic itself already smooths the transition over a few pixels).
    let mut contrast = vec![0f32; npx];
    contrast.par_iter_mut().enumerate().for_each(|(i, o)| {
        let (x, y) = (i % w, i / w);
        let mut lo = f32::MAX;
        let mut hi = f32::MIN;
        for dy in -2i32..=2 {
            let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
            for dx in -2i32..=2 {
                let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                let v = yv[sy * w + sx];
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        *o = hi - lo;
    });

    let median9 = |vals: &mut [f32; 9]| -> f32 {
        vals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        vals[4]
    };

    for _ in 0..steps {
        for plane in [&mut cb, &mut cr] {
            let mut next = plane.clone();
            next.par_iter_mut().enumerate().for_each(|(i, o)| {
                if contrast[i] <= contrast_thresh {
                    return; // not near a hard edge — never a candidate, regardless of deviation
                }
                let (x, y) = (i % w, i / w);
                let mut window = [0f32; 9];
                let mut k = 0;
                for dy in -1i32..=1 {
                    let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                    for dx in -1i32..=1 {
                        let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                        window[k] = plane[sy * w + sx];
                        k += 1;
                    }
                }
                let med = median9(&mut window);
                if (plane[i] - med).abs() > dev_thresh {
                    *o = med;
                }
            });
            *plane = next;
        }
    }

    rgb.par_chunks_mut(3).enumerate().for_each(|(i, px)| {
        let y = yv[i];
        px[0] = ((y + 1.402 * cr[i]) * 65535.0).round().clamp(0.0, 65535.0) as u16;
        px[1] = ((y - 0.344_136 * cb[i] - 0.714_136 * cr[i]) * 65535.0).round().clamp(0.0, 65535.0) as u16;
        px[2] = ((y + 1.772 * cb[i]) * 65535.0).round().clamp(0.0, 65535.0) as u16;
    });
}

/// Diagnostic-only contrast-gated hue-targeted defringe — see the call site's doc comment.
/// Ports calib/false_color_gate.py's `hue_defringe_gated` prototype exactly (hue band, sat
/// threshold, desaturation amount are the values measured there): only desaturate pixels
/// whose hue falls in the neon-green/magenta band AND sit at a local hard luma edge.
fn hue_defringe_gated(rgb: &mut [u16], w: usize, h: usize, contrast_thresh: f32) {
    const HUE_LO: f32 = 60.0 / 360.0;
    const HUE_HI: f32 = 170.0 / 360.0;
    const SAT_THRESH: f32 = 0.10;
    const DESAT_AMOUNT: f32 = 0.95;

    let npx = w * h;
    let mut yv = vec![0f32; npx];
    yv.par_iter_mut().enumerate().for_each(|(i, py)| {
        let r = rgb[i * 3] as f32 / 65535.0;
        let g = rgb[i * 3 + 1] as f32 / 65535.0;
        let b = rgb[i * 3 + 2] as f32 / 65535.0;
        *py = 0.299 * r + 0.587 * g + 0.114 * b;
    });

    let mut contrast = vec![0f32; npx];
    contrast.par_iter_mut().enumerate().for_each(|(i, o)| {
        let (x, y) = (i % w, i / w);
        let mut lo = f32::MAX;
        let mut hi = f32::MIN;
        for dy in -2i32..=2 {
            let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
            for dx in -2i32..=2 {
                let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                let v = yv[sy * w + sx];
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        *o = hi - lo;
    });

    rgb.par_chunks_mut(3).enumerate().for_each(|(i, px)| {
        if contrast[i] <= contrast_thresh {
            return;
        }
        let r = px[0] as f32 / 65535.0;
        let g = px[1] as f32 / 65535.0;
        let b = px[2] as f32 / 65535.0;
        let mx = r.max(g).max(b);
        let mn = r.min(g).min(b);
        let delta = (mx - mn).max(1e-9);
        let hue = if mx == r {
            (((g - b) / delta).rem_euclid(6.0)) / 6.0
        } else if mx == g {
            (((b - r) / delta) + 2.0) / 6.0
        } else {
            (((r - g) / delta) + 4.0) / 6.0
        };
        let sat = delta / mx.max(1e-9);
        if hue >= HUE_LO && hue <= HUE_HI && sat > SAT_THRESH {
            let y = yv[i];
            let new_r = r * (1.0 - DESAT_AMOUNT) + y * DESAT_AMOUNT;
            let new_g = g * (1.0 - DESAT_AMOUNT) + y * DESAT_AMOUNT;
            let new_b = b * (1.0 - DESAT_AMOUNT) + y * DESAT_AMOUNT;
            px[0] = (new_r * 65535.0).round().clamp(0.0, 65535.0) as u16;
            px[1] = (new_g * 65535.0).round().clamp(0.0, 65535.0) as u16;
            px[2] = (new_b * 65535.0).round().clamp(0.0, 65535.0) as u16;
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
