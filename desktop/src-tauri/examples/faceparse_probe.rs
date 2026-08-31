// One-off smoke test for the skin-class addition to faceparse.rs (ROADMAP "Mask system" item 4's
// remainder, mskFaceSelectSkin). Runs the real face-parsing model on a real photo crop and writes
// each of the 5 groups (eyes_brows, glasses, lips, hair, skin) as a grayscale PNG for visual
// inspection, plus prints mean coverage. Not part of the app — a dev-only harness, mirrors
// sam_test.rs's structure.
//
// Usage: cargo run --example faceparse_probe -- <input.jpg> <cx> <cy> <half> <out_prefix>
// where (cx,cy) is the center of a square head crop of side 2*half, in image pixels.
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/faceparse.rs"]
mod faceparse;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 6 {
        eprintln!("usage: faceparse_probe <input.jpg> <cx> <cy> <half> <out_prefix>");
        std::process::exit(2);
    }
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dylib = manifest_dir.join("vendor/onnxruntime/libonnxruntime.dylib");
    sam::set_dylib_path(dylib);
    faceparse::set_model_path(manifest_dir.join("vendor/faceparse/model_quantized.onnx"));

    let img = image::open(&args[1]).expect("open input image").to_rgb8();
    let (iw, ih) = img.dimensions();
    let cx: i64 = args[2].parse().unwrap();
    let cy: i64 = args[3].parse().unwrap();
    let half: i64 = args[4].parse().unwrap();
    let out_prefix = &args[5];

    let x0 = (cx - half).max(0) as u32;
    let y0 = (cy - half).max(0) as u32;
    let x1 = (cx + half).min(iw as i64) as u32;
    let y1 = (cy + half).min(ih as i64) as u32;
    let (cw, ch) = (x1 - x0, y1 - y0);
    eprintln!("crop: {x0},{y0} {cw}x{ch} from {iw}x{ih}");
    let crop = image::imageops::crop_imm(&img, x0, y0, cw, ch).to_image();

    eprintln!("running face-parse...");
    let masks = faceparse::parse(crop.as_raw(), cw, ch).expect("face-parse run");

    let mean = |m: &[u8]| -> f32 { m.iter().map(|&v| v as f32).sum::<f32>() / (m.len() as f32 * 255.0) };
    println!(
        "mean coverage: eyes_brows={:.4} glasses={:.4} lips={:.4} hair={:.4} skin={:.4}",
        mean(&masks.eyes_brows),
        mean(&masks.glasses),
        mean(&masks.lips),
        mean(&masks.hair),
        mean(&masks.skin)
    );

    for (name, data) in [
        ("eyes_brows", &masks.eyes_brows),
        ("glasses", &masks.glasses),
        ("lips", &masks.lips),
        ("hair", &masks.hair),
        ("skin", &masks.skin)
    ] {
        let out_img = image::GrayImage::from_raw(masks.w, masks.h, data.clone()).unwrap();
        let path = format!("{out_prefix}_{name}.png");
        out_img.save(&path).expect("save mask png");
        eprintln!("wrote {path}");
    }
    // Also dump the source crop for side-by-side comparison.
    let crop_path = format!("{out_prefix}_source.png");
    crop.save(&crop_path).expect("save source crop");
    eprintln!("wrote {crop_path}");
}
