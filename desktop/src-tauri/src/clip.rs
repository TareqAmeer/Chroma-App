// Natural-language photo search (AI stack Phase D) — Google SigLIP 2 ViT-B/16 (was OpenAI CLIP
// ViT-B/32 until 2026-10; a benchmark on the user's own library scored 68% vs 44% correct top-20
// picks — see vendor/clip/README.md), via the same raw ort-sys C
// API wrapper the rest of the AI stack uses (sam.rs/faceparse.rs/scrfd.rs/arcface.rs), NOT
// Candle. Candle's own `candle-transformers` CLIP module is genuinely turnkey (safetensors load
// directly, no conversion), but it would be a SECOND inference runtime/dependency tree in a
// codebase that already has one proven, working ONNX path — an ONNX CLIP export (extremely
// common, well-documented) keeps the whole AI stack on one integration pattern. User-directed
// choice; see CLAUDE.md's AI-stack briefing.
//
// Two SEPARATE graphs (an image encoder and a text encoder), each producing an independent
// 768-dim embedding in the SAME shared space — a photo is embedded once at scan time, a search
// query is embedded on demand, and cosine similarity between the two ranks the library. This is
// exactly why CLIP is useful for search and exactly why the two encoders must be run
// independently rather than as one combined graph.
//
// Source: `Xenova/clip-vit-base-patch32` on Hugging Face (a Transformers.js export of OpenAI's
// `openai/clip-vit-base-patch32`) — full precision, not the `_quantized` variant, per explicit
// user direction (quality/speed over vendored file size — the same call already made for
// Phase B's ArcFace model). See vendor/clip/README.md for exact URLs and the verified I/O
// contract (onnx.load() + preprocessor_config.json/tokenizer_config.json, not assumed).

use crate::sam::{create_session_from_path, input, input_i64, run_session, SamSession};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tokenizers::Tokenizer;

const IMAGE_SIZE: u32 = 224;
const MEAN: [f32; 3] = [0.5, 0.5, 0.5];
const STD: [f32; 3] = [0.5, 0.5, 0.5];
pub const EMBED_DIM: usize = 768;
const MAX_TOKENS: usize = 64; // SigLIP 2's text context length (open_clip ViT-B-16-SigLIP2 config)
const EOS_TOKEN_ID: i64 = 1; // Gemma tokenizer "<eos>", appended by tokenizer.json's post-processor
const PAD_TOKEN_ID: i64 = 0;
/// SigLIP's trained logit scale/bias (exp(t) and b from the checkpoint). SigLIP is trained with a
/// per-pair sigmoid, so `sigmoid(cos * scale + bias)` is a real, independent probability that the
/// text describes the image — unlike CLIP's cosine, which only ranks. Thresholds below are on it.
pub const LOGIT_SCALE: f32 = 112.66890;
pub const LOGIT_BIAS: f32 = -16.771725;

pub fn match_prob(cos: f32) -> f32 {
    1.0 / (1.0 + (-(cos * LOGIT_SCALE + LOGIT_BIAS)).exp())
}

/// SigLIP's own text cleaning (big_vision `canonicalize_text`, as open_clip applies it): drop
/// ASCII punctuation, "_" to space, lowercase, collapse whitespace. Token ids match open_clip's
/// tokenizer exactly with this applied first (verified on export).
fn canonicalize(text: &str) -> String {
    let t: String = text.replace('_', " ").chars().filter(|c| !c.is_ascii_punctuation()).collect();
    t.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The prompt every fixed-vocabulary term is embedded with ("a photo of a dog.").
fn photo_prompt(term: &str) -> String {
    let article = if term.starts_with(|c: char| "aeiou".contains(c)) { "an" } else { "a" };
    format!("a photo of {article} {term}.")
}

static VISION_PATH: OnceLock<PathBuf> = OnceLock::new();
static TEXT_PATH: OnceLock<PathBuf> = OnceLock::new();
static TOKENIZER_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once from main.rs's `.setup()`, same pattern as `sam::set_sam2_model_paths`.
pub fn set_model_paths(vision_path: PathBuf, text_path: PathBuf, tokenizer_path: PathBuf) {
    let _ = VISION_PATH.set(vision_path);
    let _ = TEXT_PATH.set(text_path);
    let _ = TOKENIZER_PATH.set(tokenizer_path);
}

fn vision_session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = VISION_PATH.get().ok_or("CLIP vision model path not set — set_model_paths() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn text_session() -> Result<&'static Mutex<SamSession>, String> {
    static S: OnceLock<Result<Mutex<SamSession>, String>> = OnceLock::new();
    S.get_or_init(|| {
        let path = TEXT_PATH.get().ok_or("CLIP text model path not set — set_model_paths() must run before any use")?;
        create_session_from_path(path).map(Mutex::new)
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn tokenizer() -> Result<&'static Tokenizer, String> {
    static T: OnceLock<Result<Tokenizer, String>> = OnceLock::new();
    T.get_or_init(|| {
        let path = TOKENIZER_PATH.get().ok_or("CLIP tokenizer path not set — set_model_paths() must run before any use")?;
        Tokenizer::from_file(path).map_err(|e| format!("CLIP tokenizer load: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn l2_normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-12 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// SigLIP squashes the whole frame to 224x224 (no crop — open_clip's transform is a plain
/// bicubic Resize((224, 224))), so edges of wide panoramas still count. `resize_rgb8`'s Triangle
/// filter stands in for bicubic, same tradeoff every other model in this codebase makes.
fn resize_full_frame(rgb: &[u8], w: u32, h: u32) -> Vec<u8> {
    crate::sam::resize_rgb8(rgb, w, h, IMAGE_SIZE, IMAGE_SIZE)
}

/// Embeds an already-decoded RGB8 image into CLIP's shared embedding space. Returns an
/// L2-normalized 512-dim vector — the model's own `image_embeds` output is a raw linear
/// projection, not unit-normalized, so cosine similarity requires normalizing here (same
/// convention `arcface::embed` already established for face embeddings).
pub fn embed_image(rgb: &[u8], w: u32, h: u32) -> Result<Vec<f32>, String> {
    if w == 0 || h == 0 {
        return Err("clip: zero-sized image".into());
    }
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        return Err(format!("clip: rgb length {} does not match {w}x{h}x3", rgb.len()));
    }
    let cropped = resize_full_frame(rgb, w, h);
    let side = IMAGE_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..side {
        for x in 0..side {
            let src = (y * side + x) * 3;
            for c in 0..3 {
                let v = (cropped[src + c] as f32 / 255.0 - MEAN[c]) / STD[c];
                pixels[c * side * side + y * side + x] = v;
            }
        }
    }
    let sess = vision_session()?;
    let mut outputs =
        run_session(sess, vec![input("pixel_values", pixels, &[1, 3, IMAGE_SIZE as i64, IMAGE_SIZE as i64])], &["image_embeds"])?;
    let mut emb = outputs.remove(0);
    if emb.len() != EMBED_DIM {
        return Err(format!("clip: unexpected image embedding length {} (expected {EMBED_DIM})", emb.len()));
    }
    l2_normalize(&mut emb);
    Ok(emb)
}

/// Embeds a search-query string into the SAME space as `embed_image`. Canonicalized, then
/// padded with 0 to exactly `MAX_TOKENS` — SigLIP was trained on fixed-length padded text and
/// pools the LAST position, so the padding is part of the input, not inert.
pub fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    let tok = tokenizer()?;
    let encoding = tok.encode(canonicalize(text), true).map_err(|e| format!("clip tokenize: {e}"))?;
    let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
    if ids.len() > MAX_TOKENS {
        ids.truncate(MAX_TOKENS - 1);
        ids.push(EOS_TOKEN_ID);
    } else {
        ids.resize(MAX_TOKENS, PAD_TOKEN_ID);
    }

    let sess = text_session()?;
    let mut outputs = run_session(sess, vec![input_i64("input_ids", ids, &[1, MAX_TOKENS as i64])], &["text_embeds"])?;
    let mut emb = outputs.remove(0);
    if emb.len() != EMBED_DIM {
        return Err(format!("clip: unexpected text embedding length {} (expected {EMBED_DIM})", emb.len()));
    }
    l2_normalize(&mut emb);
    Ok(emb)
}

/// Cosine similarity between two already-L2-normalized embeddings — a plain dot product. Shared
/// by the search command (text-vs-every-photo) and any future embedding-space comparison.
pub fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

// ── R10: zero-shot CLIP auto-tagging ────────────────────────────────────────────────────────
// UI layer over the embeddings that already exist, not new inference: `catalog_clip_search`
// already proves CLIP text-vs-image cosine ranking works, this just runs that same ranking
// against a small FIXED vocabulary instead of an arbitrary user query, once per photo, so the
// Info panel can surface a handful of one-click "suggested keyword" chips. This is UX taxonomy,
// not a calibration constant — genuinely broad and useful matters more than "the right list".
pub const TAG_VOCABULARY: &[&str] = &[
    // subjects — people
    "portrait", "self portrait", "group photo", "family photo", "child", "baby", "toddler",
    "candid", "couple", "crowd", "wedding", "bride", "groom",
    // subjects — animals
    "dog", "cat", "bird", "wildlife", "horse", "farm animal", "insect", "fish", "reptile",
    // places / scenes — outdoor
    "beach", "ocean", "sea", "lake", "river", "waterfall", "mountain", "hill", "valley",
    "forest", "woods", "jungle", "desert", "field", "meadow", "snow", "ice", "glacier",
    "island", "coastline", "cliff", "cave",
    // places / scenes — built
    "city", "skyline", "street", "alley", "architecture", "building", "bridge", "church",
    "cathedral", "temple", "castle", "ruins", "interior", "room", "kitchen", "bedroom",
    "office", "garden", "park", "farm", "barn", "market", "stadium", "airport", "train station",
    "harbor", "lighthouse", "windmill", "vineyard",
    // vehicles / transport
    "car", "motorcycle", "bicycle", "boat", "sailboat", "train", "airplane", "hot air balloon",
    // time / light
    "sunset", "sunrise", "golden hour", "blue hour", "night", "night sky", "stars", "moon",
    "silhouette", "fog", "mist", "storm", "lightning", "rainbow", "clear sky", "overcast",
    "long exposure", "light trails",
    // genres
    "landscape", "seascape", "cityscape", "macro", "close-up", "aerial view", "drone shot",
    "sports", "action shot", "motion blur", "food", "drink", "still life", "product photo",
    "travel", "street photography", "documentary", "concert", "festival", "event", "party",
    "sports event", "astrophotography", "underwater", "fireworks", "abstract",
    // objects / content
    "flower", "flowers", "plant", "tree", "leaf", "fruit", "vegetable", "book", "artwork",
    "sculpture", "painting", "graffiti", "sign", "text", "screenshot", "map", "clothing",
    "jewelry", "toy", "musical instrument", "computer", "phone",
    // people — activity
    "smiling", "laughing", "running", "jumping", "dancing", "swimming", "hiking", "climbing",
    "skiing", "surfing", "cycling", "cooking", "reading", "sleeping",
    // style / composition
    "black and white", "sepia", "vintage", "reflection", "bokeh", "shallow depth of field",
    "symmetry", "minimalism", "pattern", "texture", "high contrast", "low key", "high key",
    "vibrant colors", "monochrome", "panorama", "double exposure", "selective focus",
    "flat lay", "top down view", "close-up detail",
    // weather / season
    "rain", "raindrops", "autumn", "spring", "summer", "winter", "sunny day", "cloudy sky",
    // everyday search words
    "sky", "clouds", "water", "sand", "grass", "person", "people", "selfie", "pet", "puppy",
    "kitten", "restaurant", "cake", "coffee", "pizza", "sushi", "dessert", "house", "home",
    "road", "tower", "museum", "shop", "christmas", "birthday", "graduation",
];

/// The vocabulary embedded once via `embed_text`, cached behind a `OnceLock` — same lazy pattern
/// as `vision_session`/`text_session`/`tokenizer` above. Costs ~200 text-encoder forward passes
/// on first use only; every later call reuses the cached vectors.
fn tag_vocab_embeddings() -> Result<&'static Vec<(String, Vec<f32>)>, String> {
    static V: OnceLock<Result<Vec<(String, Vec<f32>)>, String>> = OnceLock::new();
    V.get_or_init(|| {
        TAG_VOCABULARY
            .iter()
            .map(|term| embed_text(&photo_prompt(term)).map(|emb| (term.to_string(), emb)))
            .collect::<Result<Vec<_>, _>>()
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Minimum SigLIP match probability (`match_prob`) for an Info-panel suggestion. Calibrated on
/// 800 photos from the real library: SigLIP's probabilities are deliberately low for short
/// prompts (a clearly-present dog commonly scores 0.003-0.05), and wrong terms sat under ~0.002.
pub const DEFAULT_TAG_THRESHOLD: f32 = 0.002;
pub const DEFAULT_TAG_TOP_K: usize = 8;

/// Ranks an already-computed image embedding against the cached vocabulary embeddings, returning
/// the top-K terms whose match probability clears `threshold`, sorted by score descending.
pub fn suggest_tags(image_embedding: &[f32], top_k: usize, threshold: f32) -> Result<Vec<(String, f32)>, String> {
    let vocab = tag_vocab_embeddings()?;
    let mut scored: Vec<(String, f32)> =
        vocab.iter().map(|(term, emb)| (term.clone(), match_prob(cosine_sim(image_embedding, emb)))).filter(|(_, s)| *s >= threshold).collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    Ok(scored)
}

/// Breed tags. The general vocabulary above only says "dog"/"cat"; once a photo already carries
/// one of those, its breed is picked by CLIP's own zero-shot classifier: every breed of that
/// species scored with the standard Oxford-IIIT Pets prompt ("a photo of a X, a type of pet."),
/// softmaxed at the model's trained logit scale. Only a clear winner is kept — a mixed-breed dog
/// or a blurry cat spreads its probability and gets no breed at all, never a wrong one. The
/// probability gate is what makes it safe to apply
/// without the user looking.
pub const DOG_BREEDS: &[&str] = &[
    "labrador retriever", "golden retriever", "german shepherd", "french bulldog", "english bulldog",
    "poodle", "beagle", "rottweiler", "dachshund", "pembroke welsh corgi", "yorkshire terrier",
    "boxer", "border collie", "siberian husky", "cavalier king charles spaniel", "shih tzu",
    "boston terrier", "pomeranian", "chihuahua", "pug", "cocker spaniel", "english springer spaniel",
    "great dane", "doberman", "miniature schnauzer", "jack russell terrier", "staffordshire bull terrier",
    "american pit bull terrier", "bernese mountain dog", "australian shepherd", "shiba inu",
    "maltese", "havanese", "basset hound", "whippet", "greyhound", "saint bernard", "newfoundland",
    "samoyed", "akita", "chow chow", "dalmatian", "west highland white terrier", "scottish terrier",
    "bichon frise", "weimaraner", "vizsla", "bull terrier", "cockapoo", "labradoodle",
];
pub const CAT_BREEDS: &[&str] = &[
    "maine coon", "ragdoll", "persian cat", "siamese cat", "british shorthair", "bengal cat",
    "sphynx cat", "abyssinian cat", "russian blue", "scottish fold", "birman", "norwegian forest cat",
    "egyptian mau", "bombay cat", "tabby cat", "tuxedo cat", "calico cat", "ginger cat",
];
/// Minimum softmax probability for the winning breed.
pub const BREED_MIN_PROB: f32 = 0.6;

fn breed_embeddings(species: &str) -> Result<&'static Vec<(String, Vec<f32>)>, String> {
    static DOGS: OnceLock<Result<Vec<(String, Vec<f32>)>, String>> = OnceLock::new();
    static CATS: OnceLock<Result<Vec<(String, Vec<f32>)>, String>> = OnceLock::new();
    let (cell, list) = if species == "cat" { (&CATS, CAT_BREEDS) } else { (&DOGS, DOG_BREEDS) };
    cell.get_or_init(|| {
        list.iter()
            .map(|b| embed_text(&format!("a photo of a {b}, a type of pet.")).map(|e| (b.to_string(), e)))
            .collect::<Result<Vec<_>, _>>()
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// Softmax pick over `candidates`; `Some((name, prob))` only when the winner clears `min_prob`.
pub fn pick_breed(image_embedding: &[f32], candidates: &[(String, Vec<f32>)], min_prob: f32) -> Option<(String, f32)> {
    let logits: Vec<f32> = candidates.iter().map(|(_, e)| LOGIT_SCALE * cosine_sim(image_embedding, e)).collect();
    let max = logits.iter().cloned().fold(f32::MIN, f32::max);
    let exps: Vec<f32> = logits.iter().map(|l| (l - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    let (i, p) = exps.iter().enumerate().map(|(i, e)| (i, e / sum)).max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))?;
    (p >= min_prob).then(|| (candidates[i].0.clone(), p))
}

/// The breed of a photo already tagged `species` ("dog" or "cat"), or None when no breed is clear.
pub fn suggest_breed(image_embedding: &[f32], species: &str) -> Result<Option<(String, f32)>, String> {
    Ok(pick_breed(image_embedding, breed_embeddings(species)?, BREED_MIN_PROB))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(crate::platform::ort_lib_dev_path());
        crate::sam::set_dylib_path(dylib);
        set_model_paths(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/clip/vision_model.onnx"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/clip/text_model.onnx"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/clip/tokenizer.json")
        );
    }

    /// Token ids must match open_clip's SigLIP 2 tokenizer exactly (ids recorded from it at export
    /// time) — a mismatch here silently degrades every tag and search without failing anything.
    #[test]
    fn tokenizer_matches_open_clip_siglip2() {
        setup_model();
        let ids = tokenizer().unwrap().encode(canonicalize("A photo of a Dog."), true).unwrap().get_ids().to_vec();
        // tokenizer.json carries its own pad-to-64 (pad id 0), same as open_clip's call.
        assert_eq!(ids.len(), MAX_TOKENS);
        assert_eq!(&ids[..7], &[235250, 2686, 576, 476, 5929, 1, 0]);
        assert_eq!(photo_prompt("owl"), "a photo of an owl.");
    }

    #[test]
    fn embed_image_returns_a_unit_vector() {
        setup_model();
        let (w, h) = (300u32, 200u32);
        let mut rgb = vec![0u8; (w * h * 3) as usize];
        for i in 0..rgb.len() {
            rgb[i] = ((i * 37) % 255) as u8;
        }
        let emb = embed_image(&rgb, w, h).expect("clip embed_image run");
        assert_eq!(emb.len(), EMBED_DIM);
        let norm: f32 = emb.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "image embedding should be L2-normalized, norm={norm}");
    }

    /// Accuracy check on real photos named "<breed>.jpg" (e.g. Wikipedia lead images):
    ///     BREED_DIR=/path/to/photos cargo test --release breed_accuracy -- --ignored --nocapture
    #[test]
    #[ignore]
    fn breed_accuracy_on_a_folder_of_labelled_photos() {
        setup_model();
        let dir = PathBuf::from(std::env::var("BREED_DIR").expect("set BREED_DIR"));
        let (mut right, mut wrong, mut none) = (0, 0, 0);
        for ent in std::fs::read_dir(&dir).unwrap() {
            let path = ent.unwrap().path();
            let want = path.file_stem().unwrap().to_string_lossy().to_string();
            let img = image::open(&path).unwrap().to_rgb8();
            let emb = embed_image(img.as_raw(), img.width(), img.height()).unwrap();
            let sp = if CAT_BREEDS.contains(&want.as_str()) { "cat" } else { "dog" };
            let got = suggest_breed(&emb, sp).unwrap();
            match &got { Some((b, _)) if *b == want => right += 1, Some(_) => wrong += 1, None => none += 1 }
            eprintln!("{want:32} -> {got:?}");
        }
        eprintln!("right {right}, wrong {wrong}, no tag {none}");
    }

    #[test]
    fn pick_breed_keeps_only_a_clear_winner() {
        let axis = |i: usize| { let mut v = vec![0f32; 512]; v[i] = 1.0; v };
        let cands = vec![("a".to_string(), axis(0)), ("b".to_string(), axis(1)), ("c".to_string(), axis(2))];
        // Leans clearly toward "a": logits differ by ~5 after the x100 scale.
        let mut img = vec![0f32; 512];
        img[0] = 0.30; img[1] = 0.25; img[2] = 0.25; img[3] = 0.88;
        assert_eq!(pick_breed(&img, &cands, 0.6).map(|(b, _)| b), Some("a".to_string()));
        // Split evenly between two breeds (a mixed breed): no tag at all.
        let mut tie = vec![0f32; 512];
        tie[0] = 0.30; tie[1] = 0.30; tie[3] = 0.9;
        assert!(pick_breed(&tie, &cands, 0.6).is_none());
    }

    #[test]
    fn embed_text_returns_a_unit_vector_and_is_deterministic() {
        setup_model();
        let a = embed_text("a photo of a dog").expect("clip embed_text run");
        assert_eq!(a.len(), EMBED_DIM);
        let norm: f32 = a.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "text embedding should be L2-normalized, norm={norm}");
        let b = embed_text("a photo of a dog").expect("clip embed_text run");
        assert!((cosine_sim(&a, &b) - 1.0).abs() < 1e-5, "embedding the same text twice must be deterministic");
    }

    /// The whole point of CLIP: two semantically different queries must embed further apart than
    /// the same query embedded twice — a real, if coarse, correctness signal without needing a
    /// labeled image dataset.
    #[test]
    fn different_text_queries_are_less_similar_than_identical_ones() {
        setup_model();
        let dog = embed_text("a photo of a dog").expect("run");
        let dog2 = embed_text("a photo of a dog").expect("run");
        let beach = embed_text("a sunset over the ocean").expect("run");
        let same_sim = cosine_sim(&dog, &dog2);
        let diff_sim = cosine_sim(&dog, &beach);
        assert!(same_sim > diff_sim, "identical text ({same_sim}) should be more similar than different text ({diff_sim})");
    }
}
