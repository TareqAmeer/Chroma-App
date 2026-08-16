// Diagnostic-only: call get_thumbnail's exact logic directly against a real file, bypassing
// Tauri IPC/webview entirely, to see the actual success/error/panic outcome deterministically.
//
//   cargo run --example test_thumb -- <path1> [path2] [path3] ...
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
