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

mod raw_decode;

// Native RW2 decode (see raw_decode.rs for why: WKWebView's SharedArrayBuffer support isn't
// reliable enough for the browser build's libraw-wasm decoder in this native shell). Input is
// base64 (simplest correct thing — decode is a one-time cost per photo import, not a hot
// loop, so the ~33% encode overhead on a ~25MB RW2 doesn't matter in practice). Output uses
// tauri::ipc::Response to skip JSON/base64 entirely for the much larger (~3x) decoded buffer:
// a tiny fixed header (width/height/iso as little-endian u32) followed by raw u16 RGB bytes,
// parsed back out in desktop-native.js's LibRaw shim.
#[tauri::command]
fn decode_raw(bytes_b64: String) -> Result<tauri::ipc::Response, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&bytes_b64)
        .map_err(|e| format!("base64: {e}"))?;
    let decoded = raw_decode::decode_rw2_bytes(&bytes)?;
    let mut out = Vec::with_capacity(12 + decoded.rgb16.len() * 2);
    out.extend_from_slice(&decoded.width.to_le_bytes());
    out.extend_from_slice(&decoded.height.to_le_bytes());
    out.extend_from_slice(&decoded.iso.to_le_bytes());
    for v in &decoded.rgb16 {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(tauri::ipc::Response::new(out))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![decode_raw])
        // Custom "cs://" protocol serving the embedded dist/ with EXPLICIT COOP/COEP headers
        // on every single response, including the very first navigation — see the Cargo.toml
        // comment for why the declarative app.security.headers config wasn't reliable here.
        .register_uri_scheme_protocol("cs", |_ctx, request| {
            let path = request.uri().path().trim_start_matches('/');
            let path = if path.is_empty() { "index.html" } else { path };
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
            let export_item =
                MenuItem::with_id(handle, "menu-export", "Export…", true, Some("CmdOrCtrl+E"))?;
            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &open_item,
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
                if matches!(id, "menu-open" | "menu-export" | "menu-undo" | "menu-redo") {
                    let _ = handle2.emit(id, ());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Chromasmith");
}
