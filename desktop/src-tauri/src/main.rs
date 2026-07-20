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
// too slow while the native RAW pipeline is still being iterated on. Trade-off: this hardcodes
// this dev machine's path, so it only works here, not as a portable double-clickable app.
// TODO before shipping: switch to Tauri's bundled "resources" (tauri.conf.json bundle.resources
// + app.path().resource_dir()) so the built .app is portable to any Mac.
const DIST_DIR: &str = "/Users/tareqameer/Documents/GitHub/Chroma-App/desktop/dist";

mod lens_correct;
mod library;
mod raw_decode;
mod sam;

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
    let mut guard = DCP_LUTS.lock().unwrap();
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

#[tauri::command]
fn decode_raw_v2(request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
    let (json, payload) = parse_framed(request.body())?;
    let mode = json["mode"].as_str().unwrap_or("linear16");
    let auto_lens = json["autoLens"].as_bool().unwrap_or(false);
    let native_nr = json["nativeNr"].as_bool().unwrap_or(true);
    // Per-photo "RAW Processing" mode ("" = Standard/PPG, "ahd" = Sparkle-optimized) — see
    // raw_decode.rs's decode_rw2_bytes doc comment for why this is opt-in, not a global default.
    let demosaic_algo = json["demosaicAlgo"].as_str().unwrap_or("");
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
    let decoded = raw_decode::decode_rw2_bytes(payload, auto_lens, native_nr, demosaic_algo, fast, lens_override)?;
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
                let guard = DCP_LUTS.lock().unwrap();
                guard
                    .as_ref()
                    .and_then(|m| m.get(key).cloned())
                    .ok_or_else(|| format!("LUT '{key}' not registered"))?
            };
            let n = (lut.len() / 3) as f64;
            let n = n.cbrt().round() as usize;
            raw_decode::apply_lut_rgba(&decoded.rgb16, &lut, n)
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
#[tauri::command]
fn download_url_native(app: tauri::AppHandle, url: String, bearer: String) -> Result<tauri::ipc::Response, String> {
    use std::io::Read;
    if !url.starts_with("https://") {
        return Err("refusing to download a non-https URL".into());
    }
    let req = ureq::get(&url).set("Authorization", &format!("Bearer {bearer}"));
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
    "2026-07-20a"
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
#[tauri::command]
fn write_file_bytes(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("decode base64: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))
}

// A file handed to us at launch (Lightroom's "Edit In", Finder's "Open With", or `open -a
// Chromasmith file.tif` from a terminal) — see RunEvent::Opened in main() below, which is the
// real macOS Launch-Services path all three of those go through, plus the args() fallback in
// .setup() for direct CLI launches. Stashed here instead of emitted as a bare event because
// RunEvent::Opened can fire on a cold start BEFORE the webview's JS has finished loading and
// registered a listener — an emitted event with no listener yet is just lost. library-ui.js
// pulls this once at its own startup instead, so timing can't drop it either way.
struct PendingOpen(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_open_path(state: tauri::State<PendingOpen>) -> Option<String> {
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
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("bad base64 payload: {e}"))?;
    let dir = gphotos_downloads_path()?;
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

#[tauri::command]
async fn google_oauth_loopback(auth_url_template: String) -> Result<OAuthResult, String> {
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
        .manage(PendingOpen(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            store_dcp_lut,
            decode_raw_v2,
            lens_profile_available,
            list_lens_profiles,
            download_url_native,
            native_build_tag,
            open_url_native,
            haptic_feedback,
            peek_raw_camera,
            read_file_bytes,
            write_file_bytes,
            take_pending_open_path,
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
            library::get_decode_cache,
            library::save_decode_cache,
            sam_encode,
            sam_points,
            sam2_encode,
            sam2_points,
            save_to_gphotos_downloads,
            gphotos_downloads_dir
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
            let full = format!("{DIST_DIR}/{path}");
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

            // CLI/manual-launch fallback for the Lightroom "Edit In" handoff (see PendingOpen
            // above) — `open -a Chromasmith file.tif` or a direct binary launch with a path
            // argument. RunEvent::Opened in run() below is the real Launch-Services path
            // Lightroom/Finder actually use; this just covers the same handoff when testing
            // from a terminal, where no Opened event fires at all.
            if let Some(arg) = std::env::args().skip(1).find(|a| Path::new(a).is_file()) {
                *handle.state::<PendingOpen>().0.lock().unwrap() = Some(arg);
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

            let menu = Menu::with_items(handle, &[&app_menu, &file_menu, &edit_menu, &window_menu])?;
            app.set_menu(menu)?;

            let handle2 = handle.clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().0.as_str();
                if matches!(id, "menu-open" | "menu-library" | "menu-export" | "menu-undo" | "menu-redo") {
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
                if let Some(path) = urls.into_iter().find_map(|u| u.to_file_path().ok()) {
                    let path_s = path.to_string_lossy().into_owned();
                    *app_handle.state::<PendingOpen>().0.lock().unwrap() = Some(path_s.clone());
                    let _ = app_handle.emit("open-file-path", path_s);
                }
            }
        });
}
