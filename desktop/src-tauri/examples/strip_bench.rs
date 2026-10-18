// Dev-only: times the strip-parallel decode-cache container against the legacy single-stream QOI
// on a real cached frame.   cargo run --release --example strip_bench -- <cache>.qoi
#[path = "../src/strip_cache.rs"]
mod strip_cache;
use image::ImageDecoder;
use std::time::Instant;
fn main() {
    let p = std::env::args().nth(1).expect("qoi path");
    let t = Instant::now();
    let bytes = std::fs::read(&p).unwrap();
    println!("read {} MB: {:?}", bytes.len() >> 20, t.elapsed());
    let t = Instant::now();
    let dec = image::codecs::qoi::QoiDecoder::new(std::io::Cursor::new(&bytes)).unwrap();
    let (w, h) = dec.dimensions();
    let mut rgba = vec![0u8; dec.total_bytes() as usize];
    dec.read_image(&mut rgba).unwrap();
    println!("legacy qoi decode {w}x{h}: {:?}", t.elapsed());
    let tmp = std::env::temp_dir().join("strip_bench.cqs");
    for i in 0..3 {
        let t = Instant::now();
        {
            let f = std::fs::File::create(&tmp).unwrap();
            strip_cache::write_file(&f, &rgba, w, h).unwrap();
        }
        let te = t.elapsed();
        let t = Instant::now();
        let src = strip_cache::FileSource::open(&tmp).unwrap();
        let (out, _, _) = strip_cache::decode_with_prefix(&src, 8).unwrap();
        println!("run{i}: file {} MB write {:?} read+decode {:?} identical={}", std::fs::metadata(&tmp).unwrap().len() >> 20, te, t.elapsed(), out[8..] == rgba[..]);
    }
    let t = Instant::now();
    let mut q = Vec::new();
    use image::ImageEncoder;
    image::codecs::qoi::QoiEncoder::new(&mut q).write_image(&rgba, w, h, image::ExtendedColorType::Rgba8).unwrap();
    println!("legacy qoi encode: {:?} ({} MB)", t.elapsed(), q.len() >> 20);
}
