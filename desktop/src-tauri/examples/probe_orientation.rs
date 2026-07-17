// Throwaway diagnostic: reproduce library.rs's get_thumbnail() orientation logic exactly,
// for one file, with prints, to find out why a portrait RW2's grid thumbnail is still sideways.
// cargo run --release --example probe_orientation -- ../../__TM3116.RW2 /tmp/probe.png
use rawler::decoders::RawDecodeParams;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = &args[1];
    let out = &args[2];

    let source = rawler::rawsource::RawSource::new(std::path::Path::new(path)).expect("RawSource");
    let decoder = rawler::get_decoder(&source).expect("get_decoder");
    let md = decoder.raw_metadata(&source, &RawDecodeParams::default()).expect("raw_metadata");
    println!("exif.orientation = {:?}", md.exif.orientation);
    println!("make={:?} model={:?}", md.make, md.model);

    let img = rawler::analyze::extract_thumbnail_pixels(path, &RawDecodeParams::default()).expect("extract_thumbnail_pixels");
    println!("thumbnail_image raw pixels: {}x{}", img.width(), img.height());

    let orientation = md.exif.orientation.unwrap_or(1);
    let rotated = match orientation {
        3 => img.rotate180(),
        6 => img.rotate90(),
        8 => img.rotate270(),
        _ => img,
    };
    println!("after apply_orientation_dynamic({orientation}): {}x{}", rotated.width(), rotated.height());
    rotated.to_rgb8().save(out).expect("save");
    println!("wrote {out}");
}
