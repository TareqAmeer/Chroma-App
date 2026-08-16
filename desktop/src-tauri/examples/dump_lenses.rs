fn main() {
    let db = lensfun::Database::load_bundled().unwrap();
    for l in &db.lenses {
        let m = format!("{} {}", l.maker, l.model).to_lowercase();
        if m.contains("ttartisan") || m.contains("7artisans") || (m.contains("panasonic") && m.contains("18-40")) || m.contains("lumix") && m.contains("18-40") || m.contains("rx100") || m.contains("tz60") || m.contains("zs60") || m.contains("sg image") || m.contains("sgimage") {
            println!("MAKER={:?} MODEL={:?} focal={}-{}", l.maker, l.model, l.focal_min, l.focal_max);
        }
    }
}
