// How long a COLD thumbnail actually takes, per source type. Item 15 (decode tiering) assumes the
// answer is "too long"; this checks before anything is built.
#[path = "../src/lens_correct.rs"] mod lens_correct;
#[path = "../src/sam.rs"] mod sam;
#[path = "../src/rawdenoise.rs"] mod rawdenoise;
#[path = "../src/raw_decode.rs"] mod raw_decode;
#[cfg(target_os = "macos")]
#[path = "../src/fastthumb.rs"] mod fastthumb;
#[path = "../src/library.rs"] mod library;
fn main() {
    for f in std::env::args().skip(1) {
        // Bust the disk cache so this measures a real cold decode, not a file read.
        let _ = std::fs::remove_dir_all(dirs_cache());
        let t = std::time::Instant::now();
        let r = library::get_thumbnail(f.clone());
        let cold = t.elapsed();
        let t2 = std::time::Instant::now();
        let _ = library::get_thumbnail(f.clone());
        let warm = t2.elapsed();
        // Tier 1: the camera's own embedded preview, no full decode.
        let t3 = std::time::Instant::now();
        let fast = library::get_thumbnail_fast(f.clone());
        let fast_ms = t3.elapsed().as_secs_f64()*1000.0;
        println!("{:<26} full {:>7.1}ms  cached {:>5.1}ms  fast {:>6.1}ms {:<4} {}",
            short(&f), cold.as_secs_f64()*1000.0, warm.as_secs_f64()*1000.0, fast_ms,
            if fast.is_ok() { "ok" } else { "n/a" },
            if r.is_ok() { "" } else { "MAIN ERR" });
    }
}
fn dirs_cache() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    std::path::PathBuf::from(home).join("Library/Caches/com.tareq.chromasmith/thumbnails")
}
fn short(p: &str) -> String {
    std::path::Path::new(p).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}
