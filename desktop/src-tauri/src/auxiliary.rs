//! Extract embedded depth and semantic/portrait mattes from Apple image containers.
//!
//! Core Image returns the requested auxiliary image (rather than the primary photo) when an
//! auxiliary option is enabled. We render it as a normalized grayscale PNG for the existing
//! mask/depth consumers. Apple ImageIO/Core Image are available only on macOS; other platforms
//! return an explicit unsupported-platform error rather than substituting a model prediction.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AuxiliaryMap {
    /// Stable identifier suitable for selecting a map in the frontend.
    pub kind: String,
    pub width: u32,
    pub height: u32,
    /// PNG bytes encoded for the existing JSON IPC boundary.
    pub png_b64: String,
}

#[cfg(not(target_os = "macos"))]
pub fn extract(path: &str) -> Result<Vec<AuxiliaryMap>, String> {
    let _ = path;
    Err("embedded auxiliary extraction currently requires macOS ImageIO/Core Image".into())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::AuxiliaryMap;
    use base64::Engine;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
    use std::io::Cursor;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    #[link(name = "CoreImage", kind = "framework")]
    extern "C" {
        fn CGImageGetWidth(image: *mut AnyObject) -> usize;
        fn CGImageGetHeight(image: *mut AnyObject) -> usize;
        fn CGImageGetBytesPerRow(image: *mut AnyObject) -> usize;
        fn CGImageGetDataProvider(image: *mut AnyObject) -> *mut AnyObject;
        fn CGDataProviderCopyData(provider: *mut AnyObject) -> *mut AnyObject;
        fn CFDataGetBytePtr(data: *mut AnyObject) -> *const u8;
        fn CFRelease(value: *mut AnyObject);
    }

    const CI_FORMAT_RGBAF: i32 = 2312; // Verified against the existing gainmap.rs Core Image path.
    const AUXILIARIES: &[(&str, &str)] = &[
        ("depth", "kCIImageAuxiliaryDepth"),
        ("disparity", "kCIImageAuxiliaryDisparity"),
        ("portrait-effects", "kCIImageAuxiliaryPortraitEffectsMatte"),
        ("skin", "kCIImageAuxiliarySemanticSegmentationSkinMatte"),
        ("sky", "kCIImageAuxiliarySemanticSegmentationSkyMatte"),
        ("hair", "kCIImageAuxiliarySemanticSegmentationHairMatte"),
        (
            "glasses",
            "kCIImageAuxiliarySemanticSegmentationGlassesMatte",
        ),
        ("teeth", "kCIImageAuxiliarySemanticSegmentationTeethMatte"),
    ];

    pub(super) fn extract(path: &str) -> Result<Vec<AuxiliaryMap>, String> {
        autoreleasepool(|_| unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            let yes = NSNumber::new_bool(true);
            let mut result = Vec::new();
            for (kind, option) in AUXILIARIES {
                let key = NSString::from_str(option);
                let opts = NSDictionary::from_slices(&[&*key], &[&*yes as &AnyObject]);
                // Apple's documented CIImageOption behavior: true returns the auxiliary image
                // instead of the primary image, or nil when that auxiliary is absent.
                let ci: *mut AnyObject =
                    msg_send![class!(CIImage), imageWithContentsOfURL: &*url, options: &*opts];
                if ci.is_null() {
                    continue;
                }

                // Preserve the native depth/matte values until a per-image min/max pass maps
                // them to the grayscale mask convention used by the app (0..255).
                let extent: CGRect = msg_send![ci, extent];
                let (w, h) = (
                    extent.size.width.ceil() as usize,
                    extent.size.height.ceil() as usize,
                );
                if w == 0 || h == 0 || w.checked_mul(h).filter(|n| *n <= 15_000_000).is_none() {
                    continue;
                }
                let ctx: *mut AnyObject =
                    msg_send![class!(CIContext), contextWithOptions: std::ptr::null::<AnyObject>()];
                if ctx.is_null() {
                    return Err("Core Image could not create a render context".into());
                }
                let cg: *mut AnyObject = msg_send![ctx, createCGImage: ci, fromRect: extent, format: CI_FORMAT_RGBAF, colorSpace: std::ptr::null::<AnyObject>()];
                if cg.is_null() {
                    continue;
                }
                let (cw, ch, row_bytes) = (
                    CGImageGetWidth(cg),
                    CGImageGetHeight(cg),
                    CGImageGetBytesPerRow(cg),
                );
                let provider = CGImageGetDataProvider(cg);
                let data = if provider.is_null() {
                    std::ptr::null_mut()
                } else {
                    CGDataProviderCopyData(provider)
                };
                if data.is_null() {
                    CFRelease(cg);
                    continue;
                }
                let ptr = CFDataGetBytePtr(data);
                if ptr.is_null() || cw == 0 || ch == 0 || row_bytes < cw.saturating_mul(16) {
                    CFRelease(data);
                    CFRelease(cg);
                    continue;
                }
                let mut values = Vec::with_capacity(cw.saturating_mul(ch));
                let mut lo = f32::INFINITY;
                let mut hi = f32::NEG_INFINITY;
                for y in 0..ch {
                    for x in 0..cw {
                        let offset = y * row_bytes + x * 16;
                        let value = f32::from_ne_bytes([
                            *ptr.add(offset),
                            *ptr.add(offset + 1),
                            *ptr.add(offset + 2),
                            *ptr.add(offset + 3),
                        ]);
                        let value = if value.is_finite() { value } else { 0.0 };
                        lo = lo.min(value);
                        hi = hi.max(value);
                        values.push(value);
                    }
                }
                CFRelease(data);
                CFRelease(cg);
                if !lo.is_finite() || !hi.is_finite() {
                    continue;
                }
                let span = hi - lo;
                let is_distance = matches!(*kind, "depth" | "disparity");
                let pixels: Vec<u8> = values
                    .into_iter()
                    .map(|v| {
                        // Matte channels are already normalized opacity. Keep their absolute
                        // coverage; depth/disparity needs a viewable relative range for the app.
                        let normalized = if is_distance {
                            if span <= f32::EPSILON {
                                0.0
                            } else {
                                (v - lo) / span
                            }
                        } else {
                            v
                        };
                        (normalized.clamp(0.0, 1.0) * 255.0).round() as u8
                    })
                    .collect();
                let Some(image) = image::GrayImage::from_raw(cw as u32, ch as u32, pixels) else {
                    continue;
                };
                let mut png = Cursor::new(Vec::new());
                image
                    .write_to(&mut png, image::ImageFormat::Png)
                    .map_err(|e| format!("encode {kind} auxiliary PNG: {e}"))?;
                result.push(AuxiliaryMap {
                    kind: (*kind).to_owned(),
                    width: cw as u32,
                    height: ch as u32,
                    png_b64: base64::engine::general_purpose::STANDARD.encode(png.into_inner()),
                });
            }
            Ok(result)
        })
    }
}

#[cfg(target_os = "macos")]
pub fn extract(path: &str) -> Result<Vec<AuxiliaryMap>, String> {
    macos::extract(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_platform_is_explicit() {
        let error = extract("sample.heic").unwrap_err();
        assert!(error.contains("requires macOS ImageIO/Core Image"));
    }
}
