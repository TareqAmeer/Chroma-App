// Dumps a DNG (specifically: DxO PureRAW's denoised output) to the SAME .bin format
// dump_rw2.rs produces (3x little-endian u32 header [width,height,iso] + width*height*3
// little-endian u16 interleaved RGB), so nr_validate.py's load_bin_srgb() reads either
// unchanged. Used to validate the High-tier neural denoiser against DxO PureRAW's own
// denoised output (the tool this whole feature exists to be a fast alternative to) — see
// the denoiser design doc; PureRAW is the ACTUAL competitive benchmark, closer in kind to
// what the High tier is than Lightroom's classical Manual NR sliders are.
//
// DxO PureRAW's DNG output is typically "Linear Raw" per the DNG spec (already demosaiced,
// not Bayer CFA) — confirmed by probing a real file's RawPhotometricInterpretation before
// writing this, not assumed. Handles both that case AND a still-CFA DNG (falls back to the
// same PPGDemosaic raw_decode.rs uses) so this doesn't silently produce garbage if a
// different DNG variant shows up.
//
//   cargo run --release --example dump_dng -- input.dng output.bin [downscale]
use rawler::decoders::RawDecodeParams;
use rawler::imgop::sensor::bayer::ppg::PPGDemosaic;
use rawler::imgop::sensor::bayer::Demosaic;
use rawler::pixarray::PixF32;
use rawler::rawimage::RawPhotometricInterpretation;
use rawler::rawsource::RawSource;
use rayon::prelude::*;
use std::io::Write;

// Identical rotation math to raw_decode.rs's apply_orientation (u16, 3 channels) — duplicated
// rather than imported (this is a standalone calibration tool, not linked against raw_decode.rs)
// but MUST match exactly: ⚠️ found by comparing dump_rw2 vs dump_dng output on real portrait
// photos — dump_rw2 (via raw_decode.rs) already rotates using the RW2's EXIF orientation, but
// this tool originally didn't apply the DNG's own orientation tag at all, so for every portrait
// shot the two dumps were comparing DIFFERENT SPATIAL LAYOUTS of the same photo (RW2 rotated to
// portrait, DNG left in landscape) — nr_validate_dxo.py's patch-based comparison doesn't require
// pixel alignment, but it does require the SAME REAL-WORLD CONTENT at the same normalized
// position, which a 90-degree rotation mismatch completely breaks (measured: one set's Y-noise
// ratio came out at 5.37x, i.e. "DxO added noise" — physically implausible for a denoiser, and
// resolved once orientation was applied here).
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
            let mut dst = vec![0u16; src.len()];
            dst.par_chunks_mut(h * 3).enumerate().for_each(|(y, line)| {
                for x in 0..h {
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 && args.len() != 4 {
        eprintln!("usage: dump_dng <input.dng> <output.bin> [downscale]");
        std::process::exit(2);
    }
    let ds: usize = args.get(3).map(|s| s.parse().expect("downscale int")).unwrap_or(1);
    let bytes = std::fs::read(&args[1]).expect("read input");

    let source = RawSource::new_from_slice(&bytes);
    let decoder = rawler::get_decoder(&source).expect("no decoder for this DNG");
    let params = RawDecodeParams::default();
    let metadata = decoder.raw_metadata(&source, &params).expect("metadata");
    let mut raw_image = decoder.raw_image(&source, &params, false).expect("decode");
    let iso = metadata.exif.iso_speed_ratings.map(|v| v as u32).or(metadata.exif.iso_speed).unwrap_or(0);

    raw_image.apply_scaling().expect("black/white scaling");
    let w = raw_image.width;
    let h = raw_image.height;

    eprintln!("photometric: {:?}", raw_image.photometric);

    let (out_w, out_h, rgb_f32): (usize, usize, Vec<f32>) = match &raw_image.photometric {
        RawPhotometricInterpretation::LinearRaw => {
            // Already demosaiced — cpp should be 3 (or 4 for RGBA-ish; take the first 3).
            let cpp = raw_image.cpp;
            assert!(cpp >= 3, "LinearRaw with cpp={cpp} — expected >=3 interleaved channels");
            let pixels = raw_image.data.as_f32().into_owned();
            let mut interleaved = vec![0f32; w * h * 3];
            for i in 0..w * h {
                interleaved[i * 3] = pixels[i * cpp];
                interleaved[i * 3 + 1] = pixels[i * cpp + 1];
                interleaved[i * 3 + 2] = pixels[i * cpp + 2];
            }
            (w, h, interleaved)
        }
        RawPhotometricInterpretation::Cfa(cfa_config) => {
            // Still Bayer — demosaic with the SAME algorithm raw_decode.rs uses by default,
            // for an apples-to-apples comparison (not testing demosaic differences here).
            eprintln!("DNG is still CFA (not pre-demosaiced) — running PPG demosaic, same as raw_decode.rs");
            let pixels = raw_image.data.as_f32().into_owned();
            let pix = PixF32::new_with(pixels, w, h);
            let roi = pix.rect();
            let rgb = PPGDemosaic::new().demosaic(&pix, &cfa_config.cfa, &cfa_config.colors, roi);
            let mut interleaved = vec![0f32; rgb.width * rgb.height * 3];
            for (i, px) in rgb.pixels().iter().enumerate() {
                interleaved[i * 3] = px[0];
                interleaved[i * 3 + 1] = px[1];
                interleaved[i * 3 + 2] = px[2];
            }
            (rgb.width, rgb.height, interleaved)
        }
        other => panic!("unsupported photometric interpretation for this tool: {other:?}"),
    };

    let mut rgb16_pre = vec![0u16; out_w * out_h * 3];
    for i in 0..out_w * out_h * 3 {
        rgb16_pre[i] = (rgb_f32[i].clamp(0.0, 1.0) * 65535.0).round() as u16;
    }
    // rawler hardcodes raw_image.orientation to Normal (same TODO raw_decode.rs notes) — read
    // the real EXIF tag, same as raw_decode.rs's decode_and_demosaic does for RW2, so a
    // portrait-shot DNG ends up in the SAME spatial layout as the matching RW2 dump.
    let orientation = metadata.exif.orientation.unwrap_or(1);
    let (rgb16, out_w, out_h) = apply_orientation(rgb16_pre, out_w, out_h, orientation);

    eprintln!("{}x{} iso {} decoded (orientation {})", out_w, out_h, iso, orientation);

    let (ow, oh) = (out_w / ds, out_h / ds);
    let mut out16 = vec![0u16; ow * oh * 3];
    for oy in 0..oh {
        for ox in 0..ow {
            let mut acc = [0f64; 3];
            for sy in 0..ds {
                for sx in 0..ds {
                    let si = ((oy * ds + sy) * out_w + ox * ds + sx) * 3;
                    for c in 0..3 {
                        acc[c] += rgb16[si + c] as f64;
                    }
                }
            }
            let n = (ds * ds) as f64;
            let oi = (oy * ow + ox) * 3;
            for c in 0..3 {
                out16[oi + c] = (acc[c] / n).round() as u16;
            }
        }
    }

    let f = std::fs::File::create(&args[2]).expect("create output");
    let mut wtr = std::io::BufWriter::new(f);
    wtr.write_all(&(ow as u32).to_le_bytes()).unwrap();
    wtr.write_all(&(oh as u32).to_le_bytes()).unwrap();
    wtr.write_all(&iso.to_le_bytes()).unwrap();
    let bytes16: Vec<u8> = out16.iter().flat_map(|v| v.to_le_bytes()).collect();
    wtr.write_all(&bytes16).unwrap();
    eprintln!("wrote {} ({}x{})", args[2], ow, oh);
}
