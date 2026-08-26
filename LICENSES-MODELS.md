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
| **ONNX Runtime** (`vendor/onnxruntime`) | Runs all of the above | MIT |

Two of these — **EdgeSAM** and the **face-parsing** model — carry non-commercial / research terms.
They are included so the app is feature-complete for personal use, and this file exists so that is
stated plainly rather than buried. Chromasmith itself is GPL-3.0 (which the RawNIND weights also
require); the model files keep their own licences and are not relicensed by being bundled.

If you are redistributing a build, or using it commercially, drop those two model files: SAM 2.1
covers subject selection on its own, and the only feature lost is "auto-exclude face features"
inside a skin mask.
