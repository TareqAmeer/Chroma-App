# Optional local erase model

Model: MI-GAN-512 Places2 ONNX Pipeline v2, by Picsart AI Research / Andranik Sargsyan.
No weights are embedded in the app or repository. The user explicitly installs this
28 MB model from Retouch → Local AI erase. Only weights download; image and mask
bytes stay on the user's computer. Model location: app-data `inpainting/`.

- Official model/export code: https://github.com/Picsart-AI-Research/MI-GAN
- Code revision: `2b793c5ece43f4253e32d4afc257120a5deed6f5`
- Exact artifact: https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx
- Artifact revision: `406830d0fa60666da0071c342ad2fbc8f30c5c64`
- File size: **28,079,181 bytes**
- SHA-256: **6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b**
- Applicable code and weights terms: explicit upstream `LICENSE` and
  [`LICENSE-WEIGHTS`](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/LICENSE-WEIGHTS),
  both MIT, copyright 2024 Picsart AI Research. Full retained notice:
  [LICENSE-MI-GAN.txt](LICENSE-MI-GAN.txt).

The authors' README directly links this converted artifact and identifies its
pretrained Places2 model lineage. This resolves the code-versus-weights ambiguity
that blocked the earlier LaMa proposal. LaMa's upstream weight-license issue #368
remains open; it is not selected or downloaded.

## Runtime contract

ONNX opset 17. Inputs `image` UINT8 `[1,3,H,W]`, RGB, and `mask` UINT8
`[1,1,H,W]`: 255 means known/unchanged, 0 means remove. Output `result` UINT8
`[1,3,H,W]`. The official graph selects surrounding context, resizes that crop to
512×512 internally, infers, and returns the original source dimensions. The app
generates with the full-resolution decoded source and persists a full-resolution
transparent PNG patch, never a preview-only patch.

Three runs vary the mask's surrounding context; repeating the same deterministic
input is never presented as three alternatives. Duplicate output hashes are omitted.
The final accepted alpha mask always equals the original user mask, so extra context
does not modify unselected pixels. Model inference is native CPU ONNX Runtime, with
type/count validation before reading UINT8 output. Existing float-only SAM output
helpers cannot read this model safely.

Erase is mask-based synthesis, **not text-prompt replacement/editing**. It does not
satisfy CHR-263's prompt-generated image requirement. Windows inference is tested;
macOS requires a live native validation, and web/mobile do not run this backend.

## Asset portability and replay

Accepted patches live alongside the source at
`<photo filename>.chroma-assets/inpaint/<sha256>.png`, plus small JSON metadata.
Recipe `inpaint` refs and localStorage session `_inpaint` refs carry version 1,
asset hash, source-file SHA-256, full-source dimensions and enabled state. They carry
no PNG/base64 pixels. Source identity and asset integrity are checked on restore;
missing/mismatched assets visibly fail restore/export instead of silently omitting
the repair. Undo, Hide and geometry changes reuse stored pixels without inference.

"Export portable repaired photo" creates a dedicated destination folder containing
the original, latest XMP recipe, all companion assets (including historical repairs)
and `session-assets.json`. Open that folder in Library to replay on another desktop.
Moving an original manually requires moving its XMP and `.chroma-assets` companion
folder together. The earlier Session scaffold has no ZIP archive API.

## Quality limits observed during readiness

A real 1280×756 pole photograph ran on ONNX Runtime 1.30 CPU in 0.632–0.828 seconds
per candidate after a 0.298-second load (Python native binding readiness probe).
Three context-mask outputs differed by 20,450–21,214 channels inside the selected
region; the accepted composition was byte-identical outside it. The isolated pole
was removed, with some tree-fill artifacts. A broad central-tower selection produced
an invented pole and failed quality review. These are inference/diversity results,
not a universal object-removal quality acceptance. Review each output at 100%.
