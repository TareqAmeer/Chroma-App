# Masking model bench (CHR-298) — 2026-10-19

Status: licence, size, latency and peak-RAM measured 2026-10-19 (CPU only, onnxruntime 1.19.2, Intel Mac,
`tools/scripts/mask_model_bench.py`, 5 warm runs, one 1024px image). **Quality is not measured**: the CHR-297 fixtures
are synthetic, so model masks on them would mean nothing; real-photo labels are still open. Quality is scored with the CHR-297 harness: `node test/mask_quality_synth.mjs --candidates <dir>`
(`<dir>/<fixture-id>.png` exports) — fixtures are procedural, so real-photo scoring is still open.

| Model | Role | Bundled? | Size | Licence (verify upstream before shipping) | Latency / RAM / score |
|---|---|---|---|---|---|
| EdgeSAM enc+dec | point/box prompts | yes (`vendor/sam`) | 22.1 + 15.9 MB | NTU S-Lab 1.0, **non-commercial** | enc 0.29 s, dec 0.04 s, 378 MB |
| SAM 2.1 Hiera-Tiny enc+dec | point prompts | yes (`vendor/sam2`) | 134.3 + 20.6 MB | Apache-2.0 | enc 1.91 s, dec 0.07 s, 1556 MB |
| face-parsing SegFormer | skin/eyes/lips/hair | yes (`vendor/faceparse`) | 89.4 MB | NVIDIA SegFormer, **non-commercial** | to measure |
| Depth Anything V2 Small | depth range | yes (`vendor/depth`) | 27.3 MB | Apache-2.0 | to measure |
| MobileSAM (`PulpCut/mobilesam-onnx`) | point/box prompts | no | 28.2 + 16.5 MB | Apache-2.0 (upstream repo LICENSE confirmed; the ONNX re-export repo declares no licence) | enc 0.70 s, dec 0.04 s, 667 MB |
| sam2-lite (distilled) | point prompts | no | ~74 MB | **CC-BY-NC-4.0 (HF repo) — exclude; earlier research claim of Apache-2.0 was wrong** | not downloaded |
| BiRefNet_lite (`onnx-community`, fp32, 1024px) | hair matting, salient subject | no | 224 MB | MIT (upstream LICENSE + HF card confirmed) | **30.9 s cold / 69.9 s warm**, 3351 MB |
| Florence-2 / Grounding DINO | text prompts | no | unverified | MIT / Apache-2.0 reported | to measure |
| SegFormer/OneFormer ADE20K | landscape classes | no | unverified | per-checkpoint, often non-commercial | needs licence-clean checkpoint |
| RMBG-1.4 | matting | no | — | **non-commercial — exclude** | — |
| SAM 3 | concept prompts | no | large | Meta SAM licence | likely too heavy for Intel CPU |

## Findings
- **Speed order:** EdgeSAM (0.29 s) < MobileSAM (0.70 s) < SAM 2.1 Tiny (1.9 s, 1.5 GB RAM) << BiRefNet_lite (30-70 s, 3.3 GB). Decoders are all <0.08 s, so re-prompting after the encoder runs is instant.
- **Licensing:** EdgeSAM is the fastest but non-commercial. MobileSAM (Apache-2.0) is 2.4x slower and 1.8x the RAM of EdgeSAM but commercially clean; it is the drop-in replacement if a commercial build is wanted. SAM 2.1 stays as the quality path.
- **Matting:** BiRefNet_lite at 1024 px is unusable interactively on this CPU. It is only viable as an opt-in background pass on a cropped boundary band at 512 px (roughly 4x fewer pixels), run once and cached; fp16 / quantised variants and a 512x512 export (`onnx-community/BiRefNet_512x512-ONNX`) should be benched next. Warm runs were slower than cold (memory pressure at 3.3 GB), so these timings are noisy.
- Quality comparison remains open until real labelled photos exist (CHR-297).

## Recommended defaults (provisional, speed/licence only)
- Point/box prompts: keep EdgeSAM for personal builds; MobileSAM for any commercial build; SAM 2.1 for the high-quality option.
- Matting: BiRefNet 512 px boundary-band pass, opt-in, background; do not ship 1024 px.
- Salient subject: reuse the SAM paths; no separate model justified yet.

## Reproduce
`python3 -m venv v && v/bin/pip install onnxruntime==1.19.2 numpy pillow && v/bin/python tools/scripts/mask_model_bench.py <models_dir> 5`

## Matting candidates, scored (2026-10-19, CHR-297 22 reviewed photos)
Whole-image models, run once per photo, scored against the reviewed labels. Alpha MAE / boundary-band MAE (lower is better). Timings are medians on the dev Intel Mac **while it was busy running other work, so treat them as pessimistic upper bounds**; they will be faster on an idle or newer machine and much faster with a GPU provider.

| Category (n) | Current EdgeSAM click | BiRefNet-lite 512* | ISNet general (1024) | MODNet (<=1024) |
|---|---|---|---|---|
| hair (4) | 0.128 / 0.353 | 0.005 / 0.014 | 0.014 / 0.033 | 0.012 / 0.030 |
| backlit (4) | 0.114 / 0.309 | 0.003 / 0.022 | 0.039 / 0.135 | 0.019 / 0.053 |
| glasses (4) | 0.058 / 0.194 | 0.006 / 0.015 | 0.016 / 0.032 | 0.010 / 0.024 |
| people (4) | 0.228 / 0.701 | 0.160 / 0.507 | 0.086 / 0.205 | 0.063 / 0.221 |
| foliage (4) | 0.305 / 0.343 | 0.291 / 0.514 | 0.266 / 0.395 | 0.283 / 0.499 |
| sky-branches (2) | 0.110 / 0.347 | 0.102 / 0.313 | 0.110 / 0.303 | 0.116 / 0.309 |
| time / photo | 0.3 s (+0.04) | see below | 1.6 s | 0.6 s |
| size, licence | 22 MB, non-commercial | 192 MB, MIT | 176 MB, MIT | 26 MB, Apache-2.0 |

\* BiRefNet-lite made the draft labels, so its column is biased upward and is shown only as a ceiling.

**Reading it:** independent matting models (ISNet, MODNet) beat the current click-mask by ~10x on hair/glasses boundary error and ~3x on groups of people, at 0.6-1.6 s. Nobody solves foliage-against-sky or fine branches without a different approach. They select the salient subject(s) automatically rather than the one thing you clicked, so they replace "Select Subject", not click prompts.

**Tiered plan (user request):**
- **Tier 1, older/CPU-only machines:** MODNet (26 MB, ~0.6 s). Default.
- **Tier 2, modern machines with a GPU / Apple Silicon:** ISNet or BiRefNet at full size through a GPU execution provider (CoreML/DirectML/CUDA), selectable in settings; auto-picked by a one-time speed test.
- Keep EdgeSAM/SAM 2.1 for click-to-select and Add/Subtract refinement.
