# Super Resolution — Real-ESRGAN `realesr-general-x4v3` (CHR-249)

`realesr-general-x4v3.onnx` — 4,866,393 bytes, SHA-256
`4498f2b22e29da4d70e2d16d7c056ba89cbd71297c798cb04f96a0c87d714cb4`.

Converted by `export_onnx.py` (this folder) from the upstream PyTorch weights, unmodified:

```
https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth
4,885,111 bytes, SHA-256 8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292
(downloaded 2026-10-18)
```

Architecture: `SRVGGNetCompact` (3 in, 3 out, 64 feat, 32 conv, x4, PReLU) — the 101 state-dict keys
load with `strict=True`. Export: torch 2.2.2, opset 17, dynamic H/W, input `input` (NCHW RGB 0..1),
output `output` (4x). No weights were retrained or edited.

## Licence evidence

- Code: **BSD 3-Clause**, "Copyright (c) 2021, Xintao Wang" — read from
  `https://raw.githubusercontent.com/xinntao/Real-ESRGAN/master/LICENSE` on 2026-10-18; standard
  three-condition text. Redistribution in binary form requires reproducing that notice (below).
- Weights: the repository and its model-zoo page (`docs/model_zoo.md`) state no separate terms for
  the pretrained weights; they are published as a release asset of the BSD-3-Clause repository.
  This is recorded as "no additional restriction stated", not as a legal opinion. Training data is
  not described on those pages.

```
BSD 3-Clause License — Copyright (c) 2021, Xintao Wang. All rights reserved.
Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the BSD 3-Clause conditions are met (retain this notice; reproduce it in binary
distributions; do not use the contributors' names to endorse derived products). Provided "as is",
without warranty. Full text: https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE
```

## How the app uses it

`src/superres.rs`: tiled inference (96 px cores + 12 px real context, ragged edges), 2x via per-block
2x2 box averaging of the 4x output, 4x kept as is, cancel flag, progress events, 160 MP output cap.
Surfaced as the desktop Export option **Super Resolution** (Off / 2x / 4x).
