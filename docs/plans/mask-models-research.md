# Mask model research (2026-10-21)

Goal: close the model-dependent Lightroom masking gaps. Rule: prefer MIT/Apache/BSD, flag non-commercial rather than adopt silently.
Machine: Intel Mac x86_64, ORT CPU. No ONNX on HF for most candidates, so exports were done locally (torch 2.2.2 in a scratch venv).

## (c) Landscape categories — SHIPPED
| Candidate | Licence | Verdict |
|---|---|---|
| **openmmlab/upernet-convnext-tiny** (ADE20K, 60M params) | MIT | **Chosen.** Exported at 576x576, int8 -> 60MB, ~2.5s CPU. |
| nvidia/segformer-b0..b5-finetuned-ade | "other" (NVIDIA SegFormer, non-commercial) | Rejected (same terms as existing face-parse flag). |
| facebook/mask2former-swin-tiny-ade | "other" | Rejected. |
| shi-labs/oneformer_ade20k_swin_tiny | MIT | Viable but heavier, multi-input task tokens; not needed. |
| microsoft/beit-base-finetuned-ade-640-640 | Apache-2.0 | Viable, ViT-B 640 input, much slower on CPU. |
| Realcat/skywater_seg (SegFormer-B2) | MIT label, NVIDIA base | Only 4 classes; base is non-commercial. |
Implemented: `landscape.rs`, `landscape_run` / `landscape_available`, Landscape create tile -> six category chips (hidden unless the model file exists), `test/mask_landscape.mjs`. Verified: real Rust inference on power-lines.jpg — sky 51%, vegetation 32%, buildings 6%, ground 7% (`cargo test --release landscape_groups -- --nocapture`).
Remaining: ADE20K dataset terms are research-only (weights are MIT) — confirm before commercial release; quality on water/mountain scenes not yet reviewed on a photo set.

## (a) Body skin + clothes + full parts for People — NOT SHIPPED (no licence-clean model found)
| Candidate | Licence | Notes |
|---|---|---|
| mattmdjaga/segformer_b2_clothes (ONNX available) | "other" | SegFormer base = NVIDIA non-commercial; ATR dataset terms. |
| yolo12138/segformer-b2-human-parse-24 | MIT label | Fine-tune of the above -> inherits non-commercial base. No ONNX. |
| fashn-ai/fashn-human-parser | "other" | Proprietary training data. |
| basso4/humanparsing (SCHP ATR/LIP ONNX, 267MB) | Apache label | Repackaged SCHP weights; a same-named repo says CC-BY-NC-SA; provenance unclear. |
| MnLgt/yolo-human-parse | Apache-2.0 label | Ultralytics .pt only, 11 coarse classes, unknown data; needs YOLO seg decode. |
| Sapiens (Meta) | CC-BY-NC | Non-commercial. |
Decision: People panel keeps only face-parse classes (already flagged non-commercial in LICENSES-MODELS.md). Body skin / clothes remain hidden. Next best path if wanted: train/fine-tune a small model on a permissive dataset, or accept the NVIDIA-terms mattmdjaga model as a flagged personal-use download (same status as face-parse).

## (b) Teeth — NOT SHIPPED (no model exists)
No photographic tooth-enamel segmenter with an open licence was found. Hits: dental X-ray/CBCT models (wrong domain), vimassaru/teeth-seg-upernet-convnext-tiny (MIT, FDI tooth numbering on dental images), Roboflow datasets (CC BY 4.0, data only). BiSeNet/CelebAMask face parsing has no teeth class (mouth interior only). Teeth Whitening stays the guided manual brush. Path forward: fine-tune a small segmenter on a CC BY 4.0 Roboflow mouth dataset, or add a teeth class to a MIT face-parser trained on LaPa/iBUG.
