# Vendored SAM 2.1 Hiera-Tiny ONNX models (Phase 3 background quality upgrade)

- `encoder.onnx`, `decoder.onnx`
- Source: https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx (converted from
  https://huggingface.co/facebook/sam2-hiera-tiny)
- License: **Apache 2.0** (commercial-safe, unlike EdgeSAM's non-commercial license in
  `vendor/sam/`).
- ~155MB total — too large for `include_bytes!` (would bloat compile times/binary size), so
  these are loaded from disk via the ONNX Runtime C API's `CreateSession` (file path), NOT
  `CreateSessionFromArray` (in-memory bytes) like `vendor/sam/`'s EdgeSAM models. Bundled as
  Tauri resources (`tauri.conf.json`'s `bundle.resources`), same mechanism as
  `vendor/onnxruntime/libonnxruntime.dylib`.
- **NOT committed to git** — `encoder.onnx` alone is ~134MB, over GitHub's 100MB hard push limit
  (this repo has no Git LFS set up). `.gitignore` excludes `vendor/sam2/*.onnx`; re-fetch after a
  fresh clone with:
  ```bash
  cd desktop/src-tauri/vendor/sam2
  curl -sL "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/encoder.onnx" -o encoder.onnx
  curl -sL "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/decoder.onnx" -o decoder.onnx
  ```
  Without these files, `sam2_encode`/`sam2_points` fail with a clear "SAM2 encoder path not
  set"/file-not-found error — EdgeSAM (`vendor/sam/`, committed, MIT-license-sized) still works
  standalone, this is purely an optional background quality upgrade.

## I/O contract (verified against the actual downloaded files via onnxruntime — `onnx.load()`
for exact names/shapes, plus a real inference run against a real photo confirming a sane mask —
not guessed. Cross-checked against Meta's own `sam2/utils/transforms.py`, since this repo's own
README undersells the actual preprocessing/postprocessing needed and has one factual error, see
below.)

**Encoder** (`encoder.onnx`) — a THIRD distinct contract, different from both MobileSAM's and
EdgeSAM's:
- input `image`: float32 `[1, 3, 1024, 1024]`. Preprocessing per Meta's `SAM2Transforms`:
  `Resize((1024,1024))` — a DIRECT, ASPECT-RATIO-DISTORTING resize straight to the square, NOT
  the resize-longest-side-then-zero-pad convention SAM1/MobileSAM/EdgeSAM all share. Then
  `(x/255 - mean) / std` with `mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]` (ImageNet
  stats, 0..1 scale — NOT EdgeSAM's 0..255-scale `pixel_mean`/`pixel_std`).
- outputs: `image_embed` `[1,256,64,64]` (same shape as MobileSAM/EdgeSAM's single embedding,
  coincidentally), plus TWO extra high-res feature maps the decoder also needs:
  `high_res_feats_0` `[1,32,256,256]`, `high_res_feats_1` `[1,64,128,128]`. All three must be
  cached together per photo (not just one tensor like SAM1-family models).

**Decoder** (`decoder.onnx`) — closer to MobileSAM's decoder shape (has `mask_input`/
`has_mask_input`, unlike EdgeSAM's), but with the two extra high-res feature inputs and no
`orig_im_size`:
- inputs: `image_embed` `[1,256,64,64]`; `high_res_feats_0` `[1,32,256,256]`; `high_res_feats_1`
  `[1,64,128,128]`; `point_coords` `[1,N,2]` float32 — in the DIRECT-1024-RESIZE pixel-coordinate
  space (`(x/orig_w, y/orig_h) * 1024`, per `transform_coords`), NOT the resize-longest-side
  space SAM1-family models use; `point_labels` `[1,N]` (1/0/-1, same convention); `mask_input`
  `[1,1,256,256]` float32 zeros when no prior mask; `has_mask_input` `[1]` float32 0.0/1.0.
- outputs: `masks` `[1,3,256,256]` LOW-RES logits (NOT full-resolution, despite this repo's own
  README implying a `low_res_masks` output exists separately — the actual downloaded graph has
  only 2 outputs: `masks` at 256×256 and `iou_predictions` `[1,3]`, confirmed via `onnx.load()`
  and a real `Run()`). Caller must pick `argmax(iou_predictions)` and upsample that 256×256
  channel to the original image size in a SINGLE bilinear resize (no crop step needed, unlike
  EdgeSAM — since the encoder's direct-square resize has no padding to crop back out; a plain
  resize with independent x/y scale factors correctly un-distorts the aspect ratio).

See `desktop/src-tauri/src/sam.rs`'s `sam2_encode`/`sam2_decode_points` for the Rust
implementation, and `desktop/src-tauri/vendor/sam/README.md` for the EdgeSAM (fast-tier)
contract this coexists with.
