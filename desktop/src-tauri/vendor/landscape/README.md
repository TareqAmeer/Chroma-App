# Landscape category segmentation (sky / water / vegetation / mountains / buildings / ground)

`model_quantized.onnx` (60MB) — [openmmlab/upernet-convnext-tiny](https://huggingface.co/openmmlab/upernet-convnext-tiny)
(UperNet + ConvNeXt-T, ADE20K 150 classes). HF model card licence: **MIT**. Fetched 2026-10-21.

Not a published ONNX: exported locally (torch 2.2.2, transformers 4.44.2, opset 17) with a FIXED
576x576 input — UperNet's pyramid pooling needs the stride-32 map divisible by 6, so 512 fails to
export — wrapped to output `logits` only ([1,150,576,576]), then `onnxruntime.quantization.quantize_dynamic`
(QUInt8): 237MB -> 60MB. Pixel argmax agreement with fp32 on test/fixtures/chr246-real/power-lines.jpg: 97.7%.
CPU (Intel Mac, ORT, 576x576): ~2.5s. Input: RGB, 0..1, ImageNet mean/std, name `pixel_values`.

Class ids are from the checkpoint's own id2label; the groups used are in `src/landscape.rs`.

Caveat: the ADE20K dataset images carry MIT CSAIL research/non-commercial terms; the released weights
declare MIT. Re-check before commercial redistribution.
