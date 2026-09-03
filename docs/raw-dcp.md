# RW2/RAW + DCP camera-profile pipeline

Deep-dive on RAW decoding and the DCP colour pipeline. Load this when touching `loadRw2`, `bakeDcpLUT`, or anything under `desktop/src-tauri/src/raw_decode.rs`.

## 7. RW2 / RAW + DCP camera-profile pipeline

- Decoder: `libraw-wasm@1.1.2` (vendored, sha512-verified). Lazy `import()` on first RW2
  load. `.RAW` extension also accepted (some Panasonic modes write RW2 data as `.RAW`).
- `loadRw2()` → `raw.imageData()` returns an **object** `{width,height,colors,bits,data}`,
  not a flat array (was an all-black bug). Orientation honored (`userFlip:-1`).
- **DCP profiles**: a "RAW profile" dropdown (default Camera Standard) applies Adobe DCPs
  from `vendor/dcp/` so RW2 colour ≈ Lightroom. Decode switches to linear 16-bit camera RGB;
  a 65³ LUT baked from the DCP is applied per pixel.
- **The DCP bake follows the Adobe DNG-SDK/RawTherapee structure exactly** (verified against
  RT's `rtengine/dcp.cc`/`curves.h` source): FM1 → XYZ(D50) → linear ProPhoto →
  2^(ev+BaselineExposureOffset) → LookTable (TABLE-INDEX clamps only, values extended-range)
  → **hue-preserving Adobe RGBTone tone curve** (curve on max+min channel, median
  interpolated — NEVER per-channel, which crushes/over-saturates shadows) → ProPhoto→sRGB.
  **NO black subtraction and no early [0,1] ceilings anywhere** — the S9 DCPs carry
  `DefaultBlackRender=None` (renderer black subtraction is spec-forbidden) and the
  ProfileToneCurve has its own shadow toe.
- Correction constants are near-identity and **not ISO-dependent**: `dcpFit` returns
  `{ev:0.0, gr:0.9860, gb:0.9783}` — fitted in `calib/dcp_native_fit.py` against 5 LR
  reference TIFFs on the NATIVE (rawler) decode, with shadow-skin patches in the loss/gate.
- A final **hue/sat/value-gated residual lift** closes the last LR gap (bright saturated COOL
  regions — blue sky — rendered ~7/255 darker; skin/water/shadows sit outside the gates and
  are untouched). Fitted in `calib/dcp_residual_tone.py` → `calib/dcp_sky_gate.json`, baked
  as constants at the end of `bakeDcpLUT` in final sRGB-gamma space (the measurement space).
  ⚠️ A 1D tone curve CANNOT express this residual — sky and water share hue AND luma; only
  saturation separates them (0.30 vs 0.13). Don't refit it as a tone/exposure tweak.
  ⚠️ The old ISO-dependent fudges (`ev=-0.819-0.17x`, `black=0.04`, native
  `WHITE_LEVEL_MATCH=2.334`) existed only to bend a **mis-linearized libraw-wasm decode**
  (measured: wasm ≈ 1.22·native^0.634 per channel) toward LR at midtones — they crushed
  shadows by design. Never reintroduce a "black" term: fix linearity instead.
- The desktop shell decodes natively (`desktop/src-tauri/src/raw_decode.rs`): rawler
  `apply_scaling` (per-CFA black/white) + `PPGDemosaic` + libraw WB convention (min mult = 1).
  The browser/wasm path linearizes libraw-wasm's output with the measured inverse power law
  before the DCP LUT (see `loadRw2`).
- ⚠️ DNG/DCP gotchas: LookTable layout is `[val][hue][sat]`; V axis is sRGB-encoded when
  `LookTableEncoding=1`; rawpy 0.21 mis-decodes the DC-S9 (wrong white level) — the Python
  harness reads dumps from `desktop/src-tauri/examples/dump_rw2.rs` (native pipeline,
  `cargo run --release --example dump_rw2 -- in.RW2 out.bin 8`).
- ⚠️ Memory: terminate the libraw worker after each decode (it leaked ~0.5–1GB shared wasm
  memory per file). Per-file try/catch + readable error strings already in place.
- **When the user says "doesn't match Lightroom", FIRST ask what's rendering the comparison
  image** — macOS Preview of a `.RAW` shows the camera's embedded JPEG (warmer/darker), not
  the real RAW render.

---

