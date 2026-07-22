// Ad-hoc harness: splice metadata from a real Lightroom Edit-In TIFF into a real UTIF-encoded
// TIFF and verify the result parses with kamadak-exif.
//   cargo run --example test_splice -- rendered.tif source.tif out.tif
#[path = "../src/tiff_meta.rs"]
mod tiff_meta;

fn dump(label: &str, bytes: &[u8]) {
    print!("{label}: ");
    match exif::Reader::new().read_raw(bytes.to_vec()) {
        Ok(ex) => {
            for tag in [
                exif::Tag::Make,
                exif::Tag::Model,
                exif::Tag::LensModel,
                exif::Tag::ExposureTime,
                exif::Tag::FNumber,
                exif::Tag::PhotographicSensitivity,
                exif::Tag::FocalLength,
                exif::Tag::DateTimeOriginal,
            ] {
                if let Some(f) = ex
                    .get_field(tag, exif::In::PRIMARY)
                {
                    print!("{}={} ", tag, f.display_value());
                }
            }
            println!();
        }
        Err(e) => println!("exif parse failed: {e}"),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let rendered = std::fs::read(&args[1]).expect("read rendered");
    let source = std::fs::read(&args[2]).expect("read source");
    dump("source  ", &source);
    dump("rendered", &rendered);
    match tiff_meta::splice_metadata(&rendered, &source) {
        Some(out) => {
            dump("spliced ", &out);
            if let Some(p) = args.get(3) {
                std::fs::write(p, &out).expect("write out");
                println!("wrote {p} ({} bytes)", out.len());
            }
        }
        None => println!("splice returned None"),
    }
}
