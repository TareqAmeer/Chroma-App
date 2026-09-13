# Visual-to-spec tool benchmark

Date: 2026-09-13. Controlled reference: `test/baselines/visual/color.png` (1440×820 PNG, SHA-256 `585982e0b83ebaaea84e47685db1840825fea2ea4d0e9dfab4cb9ed6f12e982d`). This is test evidence only, not an approved design.

## Ground truth and commands

Targeted repository evidence was `docs/ui-workflow/color-pilot-readiness.md`, the `slider` contract, `design/surfaces.json` as cited by that audit, and the component registry. The registry has no `color` family; the Color evidence binds to the proposed `slider` contract (91 source registrations overall; 14 Color registrations identified by the readiness audit). Saved Color surfaces cover default/resting 220px and 440px dark/light captures, not changed, focus, drag, mobile, accessibility, or assistive states.

Commands actually run:

```sh
git ls-remote <candidate-url> HEAD
git clone --depth 1 <candidate-url> /tmp/chroma-*
npm run components:check
npm run components:contracts:check
npm run reference:spec:validate:all
npm run reference:measure -- test/baselines/visual/color.png /tmp/... 0,0 100,100 500,400
python3 /tmp/chroma-screenshot-to-design-system/scripts/sample_colors.py --image test/baselines/visual/color.png --points 0,0 100,100 500,400
node scripts/measure-ui-reference.mjs --compare <baseline.png> <candidate.png> /tmp/...
```

The initial Chroma measurement took 5.60s through npm and emitted 604 bytes for dimensions plus three RGBA samples. It had no hash, named crop, region statistic, or comparison record; every supplied sample had method provenance, but the asset identity and crop provenance were incomplete. The audited external sampler could not run because Pillow was absent. A temporary `/tmp` virtual environment was attempted after permission to install it; Pillow 10.4.0 failed during its Python 3.8 build-backend setup and Pillow 9.5.0 had no compatible binary. No project dependency was added.

After the change, direct measurement took 0.99s. A 2×2 crop at `(0,0)` independently checked against expected `[31,31,37,255]` mean/min/max, and a 1×1 crop at `(500,400)` against `[250,235,210,255]`. The record includes the reference SHA-256 and original-image coordinates. Invalid coordinates, out-of-bounds crops, WebP, dimension mismatch, and missing input each exit 1 without output.

The same-image control reported zero pixelmatch and raw RGBA differences. A temporary 2×2 red change at `(10,20)` reported four pixelmatch differences, four raw RGBA differences, and bounds `{x:10,y:20,width:2,height:2}`. Outputs remained in `/tmp`.

## Candidate audit

| Candidate | Exact URL and commit | License | Verified evidence and decision |
| --- | --- | --- | --- |
| screenshot-to-design-system | `https://github.com/WCF900905/screenshot-to-design-system` @ `030e3007a82991113a04b9e0454824b4ad2ef9c7` | MIT | `sample_colors.py` is a deterministic Pillow point/grid sampler, but clamps invalid coordinates and emits no hash/crop provenance. Its generic component completion conflicts with Chroma’s registry. Adopt only the idea of named, bounded sampling; do not copy code. |
| Design DNA | `https://github.com/fasterv410/design-dna` @ `9dccaffa7a2ce005d53033567649ad387e9b9d90` | MIT | Its measure → tokenize → build → verify → record separation is useful, but it provides no safe deterministic measurement/comparison script and its 1–3px threshold is unsupported for Chroma. Adopt the stage boundary only. |
| visual-parity | `https://github.com/Krowli/visual-parity` @ `649364b3b8d91cf3ab8bdd9c5f5dcb4d150ff736` | MIT | `render.sh` writes a Vite harness, starts a server, invokes Chrome, and leaves Vite running; `cleanup.sh` deletes harness files. It is unsuitable for this repository. Chroma already has Playwright/pixelmatch; adopt the same-size diff concept through the existing dependencies. |
| visual-to-spec | `https://github.com/xionglingyu51-sys/codex-skills` @ `b757bc4c2c324e1daa17a037a871d29b95f271de` | No repository-level license found for `visual-to-spec` | Its visible/estimated/inferred distinction and human-review output reinforce existing Chroma evidence separation. Its instructions also infer fonts, responsive constraints, and strictness from one image, which Chroma must reject. Concepts cited only; no files copied. |

## Evidence score

Scores are 0–2 from inspected code and the controlled run: 0 absent/conflicting, 1 partial, 2 verified fit.

| Candidate | Accuracy | Determinism | Provenance | Prevents inference | Schema/registry fit | Verification | Offline/dependency | License | Maintainability |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chroma baseline | 2 | 2 | 1 | 2 | 2 | 0 | 2 | 2 | 2 |
| screenshot-to-design-system | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 1 |
| Design DNA | 1 | 0 | 1 | 0 | 0 | 1 | 2 | 2 | 1 |
| visual-parity | 1 | 1 | 1 | 1 | 1 | 2 | 0 | 2 | 0 |
| visual-to-spec | 1 | 0 | 1 | 1 | 0 | 0 | 2 | 0 | 1 |

## Outcome

Accepted: SHA-256-backed crop manifests and clearly labeled region pixel statistics; measure → specify → approve → implement → verify → record; and same-size pixelmatch comparison with raw changed bounds. They close measured gaps, use existing `pngjs`/`pixelmatch`, preserve the JSON schema, and avoid semantic claims. Expected review cost is lower than manually reconstructing sample locations or diff regions; output grows modestly only when requested crops exist.

Rejected: generic component-library completion, semantic-token claims from sampled colours, font identification, inferred responsive/accessibility/motion states, Design DNA’s unmeasured threshold, and Visual Parity’s Vite harness.

Deferred: browser/computed-style capture and visual annotation. They need an approved implementation/state target and are not established by this one static reference. Remaining limitations are PNG-only input, pixel evidence only, and no meaning/correctness judgment from a diff.
