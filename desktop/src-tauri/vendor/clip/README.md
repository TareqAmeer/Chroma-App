# CLIP models (AI stack Phase D — natural-language search)

`vision_model.onnx` + `text_model.onnx` — CLIP ViT-B/32 (OpenAI's `openai/clip-vit-base-patch32`),
exported to ONNX by the Transformers.js project. Sourced from:

```
https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx
https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx
https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json
```

Downloaded 2026-08-23: `vision_model.onnx` 351,685,709 bytes, `text_model.onnx` 254,058,553
bytes, `tokenizer.json` 2,224,119 bytes.

⚠️ **Full precision, not the `_quantized` variants** (`vision_model_quantized.onnx` 89.1MB,
`text_model_quantized.onnx` 64.5MB, same repo) — explicit user direction: quality/speed matters
more than vendored file size, the same call already made for Phase B's ArcFace model
(`w600k_r50.onnx` over the lighter `w600k_mbf.onnx`). Worth knowing if a future session wants to
revisit the size/quality tradeoff.

## Why ONNX, not Candle

The AI-stack plan originally specified `candle-transformers`' built-in CLIP module (turnkey —
loads the original safetensors weights with zero conversion). Explicitly reconsidered and
changed to ONNX via this codebase's existing raw `ort-sys` C API wrapper (`sam.rs`'s
`run_session`/`create_session_from_path`, the same pattern `scrfd.rs`/`arcface.rs`/`faceparse.rs`
already use) — Candle would have been a SECOND, entirely separate inference runtime and
dependency tree for one feature, when CLIP ONNX exports are common, well-documented, and this
codebase already has one proven working ONNX integration. Consistency won over Candle's smaller
per-feature integration cost.

## Verified I/O contract (onnx.load(), not assumed)

```
vision_model.onnx:
  input  "pixel_values"  [batch, 3, H, W]   float32, NCHW, RGB
  output "image_embeds"  [batch, 512]

text_model.onnx:
  input  "input_ids"     [batch, seq_len]   int64
  output "text_embeds"   [batch, 512]
```

Both outputs are RAW linear-projection embeddings, not L2-normalized by the graph itself —
`src/clip.rs`'s `embed_image`/`embed_text` normalize before returning, so cosine similarity is a
plain dot product (`clip::cosine_sim`), the same convention `arcface::embed` already established.

⚠️ **`input_ids` is the first int64 input anywhere in this codebase's AI stack** — every other
model takes float32 pixels. `sam.rs`'s `NamedInput`/`run_session` were extended with an
`InputData::I64` variant (`input_i64()`) rather than writing a second near-duplicate inference
function, so every model still shares one `run_session` code path.

## Preprocessing (verified against `preprocessor_config.json`, not assumed)

Image: resize shortest edge to 224, center-crop to 224x224, rescale to `[0,1]`, then normalize
with CLIP's own `image_mean`/`image_std` (`[0.48145466, 0.4578275, 0.40821073]` /
`[0.26862954, 0.26130258, 0.27577711]`). `resample: 3` (bicubic) in the source config —
`resize_and_center_crop` uses the same Triangle-filter stand-in every other model in this
codebase already accepts (none replicate PIL's bicubic exactly).

Text: `tokenizer.json` (HF `tokenizers`-format BPE, loaded via the Rust `tokenizers` crate)
already inserts `<|startoftext|>`/`<|endoftext|>` automatically via its configured post-processor
(confirmed: `tokenizer.encode("a photo of a dog")` → `[49406, ..., 49407]`). Padded/truncated to
`model_max_length: 77` (`tokenizer_config.json`) with the EOT token id `49407`, which is also
this tokenizer's configured `pad_token` — confirmed via `special_tokens_map.json`. The model's
own pooling finds the FIRST EOT position via argmax, so trailing pad-EOTs after a real one are
inert.

## Real-world sanity check (2026-08-23, outside the repo)

Cross-checked with a standalone Python/onnxruntime script (identical preprocessing/pooling to
`clip.rs`) against a real personal photo (a portrait/selfie) and 6 candidate text queries: "a
photo of a person" scored highest (0.258), ahead of "a photo of a dog" (0.214), "a photo of a
mountain" (0.208), "a plate of food" (0.175), "a photo of a beach" (0.174), and "a car on the
street" (0.168) — the correct ranking for a portrait photo, and scores in CLIP's typical
true-positive range (~0.2–0.35).

## License

CLIP (`openai/clip-vit-base-patch32`) is released under MIT by OpenAI; the Transformers.js ONNX
export (`Xenova/clip-vit-base-patch32`) carries the same license. Freely usable, no redistribution
caveat unlike the InsightFace-derived models (`vendor/scrfd/`, `vendor/arcface/`,
`vendor/faceparse/`).
