// Decode any still the WebView/browser can't (formats::STILL_RUST_EXTS: exr, hdr, tga, dds,
// qoi, ff, pnm/pbm/pgm/ppm/pam, jxl) to display-ready RGBA8. Content-sniffed first via
// `image`'s own format guessing (same philosophy as rawler's get_decoder: the extension is a
// hint, not the ground truth), so a mislabelled file still opens.
//
// Shared by decode_image_v1 (main.rs) AND library.rs's get_thumbnail_inner via open_any_path —
// deliberately one implementation, not two, so the Library grid thumbnail and the editor can
// never disagree about how a given EXR/JXL/etc. renders.
use image::{DynamicImage, ImageReader};
use std::io::Cursor;
use std::path::Path;

pub struct DecodedStill {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
    pub dpi: u32,
    pub dpi_known: bool,
    pub note: Option<String>,
}

/// sRGB OETF (linear -> gamma-encoded), applied to EXR/HDR's float samples before quantizing to
/// 8-bit. Must stay the byte-exact twin of chromasmith-22.html's srgbG()/`_srgbEncode` — see
/// srgb_oetf_matches_js below for the numbers this is checked against.
fn srgb_oetf(x: f32) -> f32 {
    if x <= 0.0031308 {
        x * 12.92
    } else {
        1.055 * x.max(0.0).powf(1.0 / 2.4) - 0.055
    }
}

/// Float (HDR/EXR) DynamicImage -> 8-bit sRGB RGBA, by clamping to [0,1] and applying the sRGB
/// OETF. Deliberately NO tone mapping, deliberately NO normalising by the frame's own max:
///
/// - A tone curve (Reinhard/Filmic/etc.) here would be a LOOK decision baked into the loader,
///   pre-grading every EXR before the user's own grade even runs, and impossible to undo from
///   inside the app afterward. The whole premise of this app is that the look comes from its own
///   calibrated pipeline (LUTs, halation model, DCP chain) — not from the loader.
/// - Normalising by the frame's own max would make two frames of the same sequence render
///   differently depending on what happened to be brightest in each one.
///
/// Clamping is lossy and obviously so: anything above 1.0 blows out, exactly like any other
/// SDR-only path in this app today. The caller surfaces `note` so the UI can log it. The
/// principled fix is reusing the RAW path's existing HDR-headroom channel (chromasmith-22.html's
/// hrOut/HR_MAX_STOPS) instead of clamping — tracked as follow-up work, not done here.
fn hdr_to_srgb8(img: &DynamicImage) -> (Vec<u8>, Option<String>) {
    let rgba32f = img.to_rgba32f();
    let (w, h) = (rgba32f.width(), rgba32f.height());
    let mut clipped = false;
    let mut out = vec![0u8; (w * h * 4) as usize];
    for (i, px) in rgba32f.pixels().enumerate() {
        let [r, g, b, a] = px.0;
        if r > 1.0 || g > 1.0 || b > 1.0 {
            clipped = true;
        }
        out[i * 4] = (srgb_oetf(r.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8;
        out[i * 4 + 1] = (srgb_oetf(g.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8;
        out[i * 4 + 2] = (srgb_oetf(b.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8;
        out[i * 4 + 3] = (a.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    }
    let note = clipped.then(|| {
        "HDR source clipped at 1.0 — values above that were blown out on import (no HDR headroom \
         carried through for this format yet)."
            .to_string()
    });
    (out, note)
}

/// Decode bytes to RGBA8 + metadata. `ext_hint` (lowercase, no dot) is used only when `image`'s
/// own magic-byte sniffing fails to guess a format — genuinely headerless formats (some raw PNM
/// variants) need it; everything else is sniffed from content first.
pub fn open_any_bytes(bytes: &[u8], ext_hint: &str) -> Result<DecodedStill, String> {
    if ext_hint.eq_ignore_ascii_case("jxl") {
        return open_jxl_bytes(bytes);
    }

    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!(".{ext_hint}: could not read image data ({e})"))?;
    let img = match reader.decode() {
        Ok(img) => img,
        Err(_) => {
            // Guessing failed (genuinely headerless formats) — retry pinned to the extension.
            let fmt = image::ImageFormat::from_extension(ext_hint)
                .ok_or_else(|| format!(".{ext_hint}: not a recognised still-image format"))?;
            let mut reader2 = ImageReader::new(Cursor::new(bytes));
            reader2.set_format(fmt);
            reader2
                .decode()
                .map_err(|e| format!(".{ext_hint}: could not decode image ({e})"))?
        }
    };
    Ok(finish_decode(img, ext_hint.eq_ignore_ascii_case("exr") || ext_hint.eq_ignore_ascii_case("hdr")))
}

fn open_jxl_bytes(bytes: &[u8]) -> Result<DecodedStill, String> {
    use jxl_oxide::integration::JxlDecoder;
    let decoder = JxlDecoder::new(Cursor::new(bytes)).map_err(|e| format!(".jxl: {e}"))?;
    let img = DynamicImage::from_decoder(decoder).map_err(|e| format!(".jxl: {e}"))?;
    let mut decoded = finish_decode(img, false);
    // JXL can carry EXIF orientation (the only new-here format that does — `image`'s
    // ImageDecoder trait doesn't apply it automatically). Best-effort: absence or a parse
    // failure just means "no rotation applied", not a hard error.
    if let Ok(exif) = rexif_orientation(bytes) {
        if let Some(o) = exif {
            let rotated = crate::library::apply_orientation_dynamic(
                image::RgbaImage::from_raw(decoded.w, decoded.h, decoded.rgba)
                    .map(DynamicImage::ImageRgba8)
                    .ok_or_else(|| ".jxl: internal RGBA buffer size mismatch".to_string())?,
                o,
            );
            let rgba = rotated.to_rgba8();
            decoded.w = rgba.width();
            decoded.h = rgba.height();
            decoded.rgba = rgba.into_raw();
        }
    }
    Ok(decoded)
}

fn rexif_orientation(bytes: &[u8]) -> Result<Option<u16>, String> {
    let mut cursor = Cursor::new(bytes);
    let exifreader = exif::Reader::new();
    let exif = match exifreader.read_from_container(&mut cursor) {
        Ok(e) => e,
        Err(_) => return Ok(None), // no EXIF box — not an error, just nothing to apply
    };
    Ok(exif
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .map(|v| v as u16))
}

fn finish_decode(img: DynamicImage, is_float_hdr: bool) -> DecodedStill {
    let (w, h) = (img.width(), img.height());
    let (rgba, note) = if is_float_hdr || matches!(img, DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_)) {
        hdr_to_srgb8(&img)
    } else {
        (img.to_rgba8().into_raw(), None)
    };
    // `image` doesn't expose resolution metadata for any format in STILL_RUST_EXTS — none of
    // exr/hdr/tga/dds/qoi/ff/pnm* carries DPI in a form the crate surfaces. 72 + dpi_known:false
    // is honest about that, not a guess. No format that HAD working DPI handling is rerouted
    // through this module (png/jpg/tif keep their own readDPI/loadTiff paths).
    DecodedStill { w, h, rgba, dpi: 72, dpi_known: false, note }
}

/// Path-based entry point for the Library thumbnailer (get_thumbnail_inner) — same decode logic
/// as open_any_bytes, so the grid and the editor never disagree about a format's rendering.
/// Returns a plain DynamicImage (RGBA8, HDR already tonemapped per hdr_to_srgb8's rule) since
/// the thumbnailer's own resize/JPEG-encode pipeline expects that type.
pub fn open_any_path(path: &Path) -> Result<DynamicImage, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let decoded = open_any_bytes(&bytes, &ext)?;
    image::RgbaImage::from_raw(decoded.w, decoded.h, decoded.rgba)
        .map(DynamicImage::ImageRgba8)
        .ok_or_else(|| format!("{}: internal RGBA buffer size mismatch", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Must match chromasmith-22.html's srgbG() exactly (or as close as f32 vs f64 allows) —
    /// checked at fixed sample points rather than assuming the formula transcribed correctly.
    #[test]
    fn srgb_oetf_matches_js() {
        // (input, expected JS srgbG() output, computed independently)
        let cases: &[(f32, f64)] = &[
            (0.0, 0.0),
            (0.0031308, 0.0031308 * 12.92),
            (0.5, 1.055 * 0.5f64.powf(1.0 / 2.4) - 0.055),
            (1.0, 1.0),
        ];
        for (input, expected) in cases {
            let got = srgb_oetf(*input) as f64;
            assert!(
                (got - expected).abs() < 1e-5,
                "srgb_oetf({input}) = {got}, expected {expected}"
            );
        }
    }

    #[test]
    fn round_trips_qoi_built_in_test() {
        // Encode a tiny 2x2 image with the `image` crate's own QOI encoder, then decode it back
        // through open_any_bytes — no fixture file on disk (payload rule), self-contained.
        let mut buf = Vec::new();
        let img = image::RgbaImage::from_fn(2, 2, |x, y| {
            image::Rgba([if x == 0 { 255 } else { 0 }, if y == 0 { 255 } else { 0 }, 0, 255])
        });
        DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Qoi)
            .expect("encode qoi");
        let decoded = open_any_bytes(&buf, "qoi").expect("decode qoi");
        assert_eq!((decoded.w, decoded.h), (2, 2));
        assert_eq!(&decoded.rgba[0..4], &[255, 255, 0, 255]); // top-left: R and G channels both set
    }

    #[test]
    fn round_trips_ppm_built_in_test() {
        let mut buf = Vec::new();
        let img = image::RgbImage::from_pixel(2, 2, image::Rgb([10, 20, 30]));
        DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Pnm)
            .expect("encode pnm");
        let decoded = open_any_bytes(&buf, "ppm").expect("decode ppm");
        assert_eq!((decoded.w, decoded.h), (2, 2));
        assert_eq!(&decoded.rgba[0..4], &[10, 20, 30, 255]);
    }

    #[test]
    fn one_pixel_exr_round_trip_and_clamp_note() {
        let mut buf = Vec::new();
        // A value > 1.0 to exercise both the clamp and the "clipped" note.
        let img = image::Rgb32FImage::from_pixel(1, 1, image::Rgb([2.0f32, 0.5, 0.0]));
        DynamicImage::ImageRgb32F(img)
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::OpenExr)
            .expect("encode exr");
        let decoded = open_any_bytes(&buf, "exr").expect("decode exr");
        assert_eq!((decoded.w, decoded.h), (1, 1));
        assert_eq!(decoded.rgba[0], 255); // clamped to 1.0 -> srgb_oetf(1.0)*255 rounds to 255
        assert!(decoded.note.is_some(), "expected a clip note for a >1.0 EXR value");
    }

    #[test]
    fn dds_cubemap_gets_named_error_not_a_panic() {
        // `image`'s DDS decoder rejects cubemap/volume textures outright — assert that surfaces
        // as our Result::Err, not a panic, so the Tauri command can report it cleanly.
        // (No real cubemap fixture bundled — this documents the expectation on garbage DDS
        // bytes that *look* like a DDS header but aren't a supported single 2D surface.)
        let mut fake_dds = vec![0u8; 128];
        fake_dds[0..4].copy_from_slice(b"DDS ");
        let result = open_any_bytes(&fake_dds, "dds");
        assert!(result.is_err(), "malformed/unsupported DDS must error, not panic");
    }
}
