# sam_eval — offline accuracy harness for the AI mask

Runs the app's own ONNX models (`desktop/src-tauri/vendor/sam`, `vendor/sam2`) with the same
preprocessing as `sam.rs`, plus the app's JS edge matting (`matte_cli.mjs` pulls `_samMatteCore`
out of `chromasmith-22.html`). Used for the findings in `docs/plans/mask-tool-fixes.md`.

Setup (any folder outside the repo): `python3 -m venv venv && venv/bin/pip install "onnxruntime<1.20" numpy pillow`

- `sam_eval.py <img.png> <prompt.json> <out_dir> [gt.png]`: every prompt/model/candidate variant, scored against an outline
- `simeval.py`: simulated sloppy scribbles at brush sizes 25 and 8 over a labelled set in `./set/`
- `libeval.py`: visual contact sheets over library photos (`./lib/ok.txt`), current pipeline vs SAM 2.1

Photos and outlines are the user's own and stay out of git; run from a scratch folder holding `set/` and `lib/`.
`audit-2026-10-27.md` is the live audit of every Masks-panel control that the plan's F6 table summarises.
