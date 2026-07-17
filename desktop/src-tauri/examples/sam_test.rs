// One-off smoke test for sam.rs: encode a real photo, run a point prompt, and write the
// resulting mask as a PNG for visual inspection. Not part of the app — a dev-only harness.
// Usage: cargo run --example sam_test -- <input.jpg> <norm_x> <norm_y> <output_mask.png> [--model sam2]
// Default model is EdgeSAM (the fast tier); pass `--model sam2` to run the same query through
// SAM 2.1 Hiera-Tiny instead, for a direct quality/speed comparison against the same photo/point.
#[path = "../src/sam.rs"]
mod sam;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut pos: Vec<String> = Vec::new();
    let mut model = "edgesam".to_string();
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--model" && i + 1 < args.len() {
            model = args[i + 1].clone();
            i += 2;
        } else {
            pos.push(args[i].clone());
            i += 1;
        }
    }
    if pos.len() != 4 {
        eprintln!("usage: sam_test <input.jpg> <norm_x> <norm_y> <output_mask.png> [--model sam2]");
        std::process::exit(2);
    }
    // Standalone harness: no Tauri AppHandle here to resolve a bundled resource path, so point
    // straight at the vendored files in the source tree (matches main.rs's dev-mode fallback).
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dylib = manifest_dir.join("vendor/onnxruntime/libonnxruntime.dylib");
    if !dylib.exists() {
        eprintln!("WARNING: vendored dylib not found at {} — set ORT_DYLIB_PATH manually if this fails", dylib.display());
    }
    sam::set_dylib_path(dylib);
    sam::set_sam2_model_paths(manifest_dir.join("vendor/sam2/encoder.onnx"), manifest_dir.join("vendor/sam2/decoder.onnx"));

    eprintln!("loading image...");
    let img = image::open(&pos[0]).expect("open input image").to_rgb8();
    let (w, h) = (img.width(), img.height());
    let rgb = img.into_raw();
    let nx: f32 = pos[1].parse().expect("norm_x");
    let ny: f32 = pos[2].parse().expect("norm_y");

    let mask = if model == "sam2" {
        eprintln!("image loaded: {}x{}, calling sam::sam2_encode...", w, h);
        let t0 = std::time::Instant::now();
        let embedding = sam::sam2_encode(&rgb, w, h).expect("sam::sam2_encode");
        eprintln!("sam2_encode: {}x{} in {:.2}s", w, h, t0.elapsed().as_secs_f32());
        let t1 = std::time::Instant::now();
        let mask = sam::sam2_decode_points(&embedding, &[(nx, ny, true)]).expect("sam::sam2_decode_points");
        eprintln!("sam2_decode_points: {:.3}s, {} bytes", t1.elapsed().as_secs_f32(), mask.len());
        mask
    } else {
        eprintln!("image loaded: {}x{}, calling sam::encode...", w, h);
        let t0 = std::time::Instant::now();
        let embedding = sam::encode(&rgb, w, h).expect("sam::encode");
        eprintln!("encode: {}x{} in {:.2}s", w, h, t0.elapsed().as_secs_f32());
        let t1 = std::time::Instant::now();
        let mask = sam::decode_points(&embedding, &[(nx, ny, true)]).expect("sam::decode_points");
        eprintln!("decode_points: {:.3}s, {} bytes", t1.elapsed().as_secs_f32(), mask.len());
        mask
    };

    let selected = mask.iter().filter(|&&v| v > 0).count();
    eprintln!("selected pixels: {} / {} ({:.1}%)", selected, mask.len(), 100.0 * selected as f32 / mask.len() as f32);

    let mask_img = image::GrayImage::from_raw(w, h, mask).expect("mask buffer size");
    mask_img.save(&pos[3]).expect("save mask png");
    eprintln!("wrote {}", pos[3]);
}
