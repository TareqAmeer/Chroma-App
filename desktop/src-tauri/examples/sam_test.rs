// One-off smoke test for sam.rs: encode a real photo, run a point prompt, and write the
// resulting mask as a PNG for visual inspection. Not part of the app — a dev-only harness.
// Usage: cargo run --example sam_test -- <input.jpg> <norm_x> <norm_y> <output_mask.png>
#[path = "../src/sam.rs"]
mod sam;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: sam_test <input.jpg> <norm_x> <norm_y> <output_mask.png>");
        std::process::exit(2);
    }
    // Standalone harness: no Tauri AppHandle here to resolve a bundled resource path, so point
    // straight at the vendored dylib in the source tree (matches main.rs's dev-mode fallback).
    let dylib = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
    if !dylib.exists() {
        eprintln!("WARNING: vendored dylib not found at {} — set ORT_DYLIB_PATH manually if this fails", dylib.display());
    }
    sam::set_dylib_path(dylib);

    eprintln!("loading image...");
    let img = image::open(&args[1]).expect("open input image").to_rgb8();
    let (w, h) = (img.width(), img.height());
    let rgb = img.into_raw();
    eprintln!("image loaded: {}x{}, calling sam::encode...", w, h);

    let t0 = std::time::Instant::now();
    let embedding = sam::encode(&rgb, w, h).expect("sam::encode");
    eprintln!("encode: {}x{} in {:.2}s", w, h, t0.elapsed().as_secs_f32());

    let nx: f32 = args[2].parse().expect("norm_x");
    let ny: f32 = args[3].parse().expect("norm_y");
    let t1 = std::time::Instant::now();
    let mask = sam::decode_point(&embedding, nx, ny, true).expect("sam::decode_point");
    eprintln!("decode_point: {:.3}s, {} bytes", t1.elapsed().as_secs_f32(), mask.len());

    let selected = mask.iter().filter(|&&v| v > 0).count();
    eprintln!("selected pixels: {} / {} ({:.1}%)", selected, mask.len(), 100.0 * selected as f32 / mask.len() as f32);

    let mask_img = image::GrayImage::from_raw(w, h, mask).expect("mask buffer size");
    mask_img.save(&args[4]).expect("save mask png");
    eprintln!("wrote {}", args[4]);
}
