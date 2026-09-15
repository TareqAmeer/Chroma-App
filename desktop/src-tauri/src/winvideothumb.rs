// Video poster frames on Windows, via IShellItemImageFactory — the Windows analogue of
// videothumb.rs's AVFoundation path. This is the same mechanism Explorer uses to show a video's
// thumbnail in the file browser: it asks the shell for a thumbnail-handler image rather than
// decoding the container ourselves, so it uses whatever codecs are actually installed (system
// HEVC/AV1 extensions included) with zero extra dependencies — matching docs/windows-port.md
// G11's plan, which named this the simpler starting point over Media Foundation's
// `IMFSourceReader` (reserved for if exact-frame seeking ever turns out to matter; this API
// picks whatever frame the installed thumbnail provider picks, same as Explorer).
#![cfg(windows)]

use std::ffi::c_void;
use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_RESIZETOFIT, SIIGBF_THUMBNAILONLY};

/// Decodes one poster frame of `path` to a JPEG whose long edge is at most `long_edge`.
///
/// `duration_secs` is accepted for parity with videothumb.rs's signature (library.rs passes the
/// same value to both) but unused here — `IShellItemImageFactory` has no seek parameter; it
/// returns whatever frame the registered thumbnail provider picks, the same frame Explorer would
/// show for that file.
///
/// Returns None on ANY failure — no shell thumbnail handler for the extension, a corrupt file, a
/// codec that isn't installed — so the caller falls back exactly as the macOS path does.
pub fn poster_jpeg(path: &str, long_edge: u32, _duration_secs: f64) -> Option<Vec<u8>> {
    // Same reasoning as winthumb.rs's thumbnail_jpeg: this can run on a Tauri command thread with
    // no ambient COM initialization, and re-initializing an already-STA thread is a documented
    // harmless no-op (S_FALSE), not an error.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = poster_jpeg_inner(path, long_edge);
        CoUninitialize();
        result
    }
}

unsafe fn poster_jpeg_inner(path: &str, long_edge: u32) -> Option<Vec<u8>> {
    let wide = windows::core::HSTRING::from(path);
    let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
    // RESIZETOFIT: the returned bitmap fits within the box preserving aspect ratio, so no further
    // scaling step is needed here — mirroring winthumb.rs's WIC scaler doing the same job for
    // stills. THUMBNAILONLY is load-bearing, not decorative: without it GetImage silently falls
    // back to the generic file-type ICON for a video its thumbnail handler can't decode (a
    // corrupt file, or no codec installed) instead of failing — which would cache a wrong, generic
    // icon as the poster forever rather than letting the caller's normal "no poster" fallback run.
    let size = SIZE { cx: long_edge as i32, cy: long_edge as i32 };
    let hbitmap = factory.GetImage(size, SIIGBF_RESIZETOFIT | SIIGBF_THUMBNAILONLY).ok()?;
    let jpeg = hbitmap_to_jpeg(hbitmap);
    let _ = DeleteObject(hbitmap);
    jpeg
}

/// HBITMAP -> JPEG bytes via GetDIBits (top-down 32bpp BGRA) then the `image` crate's encoder.
/// The two-call GetDIBits pattern (first with a null buffer to have GDI fill in width/height/bpp,
/// then again with an allocated buffer) avoids needing a separate GetObject(BITMAP) call to learn
/// the bitmap's dimensions — this is the standard documented way to read an HBITMAP's pixels.
unsafe fn hbitmap_to_jpeg(hbitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<Vec<u8>> {
    let hdc = CreateCompatibleDC(None);
    if hdc.is_invalid() {
        return None;
    }
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, ..Default::default() },
        ..Default::default()
    };
    if GetDIBits(hdc, hbitmap, 0, 0, None, &mut bmi, DIB_RGB_COLORS) == 0 {
        let _ = DeleteDC(hdc);
        return None;
    }
    let width = bmi.bmiHeader.biWidth;
    let height = bmi.bmiHeader.biHeight.abs();
    if width <= 0 || height <= 0 {
        let _ = DeleteDC(hdc);
        return None;
    }
    // Force the format the second call fills in: 32bpp, uncompressed, and top-down (negative
    // height) so the buffer reads row 0 first without a manual vertical flip afterward.
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0 as u32;
    bmi.bmiHeader.biHeight = -height;

    let mut buf = vec![0u8; (width as usize) * (height as usize) * 4];
    let lines = GetDIBits(hdc, hbitmap, 0, height as u32, Some(buf.as_mut_ptr() as *mut c_void), &mut bmi, DIB_RGB_COLORS);
    let _ = DeleteDC(hdc);
    if lines == 0 {
        return None;
    }

    // BGRA -> RGB (drop alpha; a shell thumbnail is opaque).
    let mut rgb = Vec::with_capacity((width as usize) * (height as usize) * 3);
    for px in buf.chunks_exact(4) {
        rgb.push(px[2]);
        rgb.push(px[1]);
        rgb.push(px[0]);
    }
    let img = image::RgbImage::from_raw(width as u32, height as u32, rgb)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img).write_to(&mut out, image::ImageFormat::Jpeg).ok()?;
    Some(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declines_a_non_video_instead_of_panicking() {
        let tmp = std::env::temp_dir().join(format!("cs_winvideothumb_{}.mp4", std::process::id()));
        std::fs::write(&tmp, b"not a video at all").unwrap();
        let result = poster_jpeg(tmp.to_str().unwrap(), 360, 0.0);
        std::fs::remove_file(&tmp).ok();
        assert!(result.is_none());
    }

    #[test]
    fn declines_a_missing_file_instead_of_panicking() {
        assert!(poster_jpeg("C:\\nonexistent\\nope.mp4", 360, 1.0).is_none());
    }

    /// test/fixtures/video_tiny.mp4 is committed for the macOS AVFoundation test; if a Windows
    /// dev machine has a real video thumbnail handler registered (e.g. after installing the HEVC/
    /// media feature pack), this exercises the success path too. No committed fixture is
    /// guaranteed to have a registered handler in a bare CI/test process (unlike AVFoundation,
    /// which the macOS test can rely on directly), so this skips cleanly otherwise — the same way
    /// videothumb.rs's own real-clip test degrades when its precondition isn't met.
    #[test]
    fn produces_a_bounded_jpeg_from_the_committed_fixture_if_a_handler_is_registered() {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/video_tiny.mp4");
        if !p.exists() {
            return;
        }
        match poster_jpeg(&p.to_string_lossy(), 360, 1.0) {
            Some(out) => {
                assert!(out.len() > 200, "suspiciously small JPEG: {} bytes", out.len());
                assert_eq!(&out[..2], &[0xFF, 0xD8], "not a JPEG (missing SOI marker)");
                let img = image::load_from_memory(&out).expect("re-decode");
                assert!(img.width().max(img.height()) <= 400, "long edge exceeds the requested 360 (+tolerance)");
            }
            None => eprintln!("skipping: no shell video thumbnail handler registered in this test process"),
        }
    }
}
