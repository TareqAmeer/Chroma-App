// Fast thumbnail decode via WIC (Windows Imaging Component), for the Library grid — the Windows
// analogue of fastthumb.rs's ImageIO decode. See that file's header for the measured numbers
// motivating this (JPEG, not RAW, is the expensive format at 24MP; RAW keeps using rawler's own
// fast embedded-preview path and never comes through here).
//
// ⚠️ Known gap, not a silent omission: this does NOT read/apply EXIF orientation (fastthumb.rs's
// `kCGImageSourceCreateThumbnailWithTransform` does this for free on macOS). WIC exposes
// orientation via a metadata-query-language string ("/app1/ifd/{ushort=274}" for JPEG) returning
// a PROPVARIANT that needs per-VARTYPE unpacking — real additional complexity this first pass
// deliberately scoped out rather than guess at without being able to verify against real
// EXIF-rotated photos from multiple camera brands. A photo whose camera wrote a non-Normal
// orientation tag will thumbnail sideways/upside-down until this is added — see
// docs/windows-port.md G11.
//
// Falls back to the `image` crate on ANY failure rather than erroring, same as fastthumb.rs:
// this is an optimization, not a feature — a file WIC dislikes must still get a thumbnail.
#![cfg(windows)]

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::GENERIC_READ;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatJpeg, GUID_WICPixelFormat24bppBGR, IWICImagingFactory, WICBitmapDitherTypeNone,
    WICBitmapEncoderNoCache, WICBitmapInterpolationModeFant, WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
};

/// Decodes `path` to a JPEG thumbnail whose long edge is at most `long_edge`, using WIC.
/// Returns None when WIC cannot handle the file, so the caller falls back — same contract as
/// fastthumb.rs's `thumbnail_jpeg` on macOS.
pub fn thumbnail_jpeg(path: &str, long_edge: u32) -> Option<Vec<u8>> {
    // WIC is a COM API; the calling thread needs COM initialized. Tauri's async runtime doesn't
    // guarantee this (unlike a UI-thread-only caller), and CoInitializeEx is safe to call again
    // on a thread that's already initialized (returns S_FALSE, not an error) — matching the
    // defensive pattern platform/windows.rs's move_to_trash_sta already uses for the same reason.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = thumbnail_jpeg_inner(path, long_edge);
        CoUninitialize();
        result
    }
}

unsafe fn thumbnail_jpeg_inner(path: &str, long_edge: u32) -> Option<Vec<u8>> {
    let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
    let wide = HSTRING::from(path);
    let decoder = factory
        .CreateDecoderFromFilename(PCWSTR(wide.as_ptr()), None, GENERIC_READ, WICDecodeMetadataCacheOnDemand)
        .ok()?;
    let frame = decoder.GetFrame(0).ok()?;

    let (mut w, mut h) = (0u32, 0u32);
    frame.GetSize(&mut w, &mut h).ok()?;
    if w == 0 || h == 0 {
        return None;
    }
    let scale = long_edge as f32 / w.max(h) as f32;
    let (target_w, target_h) = if scale < 1.0 {
        ((w as f32 * scale).round().max(1.0) as u32, (h as f32 * scale).round().max(1.0) as u32)
    } else {
        (w, h)
    };

    // Scale first, then convert pixel format — WriteSource below needs a fixed, known format
    // (24bppBGR) regardless of what the source file natively decodes to (CMYK JPEGs, indexed
    // PNGs, etc.), and scaling the already-converted image would do strictly more work for the
    // large majority of photos (already RGB-ish) with no benefit.
    let scaler = factory.CreateBitmapScaler().ok()?;
    scaler.Initialize(&frame, target_w, target_h, WICBitmapInterpolationModeFant).ok()?;
    let converter = factory.CreateFormatConverter().ok()?;
    converter
        .Initialize(&scaler, &GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom)
        .ok()?;

    // A growable in-memory IStream (the classic CreateStreamOnHGlobal/GetHGlobalFromStream OLE
    // pattern, not WIC-specific) rather than writing to a temp file — this never touches disk.
    let stream = CreateStreamOnHGlobal(None, true).ok()?;
    let encoder = factory.CreateEncoder(&GUID_ContainerFormatJpeg, std::ptr::null()).ok()?;
    encoder.Initialize(&stream, WICBitmapEncoderNoCache).ok()?;

    let mut frame_encode = None;
    let mut encoder_options = None;
    // Passing `None` for encoder options (no property bag) accepts JPEG's default quality —
    // MSDN's own encoding-overview doc explicitly documents this as valid ("It is also possible
    // to eliminate the property bag when no encoder options are being considered"), which avoids
    // needing to construct a PROPBAG2/VARIANT by hand just to set a custom quality level. A named
    // quality level (fastthumb.rs uses 0.82) can be added later via the "ImageQuality" (VT_R4)
    // property if the default turns out to be visibly different.
    encoder.CreateNewFrame(&mut frame_encode, &mut encoder_options).ok()?;
    let frame_encode = frame_encode?;
    frame_encode.Initialize(None).ok()?;
    frame_encode.SetSize(target_w, target_h).ok()?;
    let mut format = GUID_WICPixelFormat24bppBGR;
    frame_encode.SetPixelFormat(&mut format).ok()?;
    frame_encode.WriteSource(&converter, std::ptr::null()).ok()?;
    frame_encode.Commit().ok()?;
    encoder.Commit().ok()?;

    read_stream_to_vec(&stream)
}

fn read_stream_to_vec(stream: &windows::Win32::System::Com::IStream) -> Option<Vec<u8>> {
    use windows::Win32::System::Com::{STREAM_SEEK_SET, STATFLAG_NONAME};
    unsafe {
        let mut stat = std::mem::zeroed();
        stream.Stat(&mut stat, STATFLAG_NONAME).ok()?;
        let len = stat.cbSize as usize;
        if len == 0 {
            return None;
        }
        stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
        let mut buf = vec![0u8; len];
        let mut read: u32 = 0;
        // Read returns a bare HRESULT (not a windows_core::Result), and HRESULT's own `.ok()`
        // converts it to windows_core::Result<()> — NOT Option<()> the way std's Result::ok()
        // would (a real windows-rs naming trap: same method name, different target type
        // depending on what you start with) — so a second `.ok()` is needed to get to the
        // Option this function's own `?` needs.
        stream
            .Read(buf.as_mut_ptr() as *mut std::ffi::c_void, len as u32, Some(&mut read))
            .ok()
            .ok()?;
        buf.truncate(read as usize);
        Some(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a real, valid JPEG via the `image` crate (no external fixture dependency — this
    /// project's real photo fixtures are gitignored, see fastthumb.rs's own test for the pattern
    /// this mirrors) and confirms WIC actually decodes+scales+re-encodes it, not just that the
    /// calls didn't error. Same shape as fastthumb.rs's own
    /// `produces_a_bounded_jpeg_from_a_real_photo` test.
    #[test]
    fn produces_a_bounded_jpeg_from_a_generated_photo() {
        let tmp = std::env::temp_dir().join(format!("cs_winthumb_{}.jpg", std::process::id()));
        let img = image::RgbImage::from_fn(1200, 800, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
        });
        image::DynamicImage::ImageRgb8(img).save(&tmp).expect("write test jpeg");

        let out = thumbnail_jpeg(tmp.to_str().unwrap(), 360).expect("WIC thumbnail");
        std::fs::remove_file(&tmp).ok();

        assert!(out.len() > 500, "suspiciously small JPEG: {} bytes", out.len());
        assert_eq!(&out[..2], &[0xFF, 0xD8], "not a JPEG (missing SOI marker)");
        let decoded = image::load_from_memory(&out).expect("re-decode");
        assert!(
            decoded.width().max(decoded.height()) <= 400,
            "long edge {} exceeds the requested 360 (+tolerance)",
            decoded.width().max(decoded.height())
        );
        assert!(
            decoded.width().max(decoded.height()) >= 300,
            "unexpectedly small: {}x{}",
            decoded.width(),
            decoded.height()
        );
        // 1200x800 -> long edge 360 preserving aspect ratio should give 360x240.
        assert_eq!((decoded.width(), decoded.height()), (360, 240));
    }

    #[test]
    fn declines_a_non_image_instead_of_panicking() {
        let tmp = std::env::temp_dir().join(format!("cs_winthumb_bad_{}.jpg", std::process::id()));
        std::fs::write(&tmp, b"not an image at all").unwrap();
        let result = thumbnail_jpeg(tmp.to_str().unwrap(), 360);
        std::fs::remove_file(&tmp).ok();
        assert!(result.is_none());
    }
}
