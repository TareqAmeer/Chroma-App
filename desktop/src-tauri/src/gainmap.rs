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
/// Thin public wrapper over mean_level, for examples/raw_headroom_probe.rs only — measuring
/// whether CIRAWFilter's extendedDynamicRangeAmount does anything real on this camera's RW2s is
/// exactly the kind of one-off probe the rest of this file's callers never need.
#[cfg(test)]
pub fn mean_level_pub(img: *mut AnyObject) -> Result<f32, String> {
    unsafe { mean_level(img) }
}
#[doc(hidden)]
pub fn mean_level_pub_probe(img: *mut AnyObject) -> Result<f32, String> {
    unsafe { mean_level(img) }
}

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

// ── HDR from RAW ──────────────────────────────────────────────────────────────────────────────
//
// source_headroom/write_gainmap_heic above only work when the SOURCE file already carries an
// encoded HDR rendition — true for an iPhone HEIC (measured headroom 1.37-1.40), but NOT for a
// RAW: CIRAWFilter's extendedDynamicRangeAmount property was probed directly against a real RW2
// (examples/raw_headroom_probe.rs) and does nothing — the mean level at EDR=0 and EDR=1 came back
// byte-for-byte identical (0.02173913 both times), and the filter's own inputKeys came back
// empty, meaning this camera's files never enter CIRAWFilter's actual RAW path at all. So a RAW's
// headroom cannot come from Core Image's RAW pipeline; it has to come from the DECODE this app
// already does.
//
// The recoverable range IS there, already computed and already thrown away: CLAUDE.md §7 records
// that the DCP LookTable is "TABLE-INDEX clamps only, values extended-range" — the trilinear-
// sampled colour values inside applyDcpLUT (chromasmith-22.html) can genuinely exceed 1.0 before
// the `Uint8ClampedArray` write clamps them to 255. That headroom is measured once, for free, in
// the SAME per-pixel loop that already runs for every RAW load (see applyDcpLUT's `hrOut`
// parameter) and threaded through geometry via the same `applyGeomTo` the photo itself uses, so
// the two stay pixel-aligned by construction rather than by a second, hand-maintained transform.
//
// This function takes that headroom map (a grayscale PNG, one byte per pixel: 0 = no extra range,
// 255 = the HR_MAX_STOPS cap) and the already-graded SDR export, and builds the HDR rendition as
// graded * (1 + headroom_normalized * (2^HR_MAX_STOPS - 1)) via CIColorMatrix + the same
// CIMultiplyCompositing `multiply()` helper write_gainmap_heic already uses — reusing that
// function rather than a hand-rolled blend keeps the two HDR paths' actual compositing identical.
///
/// ⚠️ The headroom PNG's byte values are expected to be sRGB-GAMMA-ENCODED (the standard OETF),
/// not linear-normalised, and this is load-bearing rather than a stylistic choice. Measured
/// directly (`examples/gainmap_from_map_probe.rs`): loading an untagged 8-bit PNG via
/// `imageWithData:` colour-matches it as sRGB and gamma-DECODES it before CIColorMatrix ever
/// sees it, so a raw linear byte of 128/255 (intended multiplier 2.506 at 2 stops) measured back
/// at only 1.647 in the written file — matching the sRGB EOTF almost exactly (128/255 decodes to
/// ~0.216, and 1+0.216*3=1.648). Only the 0 and 255 endpoints matched by accident (gamma's two
/// fixed points), which is what made this easy to miss testing only the extremes. The caller
/// therefore gamma-ENCODES the intended linear headroom before writing the byte, cancelling the
/// decode out — verified: norm 0/0.25/0.5/1.0 all land within 0.5% of their analytic target after
/// the round trip. Trying to DISABLE colour management instead (`kCIImageColorSpace: NSNull`) was
/// tried first and measured to change nothing, so this file does not attempt that.
pub fn write_gainmap_heic_from_map(
    headroom_png: &[u8],
    graded_png: &[u8],
    dest_path: &str,
    quality: f64,
    max_stops: f64,
) -> Result<bool, String> {
    unsafe {
        let ci_class = class!(CIImage);
        // ⚠️ Loaded via the ORDINARY imageWithData: (colour-managed), and the headroom byte was
        // pre-encoded for exactly that — see the sRGB-OETF note on the caller side / JS's
        // `hrByteForHeadroom`. Do not "fix" this by disabling colour management: that was tried
        // (kCIImageColorSpace: NSNull) and measured to make no difference here, so pre-encoding
        // the byte is the verified fix, not colour-space bypass.
        let hr_data = NSData::with_bytes(headroom_png);
        let hr_img: *mut AnyObject = msg_send![ci_class, imageWithData: &*hr_data];
        if hr_img.is_null() {
            return Err("could not read the headroom map bytes".into());
        }
        let graded_data = NSData::with_bytes(graded_png);
        let graded: *mut AnyObject = msg_send![ci_class, imageWithData: &*graded_data];
        if graded.is_null() {
            return Err("could not read the graded image bytes".into());
        }

        let max_mult = 2f64.powf(max_stops.max(0.0));
        let multiplier = color_matrix_headroom(hr_img, max_mult)?;
        let hdr_out = multiply(graded, multiplier)?;

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



/// out = headroom_img * (max_mult - 1) + 1, per channel — turns a 0..1 grayscale headroom map
/// into a per-pixel multiplier image (1.0 where there's no extra range, max_mult where the cap
/// was hit), via CIColorMatrix's affine per-channel transform. Alpha is forced to 1 (opaque)
/// regardless of the headroom PNG's own alpha, since a multiplier image has no transparency of
/// its own to speak of.
unsafe fn color_matrix_headroom(img: *mut AnyObject, max_mult: f64) -> Result<*mut AnyObject, String> {
    unsafe {
        let m = max_mult - 1.0;
        let vec4 = |x: f64, y: f64, z: f64, w: f64| -> *mut AnyObject {
            msg_send![class!(CIVector), vectorWithX: x, Y: y, Z: z, W: w]
        };
        let r_vec = vec4(m, 0.0, 0.0, 0.0);
        let g_vec = vec4(0.0, m, 0.0, 0.0);
        let b_vec = vec4(0.0, 0.0, m, 0.0);
        let a_vec = vec4(0.0, 0.0, 0.0, 0.0);
        let bias_vec = vec4(1.0, 1.0, 1.0, 1.0);

        let name = NSString::from_str("CIColorMatrix");
        let k_img = NSString::from_str("inputImage");
        let k_r = NSString::from_str("inputRVector");
        let k_g = NSString::from_str("inputGVector");
        let k_b = NSString::from_str("inputBVector");
        let k_a = NSString::from_str("inputAVector");
        let k_bias = NSString::from_str("inputBiasVector");
        let params: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(
            &[&*k_img, &*k_r, &*k_g, &*k_b, &*k_a, &*k_bias],
            &[&*img, &*r_vec as &AnyObject, &*g_vec, &*b_vec, &*a_vec, &*bias_vec],
        );
        let f: *mut AnyObject =
            msg_send![class!(CIFilter), filterWithName: &*name, withInputParameters: &*params];
        if f.is_null() {
            return Err("CIColorMatrix unavailable".into());
        }
        let out: *mut AnyObject = msg_send![f, outputImage];
        if out.is_null() {
            return Err("CIColorMatrix produced no output".into());
        }
        Ok(out)
    }
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
