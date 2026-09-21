// de_compare <a.bin> <b.bin> <out_prefix> [tile_x,tile_y ...]
// dE76 (approximate: rgb16 treated as linear sRGB) between two dump_rw2 outputs, plus side-by-side
// crops (A | B | |diff|x8), 2x nearest upscale, of the worst tile and any tiles given.
use std::io::Read;
fn load(p: &str) -> (usize, usize, Vec<u16>) {
    let mut b = Vec::new();
    std::fs::File::open(p).unwrap().read_to_end(&mut b).unwrap();
    let w = u32::from_le_bytes(b[0..4].try_into().unwrap()) as usize;
    let h = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
    let d = b[12..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    (w, h, d)
}
fn enc(l: f32) -> f32 { if l <= 0.0031308 { 12.92 * l } else { 1.055 * l.powf(1.0 / 2.4) - 0.055 } }
fn lab(r: u16, g: u16, b: u16) -> [f32; 3] {
    let (r, g, b) = (r as f32 / 65535.0, g as f32 / 65535.0, b as f32 / 65535.0);
    let x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
    let f = |t: f32| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (f(x / 0.95047), f(y), f(z / 1.08883));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h, pa) = load(&a[1]);
    let (w2, h2, pb) = load(&a[2]);
    assert_eq!((w, h), (w2, h2));
    let n = w * h;
    let mut de = vec![0f32; n];
    for i in 0..n {
        let la = lab(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
        let lb = lab(pb[i * 3], pb[i * 3 + 1], pb[i * 3 + 2]);
        de[i] = ((la[0] - lb[0]).powi(2) + (la[1] - lb[1]).powi(2) + (la[2] - lb[2]).powi(2)).sqrt();
    }
    let mut s = de.clone();
    s.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let q = |p: f64| s[((n as f64 - 1.0) * p) as usize];
    let mean = de.iter().map(|&v| v as f64).sum::<f64>() / n as f64;
    println!("dE76 mean {:.3} p50 {:.3} p90 {:.3} p99 {:.3} p99.9 {:.3} max {:.2} | >1: {:.2}% >2: {:.3}% >5: {:.4}%",
        mean, q(0.5), q(0.9), q(0.99), q(0.999), s[n - 1],
        100.0 * s.iter().filter(|&&v| v > 1.0).count() as f64 / n as f64,
        100.0 * s.iter().filter(|&&v| v > 2.0).count() as f64 / n as f64,
        100.0 * s.iter().filter(|&&v| v > 5.0).count() as f64 / n as f64);
    let (tw, th) = (300usize, 200usize);
    let mut tiles: Vec<(usize, usize, String)> = vec![];
    // worst tile by mean dE
    let mut best = (0.0f64, 0usize, 0usize);
    let mut ty = 0;
    while ty + th <= h { let mut tx = 0; while tx + tw <= w {
        let mut m = 0.0f64; for y in (ty..ty + th).step_by(2) { for x in (tx..tx + tw).step_by(2) { m += de[y * w + x] as f64; } }
        if m > best.0 { best = (m, tx, ty); } tx += tw; } ty += th; }
    tiles.push((best.1, best.2, "worst".into()));
    for t in a.iter().skip(4) { let v: Vec<usize> = t.split(',').map(|x| x.parse().unwrap()).collect(); tiles.push((v[0], v[1], format!("t{}_{}", v[0], v[1]))); }
    for (tx, ty, name) in tiles {
        let (ow, oh) = (tw * 2 * 3, th * 2);
        let mut img = image::RgbImage::new(ow as u32, oh as u32);
        for y in 0..th * 2 { for x in 0..tw * 2 {
            let i = ((ty + y / 2) * w + tx + x / 2) * 3;
            for k in 0..3 {
                let a8 = (enc(pa[i + k] as f32 / 65535.0).clamp(0.0, 1.0) * 255.0).round() as u8;
                let b8 = (enc(pb[i + k] as f32 / 65535.0).clamp(0.0, 1.0) * 255.0).round() as u8;
                let d8 = ((a8 as i32 - b8 as i32).abs() * 8).min(255) as u8;
                img.get_pixel_mut(x as u32, y as u32)[k] = a8;
                img.get_pixel_mut((x + tw * 2) as u32, y as u32)[k] = b8;
                img.get_pixel_mut((x + tw * 4) as u32, y as u32)[k] = d8;
            }
        } }
        let mt: f64 = (ty..ty + th).map(|y| (tx..tx + tw).map(|x| de[y * w + x] as f64).sum::<f64>()).sum::<f64>() / (tw * th) as f64;
        let out = format!("{}_{}.png", a[3], name);
        img.save(&out).unwrap();
        println!("crop {} at ({},{}) tile-mean dE {:.3} -> {}", name, tx, ty, mt, out);
    }
}
