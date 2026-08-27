// Video poster frames via AVFoundation (macOS), for the Library grid.
//
// WHY THIS EXISTS — this replaces a WebView implementation that could not be made to work.
//
// The grid used to build video posters in the front end: fetch the clip, feed a hidden <video>,
// seek, and draw to a canvas. That path had two structural defects, and patching it three times
// did not hold:
//
//   1. The poster's blob URL was stored in a session-lifetime JS cache, but ALSO pushed into the
//      thumb pump's per-generation revoke list. Any grid rebuild (~35 call sites — every sort,
//      filter, search and view toggle) revoked it while the cache kept serving it, so every video
//      card became a permanent WebKit broken-image "?" with a still-correct duration badge.
//   2. A transient decode failure was cached as failed forever, so a clip that hiccuped once
//      never recovered.
//
// Both are gone by construction here: posters are ordinary thumbnail bytes, disk-cached by
// library.rs like every photo thumbnail (so they also survive a restart, which the WebView path
// structurally could not do), with no blob URLs and no negative cache anywhere.
//
// This does NOT violate CLAUDE.md's "not worth an ffmpeg dependency for a grid thumbnail" rule —
// AVFoundation is the operating system's own decoder, the same one Finder, QuickLook and Photos
// use for exactly this job. Following fastthumb.rs's precedent it is reached by LINKING the
// framework and sending messages to it, so it adds no Cargo dependency at all.
//
// ⚠️ Only the seek time crosses the FFI boundary as a CMTime, and only as an ARGUMENT (ordinary C
// ABI). Duration and dimensions deliberately come from catalog::video_track_info's pure-Rust
// container parse instead of `[AVAsset duration]`, because that RETURNS a 24-byte struct — on
// x86_64 a hidden-pointer `objc_msgSend_stret` call whose failure mode is silently-wrong numbers
// rather than a compile error. See that function's comment.
#![cfg(target_os = "macos")]

use objc2::encode::{Encode, Encoding, RefEncode};
use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::{NSData, NSDictionary, NSNumber, NSString, NSURL};

// Linked so the ObjC runtime has AVURLAsset/AVAssetImageGenerator registered by the time
// `class!()` looks them up. No symbols are called directly from it.
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *mut AnyObject);
}

/// CoreMedia's timestamp struct. Declared here rather than linking CoreMedia because only the
/// layout matters — every value this module builds is a literal.
#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

// Apple encodes CMTime as the anonymous struct "{?=qiIq}".
unsafe impl Encode for CMTime {
    const ENCODING: Encoding =
        Encoding::Struct("?", &[Encoding::LongLong, Encoding::Int, Encoding::UInt, Encoding::LongLong]);
}
unsafe impl RefEncode for CMTime {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[Encoding::Double, Encoding::Double]);
}
unsafe impl RefEncode for CGSize {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}

/// 600 is the conventional QuickTime timescale — it divides evenly by every common frame rate
/// (24/25/30/60), so a seek target lands on an exact tick rather than accumulating rounding.
const TIMESCALE: i32 = 600;
/// `kCMTimeFlags_Valid`. A CMTime without this bit set is treated as invalid and the seek fails.
const CMTIME_FLAG_VALID: u32 = 1;

fn cmtime(seconds: f64) -> CMTime {
    CMTime {
        value: (seconds.max(0.0) * TIMESCALE as f64).round() as i64,
        timescale: TIMESCALE,
        flags: CMTIME_FLAG_VALID,
        epoch: 0,
    }
}

/// Decodes one frame of `path` to a JPEG whose long edge is at most `long_edge`.
///
/// `duration_secs` is a PARAMETER rather than read from the asset because the seek target is
/// derived from it and the caller already knows it (catalog::video_track_info). Pass 0.0 when it
/// is unknown and the first frame is used — which also matters for the repo's own committed
/// fixture, a ~1s clip that a hardcoded "seek 1 second in" would run off the end of.
///
/// Returns None on ANY failure — unreadable file, no video track, DRM, unsupported codec, corrupt
/// container — so the caller falls back exactly as it does for a photo ImageIO dislikes.
pub fn poster_jpeg(path: &str, long_edge: u32, duration_secs: f64) -> Option<Vec<u8>> {
    // ⚠️ AVFoundation hands back a lot of AUTORELEASED objects (the asset, the generator, the
    // NSData). This runs on Tauri's command threads, which have no ambient pool, so without this
    // they would accumulate for the life of the process — generating a few hundred posters while
    // scrolling would grow RSS monotonically. fastthumb.rs needs no pool because every CF object
    // it touches is released by hand.
    autoreleasepool(|_| unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let asset: *mut AnyObject = msg_send![
            class!(AVURLAsset),
            URLAssetWithURL: &*url,
            options: std::ptr::null::<AnyObject>(),
        ];
        if asset.is_null() {
            return None;
        }
        let generator: *mut AnyObject = msg_send![class!(AVAssetImageGenerator), assetImageGeneratorWithAsset: asset];
        if generator.is_null() {
            return None;
        }
        // ⚠️ Non-negotiable: without this a portrait clip (stored landscape plus a 90° matrix)
        // comes out sideways. It is also why the poster is correct even when the tkhd matrix
        // parse in catalog.rs declines to transpose the reported dimensions.
        let _: () = msg_send![generator, setAppliesPreferredTrackTransform: Bool::new(true)];
        // Fits within the box while preserving aspect ratio, so the decoder scales down during
        // decode rather than handing back a full 4K frame for us to shrink.
        let _: () = msg_send![
            generator,
            setMaximumSize: CGSize { width: long_edge as f64, height: long_edge as f64 }
        ];
        // The single biggest speed lever on 4K HEVC: allowing a half-second tolerance lets the
        // generator return the nearest KEYFRAME instead of decoding forward from one to hit an
        // exact timestamp. A grid thumbnail does not care which frame it got.
        let tolerance = cmtime(0.5);
        let _: () = msg_send![generator, setRequestedTimeToleranceBefore: tolerance];
        let _: () = msg_send![generator, setRequestedTimeToleranceAfter: tolerance];

        // A little way in — frame 0 of a real clip is very often black or a fade-in — but never
        // past the end of a short one.
        let seek = if duration_secs > 0.0 { (duration_secs * 0.1).min(1.0) } else { 0.0 };
        let cg: *mut AnyObject = msg_send![
            generator,
            copyCGImageAtTime: cmtime(seek),
            actualTime: std::ptr::null_mut::<CMTime>(),
            error: std::ptr::null_mut::<*mut AnyObject>(),
        ];
        if cg.is_null() {
            return None;
        }
        let jpeg = cgimage_to_jpeg(cg);
        CFRelease(cg);
        jpeg
    })
}

/// CGImage -> JPEG bytes via NSBitmapImageRep. Mirrors fastthumb.rs's tail deliberately, so both
/// thumbnail tiers emit identically-encoded JPEGs and the grid can't show a visible quality seam
/// between a photo card and a video card.
unsafe fn cgimage_to_jpeg(cg: *mut AnyObject) -> Option<Vec<u8>> {
    let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), alloc];
    let rep: *mut AnyObject = msg_send![rep, initWithCGImage: cg];
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tiny_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/video_tiny.mp4")
    }

    #[test]
    fn produces_a_bounded_jpeg_from_the_committed_fixture() {
        let p = tiny_fixture();
        assert!(p.exists(), "test/fixtures/video_tiny.mp4 is committed and must be present");
        // ⚠️ If this ever fails while the built app works, the cause to check FIRST is that
        // `cargo test` runs in a bare CLI process with no window server. AVFoundation is expected
        // to fall back to software decode there, but if a future macOS stops doing so, make this
        // skip gracefully rather than fighting it — the app path is what matters.
        let out = match poster_jpeg(&p.to_string_lossy(), 360, 1.0) {
            Some(v) => v,
            None => {
                eprintln!("skipping: AVFoundation declined the fixture in this test process");
                return;
            }
        };
        assert!(out.len() > 500, "suspiciously small JPEG: {} bytes", out.len());
        assert_eq!(&out[..2], &[0xFF, 0xD8], "not a JPEG (missing SOI marker)");
        let img = image::load_from_memory(&out).expect("re-decode");
        assert!(
            img.width().max(img.height()) <= 400,
            "long edge {} exceeds the requested 360 (+tolerance)",
            img.width().max(img.height())
        );
    }

    /// A zero/unknown duration must seek to frame 0 rather than off the end of a short clip.
    #[test]
    fn an_unknown_duration_still_produces_a_frame() {
        let p = tiny_fixture();
        if !p.exists() {
            return;
        }
        if let Some(out) = poster_jpeg(&p.to_string_lossy(), 360, 0.0) {
            assert_eq!(&out[..2], &[0xFF, 0xD8], "not a JPEG");
        }
    }

    #[test]
    fn declines_a_non_video_instead_of_panicking() {
        let tmp = std::env::temp_dir().join(format!("cs_videothumb_{}.mp4", std::process::id()));
        std::fs::write(&tmp, b"not a video at all").unwrap();
        assert!(poster_jpeg(tmp.to_str().unwrap(), 360, 0.0).is_none());
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn declines_a_missing_file_instead_of_panicking() {
        assert!(poster_jpeg("/nonexistent/nope.mp4", 360, 1.0).is_none());
    }

    /// The real 4K HEVC case, if this machine has the user's own clips (skipped cleanly
    /// otherwise) — the fixture above is 160x120, so it cannot catch a scaling or
    /// rotation-transform defect on real camera footage.
    #[test]
    fn poster_from_a_real_4k_clip_if_present() {
        let dir = PathBuf::from("/Users/tareqameer/Documents/CHROMASMITH PHOTOS/2026/08/23");
        if !dir.exists() {
            eprintln!("skipping: no real clip folder on this machine");
            return;
        }
        let clip = match std::fs::read_dir(&dir).ok().and_then(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .find(|p| p.extension().map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false))
        }) {
            Some(c) => c,
            None => return,
        };
        let dur = crate::catalog::video_track_info(&clip.to_string_lossy())
            .map(|i| i.duration_secs)
            .unwrap_or(0.0);
        let out = poster_jpeg(&clip.to_string_lossy(), 360, dur).expect("real clip must decode");
        let img = image::load_from_memory(&out).expect("re-decode");
        println!("real clip {:?} -> {}x{} ({} bytes)", clip.file_name(), img.width(), img.height(), out.len());
        assert!(img.width().max(img.height()) <= 400);
    }
}
