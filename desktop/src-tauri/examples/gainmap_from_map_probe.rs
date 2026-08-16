// Verifies write_gainmap_heic_from_map's Core Image math against SYNTHETIC inputs, independent of
// the JS-side DCP integration: a flat grey graded PNG + a headroom map whose value is known
// analytically, then re-measure the written file's headroom the same way source_headroom() does.
//
// This is what caught (and then verified the fix for) a real bug: the first version wrote the
// headroom byte as a raw linear fraction and measured 1.647x where 2.506x was intended — only the
// 0 and 255 endpoints happened to match. Root cause: imageWithData: colour-matches an untagged
// 8-bit PNG as sRGB and gamma-DECODES it before any filter sees it, so the byte has to be
// sRGB-gamma-ENCODED first to cancel that out. See write_gainmap_heic_from_map's own doc comment.
//
//   cargo run --release --example gainmap_from_map_probe
#[cfg(target_os = "macos")]
#[path = "../src/gainmap.rs"]
mod gainmap;

#[cfg(target_os = "macos")]
fn write_png(path: &str, w: u32, h: u32, rgb: [u8; 3]) {
    let mut img = image::RgbImage::new(w, h);
    for p in img.pixels_mut() { *p = image::Rgb(rgb); }
    img.save(path).unwrap();
}

#[cfg(target_os = "macos")]
fn write_gray_png(path: &str, w: u32, h: u32, v: u8) {
    let mut img = image::GrayImage::new(w, h);
    for p in img.pixels_mut() { *p = image::Luma([v]); }
    img.save(path).unwrap();
}

#[cfg(target_os = "macos")]
fn main() {
    let dir = std::env::temp_dir().join("cs_gainmap_probe");
    std::fs::create_dir_all(&dir).unwrap();
    let graded = dir.join("graded.png");
    write_png(graded.to_str().unwrap(), 64, 64, [200, 190, 180]);
    let graded_bytes = std::fs::read(&graded).unwrap();

    println!("{:<10} {:<9} {:>12} {:>12} {:>10}", "norm", "byte", "expect_mult", "measured", "match?");
    let mut all_ok = true;
    // sRGB OETF (gamma-ENCODE), the inverse of what Core Image applies on load — confirmed by
    // direct measurement that 128/255 gamma-DECODES to ~0.216 (matches the standard sRGB EOTF of
    // 128/255=0.502 exactly), so pre-encoding the intended linear norm should cancel it out.
    fn srgb_encode(v: f64) -> f64 {
        if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0/2.4) - 0.055 }
    }
    for norm in [0.0f64, 0.25, 0.50, 1.0] {
        let hr_byte = (srgb_encode(norm) * 255.0).round().clamp(0.0, 255.0) as u8;
        let hr_path = dir.join("hr.png");
        write_gray_png(hr_path.to_str().unwrap(), 64, 64, hr_byte);
        let hr_bytes = std::fs::read(&hr_path).unwrap();
        let out = dir.join(format!("out_{hr_byte}.heic"));
        let max_stops = 2.0;
        let ok = gainmap::write_gainmap_heic_from_map(
            &hr_bytes, &graded_bytes, out.to_str().unwrap(), 0.92, max_stops,
        ).expect("write");
        assert!(ok, "should always write when a headroom map is supplied, even at 0");
        let measured = gainmap::source_headroom(out.to_str().unwrap()).expect("measure");
        // Expected multiplier from the analytic formula: 1 + (hr/255)*(2^max_stops - 1).
        let expect = 1.0 + norm * (2f64.powf(max_stops) - 1.0);
        let close = (measured as f64 - expect).abs() < 0.15 * expect.max(1.0);
        all_ok &= close;
        println!("{:<10} {:<9} {:>12.3} {:>12.3} {:>10}", norm, hr_byte, expect, measured, if close { "yes" } else { "NO" });
    }
    std::fs::remove_dir_all(&dir).ok();
    if !all_ok { std::process::exit(1); }
}
#[cfg(not(target_os = "macos"))]
fn main() { eprintln!("macOS only"); }
