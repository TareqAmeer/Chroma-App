// Diagnostic-only: call get_thumbnail's exact logic directly against a real file, bypassing
// Tauri IPC/webview entirely, to see the actual success/error/panic outcome deterministically.
//
//   cargo run --example test_thumb -- <path1> [path2] [path3] ...
#[path = "../src/platform/mod.rs"]
mod platform;
#[path = "../src/rawdenoise.rs"]
mod rawdenoise;
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/arcface.rs"]
mod arcface;
#[path = "../src/clip.rs"]
mod clip;
#[path = "../src/dino.rs"]
mod dino;
#[path = "../src/ingest.rs"]
mod ingest;
#[path = "../src/petdetect.rs"]
mod petdetect;
#[path = "../src/raw_decode.rs"]
mod raw_decode;
#[path = "../src/scrfd.rs"]
mod scrfd;
#[path = "../src/smart_albums.rs"]
mod smart_albums;
#[path = "../src/bgwork.rs"]
mod bgwork;
#[path = "../src/canon.rs"]
mod canon;
#[path = "../src/catalog.rs"]
mod catalog;
#[path = "../src/diag.rs"]
mod diag;
#[path = "../src/formats.rs"]
mod formats;
#[path = "../src/geocode.rs"]
mod geocode;
#[path = "../src/still_decode.rs"]
mod still_decode;
#[path = "../src/strip_cache.rs"]
mod strip_cache;
#[path = "../src/trash_undo.rs"]
mod trash_undo;
#[path = "../src/videothumb.rs"]
mod videothumb;
#[path = "../src/lens_correct.rs"]
mod lens_correct;
// library.rs calls crate::fastthumb (the ImageIO fast path), so an example that includes it has
// to declare that module too — otherwise the example fails to compile while the app builds fine,
// which is exactly how this went unnoticed.
#[path = "../src/fastthumb.rs"]
mod fastthumb;
#[path = "../src/library.rs"]
mod library;

use tauri::ipc::IpcResponse;


// The app's main.rs owns these two crate-root helpers that the #[path] modules above call as crate::...; reproduced here so this example links.
#[allow(dead_code)]
fn on_interactive_pool<R: Send>(f: impl FnOnce() -> R + Send) -> R { f() }
#[allow(dead_code)]
pub(crate) fn unique_dest_pub(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let base = std::path::Path::new(name);
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

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: test_thumb <path1> [path2] ...");
        std::process::exit(2);
    }
    for path in args {
        let t0 = std::time::Instant::now();
        let result = std::panic::catch_unwind(|| library::get_thumbnail(path.clone()));
        let elapsed = t0.elapsed();
        match result {
            Ok(Ok(resp)) => {
                let n = match resp.body() {
                    Ok(tauri::ipc::InvokeResponseBody::Raw(b)) => b.len(),
                    _ => 0,
                };
                println!("OK  {:>8.3}s  {} bytes  {}", elapsed.as_secs_f64(), n, path);
            }
            Ok(Err(e)) => {
                println!("ERR {:>8.3}s  {:?}  {}", elapsed.as_secs_f64(), e, path);
            }
            Err(panic) => {
                let msg = panic.downcast_ref::<String>().cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_else(|| "<non-string panic>".to_string());
                println!("PANIC {:>8.3}s  {}  {}", elapsed.as_secs_f64(), msg, path);
            }
        }
    }
}
