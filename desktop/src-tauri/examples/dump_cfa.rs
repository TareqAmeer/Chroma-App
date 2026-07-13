// Calibration helper (not part of the app): decode an RW2 through rawler up to
// apply_scaling() ONLY — i.e. per-CFA black/white-level normalized Bayer data, BEFORE
// white-balance multipliers and BEFORE demosaic — and dump the raw single-channel plane to
// disk for calib/noise_fit.py's Poisson-Gaussian noise calibration.
//
// This deliberately stops short of raw_decode.rs's full pipeline: the noise model must be
// fit on un-white-balanced data (WB is a per-channel gain that would distort the fitted
// variance curve — see CLAUDE.md's noise-model plan), so this dumps an EARLIER stage than
// dump_rw2.rs (which reproduces the app's full decode).
//
//   cargo run --release --example dump_cfa -- input.RW2 output.bin
//
// Output format: a JSON sidecar `output.bin.json` with
//   {width, height, iso, cfa_pattern: [[r,c],...] colors 0=R,1=G,2=B}
// followed by output.bin: width*height little-endian f32, row-major, one value per Bayer
// sample in 0..1 (post black/white scaling, pre-WB, pre-demosaic).
use rawler::decoders::RawDecodeParams;
use rawler::rawimage::RawPhotometricInterpretation;
use rawler::rawsource::RawSource;
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: dump_cfa <input.RW2> <output.bin>");
        std::process::exit(2);
    }
    let bytes = std::fs::read(&args[1]).expect("read input");
    let source = RawSource::new_from_slice(&bytes);
    let decoder = rawler::get_decoder(&source).expect("no decoder");
    let params = RawDecodeParams::default();
    let metadata = decoder.raw_metadata(&source, &params).expect("metadata");
    let mut raw_image = decoder.raw_image(&source, &params, false).expect("decode");

    let iso = metadata
        .exif
        .iso_speed_ratings
        .map(|v| v as u32)
        .or(metadata.exif.iso_speed)
        .unwrap_or(200);

    // Per-CFA black/white-level normalization → f32 in 0..1 (rawler-maintained math), same
    // call raw_decode.rs uses. NOTHING else — no WB, no demosaic.
    raw_image.apply_scaling().expect("black/white scaling");

    let w = raw_image.width;
    let h = raw_image.height;

    let cfa_config = match &raw_image.photometric {
        RawPhotometricInterpretation::Cfa(config) => config.clone(),
        other => panic!("unsupported photometric interpretation: {other:?}"),
    };

    let pixels: Vec<f32> = raw_image.data.as_f32().into_owned();
    assert_eq!(pixels.len(), w * h, "unexpected pixel count");

    // CFA pattern as a small tile of color indices (0=R,1=G,2=B), read via color_at over the
    // CFA's own repeat period (rawler CFA is typically 2x2 for Bayer).
    let (pw, ph) = (2usize, 2usize); // Panasonic/Bayer sensors are 2x2; generalizes fine if not.
    let mut pattern = vec![vec![0u8; pw]; ph];
    for row in 0..ph {
        for col in 0..pw {
            pattern[row][col] = cfa_config.cfa.color_at(row, col) as u8;
        }
    }

    eprintln!(
        "{} -> {}x{} iso {} cfa {:?}",
        args[1], w, h, iso, pattern
    );

    let f = std::fs::File::create(&args[2]).expect("create output");
    let mut wtr = std::io::BufWriter::new(f);
    let bytes32: Vec<u8> = pixels.iter().flat_map(|v| v.to_le_bytes()).collect();
    wtr.write_all(&bytes32).unwrap();
    drop(wtr);

    let sidecar = format!(
        "{{\"width\":{w},\"height\":{h},\"iso\":{iso},\"cfa_pattern\":{}}}",
        serde_json::to_string(&pattern).unwrap()
    );
    std::fs::write(format!("{}.json", &args[2]), sidecar).expect("write sidecar json");
}
