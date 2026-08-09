// Exercises gainmap.rs end to end against real files, outside the app.
//
//   cargo run --release --example gainmap_test -- <source-with-hdr> <graded-sdr.png> <out.heic>
//
// Then verify the result carries an ISO 21496-1 gain map and opens as HDR:
//   sips --getProperty all out.heic
//   qlmanage -p out.heic          (Preview/QuickLook show HDR on macOS 15+)

#[cfg(target_os = "macos")]
#[path = "../src/gainmap.rs"]
mod gainmap;

#[cfg(target_os = "macos")]
fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 4 {
        eprintln!("usage: gainmap_test <source> <graded.png> <out.heic>");
        std::process::exit(2);
    }
    let (src, graded_path, out) = (&a[1], &a[2], &a[3]);

    match gainmap::source_headroom(src) {
        Ok(v) => println!("headroom (expanded/unexpanded) = {v:.4}  -> hdr = {}", v > 1.02),
        Err(e) => println!("source_headroom failed: {e}"),
    }

    let graded = std::fs::read(graded_path).expect("read graded png");
    println!("graded render: {} bytes", graded.len());

    match gainmap::write_gainmap_heic(src, &graded, out, 0.92) {
        Ok(true) => {
            let sz = std::fs::metadata(out).map(|m| m.len()).unwrap_or(0);
            println!("WROTE {out} ({sz} bytes) with a gain map");
        }
        Ok(false) => println!("source had no HDR headroom — caller should fall back to SDR export"),
        Err(e) => {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("macOS only");
}
