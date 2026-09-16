// Diagnostic-only: call winvideothumb::poster_jpeg directly against real video files, bypassing
// Tauri IPC/library.rs's disk-cache wrapper entirely, to see whether the Windows shell thumbnail
// handler (IShellItemImageFactory) actually produces a poster frame for these files.
//
//   cargo run --release --example probe_video_thumb -- <path1> [path2] ...
#[path = "../src/winvideothumb.rs"]
mod winvideothumb;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: probe_video_thumb <path1> [path2] ...");
        std::process::exit(2);
    }
    for path in args {
        let t0 = std::time::Instant::now();
        let result = winvideothumb::poster_jpeg(&path, 360, 0.0);
        let elapsed = t0.elapsed();
        match result {
            Some(bytes) => println!("OK  {:>8.3}s  {} bytes  {}", elapsed.as_secs_f64(), bytes.len(), path),
            None => println!("NONE {:>8.3}s  {}", elapsed.as_secs_f64(), path),
        }
    }
}
