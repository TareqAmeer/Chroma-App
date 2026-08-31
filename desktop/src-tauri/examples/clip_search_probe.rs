// One-off probe for Bug #1's real fix: `catalog_clip_search` (catalog.rs) ranks by cosine
// similarity but had NO minimum-score cutoff, so a nonsense query still returned every
// CLIP-scanned photo, just reordered — with a 6-photo scanned library that reads as "search does
// nothing." This measures REAL CLIP image-vs-text cosine scores against real photos in this repo
// (same methodology as R10's DEFAULT_TAG_THRESHOLD probe) so the cutoff added to
// catalog_clip_search is picked from evidence, not a guessed round number.
//
// Usage: cargo run --release --example clip_search_probe
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/clip.rs"]
mod clip;

fn embed_photo(path: &str) -> Vec<f32> {
    let img = image::open(path).unwrap_or_else(|e| panic!("open {path}: {e}")).to_rgb8();
    let (w, h) = img.dimensions();
    clip::embed_image(img.as_raw(), w, h).unwrap_or_else(|e| panic!("embed {path}: {e}"))
}

fn main() {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dylib = manifest_dir.join("vendor/onnxruntime/libonnxruntime.dylib");
    sam::set_dylib_path(dylib);
    clip::set_model_paths(
        manifest_dir.join("vendor/clip/vision_model.onnx"),
        manifest_dir.join("vendor/clip/text_model.onnx"),
        manifest_dir.join("vendor/clip/tokenizer.json"),
    );

    let repo_root = manifest_dir.join("../../");
    let photos: Vec<(String, String)> = vec![
        (repo_root.join("Best/__TM5673.jpg").to_string_lossy().into_owned(), "dog photo (Best/__TM5673.jpg)".into()),
        (repo_root.join("Lucifer/DSC00511.JPG").to_string_lossy().into_owned(), "dog photo (Lucifer/DSC00511.JPG)".into()),
    ];

    let queries = ["a dog", "a photo of a dog outdoors", "fdsfsdfksj", "asdkjqwoieuqwoiuz", "a spaceship in outer space"];

    println!("photo, query, cosine");
    for (path, label) in &photos {
        let img_emb = embed_photo(path);
        for q in &queries {
            let txt_emb = clip::embed_text(q).unwrap_or_else(|e| panic!("embed_text {q}: {e}"));
            let score = clip::cosine_sim(&img_emb, &txt_emb);
            println!("{label}, \"{q}\", {score:.4}");
        }
    }
}
