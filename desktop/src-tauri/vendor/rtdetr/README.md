# Pet/animal detector (people-pets wireframes screen P)

`model_quantized.onnx` — [onnx-community/rtdetr_r18vd](https://huggingface.co/onnx-community/rtdetr_r18vd)
on Hugging Face: an ONNX export (by the `onnx-community` project, for `transformers.js`) of
[`PekingU/rtdetr_r18vd`](https://huggingface.co/PekingU/rtdetr_r18vd) — RT-DETR (Zhang et al.,
*"DETRs Beat YOLOs on Real-Time Object Detection"*, CVPR 2024), the ResNet-18 backbone variant,
trained on COCO. Downloaded 2026-09-02, `onnx/model_quantized.onnx` (int8 dynamic quantization),
21.7MB.

License: **Apache-2.0**, both `PekingU/rtdetr_r18vd`'s own model card and its origin repo
([lyuwenyu/RT-DETR](https://github.com/lyuwenyu/RT-DETR)) — chosen deliberately over the
Ultralytics YOLO family (AGPL-3.0, which would require open-sourcing this whole app or an
enterprise licence for a public commercial `.dmg`; see the people-pets wireframes' own screen P
notes). The r18vd (ResNet-18) variant is used rather than r50vd/r101vd for size — this is
purely "is an animal here", never the harder "which individual animal" job (that's still
`subject.rs`'s PerSAM, which needs no model of its own).

## ⚠️ Verify the real contract before trusting a published spec

Same rule `faceparse.rs`'s and `sam.rs`'s own vendor READMEs already follow — confirmed directly
with `onnx.load()` (input/output names and shapes) and a real `onnxruntime` inference run against
a real photo (the classic `pjreddie/darknet` `dog.jpg` test image: a dog, a bicycle and a
parked truck), not assumed from RT-DETR's published architecture.

**I/O, verified**:
- Input `pixel_values`: `[batch, 3, height, width]`, dynamic H/W in the graph but the model was
  trained and should be run at **640×640** (`preprocessor_config.json`'s `size`).
- Output `logits`: `[batch, 300, 80]` — 300 object queries, 80 COCO class logits each (raw, apply
  `sigmoid`, NOT softmax — RT-DETR is trained with focal loss over independent per-class
  probabilities, matching `transformers`' own `RTDetrImageProcessor.post_process_object_detection`).
- Output `pred_boxes`: `[batch, 300, 4]` — **center-x, center-y, width, height**, all normalized
  `0..1` of the input square (NOT a corner box, and NOT pixel coordinates — converted to the
  corner-box `FaceBox` convention this app uses everywhere else, in `petdetect.rs`).
- **No NMS is needed or present in the graph.** RT-DETR is explicitly NMS-free — duplicate
  suppression is learned during training via one-to-one matching, unlike YOLO's dense-anchor +
  NMS pipeline. Taking the top-scoring queries directly is correct, not a shortcut.

## Preprocessing (verified against `preprocessor_config.json` AND a real run)

Resize to 640×640, rescale to `0..1` (`x / 255`) — **`do_normalize: false`** in the real
`preprocessor_config.json`, i.e. **no ImageNet mean/std subtraction**, unlike `faceparse.rs`'s
model. Easy to get wrong by assuming every ONNX vision model normalizes the same way; this one
was checked, not assumed.

## Verification transcript (2026-09-02, `pjreddie/darknet`'s `dog.jpg`)

```
dog             score=0.925 box=(131,222,310,541)
bicycle         score=0.912 box=(127,137,568,421)
car             score=0.676 box=(467,74,693,171)
truck           score=0.437 box=(468,74,693,170)
motorbike       score=0.303 box=(59,85,104,125)
```
The dog box (131,222)-(310,541) on a 768×576 image correctly covers the dog in the lower-left —
this is `petdetect.rs`'s own committed regression fixture and test.

## Classes used

Only 4 of the 80 COCO classes are surfaced (`PET_CLASSES` in `petdetect.rs`), verified against the
real `config.json`'s `id2label`:

| class | COCO index |
|---|---|
| bird | 14 |
| cat | 15 |
| dog | 16 |
| horse | 17 |

## What this does NOT do

Detection only — "there is an animal here, roughly this box, probably this species". It has **no
opinion on identity** ("which dog"). That is still exactly what `subject.rs`'s PerSAM path does
(measured ~77-80% recall on a real multi-year, multi-camera dataset — see that file's own module
doc), and this detector's output is meant to feed it: a detected box becomes a starting point for
Teach/Find instead of a hand-scribbled one, via `catalog_pets_scan` creating an auto pet-person
per detection that shows up in the ordinary Unnamed review queue. No individual-animal
re-identification embedder (MegaDescriptor, DINOv2, etc.) is bundled — see the people-pets
wireframes' own screen P notes on that being a separate, larger, licence-sensitive decision.

## Integration pattern

Follows `faceparse.rs`/`rawdenoise.rs` exactly: a session lazily created from a bundled `.onnx`
file path (not `include_bytes!` — 21.7MB is a resource, not a link-time cost), the same raw ONNX
Runtime C API plumbing (`create_session_from_path`, `run_session`, `resize_rgb8` — exposed
`pub(crate)` from `sam.rs`), a `set_model_path()` `OnceLock` set once from `main.rs`'s `.setup()`,
and a `resources` entry in `tauri.conf.json` alongside the other disk-loaded models.
