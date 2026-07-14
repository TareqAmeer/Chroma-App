// Calibration helper (not part of the app): decode an RW2 through the EXACT same native
// pipeline the desktop app uses (raw_decode.rs) and write the linear16 buffer to disk so
// calib/dcp_dual_fit.py can fit/validate against Lightroom reference TIFFs offline.
//
//   cargo run --release --example dump_rw2 -- input.RW2 output.bin [downscale]
//
// Output format: 3 little-endian u32 (width, height, iso) followed by width*height*3
// little-endian u16 (interleaved RGB, linear, camera-WB'd — same as decode_raw's IPC buffer).
// Optional integer downscale box-averages (8 → 752x502 from 6016x4016), the same format as
// the wasm dbgDumpCam16 dumps so the Python harness reads both identically (and 63x smaller).
#[path = "../src/lens_correct.rs"]
mod lens_correct;
#[path = "../src/raw_decode.rs"]
mod raw_decode;

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 && args.len() != 4 {
        eprintln!("usage: dump_rw2 <input.RW2> <output.bin> [downscale]");
        std::process::exit(2);
    }
    let ds: usize = args.get(3).map(|s| s.parse().expect("downscale int")).unwrap_or(1);
    let bytes = std::fs::read(&args[1]).expect("read input");
    let t0 = std::time::Instant::now();
    let d = raw_decode::decode_rw2_bytes(&bytes, false, std::env::var_os("CS_NO_CHROMA_NR").is_none(), "").expect("decode");
    eprintln!(
        "{}x{} iso {} decoded in {:.2}s",
        d.width,
        d.height,
        d.iso,
        t0.elapsed().as_secs_f32()
    );
    let (w, h) = (d.width as usize, d.height as usize);
    let (ow, oh) = (w / ds, h / ds);
    let mut out16 = vec![0u16; ow * oh * 3];
    for oy in 0..oh {
        for ox in 0..ow {
            let mut acc = [0f64; 3];
            for sy in 0..ds {
                for sx in 0..ds {
                    let si = ((oy * ds + sy) * w + ox * ds + sx) * 3;
                    for c in 0..3 {
                        acc[c] += d.rgb16[si + c] as f64;
                    }
                }
            }
            let n = (ds * ds) as f64;
            let oi = (oy * ow + ox) * 3;
            for c in 0..3 {
                out16[oi + c] = (acc[c] / n).round() as u16;
            }
        }
    }
    let f = std::fs::File::create(&args[2]).expect("create output");
    let mut wtr = std::io::BufWriter::new(f);
    wtr.write_all(&(ow as u32).to_le_bytes()).unwrap();
    wtr.write_all(&(oh as u32).to_le_bytes()).unwrap();
    wtr.write_all(&d.iso.to_le_bytes()).unwrap();
    let bytes16: Vec<u8> = out16.iter().flat_map(|v| v.to_le_bytes()).collect();
    wtr.write_all(&bytes16).unwrap();
}
