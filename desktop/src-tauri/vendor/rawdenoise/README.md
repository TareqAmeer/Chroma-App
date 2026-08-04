# Vendored RawNIND UtNet2 raw denoiser (High-tier Noise Reduction)

- `model_linear.onnx`, `model_bayer.onnx`
- Source: darktable 5.6's `rawdenoise-nind.dtmodel`
  (https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel
  — a ZIP container; these two files plus `config.json` are its contents, extracted as-is).
- Original model/training: **UtNet2**, a 4-pool U-Net (`funit=32`, LeakyReLU) trained on
  RawNIND (Raw Natural Image Noise Dataset — real camera raw noise/clean pairs, not synthetic).
  Author: Benoit Brummer (UCLouvain). Paper: Brummer & De Vleeschouwer,
  ["Learning Joint Denoising, Demosaicing, and Compression from the Raw Natural Image Noise
  Dataset"](https://arxiv.org/abs/2501.08924). Source: https://github.com/trougnouf/rawnind_jddc.
- **License: GPL-3.0** (model weights). Training data: CC BY 4.0 / CC0 (Wikimedia Commons).
  ⚠️ Unlike every other model in `desktop/src-tauri/vendor/` (EdgeSAM non-commercial, SAM2/
  onnxruntime MIT/Apache), this is **copyleft**. Chromasmith ships a top-level `LICENSE` (GPL-3.0)
  and credits this model in `README.md` / the in-app Guide tab specifically because of this file.
  Do not vendor a differently-licensed weight file into this directory without revisiting that.
- **NOT committed to git** — 30MB each, and large binary blobs don't belong in history even
  under the 100MB limit. `.gitignore` excludes `vendor/rawdenoise/*.onnx`; re-fetch after a
  fresh clone with:
  ```bash
  cd desktop/src-tauri/vendor/rawdenoise
  curl -sL "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel" -o rd.dtmodel
  python3 -c "import zipfile; zipfile.ZipFile('rd.dtmodel').extractall('.')"
  mv rawdenoise-nind/model_linear.onnx rawdenoise-nind/model_bayer.onnx .
  rm -rf rd.dtmodel rawdenoise-nind
  ```

## I/O contract (verified two independent ways: `strings` on the extracted `.onnx` for the
literal graph input/output names, and a hand-rolled protobuf wire-format walk of `GraphProto`
for the exact dtype/shape of each `ValueInfoProto` — no `onnx` Python package was available on
this machine to load it normally. Cross-checked against the model's own `config.json`, which
ships alongside these files and agrees exactly.)

**`model_linear.onnx`** — denoise only, does NOT demosaic (use for post-demosaic linear RGB):
- input `input`: float32 `[1, 3, 512, 512]` (NCHW), **linear Rec.2020**, arbitrary gain.
- output `output`: float32 `[1, 3, 512, 512]` (NCHW), same colour space, same spatial size.

**`model_bayer.onnx`** — joint denoise + demosaic (⚠️ not used by phase-1 Chromasmith; see
`desktop/src-tauri/src/rawdenoise.rs`'s module doc for why post-demosaic was chosen first):
- input `input`: float32 `[1, 4, 512, 512]` — packed Bayer (R, G1, G2, B planes at half
  resolution), CFA reordered to **RGGB** by the caller (`config.json`'s
  `"bayer_orientation": "force_rggb"`) regardless of the sensor's native CFA layout.
- output `output`: float32 `[1, 3, 1024, 1024]` — **2× the input's spatial size** (the packed
  Bayer planes are already half-res; the model both denoises and demosaics/upsamples in one
  step, per `config.json`'s `"edge_pad": "mirror_cropped"`).

**Both variants**, per `config.json`'s `"output_scale": "match_gain"`: output is at an
arbitrary learned gain and must be rescaled to match the input's mean before use — the model
does not preserve absolute exposure. ⚠️ This gain match must be computed ONCE over the whole
frame and reused for every tile (see `rawdenoise.rs`) — per-tile gain matching produces visible
tile-boundary blocking, the same failure mode CLAUDE.md §5b documents for `srcV`/Skin Tone.

Static 512×512 tile size (`"tiling": true`, `"input_sizes": [512]`), input H/W must be
divisible by 16 (U-Net pooling depth 4 → 2⁴=16).

See `desktop/src-tauri/src/rawdenoise.rs` for the Rust implementation.
