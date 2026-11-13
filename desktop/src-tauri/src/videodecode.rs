// Native video frame source for VIDEO EXPORT (macOS) — AVAssetReader, hardware decode + scale.
//
// WHY THIS EXISTS — measured live in the desktop app (VIDEO_DIAG, 11 s 4K HEVC clip, Intel Mac):
// the WebView path decodes with WebCodecs, draws each 4K frame into a 2D canvas and uploads that
// canvas to WebGL. WebKit converts the frame on the CPU at that upload: ~120 ms per frame, the
// single largest cost of the export. Handing the renderer a ready RGBA buffer instead uploads in
// ~4 ms. AVAssetReader decodes on the media engine and scales to the export size in the same
// step, so the pixels that cross the IPC boundary are already 1080p-sized (2.6 MB, not 33 MB).
//
// Shape: one export at a time. `open` starts ONE decode thread for the session (bounded: never a
// thread per frame) that runs ahead of the renderer through a bounded channel, so decoding the
// next frame overlaps the GPU grading the current one. `next` hands back one frame per call as a
// raw IPC body; `close` (or opening a new session) stops the thread.
//
// Output rows are written BOTTOM-UP and as RGBA, which is exactly what WebGL's texSubImage2D wants
// with UNPACK_FLIP_Y off — so the front end uploads the bytes untouched. The container's rotation
// (0/90/180/270, from the front end's mediabunny probe) is applied while copying, matching what
// VideoSample.draw() does on the WebView path.
//
// Like videothumb.rs this links AVFoundation/CoreMedia/CoreVideo and sends messages directly —
// no Cargo dependency. Only C functions RETURN structs here (CMSampleBufferGetPresentationTimeStamp,
// ordinary C ABI); the ObjC side only TAKES a struct argument (setTimeRange:), never returns one,
// which avoids the x86_64 objc_msgSend_stret trap videothumb.rs documents.
#![cfg(target_os = "macos")]

use objc2::encode::{Encode, Encoding, RefEncode};
use objc2::rc::autoreleasepool;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}
unsafe impl Encode for CMTime {
    const ENCODING: Encoding =
        Encoding::Struct("?", &[Encoding::LongLong, Encoding::Int, Encoding::UInt, Encoding::LongLong]);
}
unsafe impl RefEncode for CMTime {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CMTimeRange {
    start: CMTime,
    duration: CMTime,
}
unsafe impl Encode for CMTimeRange {
    const ENCODING: Encoding = Encoding::Struct("?", &[CMTime::ENCODING, CMTime::ENCODING]);
}
unsafe impl RefEncode for CMTimeRange {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}

type CFTypeRef = *mut std::ffi::c_void;

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMSampleBufferGetImageBuffer(sbuf: CFTypeRef) -> CFTypeRef;
    fn CMSampleBufferGetPresentationTimeStamp(sbuf: CFTypeRef) -> CMTime;
}
#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    fn CVPixelBufferLockBaseAddress(pb: CFTypeRef, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(pb: CFTypeRef, flags: u64) -> i32;
    fn CVPixelBufferGetBaseAddress(pb: CFTypeRef) -> *const u8;
    fn CVPixelBufferGetBytesPerRow(pb: CFTypeRef) -> usize;
    fn CVPixelBufferGetWidth(pb: CFTypeRef) -> usize;
    fn CVPixelBufferGetHeight(pb: CFTypeRef) -> usize;
}
// Same signature videothumb.rs declares (one CFRelease declaration shape crate-wide).
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *mut AnyObject);
}

const TIMESCALE: i32 = 600_000; // fine enough that a 29.97 fps trim edge isn't rounded off a frame
const BGRA: u32 = 0x42475241; // kCVPixelFormatType_32BGRA ('BGRA')
const READ_ONLY: u64 = 1; // kCVPixelBufferLock_ReadOnly
const AHEAD: usize = 4; // frames decoded ahead of the renderer (~10 MB at 1080p)

fn cmtime(seconds: f64) -> CMTime {
    CMTime { value: (seconds.max(0.0) * TIMESCALE as f64).round() as i64, timescale: TIMESCALE, flags: 1, epoch: 0 }
}

pub struct Frame {
    pub pts: f64,
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

enum Msg {
    Frame(Frame),
    End,
    Err(String),
}

struct Session {
    id: u64,
    rx: Mutex<Receiver<Msg>>,
    stop: Arc<AtomicBool>,
    done: AtomicBool,
}

static SESSION: Mutex<Option<Arc<Session>>> = Mutex::new(None);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub struct OpenArgs {
    pub path: String,
    pub start_s: f64,
    pub end_s: f64,
    /// Decoded (pre-rotation) size the media engine scales to. 0 = native size.
    pub decode_w: u32,
    pub decode_h: u32,
    /// Clockwise display rotation from the container (0/90/180/270).
    pub rotation: u32,
}

/// Opens the clip and verifies the first frame decodes before returning, so the caller can fall
/// back to the WebView path on ANY failure (unsupported codec, DRM, unreadable volume).
pub fn open(a: OpenArgs) -> Result<u64, String> {
    close_all();
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = sync_channel::<Msg>(AHEAD);
    let (ready_tx, ready_rx) = sync_channel::<Result<(), String>>(1);
    let stop2 = stop.clone();
    std::thread::Builder::new()
        .name("cs-video-export-decode".into())
        .spawn(move || decode_thread(a, tx, stop2, ready_tx))
        .map_err(|e| format!("video decode thread: {e}"))?;
    match ready_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("video decode thread exited before starting".into()),
    }
    let s = Arc::new(Session { id, rx: Mutex::new(rx), stop, done: AtomicBool::new(false) });
    *SESSION.lock().unwrap() = Some(s);
    Ok(id)
}

/// Blocks until the next frame is decoded. Ok(None) at the end of the range.
pub fn next(id: u64) -> Result<Option<Frame>, String> {
    let s = SESSION.lock().unwrap().clone().ok_or("video decode: no open session")?;
    if s.id != id {
        return Err("video decode: session was replaced".into());
    }
    if s.done.load(Ordering::SeqCst) {
        return Ok(None);
    }
    let msg = s.rx.lock().unwrap().recv();
    match msg {
        Ok(Msg::Frame(f)) => Ok(Some(f)),
        Ok(Msg::End) | Err(_) => {
            s.done.store(true, Ordering::SeqCst);
            Ok(None)
        }
        Ok(Msg::Err(e)) => {
            s.done.store(true, Ordering::SeqCst);
            Err(e)
        }
    }
}

pub fn close(id: u64) {
    let mut g = SESSION.lock().unwrap();
    if g.as_ref().map(|s| s.id == id).unwrap_or(false) {
        if let Some(s) = g.take() {
            s.stop.store(true, Ordering::SeqCst);
            // Unblock a decode thread waiting on a full channel.
            while s.rx.lock().unwrap().try_recv().is_ok() {}
        }
    }
}

fn close_all() {
    if let Some(s) = SESSION.lock().unwrap().take() {
        s.stop.store(true, Ordering::SeqCst);
        while s.rx.lock().unwrap().try_recv().is_ok() {}
    }
}

fn decode_thread(a: OpenArgs, tx: SyncSender<Msg>, stop: Arc<AtomicBool>, ready: SyncSender<Result<(), String>>) {
    let mut ready = Some(ready);
    let fail = |ready: &mut Option<SyncSender<Result<(), String>>>, tx: &SyncSender<Msg>, e: String| {
        if let Some(r) = ready.take() {
            let _ = r.send(Err(e));
        } else {
            let _ = tx.send(Msg::Err(e));
        }
    };
    unsafe {
        // Reader objects live entirely on this thread; one pool for setup, one per frame below.
        let (reader, output) = match autoreleasepool(|_| setup(&a)) {
            Ok(v) => v,
            Err(e) => return fail(&mut ready, &tx, e),
        };
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let res = autoreleasepool(|_| -> Result<Option<Frame>, String> {
                let sbuf: CFTypeRef = msg_send![output, copyNextSampleBuffer];
                if sbuf.is_null() {
                    let status: isize = msg_send![reader, status];
                    // AVAssetReaderStatusFailed == 3
                    if status == 3 {
                        return Err("video decode failed mid-clip".into());
                    }
                    return Ok(None);
                }
                let pts = CMSampleBufferGetPresentationTimeStamp(sbuf);
                let pb = CMSampleBufferGetImageBuffer(sbuf);
                let frame = if pb.is_null() { None } else { Some(copy_frame(pb, a.rotation)) };
                CFRelease(sbuf as *mut AnyObject);
                match frame {
                    Some(mut f) => {
                        f.pts = if pts.flags & 1 == 1 && pts.timescale > 0 { pts.value as f64 / pts.timescale as f64 } else { 0.0 };
                        Ok(Some(f))
                    }
                    None => Err("video decode returned a sample without pixels".into()),
                }
            });
            match res {
                Ok(Some(f)) => {
                    if let Some(r) = ready.take() {
                        let _ = r.send(Ok(()));
                    }
                    if tx.send(Msg::Frame(f)).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    if let Some(r) = ready.take() {
                        let _ = r.send(Err("no frames in the requested range".into()));
                    } else {
                        let _ = tx.send(Msg::End);
                    }
                    break;
                }
                Err(e) => {
                    fail(&mut ready, &tx, e);
                    break;
                }
            }
        }
        let _: () = msg_send![reader, cancelReading];
        let _: () = msg_send![output, release];
        let _: () = msg_send![reader, release];
    }
}

unsafe fn setup(a: &OpenArgs) -> Result<(*mut AnyObject, *mut AnyObject), String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&a.path));
    let asset: *mut AnyObject = msg_send![class!(AVURLAsset), URLAssetWithURL: &*url, options: std::ptr::null::<AnyObject>()];
    if asset.is_null() {
        return Err("could not open the clip".into());
    }
    let vide = NSString::from_str("vide");
    let tracks: *mut NSArray<AnyObject> = msg_send![asset, tracksWithMediaType: &*vide];
    if tracks.is_null() || (*tracks).count() == 0 {
        return Err("no video track".into());
    }
    let track: *mut AnyObject = msg_send![tracks, objectAtIndex: 0usize];
    let reader: *mut AnyObject = msg_send![class!(AVAssetReader), alloc];
    let reader: *mut AnyObject = msg_send![reader, initWithAsset: asset, error: std::ptr::null_mut::<*mut AnyObject>()];
    if reader.is_null() {
        return Err("AVAssetReader refused the clip".into());
    }
    let k_fmt = NSString::from_str("PixelFormatType");
    let k_w = NSString::from_str("Width");
    let k_h = NSString::from_str("Height");
    let v_fmt = NSNumber::new_u32(BGRA);
    let v_w = NSNumber::new_u32(a.decode_w);
    let v_h = NSNumber::new_u32(a.decode_h);
    let settings = if a.decode_w > 0 && a.decode_h > 0 {
        let k: [&NSString; 3] = [&k_fmt, &k_w, &k_h];
        let v: [&AnyObject; 3] = [&v_fmt, &v_w, &v_h];
        NSDictionary::from_slices(&k, &v)
    } else {
        let k: [&NSString; 1] = [&k_fmt];
        let v: [&AnyObject; 1] = [&v_fmt];
        NSDictionary::from_slices(&k, &v)
    };
    let output: *mut AnyObject = msg_send![class!(AVAssetReaderTrackOutput), alloc];
    let output: *mut AnyObject = msg_send![output, initWithTrack: track, outputSettings: &*settings];
    if output.is_null() {
        let _: () = msg_send![reader, release];
        return Err("AVAssetReaderTrackOutput refused the settings".into());
    }
    let _: () = msg_send![output, setAlwaysCopiesSampleData: Bool::new(false)];
    let can: Bool = msg_send![reader, canAddOutput: output];
    if !can.as_bool() {
        let _: () = msg_send![output, release];
        let _: () = msg_send![reader, release];
        return Err("AVAssetReader cannot add the video output".into());
    }
    let _: () = msg_send![reader, addOutput: output];
    if a.end_s > a.start_s {
        // A little lead-in so the frame straddling the in-point is included (the WebView path's
        // samples(t) does the same); the front end picks frames by timestamp.
        let start = (a.start_s - 0.1).max(0.0);
        let range = CMTimeRange { start: cmtime(start), duration: cmtime(a.end_s - start + 0.1) };
        let _: () = msg_send![reader, setTimeRange: range];
    }
    let ok: Bool = msg_send![reader, startReading];
    if !ok.as_bool() {
        let _: () = msg_send![output, release];
        let _: () = msg_send![reader, release];
        return Err("AVAssetReader could not start (unsupported codec?)".into());
    }
    Ok((reader, output))
}

/// BGRA (top-down, padded rows) -> RGBA, bottom-up, rotated clockwise by `rotation`.
unsafe fn copy_frame(pb: CFTypeRef, rotation: u32) -> Frame {
    CVPixelBufferLockBaseAddress(pb, READ_ONLY);
    let base = CVPixelBufferGetBaseAddress(pb);
    let stride = CVPixelBufferGetBytesPerRow(pb);
    let sw = CVPixelBufferGetWidth(pb);
    let sh = CVPixelBufferGetHeight(pb);
    let src = std::slice::from_raw_parts(base, stride * sh);
    let f = convert(src, stride, sw, sh, rotation);
    CVPixelBufferUnlockBaseAddress(pb, READ_ONLY);
    f
}

/// Pure pixel shuffle, separated so it is unit-testable without AVFoundation.
pub fn convert(src: &[u8], stride: usize, sw: usize, sh: usize, rotation: u32) -> Frame {
    let rot = rotation % 360;
    let (dw, dh) = if rot == 90 || rot == 270 { (sh, sw) } else { (sw, sh) };
    let mut out = vec![0u8; dw * dh * 4];
    for oy in 0..dh {
        // Output is bottom-up: output row `oy` holds display row (dh-1-oy).
        let dy = dh - 1 - oy;
        let orow = &mut out[oy * dw * 4..(oy + 1) * dw * 4];
        for dx in 0..dw {
            // Display (dx,dy) -> source (sx,sy) for a clockwise rotation of the stored frame.
            let (sx, sy) = match rot {
                90 => (dy, sh - 1 - dx),
                180 => (sw - 1 - dx, sh - 1 - dy),
                270 => (sw - 1 - dy, dx),
                _ => (dx, dy),
            };
            let s = sy * stride + sx * 4;
            let o = dx * 4;
            orow[o] = src[s + 2];
            orow[o + 1] = src[s + 1];
            orow[o + 2] = src[s];
            orow[o + 3] = 255;
        }
    }
    Frame { pts: 0.0, w: dw as u32, h: dh as u32, rgba: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2x1 BGRA source: left pixel blue-ish marker, right pixel red marker; stride padded to 12.
    fn src2x1() -> (Vec<u8>, usize) {
        let mut v = vec![0u8; 12];
        v[0..4].copy_from_slice(&[10, 20, 30, 255]); // B G R A  -> RGBA 30,20,10
        v[4..8].copy_from_slice(&[40, 50, 60, 255]); // -> RGBA 60,50,40
        (v, 12)
    }

    #[test]
    fn swizzles_bgra_to_rgba_unrotated() {
        let (s, st) = src2x1();
        let f = convert(&s, st, 2, 1, 0);
        assert_eq!((f.w, f.h), (2, 1));
        assert_eq!(&f.rgba[0..4], &[30, 20, 10, 255]);
        assert_eq!(&f.rgba[4..8], &[60, 50, 40, 255]);
    }

    #[test]
    fn writes_rows_bottom_up() {
        // 1x2 source: top pixel A, bottom pixel B. Bottom-up output puts B first.
        let s = vec![1, 2, 3, 255, 4, 5, 6, 255];
        let f = convert(&s, 4, 1, 2, 0);
        assert_eq!(&f.rgba[0..4], &[6, 5, 4, 255]);
        assert_eq!(&f.rgba[4..8], &[3, 2, 1, 255]);
    }

    #[test]
    fn rotates_clockwise_90() {
        // 2x1 [L R] rotated 90 cw displays as a 1x2 column: L on top, R below.
        let (s, st) = src2x1();
        let f = convert(&s, st, 2, 1, 90);
        assert_eq!((f.w, f.h), (1, 2));
        // bottom-up: first row = display bottom = R
        assert_eq!(&f.rgba[0..4], &[60, 50, 40, 255]);
        assert_eq!(&f.rgba[4..8], &[30, 20, 10, 255]);
    }

    #[test]
    fn rotates_180_and_270() {
        let (s, st) = src2x1();
        let f = convert(&s, st, 2, 1, 180);
        assert_eq!(&f.rgba[0..4], &[60, 50, 40, 255]);
        let f = convert(&s, st, 2, 1, 270);
        assert_eq!((f.w, f.h), (1, 2));
        // 270 cw: R on top, L below; bottom-up first row = L
        assert_eq!(&f.rgba[0..4], &[30, 20, 10, 255]);
    }

    #[test]
    fn decodes_a_real_clip_scaled_if_present() {
        let p = "/Volumes/Crucial/PHOTOS/2026/2026-11-07/P_TM7671.MP4";
        if !std::path::Path::new(p).exists() {
            return;
        }
        let id = open(OpenArgs { path: p.into(), start_s: 1.0, end_s: 1.5, decode_w: 1080, decode_h: 608, rotation: 0 }).expect("open");
        let mut n = 0;
        let mut last = -1.0;
        while let Some(f) = next(id).expect("next") {
            assert_eq!((f.w, f.h), (1080, 608));
            assert!(f.pts >= last);
            last = f.pts;
            n += 1;
        }
        close(id);
        assert!(n >= 14 && n <= 22, "frames in 0.5 s window + lead-in: {n}");
    }
}
