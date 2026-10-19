# Masking model bench (CHR-298) — 2026-10-19

Status: licence + size table done; **latency/RAM/quality columns not yet measured** (they need
onnxruntime run against candidate weights that are not in the repo, and downloading weights needs an
explicit go-ahead). Quality is scored with the CHR-297 harness: `node test/mask_quality_synth.mjs --candidates <dir>`
(`<dir>/<fixture-id>.png` exports) — fixtures are procedural, so real-photo scoring is still open.

| Model | Role | Bundled? | Size | Licence (verify upstream before shipping) | Latency / RAM / score |
|---|---|---|---|---|---|
| EdgeSAM enc+dec | point/box prompts | yes (`vendor/sam`) | 22.1 + 15.9 MB | NTU S-Lab 1.0, **non-commercial** | to measure |
| SAM 2.1 Hiera-Tiny enc+dec | point prompts | yes (`vendor/sam2`) | 134.3 + 20.6 MB | Apache-2.0 | to measure |
| face-parsing SegFormer | skin/eyes/lips/hair | yes (`vendor/faceparse`) | 89.4 MB | NVIDIA SegFormer, **non-commercial** | to measure |
| Depth Anything V2 Small | depth range | yes (`vendor/depth`) | 27.3 MB | Apache-2.0 | to measure |
| MobileSAM | point/box prompts | no | ~36 MB | Apache-2.0 reported (the repo once shipped it as MIT) | to measure |
| sam2-lite (distilled) | point prompts | no | ~74 MB | Apache-2.0 reported | reported ~0.9 s/frame on 6 CPU threads |
| BiRefNet (+ matting ONNX) | hair matting, salient subject | no | unverified | MIT reported | to measure |
| Florence-2 / Grounding DINO | text prompts | no | unverified | MIT / Apache-2.0 reported | to measure |
| SegFormer/OneFormer ADE20K | landscape classes | no | unverified | per-checkpoint, often non-commercial | needs licence-clean checkpoint |
| RMBG-1.4 | matting | no | — | **non-commercial — exclude** | — |
| SAM 3 | concept prompts | no | large | Meta SAM licence | likely too heavy for Intel CPU |

## Findings so far
- Two shipped masking models (EdgeSAM, face-parsing) are non-commercial; SAM 2.1 already covers point prompts under Apache-2.0, so MobileSAM would only be worth adding as a fast path.
- Matting at hair is the clearest accuracy gap; BiRefNet is the first candidate, scored on the CHR-297 hair/backlit/complex-sky categories.

## Next steps to close the ticket
1. Get approval to download MobileSAM, BiRefNet (matting ONNX) and sam2-lite into a scratch folder; confirm each licence file.
2. Time encoder+decoder per model on the dev Intel Mac via the vendored `libonnxruntime.dylib` (cold + warm, peak RSS), N=10.
3. Export each model's masks for the CHR-297 fixtures, run the harness with `--candidates`, and fill the last column.
4. Recommend a default per task from that table.
