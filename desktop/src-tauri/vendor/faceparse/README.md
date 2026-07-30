# Face-feature parsing model (ROADMAP item 16)

`model_quantized.onnx` — [jonathandinu/face-parsing](https://huggingface.co/jonathandinu/face-parsing)
on Hugging Face: a SegFormer (`nvidia/mit-b5` backbone) fine-tuned on
[CelebAMask-HQ](https://github.com/switchablenorms/CelebAMask-HQ) for 19-class face parsing.
ONNX export contributed by Xenova. Downloaded 2026-07-30, `onnx/model_quantized.onnx`, 85MB.

License: the base model (`nvidia/mit-b5`) is tagged `license:other` (NVIDIA's SegFormer terms are
non-commercial/research); the fine-tune itself declares no separate license. Used here only because
this is a personal, non-distributed build for the app's own author — re-check licensing before any
public release or redistribution.

## ⚠️ Verify the real contract before trusting a published spec

The class table originally sourced for this integration did **not** match what this model actually
outputs. Verified directly with `onnx.load()` (input/output names and shapes) and a real
`onnxruntime` inference run against a real photo (`__TM3390.jpg`), the same rule
`desktop/src-tauri/src/sam.rs` already follows for EdgeSAM/SAM2 — a lesson learned there and worth
repeating here rather than re-learning it.

**Real `config.json` id2label** (confirmed against the downloaded model, not assumed):

| idx | class | idx | class |
|-----|-------|-----|-------|
| 0 | background | 10 | mouth (interior) |
| 1 | skin | 11 | u_lip |
| 2 | nose | 12 | l_lip |
| 3 | eye_g (glasses) | 13 | hair |
| 4 | l_eye | 14 | hat |
| 5 | r_eye | 15 | ear_r |
| 6 | l_brow | 16 | neck_l |
| 7 | r_brow | 17 | neck |
| 8 | l_ear | 18 | cloth |
| 9 | r_ear | | |

Differences from the originally-quoted table that would have silently excluded the wrong features
had they gone unverified: glasses is index **3** here (quoted **6**), hair is **13** (quoted
**17**), lips are **11/12** (quoted **12/13**), neck is **17** (quoted **14**).

## Preprocessing (verified against `preprocessor_config.json` AND a real run)

- Input `pixel_values`: `[1, 3, 512, 512]` NCHW, RGB, scaled to `0..1`, then ImageNet-normalized:
  `mean = [0.485, 0.456, 0.406]`, `std = [0.229, 0.224, 0.225]`.
- Output `logits`: **`[1, 19, 128, 128]`** — one quarter of the input resolution. The model's
  declared ONNX shapes are dynamic (`batch_size, num_channels, height, width`) and say nothing
  about this; it was only found by actually running the model. SegFormer's exported decode head
  does not upsample to input resolution — that step is normally left to
  `SegformerImageProcessor.post_process_semantic_segmentation`, which is Python-only, hence
  `faceparse.rs` reimplements it: per-pixel **softmax across the 19 classes at 128×128 first**,
  THEN bilinear-upsample each grouped probability, THEN scale to a `0..255` alpha. Softmax before
  upsample is what makes the result a genuine soft alpha (confidence) rather than an
  argmax-then-upsample, which would just alias a hard class boundary.

## Verification transcript (2026-07-30, on `__TM3390.jpg`)

A 900px half-width crop centered on the subject's face (`cx=1400, cy=3900` in the original
4000×6000 photo), resized to 512×512 and run through the model, then logits upsampled to 512×512
and argmax'd for a visual check:

```
unique classes present: 0 (background) 1 (skin) 2 (nose) 3 (eye_g) 9 (r_ear) 11 (u_lip)
                         12 (l_lip) 13 (hair) 17 (neck)
```

Overlaying the argmax segmentation on the source crop at 50% opacity confirmed every class lands
exactly where expected: glasses over the sunglasses, nose over the nose, lips over the mouth, hair
over the hair, ear over the ear, with the rest correctly skin. This is the ground truth the
`face_features_land_in_plausible_regions` Rust test (`faceparse.rs`) checks numerically (mean
coverage per group, bounded to plausible ranges) as a standing regression.

## Why this complements SAM rather than replacing it

CelebAMask-HQ classes are entirely face-centric — there is no torso, chest, shoulder or arm class.
The problem the Skin Tone tool exists to fix is chest-vs-face tone matching, so this model must
never be the subject selector; used that way it would grab only the face and drop the chest
entirely. It is only ever run on a face-region crop (derived from the SAM subject mask's bounding
box, top-anchored) to produce **exclusion** masks — lips, eyes+brows, glasses, hair — for the
features a colour gate cannot tell apart from skin.

## Integration pattern

Follows `sam.rs`'s existing SAM2 integration exactly: a session lazily created from a bundled
`.onnx` file path (not `include_bytes!` — 85MB is a resource, not a link-time cost), the same raw
ONNX Runtime C API plumbing (`create_session_from_path`, `run_session`, `bilinear_resize`,
`resize_rgb8` — exposed `pub(crate)` from `sam.rs` for reuse), a `set_model_path()` `OnceLock` set
once from `main.rs`'s `.setup()`, and a `resources` entry in `tauri.conf.json` alongside the SAM2
models it sits next to in size (85MB vs the SAM2 encoder's 128MB).
