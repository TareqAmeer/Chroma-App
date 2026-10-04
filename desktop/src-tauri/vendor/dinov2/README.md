# DINOv2 ViT-S/14 — pet identity embeddings

- Source: `timm/vit_small_patch14_dinov2.lvd142m` (Meta DINOv2, **Apache-2.0**).
- Export: `timm.create_model(..., pretrained=True, num_classes=0, img_size=224)` →
  `torch.onnx.export`, opset 17, input `pixel_values` [n,3,224,224] (ImageNet mean/std),
  output `embedding` [n,384] (pooled CLS token). Max abs diff vs PyTorch: 2.3e-5.
- Used by `src/dino.rs` for pet matching only. See that file's header for the measured comparison.
