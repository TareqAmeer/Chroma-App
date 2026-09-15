// Cross-platform Ultra HDR JPEG export (docs/windows-port.md Phase 4) — the ISO 21496-1
// gain-map counterpart to gainmap.rs's macOS-only HEIC path. Pure-Rust (ultrahdr-rs, imazen),
// so unlike gainmap.rs this isn't behind `#[cfg(target_os = "macos")]`; it's what Windows gets,
// and it's a fine second option on macOS too.
//
// This reuses the EXACT (headroom_png, graded_png, quality, max_stops) contract JS already
// builds for gainmap.rs's `write_gainmap_heic_from_map` (chromasmith-22.html's
// fxSaveGainMapHeic / _hdrHeadroomPngFor / hrByteForHeadroom) — only the container/encoder
// differs, so no new JS-side computation was needed, only a new command to route to.
//
// HEADROOM BYTE DECODE — the inverse of chromasmith-22.html's hrByteForHeadroom:
//     byte = round(255 * srgbEncode(min(1, log2(maxV) / max_stops)))
// where maxV is the per-pixel HDR/SDR linear luminance ratio. gainmap.rs's macOS path relies on
// Core Image's `imageWithData:` doing an *implicit* sRGB EOTF decode of the PNG on load (see
// that module's own comment on why the byte is pre-encoded for exactly that). The `image` crate
// used here does NOT implicitly decode gamma — `to_luma8()` hands back the stored bytes as-is —
// so this module undoes the encode explicitly, the same math gainmap.rs's Core Image filter
// graph does implicitly:
//     norm     = srgb_eotf(byte / 255)       // undoes hrByteForHeadroom's srgbEncode (OETF)
//     headroom = 2^(norm * max_stops)        // undoes the log2/HR_MAX_STOPS normalization
//     HDR(out) = SDR(graded) * headroom      // same reconstruction as gainmap.rs's multiply()
//
// The reconstructed HDR pixels are handed to ultrahdr-rs's own `compute_gainmap`, rather than
// hand-deriving GainMapMetadata, so the min/max-gain and headroom fields it writes are the
// spec-correct ones its own gain-computation loop actually produced — not a second, potentially
// drifting copy of that math.

use ultrahdr_rs::color::transfer::srgb_eotf;
use ultrahdr_rs::gainmap::compute::{compute_gainmap, GainMapConfig};
use ultrahdr_rs::{encode_ultrahdr, ColorGamut, ColorTransfer, PixelFormat, RawImage, Unstoppable};

/// Writes ONE graded photo as an Ultra HDR JPEG. Same shape as gainmap.rs's
/// `write_gainmap_heic_from_map`: `headroom_png` is a grayscale (replicated-RGB) PNG where each
/// byte encodes 0..max_stops of log2 headroom (see the module comment above), `graded_png` is
/// the SDR render, pixel-aligned to it.
///
/// Returns `Ok(false)` when the headroom map carries no actual headroom (every byte 0) — the
/// caller should then fall back to a normal SDR export rather than writing a gain map that
/// encodes nothing.
pub fn write_gainmap_uhdr_from_map(
    headroom_png: &[u8],
    graded_png: &[u8],
    dest_path: &str,
    quality: f64,
    max_stops: f64,
) -> Result<bool, String> {
    let hr_img = image::load_from_memory(headroom_png)
        .map_err(|e| format!("could not decode the headroom map: {e}"))?
        .to_luma8();
    let graded_img = image::load_from_memory(graded_png)
        .map_err(|e| format!("could not decode the graded image: {e}"))?
        .to_rgb8();

    let (w, h) = graded_img.dimensions();
    if hr_img.dimensions() != (w, h) {
        return Err(format!(
            "headroom map {}x{} doesn't match graded image {}x{}",
            hr_img.width(),
            hr_img.height(),
            w,
            h
        ));
    }

    let max_stops = (max_stops.max(0.0)) as f32;
    let sdr_bytes = graded_img.as_raw();
    let hr_bytes = hr_img.as_raw();

    let mut any_headroom = false;
    // RGBA32F, linear: compute_gainmap's own get_linear_rgb reads Rgba32F pixels as already-
    // linear (no further EOTF applied — see that function's match arm), which is exactly the
    // representation reconstructed HDR values above 1.0 need.
    let mut hdr_pixels: Vec<u8> = Vec::with_capacity((w as usize) * (h as usize) * 16);
    for i in 0..(w as usize * h as usize) {
        let hr_byte = hr_bytes[i];
        if hr_byte > 0 {
            any_headroom = true;
        }
        let norm = srgb_eotf(hr_byte as f32 / 255.0);
        let headroom = 2f32.powf(norm * max_stops);
        for c in 0..3 {
            let sdr_linear = srgb_eotf(sdr_bytes[i * 3 + c] as f32 / 255.0);
            hdr_pixels.extend_from_slice(&(sdr_linear * headroom).to_le_bytes());
        }
        hdr_pixels.extend_from_slice(&1.0f32.to_le_bytes()); // alpha
    }

    if !any_headroom {
        return Ok(false);
    }

    let sdr_raw = RawImage::from_data(
        w,
        h,
        PixelFormat::Rgb8,
        ColorGamut::Bt709,
        ColorTransfer::Srgb,
        sdr_bytes.to_vec(),
    )
    .map_err(|e| format!("build SDR RawImage: {e}"))?;
    let hdr_raw = RawImage::from_data(
        w,
        h,
        PixelFormat::Rgba32F,
        ColorGamut::Bt709,
        ColorTransfer::Linear,
        hdr_pixels,
    )
    .map_err(|e| format!("build HDR RawImage: {e}"))?;

    let (gain_map, metadata) = compute_gainmap(&hdr_raw, &sdr_raw, &GainMapConfig::default(), Unstoppable)
        .map_err(|e| format!("compute_gainmap: {e}"))?;

    let jpeg_quality = (quality.clamp(0.0, 1.0) * 100.0).round().clamp(1.0, 100.0) as u8;
    let base_jpeg = encode_jpeg_rgb8(sdr_bytes, w, h, jpeg_quality)?;
    // Grayscale for the gain map — it's single-channel data (GainMapConfig::default() is not
    // multi_channel), so channels==1 always holds here.
    let gainmap_jpeg = encode_jpeg_luma8(&gain_map.data, gain_map.width, gain_map.height, jpeg_quality)?;

    let out = encode_ultrahdr(&base_jpeg, &gainmap_jpeg, &metadata, ColorGamut::Bt709)
        .map_err(|e| format!("encode_ultrahdr: {e}"))?;

    std::fs::write(dest_path, &out).map_err(|e| format!("write '{dest_path}': {e}"))?;
    Ok(true)
}

fn encode_jpeg_rgb8(data: &[u8], w: u32, h: u32, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode(data, w, h, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("jpeg encode (base): {e}"))?;
    Ok(out)
}

fn encode_jpeg_luma8(data: &[u8], w: u32, h: u32, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode(data, w, h, image::ExtendedColorType::L8)
        .map_err(|e| format!("jpeg encode (gainmap): {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Builds a (headroom_png, graded_png) pair the same shape JS sends: a flat mid-gray graded
    // photo, and a headroom map with the RIGHT half at max headroom (byte 255) and the left half
    // at zero, both grayscale PNGs with the value replicated into R/G/B (matches
    // _hdrHeadroomPngFor's putImageData loop in chromasmith-22.html).
    fn build_inputs(w: u32, h: u32) -> (Vec<u8>, Vec<u8>) {
        let graded = image::RgbImage::from_fn(w, h, |_, _| image::Rgb([180, 150, 120]));
        let headroom = image::RgbImage::from_fn(w, h, |x, _| {
            let v = if x >= w / 2 { 255u8 } else { 0u8 };
            image::Rgb([v, v, v])
        });
        let mut graded_png = Vec::new();
        image::DynamicImage::ImageRgb8(graded)
            .write_to(&mut std::io::Cursor::new(&mut graded_png), image::ImageFormat::Png)
            .unwrap();
        let mut headroom_png = Vec::new();
        image::DynamicImage::ImageRgb8(headroom)
            .write_to(&mut std::io::Cursor::new(&mut headroom_png), image::ImageFormat::Png)
            .unwrap();
        (headroom_png, graded_png)
    }

    #[test]
    fn no_headroom_falls_back_to_sdr() {
        let graded = image::RgbImage::from_fn(16, 16, |_, _| image::Rgb([128, 128, 128]));
        let headroom = image::RgbImage::from_fn(16, 16, |_, _| image::Rgb([0, 0, 0]));
        let mut graded_png = Vec::new();
        image::DynamicImage::ImageRgb8(graded)
            .write_to(&mut std::io::Cursor::new(&mut graded_png), image::ImageFormat::Png)
            .unwrap();
        let mut headroom_png = Vec::new();
        image::DynamicImage::ImageRgb8(headroom)
            .write_to(&mut std::io::Cursor::new(&mut headroom_png), image::ImageFormat::Png)
            .unwrap();

        let dest = std::env::temp_dir().join("chromasmith_uhdr_test_no_headroom.jpg");
        let wrote = write_gainmap_uhdr_from_map(&headroom_png, &graded_png, dest.to_str().unwrap(), 0.92, 2.0)
            .expect("should not error");
        assert!(!wrote, "an all-zero headroom map must report no headroom, not write a file");
    }

    #[test]
    fn round_trip_carries_real_gain_map() {
        let (headroom_png, graded_png) = build_inputs(64, 64);
        let dest = std::env::temp_dir().join("chromasmith_uhdr_test_roundtrip.jpg");
        let wrote = write_gainmap_uhdr_from_map(&headroom_png, &graded_png, dest.to_str().unwrap(), 0.92, 2.0)
            .expect("encode should succeed");
        assert!(wrote);

        let bytes = std::fs::read(&dest).expect("read written file");
        let decoder = ultrahdr_rs::Decoder::new(&bytes).expect("parse as a JPEG/Ultra HDR container");
        assert!(decoder.is_ultrahdr(), "container must carry a gain map, not be a plain JPEG");
        let metadata = decoder.metadata().expect("gain map metadata must be present");
        // The right half of the headroom map was at max (byte 255 -> ~2 stops -> ~4x), so the
        // computed max gain must reflect real boost, not a degenerate 1.0x (log2 == 0).
        assert!(
            metadata.gain_map_max[0] > 0.5,
            "expected meaningful headroom in the metadata, got gain_map_max={:?}",
            metadata.gain_map_max
        );
        assert!(decoder.primary_jpeg().is_some());
        assert!(decoder.gainmap_jpeg().is_some());

        let _ = std::fs::remove_file(&dest);
    }
}
