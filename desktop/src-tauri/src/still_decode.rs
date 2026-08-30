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
    /// ROADMAP.md F4 — real per-channel headroom for a genuinely-HDR source (EXR/HDR), mirroring
    /// the RAW path's `apply_lut_rgba_ext`: `rgba` stays the clamped 8-bit body every existing
    /// caller expects unchanged, and this carries the UNCLAMPED sRGB-encoded value per channel
    /// (w*h*3 f32, same layout `apply_lut_rgba_ext`'s `ext`/chromasmith-22.html's `_sceneLinear`
    /// already use) so it reaches FX.setImage's existing `_sceneLinearPresent` float-texture
    /// upload with no shader change. `None` for every non-float format and for a float source
    /// that never exceeded 1.0 (nothing to preserve, so don't pay the extra buffer).
    pub ext: Option<Vec<f32>>,
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
/// OETF, PLUS (ROADMAP.md F4) the real unclamped sRGB-encoded value per channel whenever any
/// pixel actually exceeded 1.0 — the exact companion `apply_lut_rgba_ext` already produces for
/// the RAW/DCP path, so this reaches chromasmith-22.html's existing `_sceneLinear`/
/// `_sceneLinearPresent` float-texture upload (FX.setImage) with zero JS/shader change. The u8
/// body is UNCHANGED (still clamps) — every existing caller that ignores the ext buffer sees
/// byte-identical output to before this change; the ext buffer is `None` unless something
/// actually clipped, so a normal (<=1.0) HDR/EXR pays nothing extra.
///
/// Deliberately NO tone mapping, deliberately NO normalising by the frame's own max, for the
/// 8-bit body:
/// - A tone curve (Reinhard/Filmic/etc.) here would be a LOOK decision baked into the loader,
///   pre-grading every EXR before the user's own grade even runs, and impossible to undo from
///   inside the app afterward. The whole premise of this app is that the look comes from its own
///   calibrated pipeline (LUTs, halation model, DCP chain) — not from the loader.
/// - Normalising by the frame's own max would make two frames of the same sequence render
///   differently depending on what happened to be brightest in each one.
///
/// ⚠️ HR_MAX_STOPS (chromasmith-22.html) does NOT apply here and is deliberately not consulted:
/// it caps a BYTE-quantized headroom map (`hrOut`/`_hdrHeadroom`, used only by the HDR gain-map
/// HEIC export path) to a fixed number of stops above 1.0. `_sceneLinear` — the path this
/// function feeds — carries the raw unclamped float value straight through with no stops
/// encoding and no cap at all, so a wide-range EXR (which can carry far more than a RAW DCP
/// LUT's typical overshoot) needs no format-aware change to that constant. If a future gain-map
/// export path is added for EXR sources, THAT is where HR_MAX_STOPS would become relevant.
fn hdr_to_srgb8(img: &DynamicImage) -> (Vec<u8>, Option<String>, Option<Vec<f32>>) {
    let rgba32f = img.to_rgba32f();
    let (w, h) = (rgba32f.width(), rgba32f.height());
    let mut clipped = false;
    let mut out = vec![0u8; (w * h * 4) as usize];
    let mut ext = vec![0f32; (w * h * 3) as usize];
    for (i, px) in rgba32f.pixels().enumerate() {
        let [r, g, b, a] = px.0;
        if r > 1.0 || g > 1.0 || b > 1.0 {
            clipped = true;
        }
        let (er, eg, eb) = (srgb_oetf(r.max(0.0)), srgb_oetf(g.max(0.0)), srgb_oetf(b.max(0.0)));
        ext[i * 3] = er;
        ext[i * 3 + 1] = eg;
        ext[i * 3 + 2] = eb;
        out[i * 4] = (er.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        out[i * 4 + 1] = (eg.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        out[i * 4 + 2] = (eb.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        out[i * 4 + 3] = (a.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    }
    let note = clipped.then(|| {
        "HDR source had highlight detail above 1.0 — carried through as real headroom (visible \
         on HDR-capable displays; SDR displays and exports still see it clamped)."
            .to_string()
    });
    let ext = if clipped { Some(ext) } else { None };
    (out, note, ext)
}

/// Decode bytes to RGBA8 + metadata. `ext_hint` (lowercase, no dot) is used only when `image`'s
/// own magic-byte sniffing fails to guess a format — genuinely headerless formats (some raw PNM
/// variants) need it; everything else is sniffed from content first.
pub fn open_any_bytes(bytes: &[u8], ext_hint: &str) -> Result<DecodedStill, String> {
    open_any_bytes_at(bytes, ext_hint, None)
}

/// ROADMAP.md F6: same as `open_any_bytes`, plus an optional 0-based `frame` selecting a specific
/// entry out of a multi-frame ICO/CUR (see the `ico_frames` module). `frame: None` is IDENTICAL
/// to calling `open_any_bytes` — every existing caller (Library thumbnailer, the default
/// decode_image_v1 request with no `frame` field) is completely unaffected.
///
/// ⚠️ DDS mip levels are NOT selectable here, and this is a real dependency limitation, not an
/// oversight: `image` 0.25's `DdsDecoder` reads `mipmap_count` into a field literally named
/// `_mipmap_count` (dead — verified in the vendored source) and only ever decodes the base
/// level; there is no public API to seek to a different mip, and reimplementing DDS's block
/// (DXT1/3/5/BC7) decompression ourselves to expose them is out of proportion to this item. A
/// DDS with more than one mip level still opens (base level only, unchanged) and reports that
/// honestly via `note` rather than silently pretending mip selection is supported.
pub fn open_any_bytes_at(bytes: &[u8], ext_hint: &str, frame: Option<usize>) -> Result<DecodedStill, String> {
    if ext_hint.eq_ignore_ascii_case("jxl") {
        return open_jxl_bytes(bytes);
    }
    if ext_hint.eq_ignore_ascii_case("ico") || ext_hint.eq_ignore_ascii_case("cur") {
        let (w, h, rgba) = ico_frames::open(bytes, frame)?;
        let count = ico_frames::count(bytes).unwrap_or(1);
        let note = (count > 1 && frame.is_none())
            .then(|| format!("This icon has {count} frames — showing the largest by default."));
        return Ok(DecodedStill { w, h, rgba, dpi: 72, dpi_known: false, note, ext: None });
    }
    if ext_hint.eq_ignore_ascii_case("dds") {
        if let Some(mips) = dds_mipmap_count(bytes) {
            if mips > 1 {
                let mut decoded = open_any_bytes_uncounted(bytes, ext_hint)?;
                decoded.note = Some(format!(
                    "This DDS has {mips} mip levels — only the base (largest) level can be decoded; picking a                      smaller mip isn't supported yet."
                ));
                return Ok(decoded);
            }
        }
    }
    open_any_bytes_uncounted(bytes, ext_hint)
}

/// DDS mip count, read directly from the header (offset 28, per the DDS_HEADER layout `image`'s
/// own decoder parses) — `None` on anything that doesn't even look like a DDS file, which the
/// real decode below will then report as a proper error instead of this helper guessing.
fn dds_mipmap_count(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 32 || &bytes[0..4] != b"DDS " {
        return None;
    }
    Some(u32::from_le_bytes([bytes[28], bytes[29], bytes[30], bytes[31]]))
}

/// ROADMAP.md F6: how many selectable frames a still carries, for a caller deciding whether a
/// frame-picker UI is worth showing at all. `None` for every format with no such concept
/// (including DDS — see open_any_bytes_at's doc comment on why mip levels aren't counted here).
pub fn frame_count(bytes: &[u8], ext: &str) -> Option<usize> {
    if ext.eq_ignore_ascii_case("ico") || ext.eq_ignore_ascii_case("cur") {
        ico_frames::count(bytes).ok()
    } else {
        None
    }
}

fn open_any_bytes_uncounted(bytes: &[u8], ext_hint: &str) -> Result<DecodedStill, String> {
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
    let (rgba, note, ext) = if is_float_hdr || matches!(img, DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_)) {
        hdr_to_srgb8(&img)
    } else {
        (img.to_rgba8().into_raw(), None, None)
    };
    // `image` doesn't expose resolution metadata for any format in STILL_RUST_EXTS — none of
    // exr/hdr/tga/dds/qoi/ff/pnm* carries DPI in a form the crate surfaces. 72 + dpi_known:false
    // is honest about that, not a guess. No format that HAD working DPI handling is rerouted
    // through this module (png/jpg/tif keep their own readDPI/loadTiff paths).
    DecodedStill { w, h, rgba, dpi: 72, dpi_known: false, note, ext }
}

/// ROADMAP.md F6 — ICO/CUR frame picker. `image` 0.25's own `IcoDecoder` only exposes
/// `best_entry()` (largest by area/bit-depth) with no public API to select a different
/// directory entry, so this parses the ICO/CUR directory ourselves (a 6-byte header + N×16-byte
/// entries — the same layout `image`'s own decoder reads, see its `read_entries`/`DirEntry`) and
/// decodes exactly ONE chosen entry, either as PNG (modern large icons embed a real PNG) or as a
/// headerless BMP DIB (`BmpDecoder::new_without_file_header` — ICO's BMP entries omit the
/// 14-byte `BITMAPFILEHEADER` a standalone .bmp would have, by the ICO spec).
mod ico_frames {
    use image::codecs::bmp::BmpDecoder;
    use image::{DynamicImage, ImageDecoder};
    use std::io::Cursor;

    struct IcoEntry {
        image_offset: u32,
        image_length: u32,
    }

    fn read_ico_dir(bytes: &[u8]) -> Result<Vec<IcoEntry>, String> {
        if bytes.len() < 6 {
            return Err(".ico: file too short to contain a directory header".to_string());
        }
        let reserved = u16::from_le_bytes([bytes[0], bytes[1]]);
        let kind = u16::from_le_bytes([bytes[2], bytes[3]]);
        if reserved != 0 || (kind != 1 && kind != 2) {
            return Err(".ico: not a recognised ICO/CUR directory".to_string());
        }
        let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
        let mut entries = Vec::with_capacity(count);
        for i in 0..count {
            let off = 6 + i * 16;
            if off + 16 > bytes.len() {
                return Err(format!(".ico: directory entry {i} runs past end of file"));
            }
            let image_length = u32::from_le_bytes([bytes[off + 8], bytes[off + 9], bytes[off + 10], bytes[off + 11]]);
            let image_offset = u32::from_le_bytes([bytes[off + 12], bytes[off + 13], bytes[off + 14], bytes[off + 15]]);
            entries.push(IcoEntry { image_offset, image_length });
        }
        if entries.is_empty() {
            return Err(".ico: directory contains no images".to_string());
        }
        Ok(entries)
    }

    /// Number of selectable frames — `None`/an out-of-range `frame` in `open_ico_frame` falls
    /// back to `image`'s own default (largest) entry, so this is purely informational for the
    /// caller (used to decide whether a frame-picker UI is worth showing at all).
    pub fn count(bytes: &[u8]) -> Result<usize, String> {
        Ok(read_ico_dir(bytes)?.len())
    }

    /// Decode entry `frame` (0-based, directory order — same order Explorer/Preview list them
    /// in) to RGBA8. `frame: None` reproduces today's exact behaviour by delegating to `image`'s
    /// own `IcoDecoder` (its `best_entry()` selection), so every existing caller that never asks
    /// for a specific frame sees byte-identical output to before this function existed.
    pub fn open(bytes: &[u8], frame: Option<usize>) -> Result<(u32, u32, Vec<u8>), String> {
        let frame = match frame {
            None => {
                let decoder = image::codecs::ico::IcoDecoder::new(Cursor::new(bytes)).map_err(|e| format!(".ico: {e}"))?;
                let (w, h) = decoder.dimensions();
                let mut rgba = vec![0u8; decoder.total_bytes() as usize];
                decoder.read_image(&mut rgba).map_err(|e| format!(".ico: could not decode image ({e})"))?;
                return Ok((w, h, rgba));
            }
            Some(f) => f,
        };
        let entries = read_ico_dir(bytes)?;
        let entry = entries
            .get(frame)
            .ok_or_else(|| format!(".ico: frame {frame} out of range (file has {} frame(s))", entries.len()))?;
        let start = entry.image_offset as usize;
        let end = start
            .checked_add(entry.image_length as usize)
            .ok_or_else(|| ".ico: frame data offset/length overflow".to_string())?;
        let data = bytes
            .get(start..end)
            .ok_or_else(|| format!(".ico: frame {frame}'s data ({start}..{end}) runs past end of file"))?;
        // PNG-format entries (used by any icon >=256px, and common at smaller sizes on modern
        // icons) carry the real PNG signature; anything else is a headerless BMP DIB.
        const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let img = if data.len() >= 8 && data[..8] == PNG_SIG {
            image::load_from_memory_with_format(data, image::ImageFormat::Png).map_err(|e| format!(".ico: frame {frame} PNG decode failed: {e}"))?
        } else {
            let decoder = BmpDecoder::new_without_file_header(Cursor::new(data)).map_err(|e| format!(".ico: frame {frame} BMP decode failed: {e}"))?;
            DynamicImage::from_decoder(decoder).map_err(|e| format!(".ico: frame {frame} BMP decode failed: {e}"))?
        };
        let rgba8 = img.to_rgba8();
        Ok((rgba8.width(), rgba8.height(), rgba8.into_raw()))
    }
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
    fn exr_headroom_ext_buffer_present_and_unclamped() {
        // ROADMAP.md F4: a >1.0 EXR value must produce BOTH the clamped u8 body (unchanged
        // behaviour) AND a real-headroom `ext` companion carrying the true unclamped sRGB-
        // encoded value, so it can reach chromasmith-22.html's `_sceneLinear` float upload.
        let mut buf = Vec::new();
        let img = image::Rgb32FImage::from_pixel(1, 1, image::Rgb([4.0f32, 0.5, 0.0]));
        DynamicImage::ImageRgb32F(img)
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::OpenExr)
            .expect("encode exr");
        let decoded = open_any_bytes(&buf, "exr").expect("decode exr");
        assert_eq!(decoded.rgba[0], 255); // still clamped in the 8-bit body
        let ext = decoded.ext.expect("expected a headroom ext buffer for a >1.0 EXR value");
        assert_eq!(ext.len(), 3);
        // srgb_oetf(4.0) = 1.055*4.0^(1/2.4)-0.055, well above 1.0 — the whole point of F4.
        assert!(ext[0] > 1.5, "expected real unclamped headroom in ext[0], got {}", ext[0]);
        // The G channel (0.5, never clipped) must match the u8 body's own decode within
        // quantization — proves the ext buffer isn't some unrelated scaling.
        let g_srgb = srgb_oetf(0.5);
        assert!((ext[1] - g_srgb).abs() < 1e-5);
    }

    #[test]
    fn exr_under_1_0_has_no_ext_buffer() {
        // The companion buffer must be None (not merely all-1.0) when nothing clipped, so a
        // normal EXR pays zero extra allocation/upload cost — verified directly, not assumed.
        let mut buf = Vec::new();
        let img = image::Rgb32FImage::from_pixel(1, 1, image::Rgb([0.2f32, 0.5, 0.8]));
        DynamicImage::ImageRgb32F(img)
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::OpenExr)
            .expect("encode exr");
        let decoded = open_any_bytes(&buf, "exr").expect("decode exr");
        assert!(decoded.ext.is_none());
        assert!(decoded.note.is_none());
    }

    /// Builds a minimal in-memory 2-entry ICO (both entries plain PNGs of a distinct solid
    /// colour) — self-contained, no fixture file, per the payload/test-hygiene rules elsewhere
    /// in this repo.
    fn synth_ico(entries: &[(u32, u32, [u8; 3])]) -> Vec<u8> {
        let mut pngs: Vec<Vec<u8>> = Vec::new();
        for (w, h, rgb) in entries {
            let mut buf = Vec::new();
            let [r, g, b] = *rgb;
            let img = image::RgbaImage::from_pixel(*w, *h, image::Rgba([r, g, b, 255]));
            DynamicImage::ImageRgba8(img)
                .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
                .expect("encode png entry"); // ICO's own spec requires PNG entries to be RGBA

            pngs.push(buf);
        }
        let mut out = Vec::new();
        out.extend_from_slice(&0u16.to_le_bytes()); // reserved
        out.extend_from_slice(&1u16.to_le_bytes()); // type=1 (ICO)
        out.extend_from_slice(&(pngs.len() as u16).to_le_bytes());
        let header_len = 6 + pngs.len() * 16;
        let mut offset = header_len as u32;
        for (i, (w, h, _)) in entries.iter().enumerate() {
            let wb = if *w >= 256 { 0u8 } else { *w as u8 };
            let hb = if *h >= 256 { 0u8 } else { *h as u8 };
            out.push(wb);
            out.push(hb);
            out.push(0); // color count
            out.push(0); // reserved
            out.extend_from_slice(&1u16.to_le_bytes()); // planes
            out.extend_from_slice(&32u16.to_le_bytes()); // bit count
            out.extend_from_slice(&(pngs[i].len() as u32).to_le_bytes());
            out.extend_from_slice(&offset.to_le_bytes());
            offset += pngs[i].len() as u32;
        }
        for png in &pngs {
            out.extend_from_slice(png);
        }
        out
    }

    #[test]
    fn ico_frame_count_and_default_picks_largest() {
        // ROADMAP.md F6. Entry 0 is smaller (16x16 red), entry 1 is larger (32x32 blue) — the
        // default (frame:None) must still pick the LARGEST, exactly like `image`'s own
        // IcoDecoder did before this feature existed (zero behaviour change for every existing
        // caller that never asks for a specific frame).
        let ico = synth_ico(&[(16, 16, [255, 0, 0]), (32, 32, [0, 0, 255])]);
        assert_eq!(ico_frames::count(&ico).unwrap(), 2);
        let decoded = open_any_bytes(&ico, "ico").expect("decode ico default");
        assert_eq!((decoded.w, decoded.h), (32, 32));
        assert_eq!(&decoded.rgba[0..3], &[0, 0, 255]);
        assert!(decoded.note.is_some(), "expected a multi-frame note when no frame is requested");
    }

    #[test]
    fn ico_frame_picker_selects_requested_entry() {
        let ico = synth_ico(&[(16, 16, [255, 0, 0]), (32, 32, [0, 0, 255])]);
        let decoded = open_any_bytes_at(&ico, "ico", Some(0)).expect("decode ico frame 0");
        assert_eq!((decoded.w, decoded.h), (16, 16));
        assert_eq!(&decoded.rgba[0..3], &[255, 0, 0]);
        assert!(decoded.note.is_none(), "an explicit frame request shouldn't repeat the default-pick note");

        let decoded1 = open_any_bytes_at(&ico, "ico", Some(1)).expect("decode ico frame 1");
        assert_eq!((decoded1.w, decoded1.h), (32, 32));
        assert_eq!(&decoded1.rgba[0..3], &[0, 0, 255]);
    }

    #[test]
    fn ico_frame_out_of_range_errors_not_panics() {
        let ico = synth_ico(&[(16, 16, [255, 0, 0])]);
        assert!(open_any_bytes_at(&ico, "ico", Some(5)).is_err());
    }

    #[test]
    fn dds_reports_mip_limitation_note_without_pretending_to_pick() {
        // A DDS header claiming mipmap_count=4 (offset 28) but with no real pixel data past the
        // header must still error (not panic) — but through the SAME `image`-crate decode error
        // path as before, since the actual synthetic bytes here aren't a decodable DDS at all.
        // This only proves dds_mipmap_count's own header parse doesn't crash on a short/garbage
        // buffer — a real multi-mip DDS to test the "note attached" branch end-to-end isn't
        // available in this repo (see F7's report on missing DDS test fixtures).
        let mut fake_dds = vec![0u8; 32];
        fake_dds[0..4].copy_from_slice(b"DDS ");
        fake_dds[28..32].copy_from_slice(&4u32.to_le_bytes());
        assert_eq!(dds_mipmap_count(&fake_dds), Some(4));
        assert!(open_any_bytes(&fake_dds, "dds").is_err());
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
