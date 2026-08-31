# Bundled model licences

The macOS app ships several machine-learning models so that face detection, subject selection and
natural-language photo search can run **on your own machine** instead of in someone's cloud. They
are not in git (they are ~1.1 GB); the desktop build fetches them from the sources below, and each
`desktop/src-tauri/vendor/<name>/README.md` records the exact URL, download date and byte size.

| Model | What it does | Licence |
|---|---|---|
| **SAM 2.1 Hiera-Tiny** (`vendor/sam2`) | Tap-to-select subject masks | Apache-2.0 |
| **EdgeSAM / MobileSAM** (`vendor/sam`) | Faster fallback for the same job | **Non-commercial / research** |
| **face-parsing (SegFormer, `nvidia/mit-b5`)** (`vendor/faceparse`) | Excludes eyes, lips and hair from a skin mask | **NVIDIA SegFormer terms — non-commercial / research**; the fine-tune declares no separate licence |
| **SCRFD-500M** (`vendor/scrfd`) | Finds faces in a photo | InsightFace, research/OSS terms |
| **ArcFace `w600k_r50`** (`vendor/arcface`) | Groups photos of the same person | InsightFace, research/OSS terms |
| **CLIP ViT-B/32** (`vendor/clip`) | Natural-language photo search | MIT (OpenAI) |
| **RawNIND UtNet2** (`vendor/rawdenoise`) | High-quality RAW noise reduction | **GPL-3.0** |
| **Depth Anything V2 Small** (`vendor/depth`) | Depth Range mask + depth blur/tilt-shift | Apache-2.0 |
| **ONNX Runtime** (`vendor/onnxruntime`) | Runs all of the above | MIT |

Two of these — **EdgeSAM** and the **face-parsing** model — carry non-commercial / research terms.
They are included so the app is feature-complete for personal use, and this file exists so that is
stated plainly rather than buried. Chromasmith itself is GPL-3.0 (which the RawNIND weights also
require); the model files keep their own licences and are not relicensed by being bundled.

If you are redistributing a build, or using it commercially, drop those two model files: SAM 2.1
covers subject selection on its own, and the only feature lost is "auto-exclude face features"
inside a skin mask.

## Spektrafilm LUT presets (`vendor/luts/spektra_*.bin`)

20 built-in "Spektrafilm" look presets (`LUT_META`'s `"Spektrafilm"` category) are baked from the
[spektrafilm](https://github.com/andreavolpato/spektrafilm) project's film/print profiles, by
Andrea Volpato. The `spektrafilm-lut` CLI (spektrafilm's own tool, GPLv3 — only *run*, never
vendored or copied into this repo) built one 33³ `.cube` per film stock at `--input srgb --output
srgb --resolution 33 --topology 1lut`, paired with a real-world print/paper stock per
`spektrafilm-lut list film`/`list print`'s own registry (each colour-negative paired with its
`info.target_print` from the profile JSON; the 4 reversal stocks — no negative-native print target
— paired with the brand-matching paper, following the same default the project's own
`compare_simulation_revisions.py` script uses for reversal-vs-print comparisons). This is tier (a)
of ROADMAP.md's R3: baked to **display space** (colour response only, hard-clipped at 1.0) — not
the real scene-referred roll-off, which is the separate, much larger R4.

The **profiles and LUTs themselves** (not the CLI code) are licensed **CC BY-SA 4.0** under
[`SPEKTRAFILM_LICENSE.txt`](https://github.com/andreavolpato/spektrafilm/blob/main/SPEKTRAFILM_LICENSE.txt),
a separate licence from the GPLv3 tool. Quantizing a baked cube to this app's Uint8 `.bin` storage
format is a modification under that licence, so the required attribution is the licence's own
"modified" form:

    Derived from spektrafilm by Andrea Volpato
    https://github.com/andreavolpato/spektrafilm
    Licensed CC BY-SA 4.0
    Modified by Chromasmith: baked to a fixed 33³ LUT and quantized to 8-bit for
    vendor/luts/spektra_*.bin.

| Preset key | Film stock | Print/paper stock |
|---|---|---|
| `spektra_fuji_c200_ca` | Fujifilm C200 | Fujifilm Crystal Archive Type II |
| `spektra_fuji_pro_400h_ca` | Fujifilm Pro 400H | Fujifilm Crystal Archive Type II |
| `spektra_fuji_xtra_400_ca` | Fujifilm Xtra 400 | Fujifilm Crystal Archive Type II |
| `spektra_kodak_ektar_100_endura` | Kodak Ektar 100 | Kodak Portra Endura |
| `spektra_kodak_gold_200_endura` | Kodak Gold 200 | Kodak Portra Endura |
| `spektra_kodak_portra_160_endura` | Kodak Portra 160 | Kodak Portra Endura |
| `spektra_kodak_portra_400_endura` | Kodak Portra 400 | Kodak Portra Endura |
| `spektra_kodak_portra_800_endura` | Kodak Portra 800 | Kodak Portra Endura |
| `spektra_kodak_portra_800_push1_endura` | Kodak Portra 800 (push 1) | Kodak Portra Endura |
| `spektra_kodak_portra_800_push2_endura` | Kodak Portra 800 (push 2) | Kodak Portra Endura |
| `spektra_kodak_ultramax_400_endura` | Kodak Ultramax 400 | Kodak Portra Endura |
| `spektra_kodak_verita_200d_2383` | Kodak Vérité 200D | Kodak 2383 (cinema print) |
| `spektra_kodak_vision3_200t_2383` | Kodak Vision3 200T | Kodak 2383 (cinema print) |
| `spektra_kodak_vision3_250d_2383` | Kodak Vision3 250D | Kodak 2383 (cinema print) |
| `spektra_kodak_vision3_500t_2383` | Kodak Vision3 500T | Kodak 2383 (cinema print) |
| `spektra_kodak_vision3_50d_2383` | Kodak Vision3 50D | Kodak 2383 (cinema print) |
| `spektra_fuji_provia_100f` | Fujifilm Provia 100F (reversal) | Fujifilm Crystal Archive Type II |
| `spektra_fuji_velvia_100` | Fujifilm Velvia 100 (reversal) | Fujifilm Crystal Archive Type II |
| `spektra_kodak_ektachrome_100` | Kodak Ektachrome 100 (reversal) | Kodak Portra Endura |
| `spektra_kodak_kodachrome_64` | Kodak Kodachrome 64 (reversal) | Kodak Portra Endura |

### R4 addendum — native film-stock highlight shoulders (`vendor/luts/spektra_*_shoulder.bin`)

ROADMAP.md's R4 extracts, for the 16 colour-negative stocks above (the 4 reversal stocks are
out of scope — see ROADMAP.md), a real per-channel highlight roll-off shape from spektrafilm's
own density-curve model (not a curve fit or an invented shoulder): each stock's real
film+print pipeline (`spektrafilm.runtime.pipeline.SimulationPipeline`, the same code path
`spektrafilm-lut` itself drives) is run at synthetic exposures from -1 to +4.5 stops above the
model's own documented white anchor (`BundleSpec.stops_above_midgray`'s "auto" resolution for
encoded sRGB input, 4.0 stops — i.e. the same gain R3's `.cube` bake already used), resampled to
a 256-point table per channel, and quantized to 8-bit — the same "modification" this licence's
attribution text already covers for `spektra_*.bin`. The same attribution applies to
`vendor/luts/spektra_*_shoulder.bin`:

    Derived from spektrafilm by Andrea Volpato
    https://github.com/andreavolpato/spektrafilm
    Licensed CC BY-SA 4.0
    Modified by Chromasmith: real film+print highlight response sampled at synthetic exposures
    up to +4 stops above white via spektrafilm's own SimulationPipeline, resampled to a 256x1
    per-channel table and quantized to 8-bit for vendor/luts/spektra_*_shoulder.bin.

The film/print pairing for each `_shoulder.bin` is identical to its `.bin` counterpart in the
table above (same key, same stock, same print).
