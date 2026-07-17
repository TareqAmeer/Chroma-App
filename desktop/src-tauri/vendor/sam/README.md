# Vendored EdgeSAM ONNX models

- `edge_sam_encoder.onnx`, `edge_sam_decoder.onnx`
- Source: https://huggingface.co/spaces/chongzhou/EdgeSAM/tree/main/weights
- Original model: [EdgeSAM](https://github.com/chongzhou96/EdgeSAM) (Zhou et al., NTU S-Lab)
- License: **NTU S-Lab License 1.0 — non-commercial only.** Chromasmith is a personal,
  non-commercial project, so this is acceptable here; do not reuse these model files in any
  commercial context. (Contrast with the previous MobileSAM models, which were MIT-licensed —
  swapped out for EdgeSAM per the AI-select plan's Phase 2 for faster inference, keeping the
  option open to add Apache-2.0 SAM 2.1 as a background quality upgrade in Phase 3.)
- These are the base `edge_sam_encoder.onnx`/`edge_sam_decoder.onnx` exports (not the `_3x`
  variants — `_3x` is a longer-trained checkpoint; base was chosen to match the sizes referenced
  in the original plan and needs no extra justification to swap later, same I/O contract).

## I/O contract (verified against the actual downloaded files via onnxruntime — `onnx.load()`
for exact names/shapes, plus a real inference run against a real photo confirming a sane mask —
not guessed. Cross-checked against EdgeSAM's own `segment_anything/onnx/predictor_onnx.py`.)

**Encoder** (`edge_sam_encoder.onnx`) — same shape contract as MobileSAM's encoder, but CHW not
HWC and normalization happens OUTSIDE the graph (caller must do it):
- input `image`: float32 `[1, 3, 1024, 1024]` (batch, channel, height, width) — pre-normalized
  `(x - pixel_mean) / pixel_std` with `pixel_mean=[123.675,116.28,103.53]`,
  `pixel_std=[58.395,57.12,57.375]`, then zero-padded to the square 1024×1024 canvas by the
  CALLER (not inside the graph, unlike MobileSAM). Caller resizes so the longest side is exactly
  1024 before padding.
- output `image_embeddings`: float32 `[1, 256, 64, 64]` — identical shape to MobileSAM's.

**Decoder** (`edge_sam_decoder.onnx`) — a genuinely different contract from MobileSAM's decoder,
not a drop-in:
- inputs: `image_embeddings` `[1,256,64,64]`; `point_coords` `[1,N,2]` float32 in the RESIZED
  (pre-pad, 1024-longest-side) pixel-coordinate space — same convention as MobileSAM; `point_labels`
  `[1,N]` float32 (1=positive, 0=negative, -1=padding — a lone point still needs the padding
  point, same as MobileSAM). **No** `mask_input` / `has_mask_input` / `orig_im_size` inputs.
- outputs: `scores` `[1,4]` and `masks` `[1,4,256,256]` — ALWAYS 4 multimask candidates (no
  single-mask mode). The caller must pick `argmax(scores)` and upsample that one 256×256 channel
  itself in two bilinear stages (256→1024 padded square, crop to the unpadded input region, then
  resize to the original image size) — the graph does NOT do this internally, unlike MobileSAM's
  decoder which returns full-resolution logits directly. See `bilinear_resize()` /
  `decode_point()` in `desktop/src-tauri/src/sam.rs` for the exact replication of
  `predictor_onnx.py`'s `postprocess_masks()`.

See `desktop/src-tauri/src/sam.rs` for the Rust implementation.
