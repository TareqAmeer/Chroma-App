# Vendored MobileSAM ONNX models

- `mobile_sam_image_encoder.onnx`, `sam_mask_decoder_single.onnx`
- Source: https://huggingface.co/Acly/MobileSAM (MIT license)
- Original model: [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) (ChaoningZhang et al.)
- Exported via the encoder/decoder scripts bundled in that HF repo (`mobile_sam_encoder_onnx/`),
  which trace back to Meta's official `segment_anything` ONNX export utilities
  (`segment_anything/utils/onnx.py`).

## I/O contract (verified against the actual downloaded files + the export source, not guessed)

**Encoder** (`mobile_sam_image_encoder.onnx`) — exported with `--use-preprocess`, so
normalization/padding happen INSIDE the graph:
- input `input_image`: float32, HWC (NOT CHW, NO batch dim), raw 0–255 RGB values (NOT
  normalized — the graph does `(x - pixel_mean) / pixel_std` internally). Caller must resize
  so the LONGEST side is exactly 1024 (`resize_longest_image_size`); the graph zero-pads the
  rest to 1024×1024.
- output `image_embeddings`: float32 `[1, 256, 64, 64]`.

**Decoder** (`sam_mask_decoder_single.onnx`) — standard Meta SAM ONNX decoder signature,
`--return-single-mask` (one mask per call, not 3 candidates):
- inputs: `image_embeddings` `[1,256,64,64]`; `point_coords` `[1,N,2]` float32 in the RESIZED
  (pre-pad, 1024-longest-side) pixel-coordinate space — NOT original image pixels, NOT 0..1
  normalized; `point_labels` `[1,N]` float32 (1=positive click, 0=negative click, -1=padding
  "not a point" — a lone real point MUST be paired with one label=-1 padding point, per
  `segment_anything`'s `_embed_points`); `mask_input` `[1,1,256,256]` float32 (zero when no
  prior mask); `has_mask_input` `[1]` float32 (0.0/1.0); `orig_im_size` `[2]` float32
  `[height, width]` of the ORIGINAL (pre-resize) image, in real pixels.
- outputs: `masks` (full original-resolution logits, threshold at `> 0.0` for the binary mask),
  `iou_predictions`, `low_res_masks` (256×256 logits, usable as the next call's `mask_input` for
  iterative refinement — not currently used).

See `desktop/src-tauri/src/sam.rs` for the Rust implementation.
