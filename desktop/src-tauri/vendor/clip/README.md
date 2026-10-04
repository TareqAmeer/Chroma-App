# Image-text model for tagging and search (SigLIP 2)

The files keep the `clip/` folder name, `clip.rs` module and `clip_*` catalog columns for
continuity, but since 2026-10-04 they hold **Google SigLIP 2 ViT-B/16 @224** (`ViT-B-16-SigLIP2`,
`webli` weights via open_clip / `timm/ViT-B-16-SigLIP2`, Apache-2.0), replacing OpenAI CLIP
ViT-B/32.

## Why the switch

Benchmark on 800 random photos from the real library, top-20 picks hand-checked for 7 searches
(group photo, flower, bridge, boat, car, sunset, food):

| model | correct top-20 picks | sec/photo (Intel Mac CPU) |
|---|---|---|
| CLIP ViT-B/32 (old) | 44% | 0.12 |
| **SigLIP 2 ViT-B/16** | **68%** | 0.24 |
| SigLIP 2 SO400M/14 | 61% | 1.34 |

Matches the Immich community's recommendation (SigLIP 2 base for CPU machines).

## Files

- `vision_model.onnx` — image encoder, exported from open_clip with `torch.onnx.export`
  (opset 17). Input `pixel_values` [b,3,224,224] float32 RGB, full-frame bicubic resize (no crop),
  normalised (x/255-0.5)/0.5. Output `image_embeds` [b,768] (not normalised). Max abs diff vs
  PyTorch 7e-6.
- `text_model.onnx` — text encoder, same export, then `onnxruntime.quantization.quantize_dynamic`
  on the **Gather (token-embedding table) only** (256k-vocab table is 786MB in fp32). Input
  `input_ids` [b,64] int64, output `text_embeds` [b,768]. Image-text score error vs fp32 ≤0.0012.
- `tokenizer.json` — the Gemma tokenizer from `timm/ViT-B-16-SigLIP2`; pads to 64 with 0, appends
  `<eos>`=1. Text is canonicalised first (strip punctuation, lowercase) as open_clip does.

## Scoring

SigLIP is sigmoid-trained, so `sigmoid(cos * 112.6689 + -16.771725)` is a real match probability.
Thresholds (calibrated on the same 800 photos): auto-tag 0.004, Info-panel suggestion 0.002,
search cutoff 0.001 (nonsense queries return nothing). Vocabulary terms use the prompt
"a photo of a {term}.".
