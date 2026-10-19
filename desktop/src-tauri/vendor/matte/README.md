# Subject matting models (Auto Subject mask — see src/matte.rs)

Whole-image alpha matte of the salient subject(s); powers "Auto Subject" in the Masks panel. Scored
on the 22 reviewed real photos in docs/masking-model-bench.md (hair boundary-band MAE 0.030 MODNet /
0.033 ISNet vs 0.353 for the EdgeSAM click mask).

| File | Source | Size | Licence | In git? |
|---|---|---|---|---|
| `modnet.onnx` | https://huggingface.co/onnx-community/modnet-webnn/resolve/main/onnx/model.onnx (ONNX export of ZHKKKe/MODNet) | 25,888,640 B, sha256 `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9` | Apache-2.0 (HF model card) | yes, bundled — default tier |
| `isnet.onnx` | https://huggingface.co/imgly/isnet-general-onnx/resolve/main/onnx/model.onnx (ISNet general-use, from xuebinqin/DIS) | 176,149,806 B, sha256 `cc2c9f5c1751b9737cb81e708ff0c5e9542c2205daed22418a4fd2ab5d4c481a` | MIT (HF model card) | no (over the 100MB push limit): re-fetch with the URL above; optional higher-quality tier |

Downloaded 2026-10-19. Both were verified with real forward passes (`tools/scripts/mask_model_eval.py`).
Choose the model with `localStorage.chromasmithMatteModel = 'modnet' | 'isnet'`; the app uses whatever is installed otherwise.
