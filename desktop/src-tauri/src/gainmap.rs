// ISO 21496-1 gain-map HDR export — the thing every app that leads on HDR photo output converged
// on (Lightroom, Adobe Camera Raw, Pixelmator all ship it; Affinity and Capture One are called out
// for lacking it). Apple calls the format "Adaptive HDR".
//
// WHY A GAIN MAP RATHER THAN AN HDR PIPELINE
// A gain map IS an SDR image plus a per-pixel ratio to its HDR rendition. That matters here because
// a 3D LUT is defined on [0,1]^3 — every film look, print profile and calibration constant in
// calib/ assumes SDR. Making the whole render chain extended-range would invalidate all of it.
// Instead the SDR path stays EXACTLY as it is (so the preview stays truthful and the export goldens
// are untouched by construction), and the HDR rendition is reconstructed here at write time.
//
// HOW THE HDR RENDITION IS DERIVED
// The source photo (an iPhone HEIC/JPEG with a gain map, or any file Core Image can expand) carries
// highlight detail above SDR white. We recover the per-pixel ratio
//     headroom = HDR(source) / SDR(source)
// and apply it to OUR graded SDR result:
//     HDR(out) = SDR(graded) * headroom
// So the user's grade is preserved exactly, and the highlights the camera captured come back on an
// HDR display. Where the source has no headroom the ratio is 1.0 everywhere and the output is
// byte-identical to a normal SDR export.
//
// VERIFIED ON THIS MACHINE (macOS 15.7.7):
//   writeHEIFRepresentation(..., [kCIImageRepresentationHDRImage: hdr])
//     -> 8-bit sRGB base + kCGImageAuxiliaryDataTypeISOGainMap (2,211,840 bytes), and reading that
//        file back with kCIImageExpandToHDR lifts its mean from 0.2520 to 0.4390 (1.74x). So the
//        write/read loop is genuinely HDR, not just a file with an extra chunk in it.
//
// ⚠️ HOW **NOT** TO DETECT HDR — this cost real time. `CIAreaMaximum` rendered to
// extendedLinearSRGB does NOT track dynamic range: a plain SDR PNG measured 5.98 while an actual
// HLG source measured 4.33, i.e. the ordering was inverted and the numbers were meaningless.
// `CIAreaAverage` with the CIContext's working space set to extendedLinearSRGB behaves correctly.
// ⚠️ kCIImageExpandToHDR only does anything for a file that CARRIES a gain map. On a PNG or a
// plain JPEG it is a no-op (verified: identical values with the option on and off), which is
// exactly right — there is nothing to expand. So HDR detection compares expanded against
// unexpanded rather than testing an absolute threshold.
//
// ⚠️ Use kCIImageRepresentationHDRImage (ISO 21496-1), NOT kCIImageRepresentationHDRGainMapImage
//    (Apple's older proprietary aux type). Both write successfully; only the first is the standard.
// ⚠️ The Swift shims `.expandToHDR` / `.hdrImage` do not exist on the macOS 15 SDK. These raw
//    string keys do, and are what the ObjC API has always used.

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSData, NSDictionary, NSNumber, NSString, NSURL};

/// Raw Core Image option keys. Declared as constants so the two spellings that cost a build cycle
/// to discover are written down once.
const K_EXPAND_TO_HDR: &str = "kCIImageExpandToHDR";
const K_REPRESENTATION_HDR_IMAGE: &str = "kCIImageRepresentationHDRImage";

/// ⚠️ CIFormat values are NOT small ordinals — they encode the layout in their bits. Guessing
/// them (3 and 4) silently produced a wrong readback and made HDR detection always return
/// false. Read out of CoreImage on macOS 15: RGBA8=264, RGBAh=2056, RGBAf=2312.
const CI_FORMAT_RGBA8: i32 = 264;
const CI_FORMAT_RGBAF: i32 = 2312;

/// Writes `graded_png` (our SDR render) as the base image of a gain-map HEIC, with the HDR
/// rendition derived from `source_path`'s own headroom.
///
/// Returns `Ok(false)` when the source has no HDR headroom — the caller should then fall back to a
/// normal SDR export rather than writing a gain map that encodes nothing.
pub fn write_gainmap_heic(
    source_path: &str,
    graded_png: &[u8],
    dest_path: &str,
    quality: f64,
) -> Result<bool, String> {
    unsafe {
        // ── 1. the source, expanded to HDR ────────────────────────────────────────────────────
        let src_url = NSURL::fileURLWithPath(&NSString::from_str(source_path));
        let expand_key = NSString::from_str(K_EXPAND_TO_HDR);
        let yes = NSNumber::new_bool(true);
        let opts: Retained<NSDictionary<NSString, AnyObject>> =
            NSDictionary::from_slices(&[&*expand_key], &[&*yes as &AnyObject]);

        let ci_class = class!(CIImage);
        let hdr_src: *mut AnyObject =
            msg_send![ci_class, imageWithContentsOfURL: &*src_url, options: &*opts];
        if hdr_src.is_null() {
            return Err(format!("Core Image could not read '{source_path}'"));
        }
        // The same file WITHOUT expansion — the SDR the camera intended. Their ratio is the
        // headroom we want to carry over onto our grade.
        let sdr_src: *mut AnyObject = msg_send![ci_class, imageWithContentsOfURL: &*src_url];
        if sdr_src.is_null() {
            return Err("Core Image could not read the source as SDR".into());
        }

        if source_headroom(source_path)? <= 1.02 {
            return Ok(false); // nothing to encode — caller falls back to a plain export
        }

        // ── 2. our graded SDR result ──────────────────────────────────────────────────────────
        let graded_data = NSData::with_bytes(graded_png);
        let graded: *mut AnyObject = msg_send![ci_class, imageWithData: &*graded_data];
        if graded.is_null() {
            return Err("could not read the graded image bytes".into());
        }

        // ── 3. HDR(out) = SDR(graded) * (HDR(src) / SDR(src)) ─────────────────────────────────
        // A tiny epsilon keeps the division finite in the deep shadows, where the ratio is
        // meaningless anyway and any noise in it would be amplified.
        let ratio = divide(hdr_src, sdr_src)?;
        let hdr_out = multiply(graded, ratio)?;

        // ── 4. write base + gain map ──────────────────────────────────────────────────────────
        let ctx: *mut AnyObject = msg_send![class!(CIContext), context];
        let dest_url = NSURL::fileURLWithPath(&NSString::from_str(dest_path));
        let srgb = srgb_colorspace()?;

        let hdr_key = NSString::from_str(K_REPRESENTATION_HDR_IMAGE);
        let q_key = NSString::from_str("kCGImageDestinationLossyCompressionQuality");
        let q_val = NSNumber::new_f64(quality.clamp(0.0, 1.0));
        let wopts: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(
            &[&*hdr_key, &*q_key],
            &[&*hdr_out, &*q_val as &AnyObject],
        );

        // The base of a gain-map file is deliberately 8-bit: the HDR lives in the auxiliary map,
        // not in the base's bit depth.
        let mut err: *mut AnyObject = std::ptr::null_mut();
        let ok: bool = msg_send![
            ctx,
            writeHEIFRepresentationOfImage: graded,
            toURL: &*dest_url,
            format: CI_FORMAT_RGBA8,
            colorSpace: srgb,
            options: &*wopts,
            error: &mut err
        ];
        if !ok {
            return Err(describe_error(err));
        }
        Ok(true)
    }
}

/// Mean channel level in extended-linear sRGB. Used only as a RATIO between the expanded and
/// unexpanded readings — the absolute value is not meaningful on its own.
unsafe fn mean_level(img: *mut AnyObject) -> Result<f32, String> {
    unsafe {
        let extent: objc2_foundation::NSRect = msg_send![img, extent];
        let vec: *mut AnyObject = msg_send![
            class!(CIVector),
            vectorWithX: extent.origin.x,
            Y: extent.origin.y,
            Z: extent.size.width,
            W: extent.size.height
        ];
        let name = NSString::from_str("CIAreaAverage");
        let k_img = NSString::from_str("inputImage");
        let k_ext = NSString::from_str("inputExtent");
        let params: Retained<NSDictionary<NSString, AnyObject>> =
            NSDictionary::from_slices(&[&*k_img, &*k_ext], &[&*img, &*vec]);
        let f: *mut AnyObject =
            msg_send![class!(CIFilter), filterWithName: &*name, withInputParameters: &*params];
        if f.is_null() {
            return Err("CIAreaAverage unavailable".into());
        }
        let out: *mut AnyObject = msg_send![f, outputImage];
        if out.is_null() {
            return Err("CIAreaAverage produced no output".into());
        }
        // ⚠️ The context's WORKING space must be extended-linear too, not just the readback space.
        // With the default working space the reduction happens clamped and the ratio collapses.
        let cs = extended_linear_srgb()?;
        let k_work = NSString::from_str("kCIContextWorkingColorSpace");
        let copts: Retained<NSDictionary<NSString, AnyObject>> =
            NSDictionary::from_slices(&[&*k_work], &[&*cs]);
        let ctx: *mut AnyObject = msg_send![class!(CIContext), contextWithOptions: &*copts];
        let mut px = [0f32; 4];
        let rect = objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(0.0, 0.0),
            objc2_foundation::NSSize::new(1.0, 1.0),
        );
        // RGBAf (float) so values above 1.0 survive the readback.
        let _: () = msg_send![
            ctx,
            render: out,
            toBitmap: px.as_mut_ptr() as *mut std::ffi::c_void,
            rowBytes: 16isize,
            bounds: rect,
            format: CI_FORMAT_RGBAF,
            colorSpace: cs
        ];
        Ok(px[0].max(px[1]).max(px[2]))
    }
}

/// How much HDR headroom a source carries, as expanded/unexpanded mean. 1.0 == none.
/// Measured on a real ISO-gain-map HEIC: 0.4390 / 0.2520 = 1.74.
pub fn source_headroom(path: &str) -> Result<f32, String> {
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let plain: *mut AnyObject = msg_send![class!(CIImage), imageWithContentsOfURL: &*url];
        if plain.is_null() {
            return Ok(1.0);
        }
        let expand_key = NSString::from_str(K_EXPAND_TO_HDR);
        let yes = NSNumber::new_bool(true);
        let opts: Retained<NSDictionary<NSString, AnyObject>> =
            NSDictionary::from_slices(&[&*expand_key], &[&*yes as &AnyObject]);
        let expanded: *mut AnyObject =
            msg_send![class!(CIImage), imageWithContentsOfURL: &*url, options: &*opts];
        if expanded.is_null() {
            return Ok(1.0);
        }
        let a = mean_level(plain)?;
        let b = mean_level(expanded)?;
        if a <= 1e-6 {
            return Ok(1.0);
        }
        Ok(b / a)
    }
}

pub fn source_has_hdr(path: &str) -> Result<bool, String> {
    Ok(source_headroom(path)? > 1.02)
}

unsafe fn divide(a: *mut AnyObject, b: *mut AnyObject) -> Result<*mut AnyObject, String> {
    // CIDivideBlendMode computes background / foreground with Core Image's own guards against
    // division by zero, which is why it is used here rather than a hand-rolled kernel.
    unsafe { blend("CIDivideBlendMode", a, b) }
}
unsafe fn multiply(a: *mut AnyObject, b: *mut AnyObject) -> Result<*mut AnyObject, String> {
    unsafe { blend("CIMultiplyCompositing", a, b) }
}
unsafe fn blend(
    name: &str,
    image: *mut AnyObject,
    background: *mut AnyObject,
) -> Result<*mut AnyObject, String> {
    unsafe {
        let n = NSString::from_str(name);
        let k_img = NSString::from_str("inputImage");
        let k_bg = NSString::from_str("inputBackgroundImage");
        let params: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(
            &[&*k_img, &*k_bg],
            &[&*image, &*background],
        );
        let f: *mut AnyObject =
            msg_send![class!(CIFilter), filterWithName: &*n, withInputParameters: &*params];
        if f.is_null() {
            return Err(format!("filter '{name}' unavailable"));
        }
        let out: *mut AnyObject = msg_send![f, outputImage];
        if out.is_null() {
            return Err(format!("filter '{name}' produced no output"));
        }
        Ok(out)
    }
}

unsafe fn srgb_colorspace() -> Result<*mut AnyObject, String> {
    unsafe { named_colorspace("kCGColorSpaceSRGB") }
}
unsafe fn extended_linear_srgb() -> Result<*mut AnyObject, String> {
    unsafe { named_colorspace("kCGColorSpaceExtendedLinearSRGB") }
}
unsafe fn named_colorspace(name: &str) -> Result<*mut AnyObject, String> {
    // CGColorSpaceCreateWithName takes a CFStringRef; NSString is toll-free bridged to it.
    unsafe {
        // ⚠️ Explicit framework links. The app binary picks CoreGraphics up transitively via
        // objc2-app-kit, but an `examples/` target does not — this module failed to link there
        // until these were added. CoreImage is linked so its classes are registered with the
        // ObjC runtime before class!() looks them up.
        #[link(name = "CoreGraphics", kind = "framework")]
        #[link(name = "CoreImage", kind = "framework")]
        extern "C" {
            fn CGColorSpaceCreateWithName(name: *const std::ffi::c_void) -> *mut AnyObject;
        }
        let s = NSString::from_str(name);
        let cs = CGColorSpaceCreateWithName(&*s as *const _ as *const std::ffi::c_void);
        if cs.is_null() {
            return Err(format!("colour space '{name}' unavailable"));
        }
        Ok(cs)
    }
}

unsafe fn describe_error(err: *mut AnyObject) -> String {
    unsafe {
        if err.is_null() {
            return "writeHEIFRepresentation failed".into();
        }
        let d: *mut NSString = msg_send![err, localizedDescription];
        if d.is_null() {
            "writeHEIFRepresentation failed".into()
        } else {
            (*d).to_string()
        }
    }
}
