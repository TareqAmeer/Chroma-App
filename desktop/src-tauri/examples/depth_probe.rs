// One-off smoke test for depth.rs (ROADMAP R7) — runs the REAL Depth Anything V2 ONNX model on a
// real photo and writes the depth map as a grayscale PNG, to confirm the model's I/O contract
// (never verified with a live forward pass when R7 was built — see depth.rs's own doc comment)
// actually matches what the code assumes, before shipping. Mirrors faceparse_probe.rs's structure.
//
// Usage: cargo run --example depth_probe -- <input.jpg> <out.png>
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/depth.rs"]
mod depth;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: depth_probe <input.jpg> <out.png>");
        std::process::exit(2);
    }
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dylib = manifest_dir.join("vendor/onnxruntime/libonnxruntime.dylib");
    sam::set_dylib_path(dylib);
    depth::set_model_path(manifest_dir.join("vendor/depth/model_quantized.onnx"));

    let img = image::open(&args[1]).expect("open input image").to_rgb8();
    let (w, h) = img.dimensions();
    eprintln!("input: {w}x{h}");

    eprintln!("running depth estimation...");
    let t0 = std::time::Instant::now();
    let map = depth::estimate(img.as_raw(), w, h).expect("depth estimate failed");
    eprintln!("done in {:?}, {} bytes (expect {})", t0.elapsed(), map.len(), (w * h) as usize);
    assert_eq!(map.len(), (w * h) as usize, "output size must match requested w*h");

    let mn = *map.iter().min().unwrap();
    let mx = *map.iter().max().unwrap();
    let mean = map.iter().map(|&v| v as f64).sum::<f64>() / map.len() as f64;
    eprintln!("depth byte range: min={mn} max={mx} mean={mean:.1}");
    assert!(mx > mn, "a real depth map must have nonzero spread, got a flat {mn}");

    let out = image::GrayImage::from_raw(w, h, map).expect("build gray image");
    out.save(&args[2]).expect("save output png");
    eprintln!("wrote {}", args[2]);
}
