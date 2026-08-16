// Fast thumbnail decode via ImageIO (macOS), for the Library grid.
//
// WHY THIS EXISTS — measured, and the numbers invert the obvious assumption
// (`examples/thumb_timing.rs`, cold decode with the disk cache cleared):
//
//     __TM4202.jpg  (6000x4000)   804 ms
//     __TM5132.jpg  (6000x4000)   516 ms
//     P_TM5168.RW2                175 ms
//     __TM3719.RW2                 97 ms
//
// RAW is FAST because rawler pulls the camera's embedded preview. JPEG is slow because the
// `image` crate decodes all 24 megapixels and then throws away 99.7% of them to make a 360px
// thumbnail. So the tiering opportunity in the Library is JPEG, not RAW — the opposite of what
// "RAW is the expensive format" would suggest, and the reason this was measured before being
// built.
//
// `image` 0.25 exposes no scaled-decode API (it drives zune-jpeg, whose DCT scaling is not
// surfaced), so the fix is the platform's own decoder. CGImageSourceCreateThumbnailAtIndex both
// decodes at a reduced DCT scale AND uses an embedded preview when the file has one, which is
// exactly the two-tier behaviour ROADMAP item 15 asked for — without a second code path, a second
// cache, or a "low-res now, better later" flicker in the grid.
//
// ⚠️ Falls back to the `image` crate on ANY failure rather than erroring. This is an optimisation,
// not a feature: a file ImageIO dislikes must still get a thumbnail, and library.rs's existing
// panic guard and disk cache stay in charge either way.
#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSData, NSDictionary, NSNumber, NSString, NSURL};

#[link(name = "CoreGraphics", kind = "framework")]
#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageSourceCreateWithURL(url: *const std::ffi::c_void, opts: *const std::ffi::c_void) -> *mut AnyObject;
    fn CGImageSourceCreateThumbnailAtIndex(src: *mut AnyObject, index: usize, opts: *const std::ffi::c_void) -> *mut AnyObject;
    fn CGImageGetWidth(img: *mut AnyObject) -> usize;
    fn CGImageGetHeight(img: *mut AnyObject) -> usize;
    fn CFRelease(cf: *mut AnyObject);
}

/// Decodes `path` to a JPEG thumbnail whose long edge is at most `long_edge`, using ImageIO.
/// Returns None when ImageIO cannot handle the file, so the caller falls back.
pub fn thumbnail_jpeg(path: &str, long_edge: u32) -> Option<Vec<u8>> {
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let src = CGImageSourceCreateWithURL(&*url as *const _ as *const std::ffi::c_void, std::ptr::null());
        if src.is_null() {
            return None;
        }
        // kCreateThumbnailFromImageAlways rather than ...IfAbsent: a camera's embedded preview is
        // often only 160x120, and silently serving that where a 360px thumbnail was asked for
        // makes half the grid look soft. ImageIO still uses the embedded data as a shortcut when
        // it is big enough — this only forbids it from being used when it is NOT.
        let k_always = NSString::from_str("kCGImageSourceCreateThumbnailFromImageAlways");
        let k_max = NSString::from_str("kCGImageSourceThumbnailMaxPixelSize");
        // WithTransform applies the EXIF orientation for us — library.rs does that by hand for the
        // rawler path (apply_orientation_dynamic); here the platform does it, including the
        // mirrored orientations that path does not handle.
        let k_xf = NSString::from_str("kCGImageSourceCreateThumbnailWithTransform");
        let k_cache = NSString::from_str("kCGImageSourceShouldCacheImmediately");
        let v_true = NSNumber::new_bool(true);
        let v_size = NSNumber::new_u32(long_edge);
        let keys: [&NSString; 4] = [&k_always, &k_max, &k_xf, &k_cache];
        let vals: [&AnyObject; 4] = [&v_true, &v_size, &v_true, &v_true];
        let opts = NSDictionary::from_slices(&keys, &vals);
        let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, &*opts as *const _ as *const std::ffi::c_void);
        CFRelease(src);
        if cg.is_null() {
            return None;
        }
        let (w, h) = (CGImageGetWidth(cg), CGImageGetHeight(cg));
        if w == 0 || h == 0 {
            CFRelease(cg);
            return None;
        }
        // CGImage -> JPEG bytes, via NSBitmapImageRep so the result matches what the existing
        // path returns (a JPEG the frontend turns into a blob URL) rather than raw pixels.
        let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), alloc];
        let rep: *mut AnyObject = msg_send![rep, initWithCGImage: cg];
        CFRelease(cg);
        if rep.is_null() {
            return None;
        }
        let k_q = NSString::from_str("NSImageCompressionFactor");
        let v_q = NSNumber::new_f64(0.82);
        let qk: [&NSString; 1] = [&k_q];
        let qv: [&AnyObject; 1] = [&v_q];
        let props = NSDictionary::from_slices(&qk, &qv);
        // 3 == NSBitmapImageFileTypeJPEG
        let data: *mut NSData = msg_send![rep, representationUsingType: 3usize, properties: &*props];
        let _: () = msg_send![rep, release];
        if data.is_null() {
            return None;
        }
        Some((*data).to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn produces_a_bounded_jpeg_from_a_real_photo() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let jpg = repo.join("geneva/__TM4202.jpg");
        if !jpg.exists() {
            eprintln!("skipping: geneva/__TM4202.jpg not in this checkout");
            return;
        }
        let out = thumbnail_jpeg(jpg.to_str().unwrap(), 360).expect("ImageIO thumbnail");
        assert!(out.len() > 1000, "suspiciously small JPEG: {} bytes", out.len());
        assert_eq!(&out[..2], &[0xFF, 0xD8], "not a JPEG (missing SOI marker)");
        // Decode it back and check the size bound actually held — a thumbnail that quietly comes
        // back full-size would "work" while defeating the entire point.
        let img = image::load_from_memory(&out).expect("re-decode");
        assert!(
            img.width().max(img.height()) <= 400,
            "long edge {} exceeds the requested 360 (+tolerance)",
            img.width().max(img.height())
        );
        assert!(img.width().max(img.height()) >= 300, "unexpectedly small: {}x{}", img.width(), img.height());
    }

    #[test]
    fn declines_a_non_image_instead_of_panicking() {
        let tmp = std::env::temp_dir().join(format!("cs_fastthumb_{}.jpg", std::process::id()));
        std::fs::write(&tmp, b"not an image at all").unwrap();
        assert!(thumbnail_jpeg(tmp.to_str().unwrap(), 360).is_none());
        std::fs::remove_file(&tmp).ok();
    }
}
