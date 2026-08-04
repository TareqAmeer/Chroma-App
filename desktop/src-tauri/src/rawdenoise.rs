// High-tier RAW noise reduction: RawNIND UtNet2 (darktable 5.6's `rawdenoise-nind`), a 4-pool
// U-Net trained on real camera raw noise/clean pairs (the RawNIND dataset — not synthetic
// noise). GPL-3.0 model weights — see vendor/rawdenoise/README.md for full provenance; the
// top-level LICENSE and README/Guide credits exist specifically because of this file. Loaded via
// the SAME raw ONNX Runtime C API plumbing sam.rs already proved out on this Intel Mac (see
// sam.rs's top-of-file comment for why the `ort` crate itself is avoided) — this module is
// deliberately thin and delegates session creation/inference to sam::create_session_from_path /
// sam::run_session rather than re-deriving that FFI.
//
// Phase 1 ships ONLY `model_linear.onnx` (denoise, does not demosaic), run AFTER this app's own
// PPG demosaic — see raw_decode.rs's insertion-point comment for why (in short: the Bayer
// variant REPLACES demosaic entirely, and every downstream pass — false-color suppression,
// defringe, the fast/refine two-phase demosaic cache — is calibrated around PPG's specific
// output; swapping the whole demosaic step is a bigger, riskier change than adding a denoise
// pass, so `model_bayer.onnx` is deferred to a later phase that evaluates it on its own. See
// `denoise_tile_bayer` below, which exists and is tested but not yet wired into the pipeline).
//
// I/O contract (verified against the actual downloaded .onnx files — no `onnx` Python package
// was available on this dev machine, so this was checked via `strings` for the literal graph
// input/output names plus a hand-rolled protobuf wire-format walk of GraphProto for exact
// dtype/shape; both independently confirmed and cross-checked against the model's own
// config.json). Full detail in vendor/rawdenoise/README.md.
//   model_linear: input "input" f32 [1,3,512,512] linear Rec.2020 -> output "output" f32
//                 [1,3,512,512], same space, arbitrary gain ("output_scale": "match_gain").
//   model_bayer:  input "input" f32 [1,4,512,512] packed RGGB Bayer -> output "output" f32
//                 [1,3,1024,1024] (2x upsample baked in — denoise + demosaic in one step).

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::sam::{self, SamSession};

/// Static tile size baked into both ONNX exports (`config.json`'s `"input_sizes": [512]`).
pub const TILE: usize = 512;
/// Overlap consumed at each tile edge before the interior is kept and stitched. The model's own
/// "mirror_cropped" edge-padding convention means the outermost pixels of a tile are influenced
/// by mirrored padding rather than real neighbouring content; discard that band rather than
/// trust it, matching the halo-and-crop pattern this codebase already uses for tiled export
/// (chromasmith-22.html's renderTiled, halo >= 3*sigma) and for the halation/bloom blur radius.
pub const HALO: usize = 32;
/// Stride between tile origins so that, after discarding HALO on every edge, adjacent kept
/// interiors are contiguous with no gap and no overlap.
pub const STEP: usize = TILE - 2 * HALO; // 448

static LINEAR_MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();
static BAYER_MODEL_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Must run once (from main.rs's app `.setup()`, resolving a bundled resource path — same
/// pattern as sam::set_sam2_model_paths) before any High-tier NR call.
pub fn set_model_paths(linear_path: PathBuf, bayer_path: PathBuf) {
    let _ = LINEAR_MODEL_PATH.set(linear_path);
    let _ = BAYER_MODEL_PATH.set(bayer_path);
}

/// Like sam::create_session_from_path, but also tunes intra-op threading — the ORT default is
/// not tuned for a ~30MB conv net run tile-by-tile on a 4-core Intel Mac, and this is the
/// single cheapest large speedup available (measured: see examples/denoise_probe.rs's timing
/// section for the before/after this was added). Duplicated here rather than added to
/// sam::create_session_from_path so SAM's own (already-tuned-by-omission, working) session
/// creation is untouched by this change.
fn create_session_threaded(path: &std::path::Path, intra_op_threads: i32) -> Result<SamSession, String> {
    let h = sam::ort_handle()?;
    let path_c = std::ffi::CString::new(path.to_str().ok_or_else(|| format!("non-UTF8 model path: {}", path.display()))?)
        .map_err(|e| format!("model path has embedded NUL: {e}"))?;
    unsafe {
        let mut opts: *mut ort_sys::OrtSessionOptions = std::ptr::null_mut();
        sam::check(h.api, ((*h.api).CreateSessionOptions)(&mut opts), "CreateSessionOptions")?;
        let thread_res = sam::check(h.api, ((*h.api).SetIntraOpNumThreads)(opts, intra_op_threads), "SetIntraOpNumThreads");
        if let Err(e) = thread_res {
            eprintln!("rawdenoise: SetIntraOpNumThreads failed (continuing with ORT default): {e}");
        }
        let mut session: *mut ort_sys::OrtSession = std::ptr::null_mut();
        let res = sam::check(h.api, ((*h.api).CreateSession)(h.env, path_c.as_ptr(), opts, &mut session), "CreateSession");
        ((*h.api).ReleaseSessionOptions)(opts);
        res?;
        Ok(SamSession(session))
    }
}

fn linear_session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = LINEAR_MODEL_PATH
            .get()
            .ok_or("rawdenoise: linear model path not set — set_model_paths() must run before any High-tier NR use")?;
        create_session_threaded(path, num_cpus_physical()).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

#[allow(dead_code)] // exercised by examples/denoise_probe.rs; wired into the pipeline in the Bayer-variant evaluation phase (A4)
fn bayer_session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = BAYER_MODEL_PATH
            .get()
            .ok_or("rawdenoise: bayer model path not set — set_model_paths() must run before any High-tier NR use")?;
        create_session_threaded(path, num_cpus_physical()).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Physical core count, best-effort (falls back to a conservative 4 — this dev machine's real
/// count — if the OS query fails). Deliberately physical, not logical/hyperthreaded: intra-op
/// conv workloads on this kind of net don't benefit from SMT the way I/O-bound work does, and
/// oversubscribing invites cache thrashing across tiles more than it buys throughput.
fn num_cpus_physical() -> i32 {
    std::thread::available_parallelism().map(|n| (n.get() as i32 / 2).max(1)).unwrap_or(4)
}

fn hwc_to_chw(hwc: &[f32], side: usize, channels: usize) -> Vec<f32> {
    let mut chw = vec![0f32; hwc.len()];
    for y in 0..side {
        for x in 0..side {
            for c in 0..channels {
                chw[c * side * side + y * side + x] = hwc[(y * side + x) * channels + c];
            }
        }
    }
    chw
}

fn chw_to_hwc(chw: &[f32], side: usize, channels: usize) -> Vec<f32> {
    let mut hwc = vec![0f32; chw.len()];
    for y in 0..side {
        for x in 0..side {
            for c in 0..channels {
                hwc[(y * side + x) * channels + c] = chw[c * side * side + y * side + x];
            }
        }
    }
    hwc
}

/// Runs ONE 512x512x3 linear-Rec.2020 tile through the denoise-only model. `tile_hwc` is
/// interleaved RGB (matching this codebase's usual convention), converted to CHW for the
/// model's input and back for the caller. Output is at the model's own arbitrary learned gain —
/// NOT rescaled here. Gain matching must happen once over the whole frame in the caller (see
/// the module doc and denoise_linear_frame in a later phase); doing it per tile produces visible
/// tile-boundary blocking, the same failure mode CLAUDE.md's Skin Tone section (`srcV`) documents
/// for exactly this reason.
pub fn denoise_tile_linear(tile_hwc: &[f32]) -> Result<Vec<f32>, String> {
    let expected = TILE * TILE * 3;
    if tile_hwc.len() != expected {
        return Err(format!("denoise_tile_linear: expected {expected} floats, got {}", tile_hwc.len()));
    }
    let chw = hwc_to_chw(tile_hwc, TILE, 3);
    let sess = linear_session()?;
    let inputs = vec![sam::input_ref("input", &chw, &[1, 3, TILE as i64, TILE as i64])];
    let outputs = sam::run_session(sess, inputs, &["output"])?;
    let out_chw = outputs.into_iter().next().ok_or_else(|| "rawdenoise: model produced no output tensor".to_string())?;
    if out_chw.len() != expected {
        return Err(format!("rawdenoise: unexpected output length {} (expected {expected})", out_chw.len()));
    }
    Ok(chw_to_hwc(&out_chw, TILE, 3))
}

/// Runs ONE 512x512x4 packed-RGGB-Bayer tile through the joint denoise+demosaic model, returning
/// a 1024x1024x3 HWC RGB tile at the model's own arbitrary gain. NOT wired into the pipeline yet
/// (see module doc) — exists so examples/denoise_probe.rs can measure and sanity-check it
/// alongside the linear variant ahead of the phase that evaluates replacing PPG with it.
#[allow(dead_code)]
pub fn denoise_tile_bayer(tile_hwc_rggb: &[f32]) -> Result<Vec<f32>, String> {
    let in_expected = TILE * TILE * 4;
    if tile_hwc_rggb.len() != in_expected {
        return Err(format!("denoise_tile_bayer: expected {in_expected} floats, got {}", tile_hwc_rggb.len()));
    }
    let chw = hwc_to_chw(tile_hwc_rggb, TILE, 4);
    let sess = bayer_session()?;
    let inputs = vec![sam::input_ref("input", &chw, &[1, 4, TILE as i64, TILE as i64])];
    let outputs = sam::run_session(sess, inputs, &["output"])?;
    let out_chw = outputs.into_iter().next().ok_or_else(|| "rawdenoise: model produced no output tensor".to_string())?;
    let out_side = TILE * 2;
    let out_expected = out_side * out_side * 3;
    if out_chw.len() != out_expected {
        return Err(format!("rawdenoise: unexpected bayer-model output length {} (expected {out_expected})", out_chw.len()));
    }
    Ok(chw_to_hwc(&out_chw, out_side, 3))
}

/// Mean of the R/G/B channels over an interleaved-RGB buffer — used both sides of a gain match
/// (measure once on the untouched frame, once on the denoised frame, scale by the ratio). Public
/// so examples/denoise_probe.rs and the eventual full-frame denoiser can share one definition.
pub fn mean_rgb(hwc: &[f32]) -> f32 {
    if hwc.is_empty() {
        return 0.0;
    }
    hwc.iter().sum::<f32>() / hwc.len() as f32
}

// ── Colour space: camera linear RGB <-> linear Rec.2020 ─────────────────────────────────────
//
// The model wants linear Rec.2020 ("input_colorspace":"lin_rec2020" in config.json); this app's
// native decode produces linear CAMERA RGB (WB applied, not yet colour-managed — the existing JS
// DCP pipeline in chromasmith-22.html does that colour management for the main image, entirely
// unchanged by this feature). rawler resolves each RAW file's own XYZ(D50)->camera matrix
// (RawImage.xyz_to_cam, rows 0..3 — the 4th RGBE row is unused on this 3-channel Bayer sensor) —
// that's threaded through from raw_decode.rs's decode_and_demosaic. Chain: invert it to get
// camera->XYZ(D50), Bradford-adapt D50->D65 (DNG's PCS is always D50; RGB working spaces are
// conventionally D65-referenced), then XYZ(D65)->Rec.2020. All three steps are simple 3x3s, so
// they compose into one matrix and its exact inverse restores the original camera RGB.
//
// Verified (examples/denoise_probe.rs, §A6 step 1): a stand-in sRGB-D65 "camera" matrix chained
// through this exact same code round-trips to <1 LSB (16-bit) — the matrix-composition/inversion
// CODE is correct; only the real per-file `xyz_to_cam` values are new at the call site.
pub type Mat3 = [[f32; 3]; 3];

fn mat3_mul(a: Mat3, b: Mat3) -> Mat3 {
    let mut out = [[0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    out
}

fn mat3_inv(m: Mat3) -> Mat3 {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let inv_det = 1.0 / det;
    [
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det
        ],
    ]
}

pub fn mat3_apply(m: Mat3, rgb: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * rgb[0] + m[0][1] * rgb[1] + m[0][2] * rgb[2],
        m[1][0] * rgb[0] + m[1][1] * rgb[1] + m[1][2] * rgb[2],
        m[2][0] * rgb[0] + m[2][1] * rgb[1] + m[2][2] * rgb[2],
    ]
}

/// Bruce Lindbloom's published Bradford-method D50->D65 chromatic adaptation matrix (widely
/// republished, e.g. by the colour-science project and multiple ICC references) — DNG's PCS is
/// always D50; RGB working spaces (Rec.2020 here) are conventionally specified at D65.
const BRADFORD_D50_TO_D65: Mat3 =
    [[0.9555766, -0.0230393, 0.0631636], [-0.0282895, 1.0099416, 0.0210077], [0.0122982, -0.0204830, 1.3299098]];

/// Standard Rec.2020 (D65-referenced) RGB -> XYZ primaries matrix (ITU-R BT.2020).
const REC2020_TO_XYZ_D65: Mat3 =
    [[0.6369580, 0.1446169, 0.1688810], [0.2627002, 0.6779981, 0.0593017], [0.0000000, 0.0280727, 1.0609851]];

/// Builds (camera->linRec2020, linRec2020->camera) from a shot's resolved XYZ(D50)->camera
/// matrix (rawler's `RawImage.xyz_to_cam`, first 3 rows). The inverse is EXACT (matrix inverse
/// of the forward composition), not a separately-derived matrix, so round-tripping with
/// inference bypassed reproduces the source to floating-point precision.
pub fn camera_rec2020_matrices(xyz_to_cam: Mat3) -> (Mat3, Mat3) {
    let cam_to_xyz_d50 = mat3_inv(xyz_to_cam);
    let xyz_to_rec2020 = mat3_inv(REC2020_TO_XYZ_D65);
    let fwd = mat3_mul(xyz_to_rec2020, mat3_mul(BRADFORD_D50_TO_D65, cam_to_xyz_d50));
    let inv = mat3_inv(fwd);
    (fwd, inv)
}

// ── Full-frame tiled denoise (High tier) ─────────────────────────────────────────────────────

/// Per-channel (R,G,B) mean and standard deviation over an interleaved HWC f32 buffer.
/// ⚠️ Skips non-finite (NaN/Inf) samples rather than including them in the sum — a real-photo
/// tile can push the raw (un-gain-matched) model output to an extreme value the network wasn't
/// well-conditioned for (found via examples/denoise_probe.rs's synthetic-only testing NOT
/// catching this: real high-dynamic-range/high-contrast content did). A SINGLE NaN/Inf pixel in
/// an f64 running sum poisons the WHOLE frame's mean/std (NaN propagates through +=), which then
/// makes every pixel's gain-matched value NaN, which Rust's `as u16` cast silently turns into 0
/// — an entirely black frame with no error raised. Filtering here is the fix at the point where
/// the poisoning actually happens; denoise_frame_high additionally guards the PER-PIXEL result
/// (falls back to the original pixel) so an individual bad pixel/tile stays local instead of
/// corrupting its neighbours' correct output.
fn channel_stats(hwc: &[f32], n_px: usize) -> ([f32; 3], [f32; 3]) {
    let mut sum = [0f64; 3];
    let mut n_ok = [0u64; 3];
    let mut n_bad = 0u64;
    for px in hwc.chunks_exact(3) {
        for c in 0..3 {
            if px[c].is_finite() {
                sum[c] += px[c] as f64;
                n_ok[c] += 1;
            } else {
                n_bad += 1;
            }
        }
    }
    if n_bad > 0 {
        eprintln!("rawdenoise: channel_stats skipped {n_bad} non-finite sample(s) out of {} (per-channel)", n_px * 3);
    }
    let mean = [
        sum[0] / n_ok[0].max(1) as f64,
        sum[1] / n_ok[1].max(1) as f64,
        sum[2] / n_ok[2].max(1) as f64
    ];
    let mut sq = [0f64; 3];
    for px in hwc.chunks_exact(3) {
        for c in 0..3 {
            if px[c].is_finite() {
                sq[c] += (px[c] as f64 - mean[c]).powi(2);
            }
        }
    }
    (
        [mean[0] as f32, mean[1] as f32, mean[2] as f32],
        [
            (sq[0] / n_ok[0].max(1) as f64).sqrt() as f32,
            (sq[1] / n_ok[1].max(1) as f64).sqrt() as f32,
            (sq[2] / n_ok[2].max(1) as f64).sqrt() as f32
        ]
    )
}

/// Denoises a full linear-camera-RGB u16 interleaved frame with the High-tier model. Tiles at
/// 512px with a 32px halo per edge (mirror-padded at the frame boundary, matching the model's
/// own "mirror_cropped" edge convention), converts each tile into linear Rec.2020 via
/// `camera_rec2020_matrices`, runs inference, and stitches the CROPPED interiors into a
/// full-frame buffer — so the halo never contributes a seam, only context.
///
/// Gain matching: `"output_scale":"match_gain"` in the model's own config.json turned out, on
/// inspection (examples/denoise_probe.rs), to need a SIGN-CORRECTED per-channel affine match,
/// not a scalar ratio — verified empirically: standardizing the raw model output and rescaling
/// it directly onto the input's own mean/std gave -0.99 correlation with the input (i.e. clean
/// but INVERTED structure); negating that standardized value before rescaling flips correlation
/// to +0.99 and produces coherent per-pixel output. This is computed ONCE per channel over the
/// WHOLE frame (not per tile) — a per-tile gain match would give each tile a different scale and
/// show as visible tile-boundary blocking, the exact failure mode CLAUDE.md's Skin Tone section
/// documents for `srcV` re-measured per export tile.
///
/// `progress(done_rows, total_rows)` and `cancel` (checked once per tile ROW, so a full row's
/// remaining tiles still run before a cancel takes effect — same tradeoff as the row-by-row
/// design elsewhere in this codebase) are both optional.
///
/// `strength` (0.0-1.0) blends the denoised result back toward the ORIGINAL pixel in linear
/// camera space — added after real-photo review (5 ISO 12800 shots vs DxO PureRAW, see the
/// denoiser design doc's process notes) found the model smooths fine curvilinear detail (thin
/// hair/fur strands) more aggressively than DxO, even though flat-noise removal is comparably
/// strong or better. That defect is invisible to a flat-patch statistical validator BY
/// CONSTRUCTION (patches are deliberately picked in low-texture regions) — it only showed up
/// on a real pixel-level crop, the exact blind spot CLAUDE.md's halation work already
/// documents for point-sample metrics. A full-strength model is a fixed, un-tunable network;
/// blending is the standard mitigation (same idea as Lightroom/Topaz's Denoise "Amount")
/// rather than trying to make the network itself detail-preserving. `strength<=0` short-
/// circuits before running any tile inference (a real perf win, not just correctness — no
/// point paying 25-90s for a result that's discarded).
pub fn denoise_frame_high(
    rgb16: &[u16],
    w: usize,
    h: usize,
    xyz_to_cam: Mat3,
    strength: f32,
    progress: Option<&(dyn Fn(usize, usize) + Sync)>,
    cancel: Option<&std::sync::atomic::AtomicBool>
) -> Result<Vec<u16>, String> {
    let strength = strength.clamp(0.0, 1.0);
    if strength <= 0.0 {
        return Ok(rgb16.to_vec());
    }
    let (fwd, inv) = camera_rec2020_matrices(xyz_to_cam);
    let n_px = w * h;

    // camera u16 -> linear Rec.2020 f32, whole frame.
    let mut lin_rec2020 = vec![0f32; n_px * 3];
    for i in 0..n_px {
        let cam = [rgb16[i * 3] as f32 / 65535.0, rgb16[i * 3 + 1] as f32 / 65535.0, rgb16[i * 3 + 2] as f32 / 65535.0];
        let r2020 = mat3_apply(fwd, cam);
        lin_rec2020[i * 3] = r2020[0];
        lin_rec2020[i * 3 + 1] = r2020[1];
        lin_rec2020[i * 3 + 2] = r2020[2];
    }

    // Sample-at pixel with mirror (reflect) padding outside [0,w)x[0,h) — matches the model's
    // own "mirror_cropped" edge convention, so frame-edge tiles are padded the same way the
    // model itself pads internally, not with an arbitrary/inconsistent choice.
    let mirror = |v: i64, len: usize| -> usize {
        let len = len as i64;
        let mut v = v;
        if v < 0 {
            v = -v - 1;
        }
        if v >= len {
            v = 2 * len - v - 1;
        }
        v.clamp(0, len - 1) as usize
    };

    let mut raw_out = vec![0f32; n_px * 3]; // model's raw (un-gain-matched) output, stitched
    let rows = (h + STEP - 1) / STEP;
    let cols = (w + STEP - 1) / STEP;

    'rows: for ty in 0..rows {
        if let Some(c) = cancel {
            if c.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
        }
        for tx in 0..cols {
            let origin_y = (ty * STEP) as i64 - HALO as i64;
            let origin_x = (tx * STEP) as i64 - HALO as i64;
            let mut tile = vec![0f32; TILE * TILE * 3];
            for ly in 0..TILE {
                let sy = mirror(origin_y + ly as i64, h);
                for lx in 0..TILE {
                    let sx = mirror(origin_x + lx as i64, w);
                    let src = (sy * w + sx) * 3;
                    let dst = (ly * TILE + lx) * 3;
                    tile[dst] = lin_rec2020[src];
                    tile[dst + 1] = lin_rec2020[src + 1];
                    tile[dst + 2] = lin_rec2020[src + 2];
                }
            }
            let out_tile = denoise_tile_linear(&tile)?;
            // Keep only the interior [HALO, TILE-HALO) — the halo is context for the model's
            // receptive field, not trustworthy output (mirror-padding artefacts at the frame
            // edge; ordinary tile-seam softness elsewhere).
            let keep_y0 = ty * STEP;
            let keep_x0 = tx * STEP;
            let keep_h = STEP.min(h.saturating_sub(keep_y0));
            let keep_w = STEP.min(w.saturating_sub(keep_x0));
            for ly in 0..keep_h {
                for lx in 0..keep_w {
                    let local = ((ly + HALO) * TILE + (lx + HALO)) * 3;
                    let dst = ((keep_y0 + ly) * w + (keep_x0 + lx)) * 3;
                    raw_out[dst] = out_tile[local];
                    raw_out[dst + 1] = out_tile[local + 1];
                    raw_out[dst + 2] = out_tile[local + 2];
                }
            }
            if tx == cols - 1 {
                if let Some(p) = progress {
                    p(ty + 1, rows);
                }
            }
            if cancel.map(|c| c.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false) {
                break 'rows;
            }
        }
    }
    if cancel.map(|c| c.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false) {
        return Err("cancelled".to_string());
    }

    let (imean, istd) = channel_stats(&lin_rec2020, n_px);
    let (omean, ostd) = channel_stats(&raw_out, n_px);

    let mut result = vec![0u16; n_px * 3];
    let mut n_fallback = 0u64;
    for i in 0..n_px {
        let mut matched = [0f32; 3];
        for c in 0..3 {
            let raw = raw_out[i * 3 + c];
            matched[c] = imean[c] - (raw - omean[c]) / ostd[c].max(1e-8) * istd[c];
        }
        let cam = mat3_apply(inv, matched);
        // Fall back to the ORIGINAL (un-denoised) pixel if this individual pixel came out
        // non-finite — the safest possible degradation (this one pixel keeps its noise instead
        // of the whole image going black; see channel_stats' doc comment for why this can
        // happen on real high-contrast content even after the global-stats fix above).
        if cam[0].is_finite() && cam[1].is_finite() && cam[2].is_finite() {
            // Blend toward the original in LINEAR light (physically correct mixing point, and
            // the same space the original u16 values are already in) — see the strength
            // parameter's doc comment for why this exists.
            let orig = [rgb16[i * 3] as f32 / 65535.0, rgb16[i * 3 + 1] as f32 / 65535.0, rgb16[i * 3 + 2] as f32 / 65535.0];
            let blended = [
                orig[0] * (1.0 - strength) + cam[0] * strength,
                orig[1] * (1.0 - strength) + cam[1] * strength,
                orig[2] * (1.0 - strength) + cam[2] * strength
            ];
            result[i * 3] = (blended[0].clamp(0.0, 1.0) * 65535.0).round() as u16;
            result[i * 3 + 1] = (blended[1].clamp(0.0, 1.0) * 65535.0).round() as u16;
            result[i * 3 + 2] = (blended[2].clamp(0.0, 1.0) * 65535.0).round() as u16;
        } else {
            result[i * 3] = rgb16[i * 3];
            result[i * 3 + 1] = rgb16[i * 3 + 1];
            result[i * 3 + 2] = rgb16[i * 3 + 2];
            n_fallback += 1;
        }
    }
    if n_fallback > 0 {
        eprintln!("rawdenoise: {n_fallback} pixel(s) of {n_px} fell back to their original (un-denoised) value (non-finite model output)");
    }
    Ok(result)
}
