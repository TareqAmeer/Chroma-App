// Chromasmith desktop shell — a thin native wrapper around the single-file web app
// (chromasmith-22.html, staged into dist/ unmodified by build-desktop.sh). No app logic
// lives here: this only wires OS-level integration (native menu bar, file dialogs) on top.
// The frontend listens for the "menu-*" events emitted below (see desktop-native.js) and
// calls the SAME JS functions the on-screen buttons already call — no duplicated logic.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

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

#[tauri::command]
fn decode_raw_v2(request: tauri::ipc::Request) -> Result<tauri::ipc::Response, String> {
    let (json, payload) = parse_framed(request.body())?;
    let mode = json["mode"].as_str().unwrap_or("linear16");
    let auto_lens = json["autoLens"].as_bool().unwrap_or(false);
    let native_nr = json["nativeNr"].as_bool().unwrap_or(true);
    let decoded = raw_decode::decode_rw2_bytes(payload, auto_lens, native_nr)?;
    let body: Vec<u8> = match mode {
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
    let mut out = Vec::with_capacity(12 + body.len());
    out.extend_from_slice(&decoded.width.to_le_bytes());
    out.extend_from_slice(&decoded.height.to_le_bytes());
    out.extend_from_slice(&decoded.iso.to_le_bytes());
    out.extend_from_slice(&body);
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
fn lens_profile_available(make: String, model: String, lens_model: String) -> bool {
    lens_correct::profile_available(&make, &model, &lens_model)
}

// Read a file's raw bytes for the Library view to open a selected photo into the editor (a
// plain File-shaped object, same as picking it from the OS file dialog or dragging it in).
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            store_dcp_lut,
            decode_raw_v2,
            lens_profile_available,
            read_file_bytes,
            google_oauth_loopback,
            library::list_dir,
            library::get_thumbnail,
            library::get_preview,
            library::get_meta,
            library::get_sidecar,
            library::set_sidecar
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Chromasmith");
}
