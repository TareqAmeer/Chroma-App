// Regression probe for "dog key tag shows only 6 photos": runs the real auto-tag scorer
// (clip::suggest_tags at catalog.rs's AUTO_TAG_THRESHOLD/TOP_K) over every stored CLIP
// embedding in the real catalog (read-only) and compares the "dog" count it SHOULD produce
// with what photo_auto_tags actually holds. Fails if the stored count is far below expected.
// Usage: cargo run --release --example probe_dog_tags
#[path = "../src/platform/mod.rs"]
#[allow(dead_code)]
mod platform;
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/clip.rs"]
mod clip;

fn main() {
    let md = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    sam::set_dylib_path(md.join("vendor/onnxruntime/libonnxruntime.dylib"));
    clip::set_model_paths(md.join("vendor/clip/vision_model.onnx"), md.join("vendor/clip/text_model.onnx"), md.join("vendor/clip/tokenizer.json"));
    let db = std::env::var("CS_CATALOG_DIR").map(|d| format!("{d}/catalog.db"))
        .unwrap_or_else(|_| format!("{}/Library/Application Support/com.tareq.chromasmith/catalog.db", std::env::var("HOME").unwrap()));
    let conn = rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = conn.prepare("SELECT clip_embedding FROM photos WHERE clip_embedding IS NOT NULL AND present = 1").unwrap();
    let (mut n, mut dog) = (0, 0);
    for b in stmt.query_map([], |r| r.get::<_, Vec<u8>>(0)).unwrap() {
        let b = b.unwrap();
        let e: Vec<f32> = b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        n += 1;
        if clip::suggest_tags(&e, 6, 0.235).unwrap().iter().any(|(t, _)| t == "dog") { dog += 1; }
    }
    let stored: i64 = conn.query_row("SELECT COUNT(*) FROM photo_auto_tags t JOIN photos p ON p.id=t.photo_id WHERE p.present=1 AND t.term='dog'", [], |r| r.get(0)).unwrap();
    let unembedded: i64 = conn.query_row("SELECT COUNT(*) FROM photos WHERE present=1 AND clip_embedding IS NULL", [], |r| r.get(0)).unwrap();
    println!("embedded={n} expected_dog={dog} stored_dog={stored} unembedded={unembedded}");
    if stored * 2 < dog as i64 { eprintln!("FAIL: stored dog tags {stored} << expected {dog}"); std::process::exit(1); }
    println!("PASS");
}
