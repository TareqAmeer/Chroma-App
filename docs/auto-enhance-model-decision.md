# Auto-enhance: learned model decision (2026-10-18)

**Decision: no learned model is bundled. `autoEnhanceParams()` (deterministic, linear-light) stays.**
Every candidate that predicts good tone/colour was trained on data that forbids commercial use,
or has no licence at all. Checked 2026-10-18.

| Candidate | Code licence | Training data / weights | Verdict |
|---|---|---|---|
| IAT (cuiziteng/Illumination-Adaptive-Transformer, ~90K params) | Apache-2.0 (repo LICENSE, © Univ. of Tokyo) | Released weights trained on LOL and MIT-Adobe FiveK (README); no separate weights licence | Blocked by data terms |
| Image-Adaptive-3DLUT (HuiZeng) | Apache-2.0 (GitHub API) | Pretrained models are FiveK-trained | Blocked by data terms |
| AdaInt (ImCharlesY) | Apache-2.0 (repo LICENSE) | FiveK-trained | Blocked by data terms |
| CSRNet (sjmoran) | No licence file found | FiveK-trained | Blocked (no licence) |
| Zero-DCE / ++ (Li-Chongyi) | **No licence** (GitHub reports none) | SICE-trained | Blocked (all rights reserved by default) |

MIT-Adobe FiveK terms (data.csail.mit.edu/graphics/fivek/legal/LicenseAdobe.txt, LicenseAdobeMIT.txt):
"You may only exercise these rights ... solely for your own research purposes, and you shall not
exercise any of these rights in any manner that is intended for or directed toward commercial
advantage or monetary compensation." Whether weights derived from such data are bound by that is
unsettled; Chromasmith is a commercial-capable GPL app, so we do not take the risk. LOL is likewise
research-oriented. Not pursued: MAXIM (same data lineage).

## What would unlock a learned model
Expert-retouched before/after pairs under a permissive licence (none known), or a purpose-built set
of CC0/own photos graded by the team. A tiny slider regressor (features -> 9 Basic sliders) could
then be trained and shipped as ONNX following `superres.rs`. Training it on the outputs of
`autoEnhanceParams` itself would only reproduce it, so it is not worth doing.
