// Face embedding (AI stack Phase B, part 1) — ArcFace (w600k_r50, buffalo_l tier ResNet50
// backbone) via SCRFD's own 5-point landmarks from Phase A. Deliberately the LARGER/heavier
// embedding model, not the buffalo_s MobileFaceNet tier `scrfd.rs`'s sibling detector uses —
// explicit user direction: embedding quality matters more than size/CPU cost here, and a single
// 112x112 crop per face is cheap to run even with a ResNet50 backbone.
//
// ⚠️ Unlike `markrai/seen`'s own ArcFace preprocessing (`preprocess_arcface` in its face.rs,
// referenced for Phase A's model sourcing) — which just resizes the raw detection BBOX to
// 112x112 — this module does the REAL InsightFace alignment: a 5-point similarity (rotation +
// uniform scale + translation, no shear) transform of the detected landmarks onto InsightFace's
// own canonical template, then warps the ORIGINAL image into that fixed 112x112 frame. This is
// what the published ArcFace accuracy numbers assume and is a meaningfully better crop than a
// bbox resize (which leaves faces at arbitrary in-plane rotation/scale) — worth the extra math
// given the user's explicit quality-over-simplicity direction for this phase.
//
// I/O contract VERIFIED against the real downloaded .onnx via onnx.load(): input "input.1"
// [None,3,112,112] NCHW RGB, output a 512-dim embedding named "683" in this specific export (the
// raw ort-sys C API's Run() requires the exact graph output name, unlike a positional API — see
// `embed()`'s own comment if the vendored model file is ever swapped). Preprocessing matches
// InsightFace's own `ArcFaceONNX` model class exactly: `(v - 127.5) / 127.5` per channel, RGB
// order (their `blobFromImages(..., swapRB=True)` on a BGR-loaded image nets out to RGB into the
// tensor).

use crate::sam::{create_session_from_path, input, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const FACE_SIZE: u32 = 112;
const MEAN: f32 = 127.5;
const STD: f32 = 127.5;

/// InsightFace's own canonical 5-point template for a 112x112 aligned crop (left eye, right eye,
/// nose, left mouth corner, right mouth corner) — the same constant `face_align.py`'s
/// `arcface_dst` uses across the whole InsightFace ecosystem, so any embedding produced against
/// it is comparable to the published model's expectations.
const ARCFACE_DST: [(f64, f64); 5] =
    [(38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366), (41.5493, 92.3655), (70.7299, 92.2041)];

static MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's `.setup()`, same pattern as `faceparse::set_model_path` — the
/// 174MB ResNet50 backbone is loaded from disk (bundled Tauri resource), not `include_bytes!`'d.
pub fn set_model_path(path: PathBuf) {
    let _ = MODEL_PATH.set(path);
}

fn session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = MODEL_PATH.get().ok_or("ArcFace model path not set — set_model_path() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Closed-form 2x2 SVD via eigendecomposition of `A^T A` (always symmetric PSD, so this is exact
/// and branch-free): `A = U . diag(s1,s2) . V^T`. `V`'s columns are `A^T A`'s eigenvectors (so
/// `V` is always a proper rotation, det=+1, since eigenvectors of a symmetric matrix are always
/// orthonormal); `U`'s columns are `A . v_i / s_i`, which may end up a proper rotation OR a
/// reflection (det=±1) depending on the sign of `det(A)` — Umeyama's algorithm below is exactly
/// what corrects that sign back into a proper rotation. Returns `(u, s1, s2, v)`, both `u`/`v` as
/// `[[col0.x,col1.x],[col0.y,col1.y]]`.
fn svd2(a: f64, b: f64, c: f64, d: f64) -> ([[f64; 2]; 2], f64, f64, [[f64; 2]; 2]) {
    // A^T A = [[p, q], [q, r]]
    let p = a * a + c * c;
    let r = b * b + d * d;
    let q = a * b + c * d;
    let theta = if (p - r).abs() < 1e-15 && q.abs() < 1e-15 { 0.0 } else { 0.5 * (2.0 * q).atan2(p - r) };
    let (ct, st) = (theta.cos(), theta.sin());
    let v = [[ct, -st], [st, ct]]; // columns: v0=(ct,st), v1=(-st,ct)
    let half = (p + r) / 2.0;
    let rad = (((p - r) / 2.0).powi(2) + q * q).sqrt();
    let s1 = (half + rad).max(0.0).sqrt();
    let s2 = (half - rad).max(0.0).sqrt();
    // u_i = A . v_i / s_i (falls back to an arbitrary orthonormal completion when s_i ~ 0, which
    // only happens for a degenerate/rank-deficient input — five real landmarks never are).
    let av0 = (a * ct + b * st, c * ct + d * st);
    let av1 = (-a * st + b * ct, -c * st + d * ct);
    let u0 = if s1 > 1e-12 { (av0.0 / s1, av0.1 / s1) } else { (1.0, 0.0) };
    let u1 = if s2 > 1e-12 { (av1.0 / s2, av1.1 / s2) } else { (-u0.1, u0.0) };
    let u = [[u0.0, u1.0], [u0.1, u1.1]];
    (u, s1, s2, v)
}

/// Umeyama similarity-transform estimation (rotation + uniform scale + translation, no shear)
/// mapping `src` points onto `dst` points in the least-squares sense — the standard algorithm
/// behind `skimage.transform.SimilarityTransform().estimate()`, which is what InsightFace's own
/// `face_align.norm_crop` uses. Returns a 2x3 affine `[[m00,m01,tx],[m10,m11,ty]]` such that
/// `dst ≈ M . [src; 1]`.
fn umeyama_similarity(src: &[(f64, f64); 5], dst: &[(f64, f64); 5]) -> [[f64; 3]; 2] {
    let n = src.len() as f64;
    let mu_src = (src.iter().map(|p| p.0).sum::<f64>() / n, src.iter().map(|p| p.1).sum::<f64>() / n);
    let mu_dst = (dst.iter().map(|p| p.0).sum::<f64>() / n, dst.iter().map(|p| p.1).sum::<f64>() / n);

    let sigma_src2 = src.iter().map(|p| (p.0 - mu_src.0).powi(2) + (p.1 - mu_src.1).powi(2)).sum::<f64>() / n;

    // Cov = (1/n) * sum( (dst_i - mu_dst) outer (src_i - mu_src) )
    let mut cov = [[0f64; 2]; 2];
    for i in 0..5 {
        let sx = src[i].0 - mu_src.0;
        let sy = src[i].1 - mu_src.1;
        let dx = dst[i].0 - mu_dst.0;
        let dy = dst[i].1 - mu_dst.1;
        cov[0][0] += dx * sx;
        cov[0][1] += dx * sy;
        cov[1][0] += dy * sx;
        cov[1][1] += dy * sy;
    }
    for row in cov.iter_mut() {
        for v in row.iter_mut() {
            *v /= n;
        }
    }

    let (u, s1, s2, v) = svd2(cov[0][0], cov[0][1], cov[1][0], cov[1][1]);
    // det(V) is always +1 by svd2's construction; det(U) carries the sign of det(Cov) (since
    // det(Cov) = det(U)*s1*s2*det(V) = det(U)*s1*s2). Umeyama's correction: flip the second
    // singular direction when that sign is negative, so R = U . diag(1,d) . V^T stays a PROPER
    // rotation (det=+1) — a similarity transform must never mirror the face.
    let det_cov = cov[0][0] * cov[1][1] - cov[0][1] * cov[1][0];
    let d2 = if det_cov < 0.0 { -1.0 } else { 1.0 };
    // R = U . diag(1,d2) . V^T. V^T = [[ct,st],[-st,ct]] given V's column form above.
    let (vt00, vt01, vt10, vt11) = (v[0][0], v[1][0], v[0][1], v[1][1]);
    let (u00, u01, u10, u11) = (u[0][0], u[0][1], u[1][0], u[1][1]);
    let r00 = u00 * vt00 + d2 * u01 * vt10;
    let r01 = u00 * vt01 + d2 * u01 * vt11;
    let r10 = u10 * vt00 + d2 * u11 * vt10;
    let r11 = u10 * vt01 + d2 * u11 * vt11;

    let scale = if sigma_src2 > 1e-12 { (s1 + d2 * s2) / sigma_src2 } else { 1.0 };
    let (m00, m01, m10, m11) = (scale * r00, scale * r01, scale * r10, scale * r11);
    let tx = mu_dst.0 - (m00 * mu_src.0 + m01 * mu_src.1);
    let ty = mu_dst.1 - (m10 * mu_src.0 + m11 * mu_src.1);
    [[m00, m01, tx], [m10, m11, ty]]
}

/// Inverts a 2x3 affine `[[a,b,tx],[c,d,ty]]` (as a 3x3 with an implicit [0,0,1] row).
fn invert_affine(m: [[f64; 3]; 2]) -> [[f64; 3]; 2] {
    let (a, b, tx) = (m[0][0], m[0][1], m[0][2]);
    let (c, d, ty) = (m[1][0], m[1][1], m[1][2]);
    let det = a * d - b * c;
    let inv_det = if det.abs() > 1e-12 { 1.0 / det } else { 0.0 };
    let (ia, ib) = (d * inv_det, -b * inv_det);
    let (ic, id) = (-c * inv_det, a * inv_det);
    let itx = -(ia * tx + ib * ty);
    let ity = -(ic * tx + id * ty);
    [[ia, ib, itx], [ic, id, ity]]
}

/// Warps `rgb` (w x h, interleaved RGB8) into a FACE_SIZE x FACE_SIZE aligned crop via backward
/// mapping (sample the source at each destination pixel's mapped location) with bilinear
/// interpolation — avoids the holes a forward warp would leave. Out-of-bounds samples are
/// clamped to the nearest edge pixel rather than zero-filled, since InsightFace's own alignment
/// occasionally maps a template point slightly outside a tight detection crop.
fn warp_align(rgb: &[u8], w: u32, h: u32, kps: &[(f32, f32); 5]) -> Vec<u8> {
    let src_pts: [(f64, f64); 5] = kps.map(|(x, y)| (x as f64, y as f64));
    let m = umeyama_similarity(&src_pts, &ARCFACE_DST);
    let m_inv = invert_affine(m);
    let side = FACE_SIZE as usize;
    let mut out = vec![0u8; side * side * 3];
    let (wf, hf) = (w as f64, h as f64);
    for oy in 0..side {
        for ox in 0..side {
            let (dx, dy) = (ox as f64, oy as f64);
            let sx = (m_inv[0][0] * dx + m_inv[0][1] * dy + m_inv[0][2]).clamp(0.0, wf - 1.001);
            let sy = (m_inv[1][0] * dx + m_inv[1][1] * dy + m_inv[1][2]).clamp(0.0, hf - 1.001);
            let (x0, y0) = (sx.floor() as u32, sy.floor() as u32);
            let (fx, fy) = (sx - x0 as f64, sy - y0 as f64);
            let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
            let px = |xx: u32, yy: u32, c: usize| -> f64 { rgb[((yy * w + xx) as usize) * 3 + c] as f64 };
            for c in 0..3 {
                let top = px(x0, y0, c) * (1.0 - fx) + px(x1, y0, c) * fx;
                let bot = px(x0, y1, c) * (1.0 - fx) + px(x1, y1, c) * fx;
                let v = top * (1.0 - fy) + bot * fy;
                out[(oy * side + ox) * 3 + c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Embeds one face given the FULL decoded image and that face's 5 landmarks (both in the same
/// pixel-coordinate space, e.g. `scrfd::Face`'s own output) — aligns via `warp_align`, then runs
/// the model. Returns an L2-normalized 512-dim embedding, so a plain Euclidean distance between
/// two embeddings is monotonic with cosine distance (`||a-b||^2 = 2 - 2*cos(a,b)` for unit
/// vectors) — this is what lets Phase B's DBSCAN clustering use its default L2 metric unmodified
/// rather than needing a custom cosine distance.
pub fn embed(rgb: &[u8], w: u32, h: u32, kps: &[(f32, f32); 5]) -> Result<Vec<f32>, String> {
    if w == 0 || h == 0 {
        return Err("arcface: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("arcface: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }
    let aligned = warp_align(rgb, w, h, kps);
    let side = FACE_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let src = (y * side + x) * 3;
            for c in 0..3 {
                let v = (aligned[src + c] as f32 - MEAN) / STD;
                pixels[c * side * side + y * side + x] = v;
            }
        }
    }

    let sess = session()?;
    // Output tensor name verified against the real downloaded .onnx via onnx.load() — "683" for
    // w600k_r50.onnx specifically (this graph's own internal numbering, not a stable contract —
    // if the vendored model file is ever swapped, re-verify with `onnx.load()` before assuming).
    let mut outputs = run_session(sess, vec![input("input.1", pixels, &[1, 3, FACE_SIZE as i64, FACE_SIZE as i64])], &["683"])?;
    let mut emb = outputs.remove(0);
    if emb.len() != 512 {
        return Err(format!("arcface: unexpected embedding length {} (expected 512)", emb.len()));
    }
    let norm = emb.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 1e-12 {
        for v in emb.iter_mut() {
            *v /= norm;
        }
    }
    Ok(emb)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// If the "detected" landmarks are already exactly at ARCFACE_DST's own positions, the
    /// estimated similarity transform must be (very close to) the identity — no rotation, unit
    /// scale, zero translation. This is the sanity check that catches a sign/axis error in the
    /// SVD-based Umeyama derivation without needing a real face or the (174MB, not always
    /// present) model file.
    #[test]
    fn identity_landmarks_produce_the_identity_transform() {
        let src = ARCFACE_DST;
        let m = umeyama_similarity(&src, &ARCFACE_DST);
        assert!((m[0][0] - 1.0).abs() < 1e-6, "m00 should be ~1, got {}", m[0][0]);
        assert!(m[0][1].abs() < 1e-6, "m01 should be ~0, got {}", m[0][1]);
        assert!(m[1][0].abs() < 1e-6, "m10 should be ~0, got {}", m[1][0]);
        assert!((m[1][1] - 1.0).abs() < 1e-6, "m11 should be ~1, got {}", m[1][1]);
        assert!(m[0][2].abs() < 1e-6, "tx should be ~0, got {}", m[0][2]);
        assert!(m[1][2].abs() < 1e-6, "ty should be ~0, got {}", m[1][2]);
    }

    /// A pure translation of all 5 points must recover a transform with no rotation/scale change,
    /// just the corresponding translation — a second independent check on the same derivation.
    #[test]
    fn translated_landmarks_produce_a_pure_translation() {
        let (dx, dy) = (10.0, -5.0);
        let src: [(f64, f64); 5] = ARCFACE_DST.map(|(x, y)| (x + dx, y + dy));
        let m = umeyama_similarity(&src, &ARCFACE_DST);
        assert!((m[0][0] - 1.0).abs() < 1e-6);
        assert!((m[1][1] - 1.0).abs() < 1e-6);
        assert!((m[0][2] - (-dx)).abs() < 1e-6, "tx should undo the translation, got {}", m[0][2]);
        assert!((m[1][2] - (-dy)).abs() < 1e-6, "ty should undo the translation, got {}", m[1][2]);
    }

    /// A uniformly scaled-and-rotated set of points must recover that exact scale and rotation
    /// (checked via the recovered matrix's implied scale = sqrt(det) and its orthogonality).
    #[test]
    fn scaled_rotated_landmarks_recover_scale_and_orthogonality() {
        let scale = 1.4;
        let theta = 0.3f64;
        let (ct, st) = (theta.cos(), theta.sin());
        let src: [(f64, f64); 5] = ARCFACE_DST.map(|(x, y)| (scale * (ct * x - st * y), scale * (st * x + ct * y)));
        let m = umeyama_similarity(&src, &ARCFACE_DST);
        // Recovered forward map (dst <- src) should have determinant ~ 1/scale^2 since it undoes
        // the forward scale — check via inverse instead: invert_affine(m) maps DST->SRC and
        // should carry the original `scale` and rotation.
        let inv = invert_affine(m);
        let det = inv[0][0] * inv[1][1] - inv[0][1] * inv[1][0];
        assert!((det.sqrt() - scale).abs() < 1e-4, "recovered scale should be {scale}, det.sqrt()={}", det.sqrt());
        // Orthogonality: (R^T R) should be scale^2 * I for a pure similarity, i.e. m00^2+m10^2 ==
        // m01^2+m11^2 and m00*m01+m10*m11 == 0.
        let col0 = inv[0][0].powi(2) + inv[1][0].powi(2);
        let col1 = inv[0][1].powi(2) + inv[1][1].powi(2);
        assert!((col0 - col1).abs() < 1e-6, "columns should have equal norm (no shear), got {col0} vs {col1}");
        let dot = inv[0][0] * inv[0][1] + inv[1][0] * inv[1][1];
        assert!(dot.abs() < 1e-6, "columns should be orthogonal (no shear), dot={dot}");
    }

    fn setup_model() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
        set_model_path(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/arcface/w600k_r50.onnx"));
    }

    /// End-to-end: embeds a plain synthetic image (no real face) purely to prove the model loads,
    /// runs, and returns a 512-dim L2-normalized vector without error — real embedding QUALITY is
    /// out of scope for a unit test (no ground-truth face pairs are checked into this repo); it
    /// is exercised in Phase B's clustering integration instead.
    #[test]
    fn embed_runs_and_returns_a_unit_vector() {
        setup_model();
        let (w, h) = (200u32, 200u32);
        let rgb = vec![100u8; (w * h * 3) as usize];
        // A plausible-looking 5-point layout so warp_align's transform is well-conditioned.
        let kps = [(70.0f32, 80.0), (130.0, 80.0), (100.0, 110.0), (75.0, 140.0), (125.0, 140.0)];
        let emb = embed(&rgb, w, h, &kps).expect("embed run");
        assert_eq!(emb.len(), 512);
        let norm: f32 = emb.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "embedding should be L2-normalized, norm={norm}");
    }
}
