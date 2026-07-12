// Throwaway diagnostic: dump every lens-related field rawler exposes for one RW2, to find out
// why the lens-status UI reports "no lens model recorded" for a file the user says has one.
// cargo run --release --example probe_lens -- ../../__TM2787.RW2
use rawler::decoders::RawDecodeParams;

fn main() {
    let path = std::env::args().nth(1).expect("usage: probe_lens <file.RW2>");
    let source = rawler::rawsource::RawSource::new(std::path::Path::new(&path)).expect("RawSource");
    let decoder = rawler::get_decoder(&source).expect("get_decoder");
    let md = decoder.raw_metadata(&source, &RawDecodeParams::default()).expect("raw_metadata");
    println!("make={:?} model={:?}", md.make, md.model);
    println!("exif.lens_model = {:?}", md.exif.lens_model);
    println!("exif.lens_make = {:?}", md.exif.lens_make);
    println!("exif.focal_length = {:?}", md.exif.focal_length);
    println!("md.lens = {:?}", md.lens);

    // Fallback probe: RW2 is TIFF-based, so a generic EXIF/TIFF reader might parse the
    // standard LensModel tag (0xA434) even where rawler's structured metadata doesn't expose
    // it (exifread in Python found "LUMIX S 18-40/F4.5-6.3" via plain EXIF parsing).
    let mut bytes = std::fs::read(&path).expect("read");
    // Panasonic RW2 deliberately breaks the TIFF magic number (0x0055 instead of the standard
    // 0x002A at offset 2-3) specifically so generic TIFF/EXIF readers reject it outright — the
    // IFD structure underneath is otherwise standard TIFF/EXIF, which is exactly why exifread
    // (Python) parses it fine while kamadak-exif's format sniff (and read_raw's "Invalid forty
    // two" check) both refuse it. Patch the magic bytes in a scratch copy before parsing.
    if bytes.len() > 3 && bytes[0] == b'I' && bytes[1] == b'I' && bytes[2] == 0x55 && bytes[3] == 0x00 {
        bytes[2] = 0x2A;
        println!("(patched RW2 magic number 0x0055 -> 0x002A for parsing)");
    }
    match exif::Reader::new().read_raw(bytes) {
        Ok(exif) => {
            let lens = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY)
                .map(|f| f.display_value().to_string());
            println!("kamadak-exif read_raw LensModel fallback = {:?}", lens);
        }
        Err(e) => println!("kamadak-exif read_raw failed: {e}"),
    }
}
