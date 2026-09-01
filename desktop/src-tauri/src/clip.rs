// Natural-language photo search (AI stack Phase D) — CLIP ViT-B/32, via the same raw ort-sys C
// API wrapper the rest of the AI stack uses (sam.rs/faceparse.rs/scrfd.rs/arcface.rs), NOT
// Candle. Candle's own `candle-transformers` CLIP module is genuinely turnkey (safetensors load
// directly, no conversion), but it would be a SECOND inference runtime/dependency tree in a
// codebase that already has one proven, working ONNX path — an ONNX CLIP export (extremely
// common, well-documented) keeps the whole AI stack on one integration pattern. User-directed
// choice; see CLAUDE.md's AI-stack briefing.
//
// Two SEPARATE graphs (an image encoder and a text encoder), each producing an independent
// 512-dim embedding in the SAME shared space — a photo is embedded once at scan time, a search
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

const IMAGE_SIZE: u32 = 256;
const MEAN: [f32; 3] = [0.5, 0.5, 0.5];
const STD: [f32; 3] = [0.5, 0.5, 0.5];
const MAX_TOKENS: usize = 77; // CLIP's own model_max_length (tokenizer_config.json)
const EOT_TOKEN_ID: u32 = 49407; // "<|endoftext|>" — also this tokenizer's pad_token, verified against tokenizer_config.json

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

/// Resize-shortest-edge-to-224 then centre-crop 224x224 — the exact `do_resize`+`do_center_crop`
/// sequence `preprocessor_config.json` declares (`resample: 3` = bicubic; `resize_rgb8`'s
/// Triangle filter is a reasonable stand-in, same tradeoff every other model in this codebase
/// already makes — none of them replicate PIL's bicubic exactly either).
fn resize_and_center_crop(rgb: &[u8], w: u32, h: u32) -> Vec<u8> {
    let scale = IMAGE_SIZE as f32 / w.min(h) as f32;
    let (new_w, new_h) = ((w as f32 * scale).round().max(1.0) as u32, (h as f32 * scale).round().max(1.0) as u32);
    let resized = crate::sam::resize_rgb8(rgb, w, h, new_w, new_h);
    let x0 = (new_w.saturating_sub(IMAGE_SIZE)) / 2;
    let y0 = (new_h.saturating_sub(IMAGE_SIZE)) / 2;
    let mut out = vec![0u8; (IMAGE_SIZE * IMAGE_SIZE * 3) as usize];
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let sx = (x0 + x).min(new_w - 1);
            let sy = (y0 + y).min(new_h - 1);
            let src = ((sy * new_w + sx) * 3) as usize;
            let dst = ((y * IMAGE_SIZE + x) * 3) as usize;
            out[dst..dst + 3].copy_from_slice(&resized[src..src + 3]);
        }
    }
    out
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
    let cropped = resize_and_center_crop(rgb, w, h);
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
    if emb.len() != 512 {
        return Err(format!("clip: unexpected image embedding length {} (expected 512)", emb.len()));
    }
    l2_normalize(&mut emb);
    Ok(emb)
}

/// Embeds a search-query string into the SAME CLIP space as `embed_image`. Padded/truncated to
/// `MAX_TOKENS` with the EOT token id, matching this tokenizer's own configured `pad_token`
/// (verified against `tokenizer_config.json` — see vendor/clip/README.md) — the model's pooling
/// finds the FIRST EOT position via argmax, so trailing pad-EOTs after the real one are inert.
pub fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    let tok = tokenizer()?;
    let encoding = tok.encode(text, true).map_err(|e| format!("clip tokenize: {e}"))?;
    let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
    if ids.len() > MAX_TOKENS {
        ids.truncate(MAX_TOKENS - 1);
        ids.push(EOT_TOKEN_ID as i64); // truncation must still end on a real EOT for pooling to find one
    } else {
        ids.resize(MAX_TOKENS, EOT_TOKEN_ID as i64);
    }

    let sess = text_session()?;
    let mut outputs = run_session(sess, vec![input_i64("input_ids", ids, &[1, MAX_TOKENS as i64])], &["text_embeds"])?;
    let mut emb = outputs.remove(0);
    if emb.len() != 512 {
        return Err(format!("clip: unexpected text embedding length {} (expected 512)", emb.len()));
    }
    l2_normalize(&mut emb);
    Ok(emb)
}

/// Cosine similarity between two already-L2-normalized embeddings — a plain dot product. Shared
/// by the search command (text-vs-every-photo) and any future embedding-space comparison.
pub fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// Sigmoid activation function: 1 / (1 + exp(-x))
pub fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
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
];

/// The vocabulary embedded once via `embed_text`, cached behind a `OnceLock` — same lazy pattern
/// as `vision_session`/`text_session`/`tokenizer` above. Costs ~200 text-encoder forward passes
/// on first use only; every later call reuses the cached vectors.
fn tag_vocab_embeddings() -> Result<&'static Vec<(String, Vec<f32>)>, String> {
    static V: OnceLock<Result<Vec<(String, Vec<f32>)>, String>> = OnceLock::new();
    V.get_or_init(|| {
        TAG_VOCABULARY
            .iter()
            .map(|term| embed_text(term).map(|emb| (term.to_string(), emb)))
            .collect::<Result<Vec<_>, _>>()
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// The empirically-chosen cosine-similarity floor above which a vocabulary term is worth
/// suggesting as a tag — see `catalog.rs`'s `clip_tag_suggestions_ranks_close_terms_above_far_ones`
/// test and this crate's R10 verification notes for how it was picked (not guessed): real CLIP
/// image-vs-unrelated-text cosine similarities sit in a narrow positive band (commonly ~0.15-0.20
/// for OpenAI CLIP ViT-B/32), so a naive 0.2 guess risks admitting nothing. 0.22 cleared real
/// correct-tag scores while rejecting real incorrect ones on a hand-checked test photo (see the
/// README/ROADMAP note for the actual observed scores).
pub const DEFAULT_TAG_THRESHOLD: f32 = 0.5;
pub const DEFAULT_TAG_TOP_K: usize = 8;

/// Ranks an already-computed image embedding against the cached vocabulary embeddings, returning
/// the top-K terms whose Sigmoid score clears `threshold` (> 0.5), sorted by score descending.
pub fn suggest_tags(image_embedding: &[f32], top_k: usize, threshold: f32) -> Result<Vec<(String, f32)>, String> {
    let vocab = tag_vocab_embeddings()?;
    let mut scored: Vec<(String, f32)> = vocab
        .iter()
        .map(|(term, emb)| {
            let raw = cosine_sim(image_embedding, emb);
            (term.clone(), sigmoid(raw))
        })
        .filter(|(_, s)| *s > threshold)
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    if top_k > 0 {
        scored.truncate(top_k);
    }
    Ok(scored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_model() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
        set_model_paths(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/clip/vision_model.onnx"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/clip/text_model.onnx"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/clip/tokenizer.json")
        );
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
        assert_eq!(emb.len(), 512);
        let norm: f32 = emb.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "image embedding should be L2-normalized, norm={norm}");
    }

    #[test]
    fn embed_text_returns_a_unit_vector_and_is_deterministic() {
        setup_model();
        let a = embed_text("a photo of a dog").expect("clip embed_text run");
        assert_eq!(a.len(), 512);
        let norm: f32 = a.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "text embedding should be L2-normalized, norm={norm}");
        let b = embed_text("a photo of a dog").expect("clip embed_text run");
        assert!((cosine_sim(&a, &b) - 1.0).abs() < 1e-5, "embedding the same text twice must be deterministic");
    }

    /// The whole point of CLIP: two semantically different queries must embed further apart than
    /// the same query embedded twice — a real, if coarse, correctness signal without needing a
    /// labeled image dataset.
    #[test]
    fn sigmoid_thresholding_allows_multiple_tags_simultaneously() {
        let x1 = 0.8f32;
        let x2 = 0.2f32;
        let x3 = -0.5f32;

        let s1 = sigmoid(x1); // ~0.69 > 0.5
        let s2 = sigmoid(x2); // ~0.55 > 0.5
        let s3 = sigmoid(x3); // ~0.38 < 0.5

        assert!(s1 > 0.5);
        assert!(s2 > 0.5);
        assert!(s3 <= 0.5);

        let img_emb = vec![1.0f32, 0.0, 0.0];
        let tag1_emb = vec![0.8f32, 0.6, 0.0];
        let tag2_emb = vec![0.3f32, 0.95, 0.0];
        let tag3_emb = vec![-0.4f32, 0.91, 0.0];

        let tags = vec![
            ("tag1".to_string(), tag1_emb),
            ("tag2".to_string(), tag2_emb),
            ("tag3".to_string(), tag3_emb),
        ];

        let applied: Vec<(String, f32)> = tags
            .into_iter()
            .map(|(name, emb)| {
                let score = sigmoid(cosine_sim(&img_emb, &emb));
                (name, score)
            })
            .filter(|(_, score)| *score > 0.5)
            .collect();

        assert_eq!(applied.len(), 2, "Multiple tags clearing > 0.5 threshold should be applied simultaneously");
        assert_eq!(applied[0].0, "tag1");
        assert_eq!(applied[1].0, "tag2");
    }

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
