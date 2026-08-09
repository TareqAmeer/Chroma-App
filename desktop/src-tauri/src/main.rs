// Chromasmith desktop shell — a thin native wrapper around the single-file web app
// (chromasmith-22.html, staged into dist/ unmodified by build-desktop.sh). No app logic
// lives here: this only wires OS-level integration (native menu bar, file dialogs) on top.
// The frontend listens for the "menu-*" events emitted below (see desktop-native.js) and
// calls the SAME JS functions the on-screen buttons already call — no duplicated logic.
use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

// DEV-ITERATION MODE: read dist/ straight off disk on every request instead of embedding it
// into the binary at compile time. include_dir!'s compile-time byte-literal embedding of the
// ~7MB dist/ folder made every JS/HTML-only tweak force an 10+ minute full Rust rebuild — far
// too slow while the native RAW pipeline is still being iterated on. Resolved once at startup
// (see DIST_DIR_RESOLVED/dist_dir below, set from .setup()) instead of a compile-time constant:
// prefers the bundled "dist" resource (declared in tauri.conf.json's bundle.resources, same
// pattern as the onnxruntime dylib below) so a packaged .app is portable to any Mac, and falls
// back to $CARGO_MANIFEST_DIR/dist for `cargo tauri dev` — a path relative to wherever THIS repo
// is checked out, not hardcoded to one specific dev machine.
static DIST_DIR_RESOLVED: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
fn dist_dir() -> PathBuf {
    DIST_DIR_RESOLVED
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("dist"))
}

mod lens_correct;
mod library;
mod raw_decode;
mod faceparse;
mod sam;
mod rawdenoise;
mod tiff_meta;
#[cfg(target_os = "macos")]
mod gainmap;

/// Minimal percent-decoder for request paths (e.g. "%20" -> " "). No crate needed for this.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ── Native RW2 decode + develop, no base64 anywhere ─────────────────────────────────────
// (see raw_decode.rs for why native: WKWebView's SharedArrayBuffer support isn't reliable
// enough for the browser build's libraw-wasm decoder in this shell.)
//
// The JS side bakes the DCP color transform into a 65^3 LUT once per profile (bakeDcpLUT)
// and registers it here; each decode then runs entirely in Rust — rawler decode + PPG
// demosaic + rayon-parallel LUT apply — and returns display-ready RGBA8. This removed the
// two big costs measured in the old flow: a 24M-pixel trilinear loop on the JS main thread,
// and base64/oversized buffers over IPC (request was a 33MB base64 string; response was
// 145MB of u16 RGB that JS immediately quantized to 8-bit anyway).
//
// Request framing (raw invoke body, no JSON): [u32 jsonLen][json utf8][payload]
//   store_dcp_lut json {"key": "..."}     payload = little-endian f32 LUT data (65^3*3)
//   decode_raw_v2 json {"mode":"lut","lutKey":"..."} or {"mode":"srgb"} or {"mode":"linear16"}
//                 payload = the RW2 file bytes
// decode_raw_v2 response: [u32 w][u32 h][u32 iso][RGBA8 | u16 RGB LE (linear16 mode)]
use std::collections::HashMap;
use std::sync::Mutex;
static DCP_LUTS: Mutex<Option<HashMap<String, std::sync::Arc<Vec<f32>>>>> = Mutex::new(None);

fn parse_framed(body: &tauri::ipc::InvokeBody) -> Result<(serde_json::Value, &[u8]), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = body else {
        return Err("expected raw invoke body".into());
    };
    if bytes.len() < 4 {
        return Err("framed body too short".into());
    }
    let jlen = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
    if bytes.len() < 4 + jlen {
        return Err("framed body truncated".into());
    }
    let json: serde_json::Value =
        serde_json::from_slice(&bytes[4..4 + jlen]).map_err(|e| format!("frame json: {e}"))?;
    Ok((json, &bytes[4 + jlen..]))
}

#[tauri::command]
fn store_dcp_lut(request: tauri::ipc::Request) -> Result<(), String> {
    let (json, payload) = parse_framed(request.body())?;
    let key = json["key"].as_str().ok_or("missing key")?.to_string();
    if payload.len() % 4 != 0 {
        return Err("LUT payload not f32-aligned".into());
    }
    let lut: Vec<f32> = payload
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
        .collect();
    let mut guard = DCP_LUTS.lock().map_err(|_| "DCP LUT cache lock poisoned".to_string())?;
    guard.get_or_insert_with(HashMap::new).insert(key, std::sync::Arc::new(lut));
    Ok(())
}

// ── AI tap-to-select (Masks panel) — see sam.rs for the model I/O contract. A single-slot
// cache: only the CURRENTLY open photo's embedding is ever needed (one photo edited at a time),
// so there's no eviction policy to get wrong — a new sam_encode call for a different photo just
// overwrites it. Keyed by a caller-supplied token (the photo's path) purely to let sam_point
// detect "the photo changed since the last encode" and fail loudly instead of silently
// segmenting the WRONG photo.
struct SamEmbedCache {
    token: String,
    embedding: sam::Embedding,
}
static SAM_EMBED: Mutex<Option<SamEmbedCache>> = Mutex::new(None);

/// Encodes a photo for AI tap-to-select. `token` is any caller-chosen identifier for "which
/// photo is this" (library-ui.js uses the file path) — sam_point checks it matches before using
/// the cached embedding, so switching photos without re-encoding fails safely instead of
/// segmenting stale image data. Takes raw RGB8 bytes (already-decoded, e.g. from the preview
/// canvas) via the framed body — encoding works off whatever resolution the caller hands in
/// (the model resizes internally to 1024 either way), so callers should downsample to a
/// reasonable working size (a few hundred px) themselves rather than sending a full-res RAW.
#[tauri::command]
fn sam_encode(request: tauri::ipc::Request) -> Result<(), String> {
    let (json, payload) = parse_framed(request.body())?;
    let token = json["token"].as_str().ok_or("missing token")?.to_string();
    let w = json["width"].as_u64().ok_or("missing width")? as u32;
    let h = json["height"].as_u64().ok_or("missing height")? as u32;
    if payload.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("sam_encode: payload {} bytes, expected {}x{}x3", payload.len(), w, h));
    }
    let embedding = sam::encode(payload, w, h)?;
    *SAM_EMBED.lock().unwrap() = Some(SamEmbedCache { token, embedding });
    Ok(())
}

#[derive(serde::Serialize)]
struct SamPointResult {
    width: u32,
    height: u32,
}

#[derive(serde::Deserialize)]
struct SamPointIn {
    x: f32,
    y: f32,
    positive: bool
}

/// Runs a multi-point-prompt query (a Lightroom-style "brush over the object" scribble, sampled
/// into points by chromasmith-22.html's mskAiScribble* — NOT a single tap) against the CACHED
/// embedding from the most recent sam_encode call. Returns the mask raster (one byte per pixel,
/// row-major) as the raw response body, plus its dimensions as the JSON header — same
/// framed-response idea as decode_raw_v2, just simpler since there's no variant body format to
/// disambiguate.
#[tauri::command]
fn sam_points(token: String, points: Vec<SamPointIn>) -> Result<tauri::ipc::Response, String> {
    let guard = SAM_EMBED.lock().unwrap();
    let cache = guard.as_ref().ok_or("sam_points: no photo encoded yet — call sam_encode first")?;
    if cache.token != token {
        return Err("sam_points: the encoded photo has changed — re-encode before scribbling".into());
    }
    let pts: Vec<(f32, f32, bool)> = points.iter().map(|p| (p.x, p.y, p.positive)).collect();
    let mask = sam::decode_points(&cache.embedding, &pts)?;
    let header = SamPointResult { width: cache.embedding.orig_w, height: cache.embedding.orig_h };
    let header_bytes = serde_json::to_vec(&header).map_err(|e| format!("sam_points header: {e}"))?;
    let mut out = Vec::with_capacity(4 + header_bytes.len() + mask.len());
    out.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(&header_bytes);
    out.extend_from_slice(&mask);
    Ok(tauri::ipc::Response::new(out))
}

// ── SAM 2.1 (Phase 3 background quality upgrade) — a SEPARATE cache slot from SAM_EMBED above,
// not a replacement: chromasmith-22.html fires sam2_encode in the background right after
// sam_encode (EdgeSAM) returns, so taps/scribbles use whichever embedding is ready — EdgeSAM's
// immediately, SAM 2.1's automatically once its slower encode lands — mirroring the two-phase
// "fast display, background refine" pattern desktop-native.js's NativeLibRawShim.refine() already
// uses for RAW decode. No UI mode toggle: this is meant to be invisible plumbing.
struct Sam2EmbedCache {
    token: String,
    embedding: sam::Sam2Embedding,
}
static SAM2_EMBED: Mutex<Option<Sam2EmbedCache>> = Mutex::new(None);

/// Same contract as sam_encode, backed by SAM 2.1 instead of EdgeSAM — see sam.rs's
/// sam2_encode/sam2_decode_points doc comments for why these need their own cache slot (3 cached
/// tensors instead of 1, different preprocessing).
#[tauri::command]
fn sam2_encode(request: tauri::ipc::Request) -> Result<(), String> {
    let (json, payload) = parse_framed(request.body())?;
    let token = json["token"].as_str().ok_or("missing token")?.to_string();
    let w = json["width"].as_u64().ok_or("missing width")? as u32;
    let h = json["height"].as_u64().ok_or("missing height")? as u32;
    if payload.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("sam2_encode: payload {} bytes, expected {}x{}x3", payload.len(), w, h));
    }
    let embedding = sam::sam2_encode(payload, w, h)?;
    *SAM2_EMBED.lock().unwrap() = Some(Sam2EmbedCache { token, embedding });
    Ok(())
}

/// Same contract as sam_points, against the SAM2_EMBED cache.
#[tauri::command]
fn sam2_points(token: String, points: Vec<SamPointIn>) -> Result<tauri::ipc::Response, String> {
    let guard = SAM2_EMBED.lock().unwrap();
    let cache = guard.as_ref().ok_or("sam2_points: no photo encoded yet — call sam2_encode first")?;
    if cache.token != token {
        return Err("sam2_points: the encoded photo has changed — re-encode before scribbling".into());
    }
    let pts: Vec<(f32, f32, bool)> = points.iter().map(|p| (p.x, p.y, p.positive)).collect();
    let mask = sam::sam2_decode_points(&cache.embedding, &pts)?;
    let header = SamPointResult { width: cache.embedding.orig_w, height: cache.embedding.orig_h };
    let header_bytes = serde_json::to_vec(&header).map_err(|e| format!("sam2_points header: {e}"))?;
    let mut out = Vec::with_capacity(4 + header_bytes.len() + mask.len());
    out.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(&header_bytes);
    out.extend_from_slice(&mask);
    Ok(tauri::ipc::Response::new(out))
}

// ── Face-feature auto-exclusion (ROADMAP item 16) — see faceparse.rs for the model, the class
// mapping and why the originally-quoted class table was wrong. Framed request/response, same
// idiom as sam_encode/sam_points: caller sends an already-cropped RGB8 face region (derived from
// the SAM subject mask's bounding box) + its width/height; response is 4 same-sized alpha masks
// (eyes_brows, glasses, lips, hair), each width*height bytes, concatenated in that fixed order.
#[tauri::command]
fn faceparse_run(request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
    let (json, payload) = parse_framed(request.body())?;
    let w = json["width"].as_u64().ok_or("missing width")? as u32;
    let h = json["height"].as_u64().ok_or("missing height")? as u32;
    if payload.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("faceparse_run: payload {} bytes, expected {}x{}x3", payload.len(), w, h));
    }
    let masks = faceparse::parse(payload, w, h)?;
    #[derive(serde::Serialize)]
    struct Header { width: u32, height: u32 }
    let header = Header { width: masks.w, height: masks.h };
    let header_bytes = serde_json::to_vec(&header).map_err(|e| format!("faceparse_run header: {e}"))?;
    let body_len = header_bytes.len() + masks.eyes_brows.len() + masks.glasses.len() + masks.lips.len() + masks.hair.len();
    let mut out = Vec::with_capacity(4 + body_len);
    out.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(&header_bytes);
    out.extend_from_slice(&masks.eyes_brows);
    out.extend_from_slice(&masks.glasses);
    out.extend_from_slice(&masks.lips);
    out.extend_from_slice(&masks.hair);
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
fn decode_raw_v2(request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
    let (json, payload) = parse_framed(request.body())?;
    let mode = json["mode"].as_str().unwrap_or("linear16");
    let auto_lens = json["autoLens"].as_bool().unwrap_or(false);
    // "off"|"fast" ONLY — decode_raw_v2 is also the Library's thumbnail-decode path, so it must
    // be STRUCTURALLY unable to trigger the ~25-90s neural High tier no matter what a caller
    // sends; High only ever runs via the separate denoise_raw_high command below (see the
    // denoiser design doc §A4). `nativeNr` (bool) is kept as a fallback for any caller still on
    // the pre-tier JS build (desktop-native.js ships both fields for one release — see
    // chromasmith-22.html's applyUISnapshot migration comment).
    let nr = match json["rawNr"].as_str() {
        Some("off") => raw_decode::NrTier::Off,
        Some("fast") => raw_decode::NrTier::Fast,
        Some(other) => {
            eprintln!("decode_raw_v2: rawNr={other:?} not accepted here (High runs via denoise_raw_high) — using Fast");
            raw_decode::NrTier::Fast
        }
        None => {
            if json["nativeNr"].as_bool().unwrap_or(true) {
                raw_decode::NrTier::Fast
            } else {
                raw_decode::NrTier::Off
            }
        }
    };
    // Per-photo "RAW Processing" mode ("" = Standard/PPG, "ahd" = Sparkle-optimized) — see
    // raw_decode.rs's decode_rw2_bytes doc comment for why this is opt-in, not a global default.
    // Validate at the UI boundary: raw_decode.rs's decode_and_demosaic only accepts "" (PPG),
    // "ahd", "vng", "mhc" — any other string used to reach a `panic!` deep inside the demosaic
    // branch and take down the whole process. An unrecognized value here (stale localStorage,
    // future JS typo, etc.) now silently falls back to the standard "" (PPG) algorithm instead.
    let demosaic_algo_raw = json["demosaicAlgo"].as_str().unwrap_or("");
    let demosaic_algo = match demosaic_algo_raw {
        "" | "ahd" | "vng" | "mhc" => demosaic_algo_raw,
        other => {
            eprintln!("decode_raw_v2: unknown demosaicAlgo={other:?} — defaulting to standard (PPG)");
            ""
        }
    };
    // Two-phase decode: `fast=true` skips the false-color-suppression / hue-defringe / native-NR
    // passes (the serial, full-frame CPU work that made RAW opens take up to ~15s) so the shell
    // can display a photo almost immediately, then request a `fast=false` decode of the SAME
    // bytes in the background to silently upgrade to full quality once it lands (see
    // desktop/desktop-native.js's NativeLibRawShim.open()/refine()). Defaults to false so any
    // caller that doesn't set it gets today's unchanged, full-quality-only behavior.
    let fast = json["fast"].as_bool().unwrap_or(false);
    // Manual lens override (see list_lens_profiles below): a "Maker Model" string the user
    // picked from the bundled DB's own lens list, paired with a focal length in mm — for
    // manual/adapted lenses (TTArtisan and similar) that write no lens EXIF at all, so no
    // amount of EXIF fallback can recover a tag the camera never wrote.
    let lens_override = match (json["lensOverride"].as_str(), json["lensOverrideFocal"].as_f64()) {
        (Some(l), Some(f)) if !l.is_empty() && f > 0.0 => Some((l, f as f32)),
        _ => None,
    };
    let decoded = raw_decode::decode_rw2_bytes(payload, auto_lens, nr, demosaic_algo, fast, lens_override)?;
    // The bundled DCP profiles (vendor/dcp/) only cover cameras we actually have .dcp files
    // for (Panasonic DC-S9, Sony DSC-RX100M5 — see vendor/dcp/*.dcp). Applying one to a
    // DIFFERENT sensor's data wouldn't error — it would just silently produce wrong colors (a
    // much worse failure mode than not opening at all). JS already picks the file by detected
    // camera (peek_raw_camera + getDcpLUT's cameraPrefix), so this is a defense-in-depth
    // backstop, not the primary gate. Downgrade an unsupported "lut" request to the plain
    // linear16 body instead; `usedLut` in the header tells JS whether its requested mode was
    // actually honored, since the body FORMAT differs (RGBA8 for lut/srgb vs raw u16 for
    // linear16) and it needs to parse the right one.
    const KNOWN_DCP_MAKES: &[&str] = &["panasonic", "sony"];
    let make_lower = decoded.make.to_lowercase();
    let has_dcp_support = KNOWN_DCP_MAKES.iter().any(|m| make_lower.contains(m));
    let effective_mode = if mode == "lut" && !has_dcp_support { "linear16" } else { mode };
    let used_lut = if effective_mode == "lut" { 1u32 } else { 0u32 };
    let body: Vec<u8> = match effective_mode {
        "lut" => {
            let key = json["lutKey"].as_str().ok_or("missing lutKey")?;
            let lut = {
                let guard = DCP_LUTS.lock().map_err(|_| "DCP LUT cache lock poisoned".to_string())?;
                guard
                    .as_ref()
                    .and_then(|m| m.get(key).cloned())
                    .ok_or_else(|| format!("LUT '{key}' not registered"))?
            };
            let n = (lut.len() / 3) as f64;
            let n = n.cbrt().round() as usize;
            raw_decode::apply_lut_rgba(&decoded.rgb16, &lut, n)?
        }
        "srgb" => raw_decode::srgb_rgba(&decoded.rgb16),
        _ => decoded.rgb16.iter().flat_map(|v| v.to_le_bytes()).collect(),
    };
    let lens_applied: u32 = if decoded.lens_applied { 1 } else { 0 };
    let mut out = Vec::with_capacity(20 + body.len());
    out.extend_from_slice(&decoded.width.to_le_bytes());
    out.extend_from_slice(&decoded.height.to_le_bytes());
    out.extend_from_slice(&decoded.iso.to_le_bytes());
    out.extend_from_slice(&used_lut.to_le_bytes());
    out.extend_from_slice(&lens_applied.to_le_bytes());
    out.extend_from_slice(&body);
    Ok(tauri::ipc::Response::new(out))
}

/// Cancel flags for in-flight denoise_raw_high calls, keyed by the caller-supplied token.
/// Entries are removed by the SAME call that inserted them once it returns (success, error, or
/// cancelled) — cancel_denoise_high only ever flips a flag that may or may not still be there
/// (a token for a call that already finished is a harmless no-op, not an error).
static NR_CANCEL_FLAGS: Mutex<Option<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>> = Mutex::new(None);

/// The High-tier neural RAW denoiser (RawNIND UtNet2 — see rawdenoise.rs), deliberately a
/// SEPARATE command from decode_raw_v2 so the Library's thumbnail-decode path is structurally
/// unable to trigger it (decode_raw_v2 only ever accepts "off"/"fast" — see its own comment).
/// Same framed-request shape and 20-byte response header as decode_raw_v2 so the JS side
/// (desktop-native.js's NativeLibRawShim.denoiseHigh()) can swap the canvas through the exact
/// mechanism refine() already uses. Emits "raw-nr-progress" ({token,done,total}) once per tile
/// row (~15 events at 24MP, not per tile — see the denoiser design doc §A4).
#[tauri::command]
fn denoise_raw_high(app: tauri::AppHandle, request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
    let (json, payload) = parse_framed(request.body())?;
    let token = json["token"].as_str().unwrap_or("").to_string();
    let mode = json["mode"].as_str().unwrap_or("linear16");
    let auto_lens = json["autoLens"].as_bool().unwrap_or(false);
    let demosaic_algo_raw = json["demosaicAlgo"].as_str().unwrap_or("");
    let demosaic_algo = match demosaic_algo_raw {
        "" | "ahd" | "vng" | "mhc" => demosaic_algo_raw,
        other => {
            eprintln!("denoise_raw_high: unknown demosaicAlgo={other:?} — defaulting to standard (PPG)");
            ""
        }
    };
    let lens_override = match (json["lensOverride"].as_str(), json["lensOverrideFocal"].as_f64()) {
        (Some(l), Some(f)) if !l.is_empty() && f > 0.0 => Some((l, f as f32)),
        _ => None
    };
    // Blend-toward-original amount (0-100 from the UI slider, default 100 = full strength for
    // any caller that doesn't send it) — see rawdenoise::denoise_frame_high's doc comment.
    let high_strength = (json["highStrength"].as_f64().unwrap_or(100.0) as f32 / 100.0).clamp(0.0, 1.0);

    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if !token.is_empty() {
        let mut guard = NR_CANCEL_FLAGS.lock().map_err(|_| "NR cancel-flag lock poisoned".to_string())?;
        guard.get_or_insert_with(HashMap::new).insert(token.clone(), cancel.clone());
    }
    let app_for_progress = app.clone();
    let token_for_progress = token.clone();
    let progress = move |done: usize, total: usize| {
        let _ = app_for_progress.emit("raw-nr-progress", &serde_json::json!({"token": token_for_progress, "done": done, "total": total}));
    };

    let result = raw_decode::decode_rw2_bytes_ex(
        payload,
        auto_lens,
        raw_decode::NrTier::High,
        demosaic_algo,
        false, // never the `fast` pass — High is always the full-quality decode
        lens_override,
        high_strength,
        Some(&progress),
        Some(&cancel)
    );

    if !token.is_empty() {
        if let Ok(mut guard) = NR_CANCEL_FLAGS.lock() {
            if let Some(map) = guard.as_mut() {
                map.remove(&token);
            }
        }
    }
    let decoded = result?;

    const KNOWN_DCP_MAKES: &[&str] = &["panasonic", "sony"];
    let make_lower = decoded.make.to_lowercase();
    let has_dcp_support = KNOWN_DCP_MAKES.iter().any(|m| make_lower.contains(m));
    let effective_mode = if mode == "lut" && !has_dcp_support { "linear16" } else { mode };
    let used_lut = if effective_mode == "lut" { 1u32 } else { 0u32 };
    let body: Vec<u8> = match effective_mode {
        "lut" => {
            let key = json["lutKey"].as_str().ok_or("missing lutKey")?;
            let lut = {
                let guard = DCP_LUTS.lock().map_err(|_| "DCP LUT cache lock poisoned".to_string())?;
                guard
                    .as_ref()
                    .and_then(|m| m.get(key).cloned())
                    .ok_or_else(|| format!("LUT '{key}' not registered"))?
            };
            let n = (lut.len() / 3) as f64;
            let n = n.cbrt().round() as usize;
            raw_decode::apply_lut_rgba(&decoded.rgb16, &lut, n)?
        }
        "srgb" => raw_decode::srgb_rgba(&decoded.rgb16),
        _ => decoded.rgb16.iter().flat_map(|v| v.to_le_bytes()).collect()
    };
    let lens_applied: u32 = if decoded.lens_applied { 1 } else { 0 };
    let mut out = Vec::with_capacity(20 + body.len());
    out.extend_from_slice(&decoded.width.to_le_bytes());
    out.extend_from_slice(&decoded.height.to_le_bytes());
    out.extend_from_slice(&decoded.iso.to_le_bytes());
    out.extend_from_slice(&used_lut.to_le_bytes());
    out.extend_from_slice(&lens_applied.to_le_bytes());
    out.extend_from_slice(&body);
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
fn cancel_denoise_high(token: String) {
    if let Ok(guard) = NR_CANCEL_FLAGS.lock() {
        if let Some(map) = guard.as_ref() {
            if let Some(flag) = map.get(&token) {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}

#[tauri::command]
fn lens_profile_available(make: String, model: String, lens_model: String) -> bool {
    lens_correct::profile_available(&make, &model, &lens_model)
}

#[tauri::command]
fn list_lens_profiles() -> Vec<lens_correct::LensProfileEntry> {
    lens_correct::list_lens_profiles()
}

// Open a URL in the user's default system browser. Needed because the WKWebView shell has no
// browser chrome — `window.open()`/`<a target="_blank">` (the Google Photos picker's normal
// web-build fallback chain) silently do nothing here, exactly like the OAuth consent screen
// would if it used the same approach (google_oauth_loopback already spawns `open` for that
// reason). Same fix, generalized: the Photos Picker's "Tap to open" link goes through this too.
#[tauri::command]
fn open_url_native(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("refusing to open a non-http(s) URL".into());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("couldn't open the system browser: {e}"))
}

// Trackpad haptic feedback — hapt() (chromasmith-22.html) previously ONLY fired on
// window.Capacitor (the iOS shell), so the desktop build had zero haptic feedback on slider
// detents/flag toggles/etc despite Macs with a Force Touch trackpad supporting exactly this via
// NSHapticFeedbackManager. .generic is Apple's own "neutral UI event" pattern (same one Finder
// uses for e.g. snapping icons to a grid) — .alignment/.levelChange read as more specific
// gestures than a slider nudge or a flag toggle actually are. Silently a no-op on a non-Force-
// Touch trackpad or an external mouse (defaultPerformer() itself handles that — nothing to
// detect here). macOS-only; see the JS-side hapt() for the window.__TAURI__ branch that calls
// this, and Cargo.toml's target.'cfg(target_os = "macos")' dependencies for objc2-app-kit.
// AppKit calls are main-thread-only — a #[tauri::command] otherwise runs on Tauri's async
// runtime (not guaranteed to be the main thread), so this dispatches via run_on_main_thread
// (the same pattern Tauri's own macOS window code uses internally, per app.rs) rather than
// calling NSHapticFeedbackManager directly from whatever thread invoked this command.
#[cfg(target_os = "macos")]
#[tauri::command]
fn haptic_feedback(app: tauri::AppHandle) {
    let _ = app.run_on_main_thread(|| {
        use objc2_app_kit::{NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformer};
        let performer = NSHapticFeedbackManager::defaultPerformer();
        performer.performFeedbackPattern_performanceTime(
            NSHapticFeedbackPattern::Generic,
            objc2_app_kit::NSHapticFeedbackPerformanceTime::Default,
        );
    });
}
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn haptic_feedback(_app: tauri::AppHandle) {}

// Native HTTP download, bypassing the WKWebView network stack. The Google Photos Picker's
// media bytes live on the `*.googleusercontent.com` user-content CDN; a cross-origin GET with
// the required `Authorization: Bearer` header forces a CORS preflight the CDN never answers
// for the `tauri://localhost` origin — so BOTH fetch() and XHR fail identically ("Load
// failed"/"XHR network error"), transport-independently. Doing the GET natively in Rust (same
// pattern as google_oauth_loopback/open_url_native) sidesteps CORS, redirects, and any
// WKWebView blob-size limit entirely. On a non-2xx the error string carries the HTTP status,
// so an auth/scope problem (401/403) is distinguishable from the transport problem this fixes.
// `headers`: optional extra request headers (e.g. Lightroom's X-API-Key) — existing callers
// that don't pass it are unaffected (Tauri maps a missing invoke arg to None).
#[tauri::command]
fn download_url_native(
    app: tauri::AppHandle,
    url: String,
    bearer: String,
    headers: Option<Vec<(String, String)>>,
) -> Result<tauri::ipc::Response, String> {
    use std::io::Read;
    if !url.starts_with("https://") {
        return Err("refusing to download a non-https URL".into());
    }
    let mut req = ureq::get(&url).set("Authorization", &format!("Bearer {bearer}"));
    for (k, v) in headers.unwrap_or_default() {
        req = req.set(&k, &v);
    }
    match req.call() {
        Ok(resp) => {
            let content_type = resp.header("content-type").unwrap_or("?").to_string();
            let mut buf = Vec::new();
            resp.into_reader()
                .take(500 * 1024 * 1024) // 500MB cap — a sane ceiling for a single photo
                .read_to_end(&mut buf)
                .map_err(|e| format!("read body: {e}"))?;
            // Diagnostic for the DNG "no decoder found" report: confirms whether the download
            // itself is intact (right size, right magic bytes) before blaming rawler's DNG
            // support — a truncated/wrong-content-type response would explain an empty
            // make/model just as well as a genuine rawler gap. Emitted as an app event (not
            // just eprintln!) so it lands in the app's OWN log panel — the packaged .app has
            // no attached terminal, so eprintln! output was invisible to anyone not running
            // `cargo run`/`tauri dev` themselves, which is why this diagnostic never actually
            // got read despite being added a session ago.
            let head: String = buf.iter().take(16).map(|b| format!("{b:02x}")).collect();
            let msg = format!("[gphotos download] {} bytes, content-type={content_type}, head={head}", buf.len());
            eprintln!("{msg}");
            let _ = app.emit("gphotos-download-diag", &msg);
            Ok(tauri::ipc::Response::new(buf))
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("HTTP {code}")),
        Err(e) => Err(format!("network: {e}")),
    }
}

#[derive(serde::Serialize)]
struct CameraIdent {
    make: String,
    model: String,
    // Lens model, with the RW2 kamadak-exif fallback applied (rawler's own parse misses it on
    // Panasonic RW2 — see lens_correct::exif_lens_model_fallback). Attached here so the editor's
    // decode shim can populate the metadata panel's lens on EVERY open path, not only the single
    // library-card path that separately calls get_meta.
    lens: String,
}

// Cheap EXIF-only peek (no demosaic) so the JS side can pick the right DCP profile file
// BEFORE committing to a full 'lut'-mode decode — NativeLibRawShim.open() only receives raw
// bytes (not a filesystem path), so it can't just call library::get_meta(path) for this.
#[tauri::command]
fn peek_raw_camera(request: tauri::ipc::Request) -> Result<CameraIdent, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.as_slice(),
        _ => return Err("expected raw body".into()),
    };
    let source = rawler::rawsource::RawSource::new_from_slice(bytes);
    let decoder = rawler::get_decoder(&source).map_err(|e| format!("no decoder: {e}"))?;
    let md = decoder
        .raw_metadata(&source, &rawler::decoders::RawDecodeParams::default())
        .map_err(|e| format!("metadata: {e}"))?;
    let lens = md
        .exif
        .lens_model
        .clone()
        .or_else(|| md.lens.as_ref().map(|l| l.lens_model.clone()))
        .or_else(|| lens_correct::exif_lens_model_fallback(bytes))
        .unwrap_or_default();
    Ok(CameraIdent { make: md.make.clone(), model: md.model.clone(), lens })
}

// A visible way to confirm the RUNNING app actually has today's Rust changes compiled in —
// unlike chromasmith-22.html/desktop/*.js (read from desktop/dist/ off disk at runtime, so a
// plain in-app reload picks up JS/CSS edits), any change to desktop/src-tauri/src/*.rs needs a
// full `cargo build` + app RESTART (quitting a running `tauri dev`/.app and relaunching, not
// just Cmd+R) before it takes effect. Bump this string whenever a native fix ships, and check
// it (Guide/Info panel, or the startup log) BEFORE concluding a native-side fix "didn't work".
#[tauri::command]
fn native_build_tag() -> &'static str {
    "2026-07-22a"
}

// Read a file's raw bytes for the Library view to open a selected photo into the editor (a
// plain File-shaped object, same as picking it from the OS file dialog or dragging it in).
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

// Overwrites a file in place with rendered export bytes — used by "Save to Lightroom" (see
// library-ui.js's Edit-In handoff wiring) to write the finished render straight back over the
// TIFF Lightroom handed us, so Lightroom's own file-watcher re-imports and cloud-syncs it.
// data_b64 (not a raw-bytes IPC body) mirrors the "recipe" base64 round-trip already used
// elsewhere in this codebase (get_export_history/set_sidecar) — a proven-simple pattern here,
// at the cost of ~33% transfer overhead which is a non-issue for a single-photo TIFF write.

// ── Gain-map HDR export (ISO 21496-1) ────────────────────────────────────────────────────────
// Takes OUR graded SDR render plus the ORIGINAL source path, and writes a HEIC whose base image is
// the grade and whose auxiliary gain map carries the highlight headroom the source captured. See
// gainmap.rs for why this shape was chosen over an extended-range render pipeline.
//
// Returns false when the source has no HDR headroom, so the caller can fall back to a normal
// export instead of writing a gain map that encodes nothing.
#[cfg(target_os = "macos")]
#[tauri::command]
fn write_gainmap_heic(request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    use base64::Engine;
    let hdr = |k: &str| -> Result<String, String> {
        let v = request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| format!("missing {k} header"))?;
        let b = base64::engine::general_purpose::STANDARD
            .decode(v)
            .map_err(|e| format!("decode {k}: {e}"))?;
        String::from_utf8(b).map_err(|e| format!("{k} not utf8: {e}"))
    };
    let source = hdr("x-source")?;
    let dest = hdr("x-dest")?;
    let quality: f64 = request
        .headers()
        .get("x-quality")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.92);
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b,
        _ => return Err("expected raw request body (the graded PNG)".into()),
    };
    gainmap::write_gainmap_heic(&source, bytes, &dest, quality)
}

// Reports whether a file carries HDR headroom, so the UI can offer the HDR option only when it
// would actually do something.
#[cfg(target_os = "macos")]
#[tauri::command]
fn source_has_hdr(path: String) -> Result<bool, String> {
    gainmap::source_has_hdr(&path)
}

#[tauri::command]
fn write_file_bytes(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("decode base64: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))
}

// Raw-body twin of write_file_bytes — see write_lightroom_tiff_raw's comment for why this
// avoids the base64 triple-copy that OOMs on large exports.
#[tauri::command]
fn write_file_bytes_raw(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-path header")?
        .to_string();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw request body".into()),
    };
    std::fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))
}

// "Save to Lightroom" writer: like write_file_bytes, but first reads the ORIGINAL TIFF still
// sitting at `path` (the Edit-In file we're about to overwrite) and splices its EXIF sub-IFD
// (shutter/aperture/ISO/focal length/lens/DateTimeOriginal — everything Lightroom's Info panel
// shows), GPS, XMP and IPTC into the rendered TIFF — see tiff_meta.rs. The read MUST happen
// before the write: the command overwrites its own metadata source. A splice failure never
// blocks the save — the rendered bytes are written unmodified, same as before this existed.
#[tauri::command]
fn write_lightroom_tiff(app: tauri::AppHandle, path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let rendered = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("decode base64: {e}"))?;
    write_lightroom_tiff_impl(app, path, rendered)
}

// Raw-body twin of write_lightroom_tiff — same splice logic, but the render arrives as the
// IPC request's raw binary body (path carried in a header) instead of a base64 JSON string.
// The base64 path makes THREE full copies of a large TIFF in flight at once (the JS string
// built by _u8b64, the base64 std::string, and Tauri's own JSON-escaped copy of that string
// crossing the IPC boundary) — for a full-res 16-bit TIFF (100s of MB) that's enough to OOM
// on export. tauri::ipc::Request hands the bytes straight through with no re-encoding.
#[tauri::command]
fn write_lightroom_tiff_raw(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-path header")?
        .to_string();
    let rendered = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw request body".into()),
    };
    write_lightroom_tiff_impl(app, path, rendered)
}

fn write_lightroom_tiff_impl(app: tauri::AppHandle, path: String, rendered: Vec<u8>) -> Result<(), String> {
    // Splice outcome goes to the app's OWN log panel via an event (same pattern as
    // gphotos-download-diag) — the packaged .app has no terminal, so eprintln! alone made the
    // silent-skip bug (UTIF's big-endian output being rejected) invisible for a whole day.
    let mut diag;
    let out = match std::fs::read(&path) {
        Ok(source) => match tiff_meta::splice_metadata(&rendered, &source) {
            Some(spliced) => {
                diag = format!(
                    "metadata spliced from original ({} -> {} bytes)",
                    rendered.len(),
                    spliced.len()
                );
                spliced
            }
            None => {
                diag = "NO metadata spliced (source carried none, or parse failed) — wrote render as-is".into();
                rendered
            }
        },
        Err(e) => {
            diag = format!("could not read original for metadata ({e}) — wrote render as-is");
            rendered
        }
    };
    if let Err(e) = std::fs::write(&path, &out) {
        return Err(format!("write {path}: {e}"));
    }
    diag = format!("[lightroom save] {diag}");
    eprintln!("{diag}");
    let _ = app.emit("lr-save-diag", &diag);
    Ok(())
}

#[derive(serde::Serialize)]
struct HttpNativeResult {
    status: u16,
    body: String,
}

// Generic native HTTP for the Lightroom cloud integration — Adobe's IMS token endpoint and
// lr.adobe.io don't answer CORS preflights for the tauri:// origin, so WKWebView fetch() dies
// with its generic "Load failed" (the exact same failure mode download_url_native fixes for
// the Google Photos CDN). Non-2xx statuses are returned as data (status + body), NOT as an
// Err — the JS callers need Adobe's JSON error bodies (error_description etc.) to drive their
// own retry/secret-prompt logic; only a genuine transport failure errors.
#[tauri::command]
fn http_native(
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<HttpNativeResult, String> {
    if !url.starts_with("https://") {
        return Err("refusing a non-https URL".into());
    }
    let mut req = ureq::request(&method, &url);
    for (k, v) in &headers {
        req = req.set(k, v);
    }
    let resp = match body {
        Some(b) => req.send_string(&b),
        None => req.call(),
    };
    match resp {
        Ok(r) => {
            let status = r.status();
            let body = r.into_string().map_err(|e| format!("read body: {e}"))?;
            Ok(HttpNativeResult { status, body })
        }
        Err(ureq::Error::Status(status, r)) => {
            let body = r.into_string().unwrap_or_default();
            Ok(HttpNativeResult { status, body })
        }
        Err(e) => Err(format!("network: {e}")),
    }
}

// File(s) handed to us at launch (Lightroom's "Edit In" — which can hand off several selected
// photos at once, Finder's "Open With", or `open -a Chromasmith file.tif` from a terminal) —
// see RunEvent::Opened in main() below, which is the real macOS Launch-Services path all three
// of those go through, plus the args() fallback in .setup() for direct CLI launches. A Vec (not
// a single Option<String>) so a multi-file Lightroom handoff isn't collapsed to just the last
// path. Stashed here instead of emitted as a bare event because RunEvent::Opened can fire on a
// cold start BEFORE the webview's JS has finished loading and registered a listener — an
// emitted event with no listener yet is just lost. library-ui.js pulls this once at its own
// startup instead, so timing can't drop it either way.
struct PendingOpen(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_path(state: tauri::State<PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

// Adobe Lightroom OAuth callback — Adobe's "Native App" credential type (see chromasmith-22.html's
// lrAuthNative) redirects to a registered custom URL scheme (adobe+<id>://...), NOT an HTTP
// loopback like Google's "Desktop app" client type. macOS routes a custom-scheme open through the
// SAME Launch-Services mechanism as a file open — see RunEvent::Opened below, which now branches
// on url.scheme() to tell the two apart. Same PendingX-mutex-plus-live-event pattern as
// PendingOpen above, for the same reason (a cold-launch race is unlikely for an interactive
// sign-in flow the user just triggered, but costs nothing to guard against anyway).
struct PendingOAuth(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_oauth_callback(state: tauri::State<PendingOAuth>) -> Option<String> {
    state.0.lock().unwrap().take()
}

fn gphotos_downloads_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME")?;
    Ok(PathBuf::from(home).join("Documents").join("Google Photos Download"))
}

// Resolves (and creates) the local Google Photos cache folder so the Library's pinned
// "Google Photos Download" tree entry has a real path to open, even before any import has
// run yet this session.
#[tauri::command]
fn gphotos_downloads_dir() -> Result<String, String> {
    let dir = gphotos_downloads_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create download dir: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Sniffs the first bytes for a REAL image container, the same magic-byte check
/// chromasmith-22.html's sniffRealImageKind() does client-side — used here so a RAW-named file
/// that Google Photos actually only had a JPEG copy of (common for RAW+JPEG pairs and iPhone
/// ProRAW) gets a truthful extension in the saved-to-disk cache, instead of silently sitting on
/// disk as "IMG_1234.DNG" while actually being JPEG bytes (misleading in Finder/the Library's
/// type filter forever after).
fn sniff_real_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some("png")
    } else {
        None
    }
}

#[derive(serde::Serialize)]
struct GpSaveResult {
    path: String,
    bytes: u64,
    renamed: bool, // true if the RAW-looking filename actually held JPEG/PNG bytes
}

// Caches every Google Photos import to ~/Documents/Google Photos Download/ so re-opening a
// previously-imported photo (e.g. clicking it again in the Library) reads from disk instead
// of re-downloading from Google. The Library pins this folder at the top of its tree for
// quick access (see library-ui.js's pinned-row code).
//
// PREVIOUSLY this silently no-op'd on a same-name collision (`if !dest.exists()`) and swallowed
// every error into a bare console.error on the JS side — so a permissions failure, a full disk,
// or a stale same-named file from a past import all looked identical to "it worked" from the
// user's perspective, which is exactly why "files never appear in the folder" survived multiple
// past fixes: nothing made a failure OBSERVABLE. Now: (1) a name collision gets a de-duped
// "name (2).ext" instead of being dropped, (2) every Err propagates back to JS with a real
// message instead of being discarded, (3) the actual written path + byte count come back so the
// caller can log a concrete confirmation line per file instead of hoping.
//
// base64, not a raw-body+header invoke: this command is a low-frequency background write (a
// handful of calls per Google Photos import session, not a hot decode path), so the ~33% size
// overhead is worth it for a guaranteed-correct argument shape.
#[tauri::command]
fn save_to_gphotos_downloads(filename: String, data_b64: String) -> Result<GpSaveResult, String> {
    save_to_download_dir(gphotos_downloads_path()?, filename, data_b64)
}

// Same disk-cache pattern for Lightroom cloud imports: every import lands in
// ~/Documents/Lightroom Download/ so re-opening reads from disk (thumbnails, sidecar ratings
// and the decode cache all work on it like any local photo) instead of re-downloading.
fn lr_downloads_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME")?;
    Ok(PathBuf::from(home).join("Documents").join("Lightroom Download"))
}

#[tauri::command]
fn lr_downloads_dir() -> Result<String, String> {
    let dir = lr_downloads_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create download dir: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_to_lr_downloads(filename: String, data_b64: String) -> Result<GpSaveResult, String> {
    save_to_download_dir(lr_downloads_path()?, filename, data_b64)
}

fn save_to_download_dir(dir: PathBuf, filename: String, data_b64: String) -> Result<GpSaveResult, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("bad base64 payload: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create download dir '{}': {e}", dir.display()))?;
    // Strip any path separators from the filename Google handed back — it's untrusted input.
    let safe_name = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("gphotos_import");
    let src_path = Path::new(safe_name);
    let src_ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    const RAW_LOOKING: &[&str] = &["raw", "rw2", "dng", "cr2", "cr3", "nef", "arw", "orf"];
    let mut renamed = false;
    let final_name = if RAW_LOOKING.contains(&src_ext.as_str()) {
        if let Some(real_ext) = sniff_real_ext(&bytes) {
            renamed = true;
            let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("gphotos_import");
            format!("{stem}.{real_ext}")
        } else {
            safe_name.to_string()
        }
    } else {
        safe_name.to_string()
    };
    let base = Path::new(&final_name);
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("gphotos_import").to_string();
    let ext = base.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    let mut dest = dir.join(&final_name);
    let mut n = 2;
    // De-dupe by name+size: an identical re-import (same photo, same bytes) reuses the existing
    // file rather than piling up "(2)", "(3)"... copies of the same download every re-run.
    while dest.exists() {
        if std::fs::metadata(&dest).map(|m| m.len()).ok() == Some(bytes.len() as u64) {
            return Ok(GpSaveResult { path: dest.to_string_lossy().into_owned(), bytes: bytes.len() as u64, renamed });
        }
        let name = if ext.is_empty() { format!("{stem} ({n})") } else { format!("{stem} ({n}).{ext}") };
        dest = dir.join(name);
        n += 1;
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("write {}: {e}", dest.display()))?;
    Ok(GpSaveResult { path: dest.to_string_lossy().into_owned(), bytes: bytes.len() as u64, renamed })
}

// ── Normal photo export ───────────────────────────────────────────────────────────────────
// The desktop shell had NO native save path for ordinary exports: saveFiles() in
// chromasmith-22.html fell through to a burst of browser <a download> clicks staggered 300ms
// apart. After a multi-minute full-res batch render the click's user activation is long gone,
// so WKWebView drops the later downloads as unattended — a user exporting 11 photos got 4
// files and a "Exported 11 photos ✓" toast, because anchorDownload can neither fail nor
// report. Every export now goes through this command instead: one file per invoke, a real
// Result per file, and the actual written path handed back so JS can log a concrete line.
fn export_downloads_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME")?;
    Ok(PathBuf::from(home).join("Downloads"))
}

// Next free "name (2).ext" / "name (3).ext" in `dir`. Deliberately NOT shared with
// save_to_download_dir above: that one treats a same-name+same-size file as an already-cached
// re-import and skips the write, which is right for a Google Photos re-download and WRONG for
// an export (it would silently drop a file the user just asked for).
fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let base = Path::new(name);
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("export").to_string();
    let ext = base.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    let mut dest = dir.join(name);
    let mut n = 2;
    while dest.exists() {
        let alt = if ext.is_empty() { format!("{stem} ({n})") } else { format!("{stem} ({n}).{ext}") };
        dest = dir.join(alt);
        n += 1;
    }
    dest
}

// Raw-body writer, modelled on write_file_bytes_raw: the render arrives as the IPC request's
// binary body with the filename in a header, so a full-res export isn't tripled in memory the
// way the base64 path is (the same triple-copy that OOMed Lightroom TIFF saves — see
// write_lightroom_tiff_raw's comment). The header carries the name BASE64-encoded because HTTP
// headers are ASCII-only and export filenames routinely are not.
#[tauri::command]
fn save_export_file_raw(request: tauri::ipc::Request<'_>) -> Result<GpSaveResult, String> {
    use base64::Engine;
    let name_b64 = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-filename header")?;
    let name_bytes = base64::engine::general_purpose::STANDARD
        .decode(name_b64)
        .map_err(|e| format!("decode x-filename: {e}"))?;
    let name = String::from_utf8(name_bytes).map_err(|e| format!("x-filename not utf8: {e}"))?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("expected raw request body".into()),
    };
    // Strip any path separators — never let a filename escape the downloads folder.
    let safe_name = Path::new(&name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("empty filename")?;
    let dir = export_downloads_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create '{}': {e}", dir.display()))?;
    let dest = unique_dest(&dir, safe_name);
    std::fs::write(&dest, bytes).map_err(|e| format!("write {}: {e}", dest.display()))?;
    Ok(GpSaveResult { path: dest.to_string_lossy().into_owned(), bytes: bytes.len() as u64, renamed: false })
}

// ── Streaming save for large video exports (V3 — see CLAUDE.md §12 / the video plan's B5) ──
// mediabunny's mp4-muxer patches box sizes by SEEKING BACKWARD after writing forward-only data
// (the moov/mdat size fields aren't known until encoding finishes), so `pos` on every write is
// MANDATORY, not append-only — treating it as append-only silently produces a corrupt MP4.
// One open std::fs::File per in-flight export, keyed by a caller-supplied token, so multiple
// concurrent commands (open this session, write many times, close once) can address the same
// handle without holding a lock across the whole export. `.part` + rename-on-commit means a
// cancelled or crashed export never leaves a half-written file that LOOKS like a finished one.
struct StreamHandle {
    file: std::fs::File,
    part_path: PathBuf,
    final_name: String,
}
static STREAMS: Mutex<Option<HashMap<String, StreamHandle>>> = Mutex::new(None);
static STREAM_TOKEN_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[tauri::command]
fn stream_open(filename: String) -> Result<serde_json::Value, String> {
    let safe_name = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("empty filename")?
        .to_string();
    let dir = export_downloads_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create '{}': {e}", dir.display()))?;
    // The .part name is its own unique_dest lookup (independent of the FINAL name's, which is
    // resolved at close time) — two concurrent exports of the same source filename must not
    // collide on the .part file while both are still in flight.
    let part_dest = unique_dest(&dir, &format!("{safe_name}.part"));
    let file = std::fs::File::create(&part_dest)
        .map_err(|e| format!("create '{}': {e}", part_dest.display()))?;
    let n = STREAM_TOKEN_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let token = format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        n
    );
    let mut guard = STREAMS.lock().map_err(|_| "stream lock poisoned".to_string())?;
    guard.get_or_insert_with(HashMap::new).insert(
        token.clone(),
        StreamHandle { file, part_path: part_dest, final_name: safe_name },
    );
    Ok(serde_json::json!({ "handle": token }))
}

// Seeks to `pos` then writes `data` — pulled out of stream_write so it's testable on a plain
// std::fs::File without needing a real tauri::ipc::Request. `pos` is REQUIRED, never an append:
// mediabunny's mp4-muxer seeks BACKWARD to patch box sizes once the final sizes are known, so
// treating writes as append-only would silently corrupt the MP4 the moment that happens.
fn stream_write_at(file: &mut std::fs::File, pos: u64, data: &[u8]) -> Result<(), String> {
    use std::io::{Seek, SeekFrom, Write};
    file.seek(SeekFrom::Start(pos)).map_err(|e| format!("seek: {e}"))?;
    file.write_all(data).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

// Framed body: [u32 jsonLen][json {handle,pos}][raw chunk bytes]. `pos` is REQUIRED (see
// stream_write_at's comment) — every write seeks there first, even ones that happen to be
// sequential.
#[tauri::command]
fn stream_write(request: tauri::ipc::Request) -> Result<(), String> {
    let (json, payload) = parse_framed(request.body())?;
    let handle = json["handle"].as_str().ok_or("missing handle")?;
    let pos = json["pos"].as_u64().ok_or("missing pos")?;
    let mut guard = STREAMS.lock().map_err(|_| "stream lock poisoned".to_string())?;
    let map = guard.as_mut().ok_or("no open streams")?;
    let h = map.get_mut(handle).ok_or("unknown stream handle")?;
    stream_write_at(&mut h.file, pos, payload)
        .map_err(|e| format!("{} on {}", e, h.part_path.display()))?;
    Ok(())
}

// Pure rename-or-delete logic, pulled out of stream_close so it's testable against a temp dir
// instead of the real Downloads folder (stream_close itself always operates on a real
// StreamHandle's part_path, which lives under export_downloads_path()).
fn stream_close_at(part_path: &Path, final_name: &str, commit: bool) -> Result<GpSaveResult, String> {
    if !commit {
        let _ = std::fs::remove_file(part_path); // best-effort — a cancel shouldn't itself fail loudly
        return Ok(GpSaveResult { path: String::new(), bytes: 0, renamed: false });
    }
    let bytes = std::fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
    let dir = part_path.parent().ok_or("part file has no parent dir")?;
    let dest = unique_dest(dir, final_name);
    std::fs::rename(part_path, &dest)
        .map_err(|e| format!("rename {} -> {}: {e}", part_path.display(), dest.display()))?;
    Ok(GpSaveResult { path: dest.to_string_lossy().into_owned(), bytes, renamed: false })
}

#[tauri::command]
fn stream_close(handle: String, commit: bool) -> Result<GpSaveResult, String> {
    use std::io::Write;
    let removed = {
        let mut guard = STREAMS.lock().map_err(|_| "stream lock poisoned".to_string())?;
        guard
            .as_mut()
            .and_then(|m| m.remove(&handle))
            .ok_or("unknown stream handle")?
    };
    let StreamHandle { mut file, part_path, final_name } = removed;
    file.flush().map_err(|e| format!("flush {}: {e}", part_path.display()))?;
    drop(file); // release the handle before rename/delete
    stream_close_at(&part_path, &final_name, commit)
}

// ── Google OAuth for the desktop shell: the web build's popup+redirect flow (gpAuth() in
// chromasmith-22.html) assumes the page is served from a real https:// origin, so Google can
// redirect the popup back to it — but this shell serves from a custom "cs://" scheme, which
// Google's OAuth server won't accept as a redirect_uri at all. The standard fix for installed/
// desktop apps (RFC 8252) is a loopback redirect: open the system browser at the Google
// consent screen, bind an ephemeral 127.0.0.1 port as the redirect target, and read the
// authorization code off the one HTTP request Google's redirect makes to it. No client secret
// needed — the JS side does a PKCE code exchange, same as any public/installed OAuth client.
// (This requires a Google OAuth client of type "Desktop app", not "Web application" — the
// existing GP_DEFAULT_CLIENT_ID is a Web client for the GitHub Pages build and won't work here;
// chromasmith-22.html's gpClientId() already refuses to fall back to it under window.__TAURI__.)
#[derive(serde::Serialize)]
struct OAuthResult {
    port: u16,
    query: String,
}

// Google's "Desktop app" OAuth client type uses a plain HTTP loopback redirect (RFC 8252) — an
// ephemeral 127.0.0.1 port this process listens on directly. Adobe's Lightroom integration turned
// out to use a DIFFERENT credential type ("Native App") that redirects to a registered custom URL
// scheme instead (adobe+<id>://...) — see PendingOAuth/RunEvent::Opened below for that flow; it
// doesn't go through this loopback listener at all (an adobe_oauth_loopback command used to live
// here, sharing this same function, before that was discovered).
#[tauri::command]
async fn google_oauth_loopback(auth_url_template: String) -> Result<OAuthResult, String> {
    oauth_loopback_flow(auth_url_template).await
}

async fn oauth_loopback_flow(auth_url_template: String) -> Result<OAuthResult, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind loopback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // The JS side builds the template with URLSearchParams, which percent-encodes the braces
    // in the redirect_uri to %7BPORT%7D — a plain "{PORT}" replace never matched, so Google
    // received a literal "http://127.0.0.1:{PORT}/callback" redirect URI and rejected the
    // whole request with "Error 400: invalid_request / doesn't comply with OAuth 2.0 policy".
    // Replace both the raw and percent-encoded forms so either template encoding works.
    let auth_url = auth_url_template
        .replace("{PORT}", &port.to_string())
        .replace("%7BPORT%7D", &port.to_string());
    std::process::Command::new("open")
        .arg(&auth_url)
        .spawn()
        .map_err(|e| format!("couldn't open the system browser: {e}"))?;

    // Watchdog: Google only ever calls the redirect if the user finishes sign-in. If they
    // close the tab instead, accept() below would block forever — after 3 minutes, connect to
    // our own listener with a sentinel path so accept() returns and the command can give up.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(180));
        if let Ok(mut s) = std::net::TcpStream::connect(("127.0.0.1", port)) {
            let _ = s.write_all(b"GET /__cs_timeout HTTP/1.1\r\nHost: x\r\n\r\n");
        }
    });

    tauri::async_runtime::spawn_blocking(move || -> Result<OAuthResult, String> {
        let (mut stream, _) = listener.accept().map_err(|e| format!("accept: {e}"))?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]).into_owned();
        let path = req.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("").to_string();
        let timed_out = path.contains("__cs_timeout");
        let body = if timed_out {
            "<html><body style=\"font-family:-apple-system,sans-serif;text-align:center;padding:60px\"><h2>Sign-in timed out</h2><p>Close this tab and try again in Chromasmith.</p></body></html>"
        } else {
            "<html><body style=\"font-family:-apple-system,sans-serif;text-align:center;padding:60px\"><h2>Chromasmith connected ✓</h2><p>You can close this tab and return to the app.</p></body></html>"
        };
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes());
        let _ = stream.flush();
        if timed_out {
            return Err("Sign-in timed out — try again".into());
        }
        Ok(OAuthResult { port, query: path.splitn(2, '?').nth(1).unwrap_or("").to_string() })
    })
    .await
    .map_err(|e| format!("oauth listener thread panicked: {e}"))?
}

fn main() {
    // Printed unconditionally, BEFORE anything else, straight to the terminal `npm run dev`
    // (or `cargo run`) runs in — no JS round-trip needed, so it's visible even if the webview
    // never loads. Compare against native_build_tag()'s value: if they differ (or this line
    // never appears), the running process is NOT the one src-tauri/src was last edited for —
    // a full quit + relaunch (real recompile) is needed before any native-side fix applies.
    eprintln!("=== Chromasmith native build: {} ===", native_build_tag());
    tauri::Builder::default()
        .manage(PendingOpen(Mutex::new(Vec::new())))
        .manage(PendingOAuth(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "macos")]
            write_gainmap_heic,
            #[cfg(target_os = "macos")]
            source_has_hdr,
            store_dcp_lut,
            decode_raw_v2,
            denoise_raw_high,
            cancel_denoise_high,
            lens_profile_available,
            list_lens_profiles,
            download_url_native,
            native_build_tag,
            open_url_native,
            haptic_feedback,
            peek_raw_camera,
            read_file_bytes,
            write_file_bytes,
            write_file_bytes_raw,
            write_lightroom_tiff,
            write_lightroom_tiff_raw,
            http_native,
            take_pending_open_path,
            take_pending_oauth_callback,
            google_oauth_loopback,
            library::list_dir,
            library::get_thumbnail,
            library::get_preview,
            library::get_meta,
            library::get_sidecar,
            library::set_sidecar,
            library::get_export_history,
            library::append_export_history,
            library::duplicate_file,
            library::trash_file,
            library::reveal_in_finder,
            library::list_edited,
            library::list_collection,
            library::list_exported,
            library::collection_counts,
            library::touch_recent,
            library::backfill_edited_registry,
            library::phash_batch,
            library::registry_set_cmd,
            library::get_decode_cache,
            library::save_decode_cache,
            library::get_lr_thumb,
            library::save_lr_thumb,
            sam_encode,
            sam_points,
            sam2_encode,
            sam2_points,
            faceparse_run,
            save_to_gphotos_downloads,
            gphotos_downloads_dir,
            save_to_lr_downloads,
            save_export_file_raw,
            stream_open,
            stream_write,
            stream_close,
            lr_downloads_dir
        ])
        // Custom "cs://" protocol serving the embedded dist/ with EXPLICIT COOP/COEP headers
        // on every single response, including the very first navigation — see the Cargo.toml
        // comment for why the declarative app.security.headers config wasn't reliable here.
        .register_uri_scheme_protocol("cs", |_ctx, request| {
            let raw_path = request.uri().path().trim_start_matches('/');
            let raw_path = if raw_path.is_empty() { "index.html" } else { raw_path };
            // The URI path arrives percent-encoded (spaces -> %20 etc — several of the app's
            // own asset filenames have spaces, e.g. "vendor/dcp/Panasonic DC-S9 Camera
            // Standard.dcp") but std::fs::read needs the literal decoded path. Forgetting this
            // silently 404s every asset whose name needs encoding.
            let path = percent_decode(raw_path);
            let full = format!("{}/{path}", dist_dir().display());
            let (body, mime, status): (Vec<u8>, String, u16) = match std::fs::read(&full) {
                Ok(b) => (
                    b,
                    mime_guess::from_path(path)
                        .first_raw()
                        .unwrap_or("application/octet-stream")
                        .to_string(),
                    200,
                ),
                Err(_) => (b"404 Not Found".to_vec(), "text/plain".to_string(), 404),
            };
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", mime)
                .header("Cross-Origin-Opener-Policy", "same-origin")
                .header("Cross-Origin-Embedder-Policy", "require-corp")
                .body(body)
                .unwrap()
        })
        .setup(|app| {
            let handle = app.handle();

            // Resolve dist_dir() once — see DIST_DIR_RESOLVED's doc comment above. Same
            // bundled-resource-with-dev-fallback pattern as the onnxruntime dylib below.
            let bundled_dist = handle.path().resource_dir().ok().map(|d| d.join("dist"));
            let dist = bundled_dist
                .filter(|p| p.exists())
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("dist"));
            let _ = DIST_DIR_RESOLVED.set(dist);

            // CLI/manual-launch fallback for the Lightroom "Edit In" handoff (see PendingOpen
            // above) — `open -a Chromasmith file1.tif file2.tif` or a direct binary launch with
            // path arguments (plural — a multi-select Edit-In can hand off several). RunEvent::
            // Opened in run() below is the real Launch-Services path Lightroom/Finder actually
            // use; this just covers the same handoff when testing from a terminal, where no
            // Opened event fires at all.
            let cli_paths: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| Path::new(a).is_file())
                .collect();
            if !cli_paths.is_empty() {
                *handle.state::<PendingOpen>().0.lock().unwrap() = cli_paths;
            }

            // Prune unbounded caches (thumbnails/decode JPEGs) in the background — see
            // library::prune_caches for the caps. Never blocks startup.
            // TEMP DISABLED: added today, only new code touching the thumbnail cache dir;
            // suspected of racing get_thumbnail's own reads/writes to the same directory right
            // at startup (the exact moment thumbnails were reported broken). Re-enable once
            // thumbnail loading is confirmed fixed without it.
            // std::thread::spawn(library::prune_caches);

            let open_item =
                MenuItem::with_id(handle, "menu-open", "Open Photo…", true, Some("CmdOrCtrl+O"))?;
            let library_item =
                MenuItem::with_id(handle, "menu-library", "Library…", true, Some("CmdOrCtrl+L"))?;
            let export_item =
                MenuItem::with_id(handle, "menu-export", "Export…", true, Some("CmdOrCtrl+E"))?;
            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &open_item,
                    &library_item,
                    &export_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;

            let undo_item = MenuItem::with_id(handle, "menu-undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
            let redo_item = MenuItem::with_id(
                handle,
                "menu-redo",
                "Redo",
                true,
                Some("CmdOrCtrl+Shift+Z"),
            )?;
            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &undo_item,
                    &redo_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;

            // Photo: culling flags + geometry, mirroring the Library grid's right-click menu and
            // its keyboard culling (X/P/U, already handled in library-ui.js's own keydown
            // listener — which correctly ignores keystrokes while a text field is focused).
            // Deliberately NO accelerator on Reject/Pick/Clear/Toggle-Full-Library here: a bare,
            // modifier-less menu key-equivalent is intercepted by AppKit's performKeyEquivalent:
            // BEFORE it ever reaches a focused text field, so "X"/"P"/"U"/"G" as native menu
            // shortcuts would silently eat those letters everywhere in the app (renaming a file,
            // typing in search, the filename-pattern field) — exactly the class of bug this
            // project's CLAUDE.md warns about re-testing in a real browser/app after a change.
            // The menu items stay reachable by click; the real keyboard shortcuts are the
            // existing JS-side, focus-aware ones.
            let reject_item = MenuItem::with_id(handle, "menu-reject", "Reject", true, Option::<&str>::None)?;
            let pick_item = MenuItem::with_id(handle, "menu-pick", "Pick (Flag)", true, Option::<&str>::None)?;
            let clear_flag_item = MenuItem::with_id(handle, "menu-clear-flag", "Clear Flag", true, Option::<&str>::None)?;
            let reset_edit_item = MenuItem::with_id(handle, "menu-reset-edit", "Reset Edit", true, Option::<&str>::None)?;
            let rotate_left_item = MenuItem::with_id(handle, "menu-rotate-left", "Rotate Left", true, Some("CmdOrCtrl+["))?;
            let rotate_right_item = MenuItem::with_id(handle, "menu-rotate-right", "Rotate Right", true, Some("CmdOrCtrl+]"))?;
            let flip_h_item = MenuItem::with_id(handle, "menu-flip-h", "Flip Horizontal", true, Option::<&str>::None)?;
            let flip_v_item = MenuItem::with_id(handle, "menu-flip-v", "Flip Vertical", true, Option::<&str>::None)?;
            let copy_edit_item = MenuItem::with_id(handle, "menu-copy-edit", "Copy Edit", true, Some("CmdOrCtrl+Shift+C"))?;
            let paste_edit_item = MenuItem::with_id(handle, "menu-paste-edit", "Paste Edit", true, Some("CmdOrCtrl+Shift+V"))?;
            let photo_menu = Submenu::with_items(
                handle,
                "Photo",
                true,
                &[
                    &reject_item,
                    &pick_item,
                    &clear_flag_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &rotate_left_item,
                    &rotate_right_item,
                    &flip_h_item,
                    &flip_v_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &copy_edit_item,
                    &paste_edit_item,
                    &reset_edit_item,
                ],
            )?;

            // View: zoom, split/compare, histogram, and the Library's expanded/grid view — the
            // on-screen buttons for most of these already exist (fx-wrap zoom controls, the ○/⇔/▦
            // preview-tools row, the ⛶ Library-expand button); this just gives them menu-bar
            // discoverability and real shortcuts, same idiom as darktable/RawTherapee/digiKam.
            let zoom_in_item = MenuItem::with_id(handle, "menu-zoom-in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?;
            let zoom_out_item = MenuItem::with_id(handle, "menu-zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
            let zoom_fit_item = MenuItem::with_id(handle, "menu-zoom-fit", "Zoom to Fit", true, Some("CmdOrCtrl+0"))?;
            let zoom_100_item = MenuItem::with_id(handle, "menu-zoom-100", "Zoom to 100%", true, Some("CmdOrCtrl+1"))?;
            let split_item = MenuItem::with_id(handle, "menu-split", "Toggle Before/After Split", true, Some("CmdOrCtrl+\\"))?;
            let hist_item = MenuItem::with_id(handle, "menu-histogram", "Toggle Histogram", true, Some("CmdOrCtrl+H"))?;
            let expand_lib_item = MenuItem::with_id(handle, "menu-expand-library", "Toggle Full Library", true, Option::<&str>::None)?; // bare "G" is already the JS-side shortcut — see the Photo-menu comment above on why it can't ALSO be a native accelerator
            let view_menu = Submenu::with_items(
                handle,
                "View",
                true,
                &[
                    &zoom_in_item,
                    &zoom_out_item,
                    &zoom_fit_item,
                    &zoom_100_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &split_item,
                    &hist_item,
                    &expand_lib_item,
                ],
            )?;

            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::fullscreen(handle, None)?,
                ],
            )?;

            let shortcuts_item = MenuItem::with_id(handle, "menu-shortcuts", "Keyboard Shortcuts…", true, Some("CmdOrCtrl+/"))?;
            let guide_item = MenuItem::with_id(handle, "menu-guide", "Chromasmith Guide", true, Option::<&str>::None)?;
            let whatsnew_item = MenuItem::with_id(handle, "menu-whatsnew", "What's New", true, Option::<&str>::None)?;
            let help_menu = Submenu::with_items(
                handle,
                "Help",
                true,
                &[&shortcuts_item, &guide_item, &whatsnew_item],
            )?;

            let app_menu = Submenu::with_items(
                handle,
                "Chromasmith",
                true,
                &[
                    &PredefinedMenuItem::about(handle, None, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;

            let menu = Menu::with_items(
                handle,
                &[&app_menu, &file_menu, &edit_menu, &photo_menu, &view_menu, &window_menu, &help_menu],
            )?;
            app.set_menu(menu)?;

            let handle2 = handle.clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().0.as_str();
                if matches!(
                    id,
                    "menu-open" | "menu-library" | "menu-export" | "menu-undo" | "menu-redo"
                        | "menu-reject" | "menu-pick" | "menu-clear-flag" | "menu-reset-edit"
                        | "menu-rotate-left" | "menu-rotate-right" | "menu-flip-h" | "menu-flip-v"
                        | "menu-copy-edit" | "menu-paste-edit"
                        | "menu-zoom-in" | "menu-zoom-out" | "menu-zoom-fit" | "menu-zoom-100"
                        | "menu-split" | "menu-histogram" | "menu-expand-library"
                        | "menu-shortcuts" | "menu-guide" | "menu-whatsnew"
                ) {
                    let _ = handle2.emit(id, ());
                }
            });

            // AI tap-to-select's onnxruntime dylib (see sam.rs): a bundled RESOURCE (declared in
            // tauri.conf.json's bundle.resources), not embedded in the binary — `ort`'s
            // load-dynamic feature dlopen()s it by path at first use, and 28MB is fine as a
            // resource file but not worth doubling the binary's link time via include_bytes!.
            // Prefer the packaged resource_dir() (a real distributed .app); fall back to the
            // source tree's vendor/ directly for `cargo tauri dev`, where resource_dir() may not
            // point at a populated location.
            let dylib_rel = "vendor/onnxruntime/libonnxruntime.dylib";
            let bundled = handle.path().resource_dir().ok().map(|d| d.join(dylib_rel));
            let dev_fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(dylib_rel);
            let dylib_path = bundled.filter(|p| p.exists()).unwrap_or(dev_fallback);
            sam::set_dylib_path(dylib_path);

            // SAM 2.1's ~155MB models (see sam.rs's SAM2_ENCODER_PATH/SAM2_DECODER_PATH doc
            // comment) — same bundled-resource-with-dev-fallback pattern as the dylib above,
            // since include_bytes! would be a much bigger compile-time/binary-size hit here.
            let resolve_vendor = |rel: &str| -> PathBuf {
                let bundled = handle.path().resource_dir().ok().map(|d| d.join(rel));
                let dev_fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
                bundled.filter(|p| p.exists()).unwrap_or(dev_fallback)
            };
            sam::set_sam2_model_paths(resolve_vendor("vendor/sam2/encoder.onnx"), resolve_vendor("vendor/sam2/decoder.onnx"));

            // Face-feature auto-exclusion (ROADMAP item 16) — same bundled-resource-with-
            // dev-fallback pattern as the SAM2 models above.
            faceparse::set_model_path(resolve_vendor("vendor/faceparse/model_quantized.onnx"));

            // High-tier RAW denoiser (rawdenoise.rs) — same bundled-resource-with-dev-fallback
            // pattern; ~30MB each, so file-path CreateSession like SAM2/faceparse, not
            // include_bytes! like EdgeSAM's much smaller models.
            rawdenoise::set_model_paths(resolve_vendor("vendor/rawdenoise/model_linear.onnx"), resolve_vendor("vendor/rawdenoise/model_bayer.onnx"));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Chromasmith")
        .run(|app_handle, event| {
            // macOS Launch-Services "open this document" — the actual mechanism behind Finder's
            // "Open With", and (once tauri.conf.json's fileAssociations register Chromasmith as
            // an editor) Lightroom's "Edit In" handoff. Fires both on a cold launch WITH a file
            // and on a already-running app being handed a new one. Stash it via PendingOpen
            // (see above) rather than emitting straight to the webview — on a cold launch this
            // can arrive before the frontend has attached any listener, so an emitted event
            // would just be silently dropped; also emit it for the already-running case, where
            // a listener reliably exists already and the extra immediacy is worth it.
            if let tauri::RunEvent::Opened { urls } = event {
                // A file:// URL (Lightroom Edit-In / Finder "Open With" / CLI open) goes to
                // PendingOpen. Anything else — currently just Adobe's Lightroom OAuth
                // custom-scheme callback (adobe+<id>://...), registered via tauri-plugin-deep-link
                // in tauri.conf.json — goes to PendingOAuth instead. A single Opened event can
                // carry MULTIPLE file:// urls at once (Lightroom's "Edit In" with several photos
                // selected hands them all off together) — collect every file path from this
                // event into one batch instead of overwriting PendingOpen per-url (which used to
                // silently drop every file but the last one) and emit it as a single array so the
                // frontend opens them together as one batch, not N separate single-photo opens.
                let mut file_paths: Vec<String> = Vec::new();
                for u in urls {
                    if let Ok(path) = u.to_file_path() {
                        file_paths.push(path.to_string_lossy().into_owned());
                    } else {
                        let url_s = u.to_string();
                        *app_handle.state::<PendingOAuth>().0.lock().unwrap() = Some(url_s.clone());
                        let _ = app_handle.emit("adobe-oauth-callback", url_s);
                    }
                }
                if !file_paths.is_empty() {
                    *app_handle.state::<PendingOpen>().0.lock().unwrap() = file_paths.clone();
                    let _ = app_handle.emit("open-file-path", file_paths);
                }
            }
        });
}

#[cfg(test)]
mod export_save_tests {
    use super::unique_dest;
    use std::path::Path;

    // A batch export must never silently overwrite an existing file — the whole point of the
    // native save path is that nothing disappears without the user hearing about it.
    #[test]
    fn unique_dest_avoids_collisions() {
        let dir = std::env::temp_dir().join(format!("cs_unique_dest_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let first = unique_dest(&dir, "photo_1.0.jpg");
        assert_eq!(first, dir.join("photo_1.0.jpg"));
        std::fs::write(&first, b"x").unwrap();

        let second = unique_dest(&dir, "photo_1.0.jpg");
        assert_eq!(second, dir.join("photo_1.0 (2).jpg"));
        std::fs::write(&second, b"x").unwrap();

        assert_eq!(unique_dest(&dir, "photo_1.0.jpg"), dir.join("photo_1.0 (3).jpg"));

        // Extensionless names keep working.
        std::fs::write(dir.join("noext"), b"x").unwrap();
        assert_eq!(unique_dest(&dir, "noext"), dir.join("noext (2)"));

        // Non-ASCII round-trips (the reason the filename crosses IPC base64-encoded).
        assert_eq!(unique_dest(&dir, "café ☕.jpg"), dir.join("café ☕.jpg"));

        // Path separators are stripped by the caller, not here — confirm the caller's contract.
        assert_eq!(Path::new("../../etc/passwd").file_name().unwrap(), "passwd");

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod stream_tests {
    use super::{stream_close_at, stream_write_at};
    use std::io::Read;

    fn tmp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cs_stream_test_{}_{}", label, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // The whole reason `pos` is mandatory: a write that lands somewhere OTHER than the current
    // end of the file (mediabunny's mp4-muxer patching a box size after the fact) must land
    // exactly there, not get appended past whatever was already written.
    #[test]
    fn stream_write_at_seeks_before_writing() {
        let dir = tmp_dir("seek");
        let path = dir.join("out.part");
        let mut file = std::fs::File::create(&path).unwrap();
        stream_write_at(&mut file, 0, b"AAAAAAAAAA").unwrap(); // 10 bytes
        stream_write_at(&mut file, 2, b"BB").unwrap(); // patch bytes 2..4, NOT appended at byte 10
        drop(file);
        let mut got = String::new();
        std::fs::File::open(&path).unwrap().read_to_string(&mut got).unwrap();
        assert_eq!(got, "AABBAAAAAA");
        std::fs::remove_dir_all(&dir).ok();
    }

    // Out-of-order writes (a later chunk arriving before an earlier patch, or vice versa) must
    // still land correctly purely by position — this is what makes streaming safe regardless of
    // the order mediabunny's writer happens to call in.
    #[test]
    fn stream_write_at_out_of_order() {
        let dir = tmp_dir("outoforder");
        let path = dir.join("out.part");
        let mut file = std::fs::File::create(&path).unwrap();
        stream_write_at(&mut file, 5, b"XXXXX").unwrap();
        stream_write_at(&mut file, 0, b"YYYYY").unwrap();
        drop(file);
        let mut got = String::new();
        std::fs::File::open(&path).unwrap().read_to_string(&mut got).unwrap();
        assert_eq!(got, "YYYYYXXXXX");
        std::fs::remove_dir_all(&dir).ok();
    }

    // commit:true renames .part to a real, collision-free filename in the SAME directory.
    #[test]
    fn stream_close_commit_renames_part_file() {
        let dir = tmp_dir("commit");
        let part = dir.join("clip.mp4.part");
        std::fs::write(&part, b"hello world").unwrap();
        let result = stream_close_at(&part, "clip.mp4", true).unwrap();
        assert!(!part.exists(), ".part file must be gone after a committed close");
        assert_eq!(result.path, dir.join("clip.mp4").to_string_lossy());
        assert_eq!(result.bytes, 11);
        assert!(std::path::Path::new(&result.path).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    // A cancelled export (commit:false) must delete the .part file — never leave a half-written
    // file that could be mistaken for a finished export.
    #[test]
    fn stream_close_cancel_deletes_part_file() {
        let dir = tmp_dir("cancel");
        let part = dir.join("clip.mp4.part");
        std::fs::write(&part, b"partial").unwrap();
        let result = stream_close_at(&part, "clip.mp4", false).unwrap();
        assert!(!part.exists(), ".part file must be deleted on cancel");
        assert!(!dir.join("clip.mp4").exists(), "no renamed file should appear on cancel");
        assert_eq!(result.bytes, 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    // A commit onto a directory that ALREADY has a same-named file must not clobber it — same
    // guarantee unique_dest already gives the plain export path.
    #[test]
    fn stream_close_commit_avoids_collision() {
        let dir = tmp_dir("collide");
        std::fs::write(dir.join("clip.mp4"), b"existing").unwrap();
        let part = dir.join("clip.mp4.part");
        std::fs::write(&part, b"new export").unwrap();
        let result = stream_close_at(&part, "clip.mp4", true).unwrap();
        assert_eq!(result.path, dir.join("clip (2).mp4").to_string_lossy());
        assert_eq!(std::fs::read(dir.join("clip.mp4")).unwrap(), b"existing"); // untouched
        assert_eq!(std::fs::read(dir.join("clip (2).mp4")).unwrap(), b"new export");
        std::fs::remove_dir_all(&dir).ok();
    }
}
