# AI inpainting model decision (CHR-263)

**Status: provisional implementation constraint, 2026-10-06.** This is a product and engineering
decision for the current work, not a legal opinion or a final model approval.

## Decision

Do not add remote image generation, bundle or distribute an inpainting model, or expose in-app
generative inpainting yet. A future proposal must first identify a prompt-capable artifact and
document its provenance and applicable terms, runtime and download behavior, target hardware and
storage cost, image privacy/data flow, and how generated candidates are previewed, persisted,
undone, and exported. Review those findings before selecting or shipping an artifact.

Keep deterministic, mask-based repair work separate from prompt-guided generation. Open-source
tools illustrate that these are distinct model classes: IOPaint documents erase models such as
LaMa, MAT, and MIGAN separately from its Stable Diffusion and other diffusion integrations. Its
model documentation also describes fetching models at service startup and allowing a custom model
directory. This is a useful implementation and operations reference, not an endorsement or a
license review for Chromasmith.

## Evidence and limits

- OpenCV Zoo's LaMa ONNX directory states that files in that directory are Apache-2.0 and points to
  the ONNX model source. The Hugging Face model card identifies its artifact as a port of the
  original PyTorch big-lama model. These statements describe those published artifacts; they do
  not establish the provenance or rights for every upstream pretrained weight. The upstream LaMa
  issue about pretrained-weight licensing is unresolved in the cited discussion.
- The Stable Diffusion v1.5 inpainting model card declares CreativeML OpenRAIL-M. That is a
  model-specific set of terms to review, not a universal license for diffusion models.
- A hosted inference path would transmit image content beyond the local app, while a local model
  introduces artifact acquisition, storage, runtime, and hardware requirements. Both need explicit
  product and privacy review before implementation.
- This note makes no legal conclusion that any candidate artifact may or may not be used,
  redistributed, or bundled.

## Re-entry checklist

Before reopening implementation, record:

1. Exact model repository, revision, file hashes, upstream code/weight provenance, and the terms
   applicable to each artifact and its training or conversion lineage.
2. Whether inference is local or remote; for remote inference, the transmitted fields, provider,
   retention/training terms, user consent, and failure behavior.
3. Download source, integrity verification, update policy, install location, disk footprint,
   supported operating systems, hardware requirements, and graceful unsupported-device behavior.
4. The user-visible generation boundary: candidate preview, source immutability, durable save,
   undo/redo, recipe/history representation, and explicit export behavior.
5. Quality, latency, memory, and representative-image acceptance criteria, including artifacts,
   safety boundaries, and regression coverage.

## References

- [IOPaint model families](https://www.iopaint.com/models)
- [IOPaint model download and storage behavior](https://www.iopaint.com/install/download_model)
- [OpenCV Zoo LaMa ONNX directory and license statement](https://github.com/opencv/opencv_zoo/tree/main/models/inpainting_lama)
- [Carve LaMa-ONNX model card](https://huggingface.co/Carve/LaMa-ONNX)
- [LaMa upstream issue on pretrained-weight licensing](https://github.com/advimman/lama/issues/368)
- [Stable Diffusion v1.5 inpainting model card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting)
