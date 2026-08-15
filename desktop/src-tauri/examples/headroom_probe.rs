// Measures how much HDR headroom real source files actually carry, which is what decides whether
// the "HDR (gain map)" export option can appear for a given photo at all.
//   cargo run --release --example headroom_probe -- <file> [file...]
#[cfg(target_os = "macos")]
#[path = "../src/gainmap.rs"]
mod gainmap;

#[cfg(target_os = "macos")]
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: headroom_probe <file>..."); std::process::exit(2); }
    println!("{:<44} {:>10}  {}", "file", "headroom", "HDR export offered?");
    println!("{}", "-".repeat(78));
    for f in &args {
        match gainmap::source_headroom(f) {
            Ok(h) => println!("{:<44} {:>10.4}  {}", short(f), h, if h > 1.02 { "YES" } else { "no" }),
            Err(e) => println!("{:<44} {:>10}  {e}", short(f), "err"),
        }
    }
}
#[cfg(target_os = "macos")]
fn short(p: &str) -> String {
    let n = std::path::Path::new(p).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    if n.len() > 42 { n[..42].to_string() } else { n }
}
#[cfg(not(target_os = "macos"))]
fn main() { eprintln!("macOS only"); }
