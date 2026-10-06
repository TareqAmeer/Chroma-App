# Camera and RAW coverage (CHR-250)

This is a source-derived capability inventory, not a promise that every camera file with a listed suffix will open. It keeps five independent questions separate: does the app recognize the suffix, does the native decoder advertise a decoder for it, does a representative file decode, can the resulting pixels pass through Chromasmith's processing path, and is a matching camera profile bundled locally?

## Current matrix

| RAW suffix(es) | App recognizes | Native `rawler` decoder table (desktop) | Web / iOS path | Sample pixel decode | Native pixel-processing path | Bundled camera DCP |
| --- | --- | --- | --- | --- | --- | --- |
| `.3fr`, `.ari`, `.arw`, `.cr2`, `.cr3`, `.crw`, `.dcr`, `.dcs`, `.dng`, `.erf`, `.fff`, `.iiq`, `.kdc`, `.mef`, `.mos`, `.mrw`, `.nef`, `.nrw`, `.orf`, `.pef`, `.raf`, `.raw`, `.rw2`, `.rwl`, `.srw`, `.x3f` | Yes on desktop; all except `.ari` on web/iOS | Listed by rawler 0.7.2 | Accepted suffixes are sent to bundled LibRaw WASM; per-suffix support is not enumerated by the wrapper | **Unknown** for every suffix: no representative licensed camera RAW fixture is in the repository | Conditional; see processing gates below | Only for matching Panasonic DC-S9 or Sony DSC-RX100M5 make/model; suffix does not select a profile |
| `.bay`, `.k25`, `.pro`, `.ptx`, `.sr2`, `.srf` | Yes on desktop and web/iOS | No entry in rawler 0.7.2's advertised extension table | Accepted suffixes are sent to bundled LibRaw WASM; per-suffix support is not enumerated by the wrapper | **Unknown** for every suffix | Native decoder lookup will fail before pixel processing; web decode remains unverified | Only if the decoded camera make/model matches a bundled DCP model; suffix alone gives no match |

The app registry contains 32 RAW suffixes (`FMT_RAW` in `chromasmith-22.html`, mirrored by `RAW_EXTS` in `desktop/src-tauri/src/formats.rs`). The native table lists 26 of them; the six in the second row are recognized for routing and picker UX, but are not thereby natively decodable. The three extra suffixes in rawler's table (`.crm`, `.ori`, `.qtk`) are not app-registered and are not advertised as app inputs.

“Listed by rawler” means the pinned decoder package includes that suffix in `supported_extensions()`. The repository itself warns that this list is only an advertised lower bound, not a decode guarantee. A concrete file can still fail at decoder identification, metadata parsing, decompression, camera-model lookup, or image decode.

### Pixel-processing gates

After native rawler decode, `desktop/src-tauri/src/raw_decode.rs` accepts either:

- CFA data whose pattern is RGB-capable. The standard PPG path is the default; optional AHD/VNG/MHC processing is limited to the four 2×2 Bayer layouts RGGB, BGGR, GRBG, and GBRG. Other CFA patterns can use the default PPG branch only if rawler reports the CFA as RGB-capable.
- `LinearRaw` data with exactly three components per pixel. These pixels are already interleaved RGB and skip demosaicing.

Non-RGB CFA (including monochrome), linear data with a component count other than three, and other photometric interpretations are rejected. These are code-level format gates; they do not establish that a camera model's file actually reaches the supported branch. For example, X3F's decoder source reports `LinearRaw`, but this repository has no licensed X3F fixture to validate a full decode.

The browser path instead asks LibRaw WASM to produce a render (or linear data when a bundled profile is selected); shared-memory availability and browser resource limits also apply. The vendored WASM artifact has no machine-readable per-suffix support inventory in this repository. Its ability to open an individual family is therefore left **unknown** until tested against an appropriate sample.

### Bundled and machine-installed profiles

- `vendor/dcp/` contains 15 Panasonic DC-S9 DCP files and 10 Sony DSC-RX100M5 DCP files. The app selects these by both EXIF make and model, not by file suffix. Style names can fall back to that camera's Standard profile.
- A DNG may carry an embedded DCP; the loader can use it when no bundled camera match exists. Otherwise the web path falls back to LibRaw's sRGB rendering. This is a fallback path, not a camera-specific bundled profile.
- Desktop can additionally discover Adobe Camera Raw / DNG Converter profiles installed on the machine. Their presence is machine-specific and is not asserted here.
- The native lens-correction path uses the bundled Lensfun database and checks the camera/lens pairing at runtime. A code-level test covers Panasonic DC-S9 + LUMIX S 18-40/F4.5-6.3; it is not a claim that every camera in the matrix has a matching lens profile.

## Evidence and limits

Repository sources: `chromasmith-22.html` (`FMT_RAW`, `FMT_RAW_WEB`, `loadRw2`, camera-to-DCP mapping); `desktop/src-tauri/src/formats.rs` (`RAW_EXTS` and the rawler table coverage test); `desktop/src-tauri/src/raw_decode.rs` (decoder lookup and pixel-processing branches); `vendor/dcp/` (bundled DCP inventory); `desktop/src-tauri/src/lens_correct.rs` (runtime Lensfun lookup and the explicit DC-S9 pairing test). The only RAW-like test fixture under `desktop/src-tauri/tests/` is `iphone_ifd0_preview.dng`, used for preview/metadata coverage, not a full RAW pixel decode. No camera RAW sample has been used to mark a suffix verified.

The inventory uses the pinned rawler 0.7.2 source (`src/decoders/mod.rs`) and the repository's vendored LibRaw WASM integration. For broader upstream context, rawler/dnglab documents its format and camera support in [DNGLab's README](https://github.com/dnglab/dnglab/blob/main/README.md), while [LibRaw documents camera and format support as build- and release-dependent](https://github.com/LibRaw/LibRaw). Neither upstream's general list is treated as proof that this application's pinned build decodes a particular sample. The community [raw.pixls.us sample archive](https://raw.pixls.us/) is a suitable source for future authorized, license-checked fixture selection; no camera sample was downloaded for this matrix.

## How to upgrade an entry from unknown

Record the camera make/model, suffix, decoder/backend and version, sample source and license, whether open/metadata/pixel decode completed, resulting photometric interpretation and component count, and whether the intended profile was actually applied. Keep sample status unknown when any of those checks are missing; do not infer it from the picker or decoder extension table.
