// Face detection (AI stack Phase A) — SCRFD-500M-BNKPS, bounding boxes + 5-point landmarks only.
// No embedding, no clustering, no naming yet — those are Phase B/C. See CLAUDE.md's AI-stack
// briefing (progress log part 8) for the full plan; this module is Phase A alone.
//
// Model: `insightface`'s SCRFD-500M (bnkps = with 5-point keypoints), sourced via the
// `markrai/seen` project's own documented download URL (see vendor/scrfd/README.md for
// provenance/license). Small enough (~2.5MB) to `include_bytes!`, same as EdgeSAM's encoder/
// decoder in sam.rs, rather than the disk-loaded-resource pattern SAM2/faceparse/rawdenoise use
// for their much larger models.
//
// ⚠️ I/O contract VERIFIED against the real downloaded .onnx via onnx.load() + a real
// onnxruntime Run(), not assumed from SCRFD's published architecture (the same rule
// faceparse.rs's module doc comment describes learning the hard way):
//   input  "input.1"  [1,3,H,W]  (dynamic H/W, NCHW, RGB)
//   outputs per stride s in {8,16,32}: "score_s" [1,N_s,1], "bbox_s" [1,N_s,4], "kps_s" [1,N_s,10]
//   at a 640x640 input, N_8=12800, N_16=3200, N_32=800 — i.e. (640/s)^2 * 2, confirming
//   num_anchors=2 (identical anchor centers, stacked) per spatial location, matching insightface's
//   own `scrfd.py` reference decoder exactly. Decode below ports that algorithm.
//
// Preprocessing: letterbox-resize (aspect-preserving, top-left aligned, zero-pad) into a fixed
// 640x640 square, then `(pixel - 127.5) / 128.0` per channel, matching insightface's own
// `input_mean=127.5, input_std=128.0` — see vendor/scrfd/README.md for the source citation.

use crate::sam::{input, ort_handle, run_session, SamSession};
use std::sync::{Mutex, OnceLock};

static MODEL_BYTES: &[u8] = include_bytes!("../vendor/scrfd/scrfd_500m_bnkps.onnx");

const INPUT_SIZE: u32 = 640;
const STRIDES: [u32; 3] = [8, 16, 32];
const NUM_ANCHORS: usize = 2;
const MEAN: f32 = 127.5;
const STD: f32 = 128.0;
const SCORE_THRESH: f32 = 0.5;
const NMS_THRESH: f32 = 0.4;

// ⚠️ `faces_run` (catalog.rs) drives this from a `par_iter` batch over already-rayon-capped
// worker threads (main.rs leaves 2 cores free for the UI). SCRFD's session sits behind a single
// global `Mutex`, so those par_iter calls actually SERIALIZE on inference — but with no thread
// cap, ONNX Runtime's own intra-op pool defaults to using every core for that one inference call
// anyway, which is exactly the double-parallelism main.rs's rayon cap was trying to avoid: a
// background face scan pegging every core and starving the UI thread, measured live during a
// stuck-scan report (238-394% CPU, zero DB progress for 80s+ straight). Capped low (2) rather
// than to 1: SCRFD's 640x640 input is small and fixed-size regardless of source photo
// resolution, so there's little to gain from more intra-op threads per call, but the outer
// par_iter is where real throughput should come from.
const INTRA_OP_THREADS: i32 = 2;

fn create_session_capped(bytes: &'static [u8]) -> Result<SamSession, String> {
    let h = ort_handle()?;
    unsafe {
        let mut opts: *mut ort_sys::OrtSessionOptions = std::ptr::null_mut();
        crate::sam::check(h.api, ((*h.api).CreateSessionOptions)(&mut opts), "CreateSessionOptions")?;
        if let Err(e) = crate::sam::check(h.api, ((*h.api).SetIntraOpNumThreads)(opts, INTRA_OP_THREADS), "SetIntraOpNumThreads") {
            eprintln!("scrfd: SetIntraOpNumThreads failed (continuing with ORT default): {e}");
        }
        let mut session: *mut ort_sys::OrtSession = std::ptr::null_mut();
        let res = crate::sam::check(
            h.api,
            ((*h.api).CreateSessionFromArray)(h.env, bytes.as_ptr() as *const _, bytes.len(), opts, &mut session),
            "CreateSessionFromArray"
        );
        ((*h.api).ReleaseSessionOptions)(opts);
        res?;
        Ok(SamSession(session))
    }
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| create_session_capped(MODEL_BYTES).map(Mutex::new)).as_ref().map_err(|e| e.clone())
}

/// One detected face, in the ORIGINAL image's pixel coordinates (the letterbox scale/offset is
/// undone before returning — the caller never has to know INPUT_SIZE exists).
#[derive(Debug, Clone)]
pub struct Face {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub score: f32,
    /// 5 landmarks (left eye, right eye, nose, left mouth corner, right mouth corner), each
    /// (x, y) in original image pixel coordinates — insightface's own bnkps point order.
    pub kps: [(f32, f32); 5]
}

/// `rgb` is an already-decoded RGB8 image (interleaved, row-major, no alpha), any resolution —
/// letterboxed internally to the model's fixed 640x640 input. Returns faces sorted by descending
/// score, already NMS-deduplicated.
pub fn detect(rgb: &[u8], w: u32, h: u32) -> Result<Vec<Face>, String> {
    if w == 0 || h == 0 {
        return Err("scrfd: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("scrfd: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }

    // Letterbox: scale so the longer side fits INPUT_SIZE, top-left aligned, zero-pad the rest —
    // matches insightface's own `detect()` preprocessing (`det_scale`, no centering).
    let scale = INPUT_SIZE as f32 / w.max(h) as f32;
    let new_w = ((w as f32 * scale).round().max(1.0) as u32).min(INPUT_SIZE);
    let new_h = ((h as f32 * scale).round().max(1.0) as u32).min(INPUT_SIZE);
    let resized = crate::sam::resize_rgb8(rgb, w, h, new_w, new_h);

    let side = INPUT_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..new_h as usize {
        for x in 0..new_w as usize {
            let src = (y * new_w as usize + x) * 3;
            for c in 0..3 {
                let v = (resized[src + c] as f32 - MEAN) / STD;
                pixels[c * side * side + y * side + x] = v;
            }
        }
    }

    let sess = session()?;
    let mut outputs = run_session(
        sess,
        vec![input("input.1", pixels, &[1, 3, INPUT_SIZE as i64, INPUT_SIZE as i64])],
        &[
            "score_8", "score_16", "score_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32",
        ]
    )?;
    let kps_32 = outputs.remove(8);
    let kps_16 = outputs.remove(7);
    let kps_8 = outputs.remove(6);
    let bbox_32 = outputs.remove(5);
    let bbox_16 = outputs.remove(4);
    let bbox_8 = outputs.remove(3);
    let score_32 = outputs.remove(2);
    let score_16 = outputs.remove(1);
    let score_8 = outputs.remove(0);

    let mut candidates: Vec<Face> = Vec::new();
    for (stride, scores, bboxes, kps) in [
        (STRIDES[0], &score_8, &bbox_8, &kps_8),
        (STRIDES[1], &score_16, &bbox_16, &kps_16),
        (STRIDES[2], &score_32, &bbox_32, &kps_32),
    ] {
        let grid_w = (INPUT_SIZE / stride) as usize;
        let grid_h = (INPUT_SIZE / stride) as usize;
        let n = grid_w * grid_h * NUM_ANCHORS;
        if scores.len() != n || bboxes.len() != n * 4 || kps.len() != n * 10 {
            return Err(format!(
                "scrfd: stride {stride} output size mismatch (scores {} bboxes {} kps {}, expected n={n})",
                scores.len(),
                bboxes.len(),
                kps.len()
            ));
        }
        // Anchor centers: raster order over the grid, each center repeated NUM_ANCHORS times
        // consecutively — matches insightface's `np.stack([centers]*num_anchors, axis=1)`.
        for gy in 0..grid_h {
            for gx in 0..grid_w {
                let cx = gx as f32 * stride as f32;
                let cy = gy as f32 * stride as f32;
                for a in 0..NUM_ANCHORS {
                    let idx = (gy * grid_w + gx) * NUM_ANCHORS + a;
                    let score = scores[idx];
                    if score < SCORE_THRESH {
                        continue;
                    }
                    let b = &bboxes[idx * 4..idx * 4 + 4];
                    let x0 = cx - b[0] * stride as f32;
                    let y0 = cy - b[1] * stride as f32;
                    let x1 = cx + b[2] * stride as f32;
                    let y1 = cy + b[3] * stride as f32;
                    let k = &kps[idx * 10..idx * 10 + 10];
                    let mut pts = [(0f32, 0f32); 5];
                    for p in 0..5 {
                        pts[p] = (cx + k[p * 2] * stride as f32, cy + k[p * 2 + 1] * stride as f32);
                    }
                    // Undo the letterbox scale (translation is zero — top-left aligned).
                    candidates.push(Face {
                        x0: x0 / scale,
                        y0: y0 / scale,
                        x1: x1 / scale,
                        y1: y1 / scale,
                        score,
                        kps: pts.map(|(px, py)| (px / scale, py / scale))
                    });
                }
            }
        }
    }

    Ok(nms(candidates, NMS_THRESH))
}

fn iou(a: &Face, b: &Face) -> f32 {
    let ix0 = a.x0.max(b.x0);
    let iy0 = a.y0.max(b.y0);
    let ix1 = a.x1.min(b.x1);
    let iy1 = a.y1.min(b.y1);
    let iw = (ix1 - ix0).max(0.0);
    let ih = (iy1 - iy0).max(0.0);
    let inter = iw * ih;
    let area_a = (a.x1 - a.x0).max(0.0) * (a.y1 - a.y0).max(0.0);
    let area_b = (b.x1 - b.x0).max(0.0) * (b.y1 - b.y0).max(0.0);
    let union = area_a + area_b - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

fn nms(mut faces: Vec<Face>, thresh: f32) -> Vec<Face> {
    faces.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept: Vec<Face> = Vec::new();
    'outer: for f in faces {
        for k in &kept {
            if iou(&f, k) > thresh {
                continue 'outer;
            }
        }
        kept.push(f);
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() {
        let dylib = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
    }

    /// Runs against a real photo if one happens to be present in this checkout (same
    /// skip-if-absent convention faceparse.rs's test uses — no face photo is checked into the
    /// repo). Otherwise runs against a blank synthetic image and only asserts the model executes
    /// without error and returns zero faces on a face-free image (a real correctness check on a
    /// real face is still outstanding — see vendor/scrfd/README.md).
    #[test]
    fn detect_runs_and_finds_nothing_on_a_blank_image() {
        setup_model();
        let (w, h) = (320u32, 240u32);
        let rgb = vec![128u8; (w * h * 3) as usize];
        let faces = detect(&rgb, w, h).expect("scrfd detect run");
        assert!(faces.is_empty(), "blank image should not detect any faces, got {}", faces.len());
    }

    #[test]
    fn detect_finds_a_face_in_a_real_photo_if_present() {
        setup_model();
        let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let path = repo_root.join("__TM3390.jpg");
        if !path.exists() {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        }
        let img = image::open(&path).expect("open __TM3390.jpg").to_rgb8();
        let (w, h) = img.dimensions();
        let faces = detect(img.as_raw(), w, h).expect("scrfd detect run");
        println!("detected {} face(s)", faces.len());
        assert!(!faces.is_empty(), "expected at least one face in __TM3390.jpg");
        for f in &faces {
            assert!(f.x0 < f.x1 && f.y0 < f.y1, "degenerate bbox");
            assert!(f.score >= SCORE_THRESH);
        }
    }
}
