// Headless CLI export (ROADMAP.md R15, part 2) — an argv path into the native RAW pipeline,
// following dump_rw2.rs's exact pattern (no Tauri/GUI bootstrap).
//
//   cargo run --release --example cli_export -- input.RW2 output.png [--dcp path/to/profile.dcp]
//
// ⚠️ SCOPE, stated up front because it is easy to overclaim: this does RAW decode → demosaic →
// per-camera colour matrix (XYZ->sRGB, the SAME `srgb_rgba` main.rs uses for cameras with no
// bundled DCP — see raw_decode.rs) → PNG/JPEG encode. It does NOT reproduce a Chromasmith export:
//
//   - No DCP LookTable/tone-curve bake. That happens in JS (`bakeDcpLUT`, chromasmith-22.html,
//     CLAUDE.md §7) and the Rust side only ever APPLIES an already-baked 65^3 LUT that JS hands
//     it over IPC (see main.rs's `store_dcp_lut` / `decode_raw_v2`) — there is no Rust
//     implementation of the DCP bake itself to call headlessly. `--dcp` here is accepted as a
//     compatibility no-op flag (rejected with a clear error) rather than silently ignored.
//   - No halation, bloom, grain, film artifacts, look LUTs, print profiles, tone curves, HSL
//     mixer, local-adjustment masks, or any of the WebGL `FXR` pipeline (CLAUDE.md §3). All of
//     that is JS/WebGL-only. A full-fidelity headless export of an actual Chromasmith edit needs
//     to drive the real app, which is exactly what test/export_harness.mjs already does
//     (Playwright + `applyUISnapshot`/`processToCanvas`) — this binary does not attempt to
//     replace that.
//
// What this DOES give you headlessly, with no browser/WebView: a real RAW decode with the same
// demosaic/lens/NR code paths as the app, rendered to a per-camera-corrected sRGB image, for
// batch scripting, calibration tooling, or anywhere a plain "get me a viewable image from this
// RAW" step is wanted without opening the GUI.
#[path = "../src/lens_correct.rs"]
mod lens_correct;
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/rawdenoise.rs"]
mod rawdenoise;
#[path = "../src/raw_decode.rs"]
mod raw_decode;

fn print_usage() {
    eprintln!(
        "cli_export — headless RAW decode + native colour correction (NOT the full creative pipeline)\n\n\
         usage: cli_export <input.RW2|.RAW> <output.png|.jpg> [--nr off|fast|high]\n\n\
         Does: RAW decode -> demosaic -> per-camera colour matrix (XYZ->sRGB) -> PNG/JPEG encode.\n\
         Does NOT do: DCP LookTable/tone-curve bake (JS-only, see bakeDcpLUT in chromasmith-22.html),\n\
         halation, bloom, grain, film artifacts, look LUTs, print profiles, tone curves, HSL mixer,\n\
         or local-adjustment masks (all WebGL/JS-only, CLAUDE.md section 3). For a full-fidelity\n\
         headless export of a real edit, drive the app itself the way test/export_harness.mjs does."
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_usage();
        std::process::exit(0);
    }
    if args.iter().any(|a| a == "--dcp") {
        eprintln!("error: --dcp is not supported — DCP LookTable baking happens in JS (bakeDcpLUT), \
                    not Rust. This CLI only does the native camera-matrix colour correction \
                    (raw_decode::srgb_rgba). See this file's doc comment.");
        std::process::exit(2);
    }
    let positional: Vec<&String> = args.iter().skip(1).filter(|a| !a.starts_with("--")).collect();
    if positional.len() != 2 {
        print_usage();
        std::process::exit(2);
    }
    let (in_path, out_path) = (positional[0].clone(), positional[1].clone());

    let nr = match args.iter().position(|a| a == "--nr").and_then(|i| args.get(i + 1)) {
        Some(s) if s == "off" => raw_decode::NrTier::Off,
        Some(s) if s == "high" => raw_decode::NrTier::High,
        _ => raw_decode::NrTier::Fast,
    };

    let bytes = std::fs::read(&in_path).unwrap_or_else(|e| {
        eprintln!("error: could not read '{in_path}': {e}");
        std::process::exit(1);
    });

    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    sam::set_dylib_path(manifest_dir.join("vendor/onnxruntime/libonnxruntime.dylib"));
    rawdenoise::set_model_paths(
        manifest_dir.join("vendor/rawdenoise/model_linear.onnx"),
        manifest_dir.join("vendor/rawdenoise/model_bayer.onnx"),
    );

    let t0 = std::time::Instant::now();
    let decoded = raw_decode::decode_rw2_bytes(&bytes, true, nr, "ppg", false, None)
        .unwrap_or_else(|e| {
            eprintln!("error: RAW decode failed: {e}");
            std::process::exit(1);
        });
    eprintln!(
        "decoded {}x{} iso {} make={:?} lens_applied={} in {:.2}s",
        decoded.width,
        decoded.height,
        decoded.iso,
        decoded.make,
        decoded.lens_applied,
        t0.elapsed().as_secs_f32()
    );

    let rgba = raw_decode::srgb_rgba(&decoded.rgb16, decoded.xyz_to_cam);
    let (w, h) = (decoded.width, decoded.height);

    let img = image::RgbaImage::from_raw(w, h, rgba)
        .unwrap_or_else(|| {
            eprintln!("error: decoded buffer size mismatch ({w}x{h})");
            std::process::exit(1);
        });
    image::DynamicImage::ImageRgba8(img)
        .save(&out_path)
        .unwrap_or_else(|e| {
            eprintln!("error: could not write '{out_path}': {e}");
            std::process::exit(1);
        });
    eprintln!("wrote {out_path} ({w}x{h}) in {:.2}s total", t0.elapsed().as_secs_f32());
}
