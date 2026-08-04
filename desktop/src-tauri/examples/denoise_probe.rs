// A0 go/no-go gate for the High-tier RAW denoiser (RawNIND UtNet2 / rawdenoise-nind) — see the
// plan's §A6 step 0. Two independent things, both required before any pipeline code gets built
// around this model:
//
//   1. TIMING, measured on THIS Intel Mac (darktable's own "tens of seconds" claim is not a
//      measurement on this hardware). Runs several 512x512 tiles through the real model_linear
//      session, reports first-run vs steady-state per-tile time, and extrapolates to a full
//      24MP frame's tile count at the plan's tile geometry (512 tile, 32px halo, 448 step).
//   2. COLOUR ROUND-TRIP correctness. The model wants linear Rec.2020; the decode pipeline
//      produces linear camera RGB. That conversion is a chain of 3x3 matrices (camera->XYZ,
//      then a D50<->D65 Bradford adaptation, then XYZ->Rec2020 — see raw_decode.rs's insertion
//      point comment) that MUST invert to <1 LSB with inference bypassed, or a silent colour
//      shift is indistinguishable from "the model changed the colour". This probe cannot use the
//      real DC-S9 camera matrix (that lives in rawler's per-file metadata, exercised only once
//      this is wired into raw_decode.rs in phase A1) — it substitutes the standard sRGB-D65
//      primaries matrix as a stand-in "camera" matrix, which is fine: the property under test is
//      whether the matrix-chain/inverse CODE composes correctly, not whether these specific
//      constants are the DC-S9's. A1 swaps in the real forward matrix; the round-trip math is
//      unchanged.
//
// Usage: cargo run --release --example denoise_probe
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/rawdenoise.rs"]
mod rawdenoise;

use std::time::Instant;

// ---- Part 2: colour round-trip -------------------------------------------------------------

type Mat3 = [[f64; 3]; 3];

fn matmul(a: Mat3, b: Mat3) -> Mat3 {
    let mut out = [[0f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    out
}

fn mat_inv(m: Mat3) -> Mat3 {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let inv_det = 1.0 / det;
    [
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det
        ],
    ]
}

fn apply(m: Mat3, rgb: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * rgb[0] + m[0][1] * rgb[1] + m[0][2] * rgb[2],
        m[1][0] * rgb[0] + m[1][1] * rgb[1] + m[1][2] * rgb[2],
        m[2][0] * rgb[0] + m[2][1] * rgb[1] + m[2][2] * rgb[2],
    ]
}

// Standard sRGB (D65-referenced) RGB -> XYZ, IEC 61966-2-1. Stand-in "camera" matrix for this
// probe — see module doc.
const SRGB_TO_XYZ_D65: Mat3 =
    [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]];

// Standard Rec.2020 (D65-referenced) RGB -> XYZ.
const REC2020_TO_XYZ_D65: Mat3 =
    [[0.6369580, 0.1446169, 0.1688810], [0.2627002, 0.6779981, 0.0593017], [0.0000000, 0.0280727, 1.0609851]];

fn colour_roundtrip_check() {
    println!("=== colour round-trip (sRGB stand-in camera -> linear Rec.2020 -> back) ===");
    let fwd = matmul(mat_inv(REC2020_TO_XYZ_D65), SRGB_TO_XYZ_D65); // camera -> XYZ -> Rec2020
    let inv = mat_inv(fwd);
    let identity_check = matmul(fwd, inv);
    let identity_err: f64 = (0..3)
        .flat_map(|i| (0..3).map(move |j| (i, j)))
        .map(|(i, j)| {
            let expect = if i == j { 1.0 } else { 0.0 };
            (identity_check[i][j] - expect).abs()
        })
        .fold(0.0, f64::max);
    println!("fwd*inv identity max abs error: {identity_err:.3e}");

    // Synthetic 16-bit test values: a gradient plus a few "real photo"-ish points, avoiding pure
    // 0 (matrix chains can amplify relative error near zero, which is a real and expected
    // property near black — not a bug — so the pass bar is stated in absolute LSB, not relative).
    let mut max_lsb_err = 0f64;
    let mut worst = (0u16, 0u16, 0u16);
    for i in 0..=20u32 {
        let t = i as f64 / 20.0;
        for &(r, g, b) in &[(t, t * 0.6, t * 0.3), (t * 0.2, t, t * 0.5), (t * 0.8, t * 0.4, t)] {
            let cam_u16 = [(r * 65535.0) as u16, (g * 65535.0) as u16, (b * 65535.0) as u16];
            let cam_f = [cam_u16[0] as f64 / 65535.0, cam_u16[1] as f64 / 65535.0, cam_u16[2] as f64 / 65535.0];
            let rec2020 = apply(fwd, cam_f);
            let back = apply(inv, rec2020);
            let back_u16 = [
                (back[0].clamp(0.0, 1.0) * 65535.0).round(),
                (back[1].clamp(0.0, 1.0) * 65535.0).round(),
                (back[2].clamp(0.0, 1.0) * 65535.0).round()
            ];
            for c in 0..3 {
                let err = (back_u16[c] - cam_u16[c] as f64).abs();
                if err > max_lsb_err {
                    max_lsb_err = err;
                    worst = (cam_u16[0], cam_u16[1], cam_u16[2]);
                }
            }
        }
    }
    println!("max |error| over synthetic sweep: {max_lsb_err:.3} LSB (16-bit), worst input rgb={worst:?}");
    if max_lsb_err < 1.0 {
        println!("PASS: colour round-trip <1 LSB");
    } else {
        println!("FAIL: colour round-trip >=1 LSB — do not proceed to pipeline integration until this is fixed");
    }
}

// ---- Part 1: timing --------------------------------------------------------------------------

fn timing_check() {
    println!("\n=== timing (model_linear.onnx, one 512x512x3 tile per run) ===");
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dylib = manifest_dir.join("vendor/onnxruntime/libonnxruntime.dylib");
    if !dylib.exists() {
        eprintln!("WARNING: vendored dylib not found at {} — this will fail", dylib.display());
    }
    sam::set_dylib_path(dylib);
    let linear = manifest_dir.join("vendor/rawdenoise/model_linear.onnx");
    let bayer = manifest_dir.join("vendor/rawdenoise/model_bayer.onnx");
    if !linear.exists() {
        eprintln!("model_linear.onnx not found at {} — see vendor/rawdenoise/README.md to fetch it", linear.display());
        std::process::exit(2);
    }
    rawdenoise::set_model_paths(linear, bayer);

    fn stats(v: &[f32]) -> (f32, f32, f32, f32) {
        let n = v.len() as f64;
        let mean = v.iter().map(|&x| x as f64).sum::<f64>() / n;
        let var = v.iter().map(|&x| (x as f64 - mean).powi(2)).sum::<f64>() / n;
        let min = v.iter().cloned().fold(f32::INFINITY, f32::min);
        let max = v.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        (min, max, mean as f32, var.sqrt() as f32)
    }

    // Try a few input styles: a near-flat smooth gradient (low variance — could trip a
    // variance-normalization layer into dividing by ~0) and a synthetic-noise "photographic"
    // tile (real variance), to isolate whether the model needs real image statistics.
    let side = rawdenoise::TILE;
    let mut flat_tile = vec![0f32; side * side * 3];
    let mut noisy_tile = vec![0f32; side * side * 3];
    // Simple xorshift PRNG, no external dependency needed for this probe.
    let mut rng_state: u32 = 0x9E3779B9;
    let mut next_rand = move || -> f32 {
        rng_state ^= rng_state << 13;
        rng_state ^= rng_state >> 17;
        rng_state ^= rng_state << 5;
        (rng_state as f32) / (u32::MAX as f32)
    };
    for y in 0..side {
        for x in 0..side {
            let v = 0.18 + 0.1 * ((x as f32 / side as f32) * std::f32::consts::PI).sin() + 0.05 * ((y as f32 / side as f32) * 3.0).cos();
            let v = v.clamp(0.0, 1.0);
            flat_tile[(y * side + x) * 3] = v;
            flat_tile[(y * side + x) * 3 + 1] = v * 0.95;
            flat_tile[(y * side + x) * 3 + 2] = v * 1.05;

            let base = 0.3 + 0.25 * (((x + y) as f32 / side as f32) * 6.0).sin();
            let noise = (next_rand() - 0.5) * 0.08;
            let nv = (base + noise).clamp(0.0, 1.0);
            noisy_tile[(y * side + x) * 3] = nv;
            noisy_tile[(y * side + x) * 3 + 1] = (nv * 0.95 + (next_rand() - 0.5) * 0.02).clamp(0.0, 1.0);
            noisy_tile[(y * side + x) * 3 + 2] = (nv * 1.05 + (next_rand() - 0.5) * 0.02).clamp(0.0, 1.0);
        }
    }

    for (label, t) in [("flat gradient", &flat_tile), ("noisy synthetic", &noisy_tile)] {
        let (imin, imax, imean, istd) = stats(t);
        let out = rawdenoise::denoise_tile_linear(t).expect("denoise_tile_linear (diagnostic pass)");
        let (omin, omax, omean, ostd) = stats(&out);
        println!(
            "[{label}] input  min={imin:.4} max={imax:.4} mean={imean:.4} std={istd:.4}\n[{label}] output min={omin:.4} max={omax:.4} mean={omean:.4} std={ostd:.4}"
        );
        // Hypothesis: raw output is affine-related to input (mean/std both scale with input's),
        // consistent with "output_scale":"match_gain" meaning a full mean+std (AdaIN-style)
        // match is required, not a scalar mean-ratio multiply. Test it: standardize the raw
        // output then rescale/reshift to the INPUT's own mean+std.
        let matched: Vec<f32> = out.iter().map(|&v| (v - omean) / ostd.max(1e-12) * istd + imean).collect();
        let (mmin, mmax, mmean, mstd) = stats(&matched);
        println!("[{label}] gain-matched (AdaIN mean+std) min={mmin:.4} max={mmax:.4} mean={mmean:.4} std={mstd:.4}");
        // A denoiser should track the input closely at low spatial frequency: correlation
        // between matched-output and input should be high and positive if this is the right
        // rescaling, not an arbitrary/wrong transform.
        let n = t.len() as f64;
        let (mut sxy, mut sxx, mut syy) = (0f64, 0f64, 0f64);
        for i in 0..t.len() {
            let x = (t[i] - imean) as f64;
            let y = (matched[i] - mmean) as f64;
            sxy += x * y;
            sxx += x * x;
            syy += y * y;
        }
        let corr = sxy / (sxx.sqrt() * syy.sqrt()).max(1e-12);
        let _ = n;
        println!("[{label}] corr(input, gain-matched output) = {corr:.4}");

        // If that correlation comes back strongly NEGATIVE, test the sign-flipped match: negate
        // the standardized output before rescaling (mirrors it around the input's own mean).
        if corr < -0.5 {
            let flipped: Vec<f32> = out.iter().map(|&v| imean - (v - omean) / ostd.max(1e-12) * istd).collect();
            let (fmin, fmax, fmean, fstd) = stats(&flipped);
            let (mut sxy2, mut sxx2, mut syy2) = (0f64, 0f64, 0f64);
            for i in 0..t.len() {
                let x = (t[i] - imean) as f64;
                let y = (flipped[i] - fmean) as f64;
                sxy2 += x * y;
                sxx2 += x * x;
                syy2 += y * y;
            }
            let corr2 = sxy2 / (sxx2.sqrt() * syy2.sqrt()).max(1e-12);
            println!(
                "[{label}] SIGN-FLIPPED match min={fmin:.4} max={fmax:.4} mean={fmean:.4} std={fstd:.4}  corr(input, sign-flipped)={corr2:.4}"
            );
            // Sample a few individual pixel triplets (not just aggregate stats) so a sign flip
            // that's correct in aggregate but wrong per-pixel (e.g. a spatial transpose masquerading
            // as a sign flip in these particular smooth synthetic tiles) would still show up.
            for &idx in &[0usize, side * side / 2, side * side - 1] {
                let px = (t[idx * 3], t[idx * 3 + 1], t[idx * 3 + 2]);
                let py = (flipped[idx * 3], flipped[idx * 3 + 1], flipped[idx * 3 + 2]);
                println!("[{label}]   px{idx}: input={px:?} sign-flipped={py:?}");
            }
        }
    }

    let tile = &noisy_tile; // use the better-conditioned input for the timing loop below
    const RUNS: usize = 6;
    let mut times = Vec::with_capacity(RUNS);
    for i in 0..RUNS {
        let t0 = Instant::now();
        let out = rawdenoise::denoise_tile_linear(tile).expect("denoise_tile_linear");
        let dt = t0.elapsed();
        println!("run {i}: {:.3}s (output mean {:.4}, input mean {:.4})", dt.as_secs_f64(), rawdenoise::mean_rgb(&out), rawdenoise::mean_rgb(tile));
        times.push(dt.as_secs_f64());
    }

    let first = times[0];
    let mut steady = times[1..].to_vec();
    steady.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_steady = steady[steady.len() / 2];

    println!("\nfirst run: {first:.3}s   steady-state median (runs 2..{RUNS}): {median_steady:.3}s");

    // Tile geometry from the plan: step 448 (512 tile - 2*32 halo). Project for a representative
    // 24MP frame (6000x4000 — the DC-S9's native RW2 dimensions).
    let (w, h) = (6000usize, 4000usize);
    let step = rawdenoise::STEP;
    let cols = (w + step - 1) / step;
    let rows = (h + step - 1) / step;
    let n_tiles = cols * rows;
    let projected_first = first * n_tiles as f64;
    let projected_steady = median_steady * n_tiles as f64;
    println!("24MP frame ({w}x{h}) tile grid: {cols}x{rows} = {n_tiles} tiles");
    println!("projected total (all first-run cost): {projected_first:.1}s");
    println!("projected total (steady-state, single-threaded sequential): {projected_steady:.1}s");

    const BUDGET_S: f64 = 90.0;
    if projected_steady < BUDGET_S {
        println!("\nPASS: projected {projected_steady:.1}s < {BUDGET_S}s budget — proceed to A1 pipeline integration");
    } else {
        println!("\nFAIL: projected {projected_steady:.1}s >= {BUDGET_S}s budget — reconsider before building the pipeline around this model (tile-level rayon parallelism, ORT intra-op threading, or a smaller model are the next levers, in that order)");
    }
}

fn main() {
    colour_roundtrip_check();
    timing_check();
}
