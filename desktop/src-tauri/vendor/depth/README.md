# Depth Anything V2 Small (ROADMAP R7 — depth mask + depth blur/tilt-shift)

`model_quantized.onnx` — [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small)
on Hugging Face: an ONNX export (contributed by the `onnx-community`/Transformers.js project) of
[depth-anything/Depth-Anything-V2-Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small),
a monocular relative-depth model. Downloaded 2026-08-31:

```
https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx
https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/preprocessor_config.json
```

`model_quantized.onnx` is 27,258,801 bytes (26.0MB), sha256
`fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d`. Chosen over the full-precision
`model.onnx` (99.1MB) — for a single-channel depth map feeding a mask gate and a blur-weight
compositor, the int8 quantization's extra error is inconsequential compared to CLIP's per-photo
similarity ranking (`vendor/clip/README.md`'s explicit "quality over size" call doesn't apply here:
there is no downstream numeric comparison sensitive to embedding precision). Comparable in size to
`vendor/sam2/decoder.onnx` (20MB) and smaller than `vendor/faceparse/model_quantized.onnx` (85MB).

## License — genuinely permissive, verified, not assumed

- The ONNX export repo (`onnx-community/depth-anything-v2-small`) declares `license: apache-2.0`
  via the Hugging Face API (`cardData.license`, confirmed via `GET /api/models/...`).
- Its `base_model` tag points to `depth-anything/Depth-Anything-V2-Small`, whose own model card
  also states `License: apache-2.0`.
- This is the **Small** variant specifically — Depth Anything V2's **Base** and **Large** variants
  are `cc-by-nc-4.0` (non-commercial), same asymmetry pattern as this repo already saw with SAM
  (EdgeSAM non-commercial vs SAM 2.1 Apache-2.0) and CLIP. Small was chosen because it is both the
  smallest file AND the only variant with no non-commercial caveat — no LICENSES-MODELS.md flag
  needed for this one, unlike EdgeSAM/face-parsing.

## Verified I/O contract

Static verification against the real downloaded `.onnx` (protobuf string table, `strings -a`):
tensor names `pixel_values` (input) and `predicted_depth` (output) — matching the standard
Transformers `DPTImageProcessor`/`AutoModelForDepthEstimation` export naming used by every other
Depth Anything ONNX conversion. ⚠️ A live `onnxruntime` forward-pass verification (shapes with
real numbers, not just names) could **not** be completed in this environment — see the exact
blocker recorded in `depth.rs`'s module doc comment. Treat the fixed working resolution and
preprocessing below as sourced from `preprocessor_config.json` (downloaded alongside, real file)
rather than from a live run, and re-verify shapes with a debug print on first real desktop build.

`preprocessor_config.json` (`DPTImageProcessor`, real downloaded file):
```
size: 518x518, resample: bicubic (3), keep_aspect_ratio: true, ensure_multiple_of: 14
rescale_factor: 1/255, image_mean: [0.485,0.456,0.406], image_std: [0.229,0.224,0.225]
```
`depth.rs` uses a fixed 518x518 square input (matching `faceparse.rs`'s fixed-512 convention
rather than the processor's dynamic aspect-preserving resize — same simplification, same
justification: a per-photo dynamic ONNX shape would need session recreation per aspect ratio).

## Output convention — relative inverse depth (disparity), NOT metric

Depth Anything (V1 and V2) predicts **disparity**, not depth: the model card and the upstream
repo (`DepthAnything/Depth-Anything-V2` issue #93) describe the raw output as inverse-depth-like,
where **larger value = closer to the camera**, smaller = farther. There is no documented fixed
output range — `depth.rs` min-max normalizes each photo's raw output to 0..1 itself (0 = farthest
point in THIS photo, 1 = nearest), the standard visualization convention this model's own repo
uses. This is a *relative*, per-photo scale, not an absolute distance — consistent with "Small"
never being metric-fine-tuned (only the separate Metric variants are).
