// Bit-exactness + timing check for raw_decode::apply_lut_rgba against the original per-pixel loop.
//   cargo run --release --example lut_bench
#[path = "../src/lens_correct.rs"]
mod lens_correct;
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/rawdenoise.rs"]
mod rawdenoise;
#[path = "../src/raw_decode.rs"]
mod raw_decode;
#[path = "../src/platform/mod.rs"]
mod platform;
#[path = "../src/diag.rs"]
mod diag;
#[path = "../src/trash_undo.rs"]
mod trash_undo;
use rayon::prelude::*;

fn legacy(rgb16: &[u16], lut: &[f32], n: usize) -> Vec<u8> {
    let nm = n - 1;
    let sc = nm as f32 / 65535.0;
    let mut rgba = vec![0u8; rgb16.len() / 3 * 4];
    rgba.par_chunks_mut(4).zip(rgb16.par_chunks(3)).for_each(|(dst, src)| {
        let fr = src[0] as f32 * sc; let fg = src[1] as f32 * sc; let fb = src[2] as f32 * sc;
        let r0 = (fr as usize).min(nm - 1); let g0 = (fg as usize).min(nm - 1); let b0 = (fb as usize).min(nm - 1);
        let rf = fr - r0 as f32; let gf = fg - g0 as f32; let bf = fb - b0 as f32;
        let idx = |r: usize, g: usize, b: usize| 3 * ((b * n + g) * n + r);
        for c in 0..3 {
            let c000 = lut[idx(r0, g0, b0) + c]; let c100 = lut[idx(r0 + 1, g0, b0) + c];
            let c010 = lut[idx(r0, g0 + 1, b0) + c]; let c110 = lut[idx(r0 + 1, g0 + 1, b0) + c];
            let c001 = lut[idx(r0, g0, b0 + 1) + c]; let c101 = lut[idx(r0 + 1, g0, b0 + 1) + c];
            let c011 = lut[idx(r0, g0 + 1, b0 + 1) + c]; let c111 = lut[idx(r0 + 1, g0 + 1, b0 + 1) + c];
            let c00 = c000 * (1.0 - rf) + c100 * rf; let c10 = c010 * (1.0 - rf) + c110 * rf;
            let c01 = c001 * (1.0 - rf) + c101 * rf; let c11 = c011 * (1.0 - rf) + c111 * rf;
            let v = (c00 * (1.0 - gf) + c10 * gf) * (1.0 - bf) + (c01 * (1.0 - gf) + c11 * gf) * bf;
            dst[c] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        dst[3] = 255;
    });
    rgba
}

fn main() {
    let n = 65usize;
    let mut s = 12345u64;
    let mut rnd = || { s ^= s << 13; s ^= s >> 7; s ^= s << 17; s };
    let lut: Vec<f32> = (0..n * n * n * 3).map(|_| (rnd() % 20000) as f32 / 15000.0 - 0.05).collect();
    let px = 6016 * 4016 + 1237; // odd tail exercises the partial last chunk
    let rgb: Vec<u16> = (0..px * 3).map(|_| (rnd() % 65536) as u16).collect();
    let pool = rayon::ThreadPoolBuilder::new().num_threads(8).build().unwrap();
    for round in 0..3 {
        let t = std::time::Instant::now();
        let a = pool.install(|| legacy(&rgb, &lut, n));
        let ta = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let b = pool.install(|| raw_decode::apply_lut_rgba(&rgb, &lut, n).unwrap());
        let tb = t.elapsed().as_millis();
        println!("round {round}: legacy {ta}ms new {tb}ms identical={}", a == b);
    }
}
