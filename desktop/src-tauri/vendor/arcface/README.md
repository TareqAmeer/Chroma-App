# ArcFace face embedding model (AI stack Phase B)

`w600k_r50.onnx` — InsightFace's `buffalo_l`-tier ArcFace recognition model, ResNet50 backbone,
512-dim embedding. Sourced from the same mirror `markrai/seen` documents and uses itself:

```
https://huggingface.co/maze/faceX/resolve/e010b5098c3685fd00b22dd2aec6f37320e3d850/w600k_r50.onnx
```

Downloaded 2026-08-23, 174,383,860 bytes.

⚠️ **Deliberately the heavier `buffalo_l` tier, not `buffalo_s`/MobileFaceNet** — the AI-stack
plan's original scoping picked buffalo_s for "no dedicated GPU", but that reasoning was about
*detection* running over a whole image; embedding runs once per already-detected 112x112 face
crop, which is cheap regardless of backbone. Explicit user direction for this phase: embedding
quality matters more than model size or a marginal CPU-time difference on a single small crop.
A `w600k_mbf.onnx` (buffalo_s, ~13.6MB, `https://huggingface.co/deepghs/insightface/resolve/main/buffalo_s/w600k_mbf.onnx`)
was downloaded and verified live first, then swapped for this one on that direction — worth
knowing if a future session wants to revisit the size/quality tradeoff.

## Verified I/O contract (onnx.load(), not assumed)

```
input  "input.1"  [None, 3, 112, 112]   NCHW, RGB, float32
output "683"      [1, 512]              L2-normalized by src/arcface.rs after inference
```

The output tensor name (`"683"`) is this specific export's own internal numbering, not a stable
contract — if this model file is ever re-downloaded or swapped for a different export, re-verify
with `onnx.load()` before assuming the name is unchanged (the raw `ort-sys` C API's `Run()`
requires the exact graph output name, unlike a positional/first-output API).

Preprocessing matches InsightFace's own `ArcFaceONNX` model class: `(pixel - 127.5) / 127.5` per
channel, RGB channel order.

## Alignment — real 5-point similarity transform, not a naive bbox crop

`markrai/seen`'s own ArcFace preprocessing (`preprocess_arcface` in `face.rs`) just resizes the
raw SCRFD detection bounding box to 112x112 — it does NOT use the 5 landmarks SCRFD already
provides. `src/arcface.rs` does the real InsightFace alignment instead: a Umeyama similarity
transform (rotation + uniform scale + translation, least-squares fit, no shear) mapping the
detected 5 landmarks onto InsightFace's own canonical `arcface_dst` template, then a backward-
mapped bilinear warp of the ORIGINAL image into that fixed 112x112 frame. This is what the
published ArcFace accuracy numbers assume, and is what real InsightFace pipelines
(`face_align.norm_crop`) do — a meaningfully better crop than a bbox resize, which leaves faces
at whatever in-plane rotation/scale the camera happened to capture them at.

The Umeyama estimator is implemented from scratch (2x2 SVD via `A^T A` eigendecomposition, no
external linear-algebra dependency) and covered by three analytic unit tests in `arcface.rs`
(identity landmarks → identity transform, pure translation, and a known scale+rotation → the
transform must recover that exact scale with an orthogonal, shear-free rotation) rather than
relying on a real face image to catch a sign/axis bug in the derivation.

## Not yet done

No labeled same-person/different-person photo pairs are checked into this repo, so embedding
QUALITY (same person → high cosine similarity, different people → low) is not covered by an
automated test — only that the model loads, runs, and returns a well-formed 512-dim unit vector.
Phase A's SCRFD detector was spot-checked against real personal photos outside the repo (see
`vendor/scrfd/README.md`); doing the equivalent for embedding similarity is a reasonable next
step once real labeled pairs are available, before trusting the clustering `eps` default (0.6)
on a real library.

## License

Same InsightFace pretrained-model licensing caveat already recorded for `vendor/scrfd/README.md`
and `vendor/faceparse/README.md`: fine for this personal, non-distributed build; re-check before
any public release or redistribution.
