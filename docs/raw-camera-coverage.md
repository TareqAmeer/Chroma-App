# Camera and RAW coverage (CHR-250)

This is a source-derived capability inventory, not a promise that every camera file with a listed suffix will open. It keeps five independent questions separate: does the app recognize the suffix, does the native decoder advertise a decoder for it, does a representative file decode, can the resulting pixels pass through Chromasmith's processing path, and is a matching camera profile bundled locally?

## Current matrix

| RAW suffix(es) | App recognizes | Native `rawler` decoder table (desktop) | Web / iOS path | Sample pixel decode | Native pixel-processing path | Bundled camera DCP |
| --- | --- | --- | --- | --- | --- | --- |
| `.3fr`, `.ari`, `.arw`, `.cr2`, `.cr3`, `.crw`, `.dcr`, `.dcs`, `.dng`, `.erf`, `.fff`, `.iiq`, `.kdc`, `.mef`, `.mos`, `.mrw`, `.nef`, `.nrw`, `.orf`, `.pef`, `.raf`, `.raw`, `.rw2`, `.rwl`, `.srw`, `.x3f` | Yes on desktop; all except `.ari` on web/iOS | Listed by rawler 0.7.2 | Accepted suffixes are sent to bundled LibRaw WASM; per-suffix support is not enumerated by the wrapper | Browser (LibRaw WASM): `.cr2 .nef .arw .raf .orf .rw2 .pef .3fr .iiq .dng` each decoded one real CC0 sample — see *Measured browser decode* below. Other suffixes and the native path: **unknown** | Conditional; see processing gates below | Only for matching Panasonic DC-S9 or Sony DSC-RX100M5 make/model; suffix does not select a profile |
| `.bay`, `.k25`, `.pro`, `.ptx`, `.sr2`, `.srf` | Yes on desktop and web/iOS | No entry in rawler 0.7.2's advertised extension table | Accepted suffixes are sent to bundled LibRaw WASM; per-suffix support is not enumerated by the wrapper | **Unknown** for every suffix | Native decoder lookup will fail before pixel processing; web decode remains unverified | Only if the decoded camera make/model matches a bundled DCP model; suffix alone gives no match |

The app registry contains 32 RAW suffixes (`FMT_RAW` in `chromasmith-22.html`, mirrored by `RAW_EXTS` in `desktop/src-tauri/src/formats.rs`). The native table lists 26 of them; the six in the second row are recognized for routing and picker UX, but are not thereby natively decodable. The three extra suffixes in rawler's table (`.crm`, `.ori`, `.qtk`) are not app-registered and are not advertised as app inputs.

“Listed by rawler” means the pinned decoder package includes that suffix in `supported_extensions()`. The repository itself warns that this list is only an advertised lower bound, not a decode guarantee. A concrete file can still fail at decoder identification, metadata parsing, decompression, camera-model lookup, or image decode.

### Pixel-processing gates

After native rawler decode, `desktop/src-tauri/src/raw_decode.rs` accepts either:

- CFA data whose pattern is RGB-capable. The standard PPG path is the default; optional AHD/VNG/MHC processing is limited to the four 2×2 Bayer layouts RGGB, BGGR, GRBG, and GBRG. Other CFA patterns can use the default PPG branch only if rawler reports the CFA as RGB-capable.
- `LinearRaw` data with exactly three components per pixel. These pixels are already interleaved RGB and skip demosaicing.

Non-RGB CFA (including monochrome), linear data with a component count other than three, and other photometric interpretations are rejected. These are code-level format gates; they do not establish that a camera model's file actually reaches the supported branch. For example, X3F's decoder source reports `LinearRaw`, but this repository has no licensed X3F fixture to validate a full decode.

The browser path instead asks LibRaw WASM to produce a render (or linear data when a bundled profile is selected); shared-memory availability and browser resource limits also apply. The vendored WASM artifact has no machine-readable per-suffix support inventory in this repository. Its ability to open an individual family is therefore left **unknown** until tested against an appropriate sample; the families measured so far are listed below.

### Bundled and machine-installed profiles

- `vendor/dcp/` contains 15 Panasonic DC-S9 DCP files and 10 Sony DSC-RX100M5 DCP files. The app selects these by both EXIF make and model, not by file suffix. Style names can fall back to that camera's Standard profile.
- A DNG may carry an embedded DCP; the loader can use it when no bundled camera match exists. Otherwise the web path falls back to LibRaw's sRGB rendering. This is a fallback path, not a camera-specific bundled profile.
- Desktop can additionally discover Adobe Camera Raw / DNG Converter profiles installed on the machine. Their presence is machine-specific and is not asserted here.
- The native lens-correction path uses the bundled Lensfun database and checks the camera/lens pairing at runtime. A code-level test covers Panasonic DC-S9 + LUMIX S 18-40/F4.5-6.3; it is not a claim that every camera in the matrix has a matching lens profile.

## Measured browser decode (CHR-250)

**Path tested: browser only.** The app's own `loadRw2()` in headless Chromium (Playwright, SwiftShader), served with COOP/COEP so `SharedArrayBuffer` works, using the vendored `libraw-wasm@1.6.0` (LibRaw 0.22.1; 1.1.2 until note 5) with the default RAW profile setting. **The native desktop Rust (`rawler`) path was NOT tested** — it cannot be built in this environment. None of these results say anything about it.

Samples come from [raw.pixls.us `/data-unique/`](https://raw.pixls.us/data-unique/). That set is dedicated **CC0 1.0** by its [LICENSE.txt](https://raw.pixls.us/data-unique/LICENSE.txt); the `/data/` set is not used because it mixes in CC BY-NC-SA files. URL, SHA-256, size and licence for each file are in `test/fixtures/raw-samples.json`. The RAW files themselves are gitignored and never committed.

| Format | Camera (sample) | Size | Decode | Output (full) | Output (half / proxy) | Full decode time | Colour path taken |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CR2 | Canon EOS 40D | 5.8 MB | OK | 1944×1296 ¹ | 1944×1296 ¹ | 1.1 s | LibRaw sRGB fallback |
| NEF | Nikon D7200 | 22.7 MB | OK | 6016×4016 | 3008×2008 | 9.2 s | LibRaw sRGB fallback |
| ARW | Sony ILCE-7S | 6.2 MB | OK | 2784×1872 | 1392×936 | 2.0 s | LibRaw sRGB fallback |
| RAF (X-Trans III) | Fujifilm X-Pro2 | 26.8 MB | OK | 6032×4028 | 3016×2014 | 48.9 s ⁵ | LibRaw sRGB fallback |
| ORF | Olympus XZ-1 | 10.8 MB | OK | 3680×2760 | 1840×1380 | 3.2 s | LibRaw sRGB fallback |
| RW2 | Panasonic DC-GH5S | 19.2 MB | OK | 3704×2776 | 1852×1388 | 3.6 s | LibRaw sRGB fallback (no DC-GH5S DCP) |
| PEF | Pentax K10D | 9.6 MB | OK | 3896×2616 | 1948×1308 | 4.0 s | LibRaw sRGB fallback |
| 3FR | Hasselblad H3D (reports H3DII-39) | 53.6 MB | OK | 7247×5444 | 3623×2722 | 24.7 s | Embedded profile, parsed as a DNG profile ³ |
| IIQ | Phase One P65+ | 71.9 MB | OK (edge rows fixed, note 4) | 8984×6732 | 4492×3366 | 27.4 s | LibRaw sRGB fallback |
| DNG | Canon EOS 5D Mark III via Adobe DNG Converter (lossless) | 23.2 MB | OK | 5796×3870 | 2898×1935 | 10.5 s | Embedded DNG profile |

Times are the probe's wall time per `loadRw2` call with libraw-wasm 1.6.0 (note 5), on a slow, shared container CPU (load average about 20 on 4 cores during the run). Treat them as relative, not as user-facing figures.

**Orientation.** libraw-wasm's `metadata()` has no flip/orientation field. LibRaw applies the EXIF orientation itself (`userFlip:-1`). All 10 samples are landscape, and none came out turned 90° relative to the sensor `width`/`height`. That means no sample exercised a rotated file, so **orientation handling is still unverified**. A 180° turn could not be detected this way at all.

Notes:

1. LibRaw reports 1944×1296 for this 40D file even on a full decode, which is half the 40D's 3888×2592 sensor. The file is small (5.8 MB), which is consistent with an sRAW capture. Not otherwise verified.
2. **Fixed: one decode instead of two.** `loadRw2` used to decode linear first, for the DCP path. Only then did LibRaw's metadata show that no bundled DCP matched, so it decoded again for the LibRaw sRGB fallback. It now reads make/model from the file header (`rawSniffMakeModel`: TIFF IFDs, RAF header). When no bundled DCP can match and the file has no embedded DNG profile, it decodes once, straight to the fallback settings. LibRaw's own make/model is still checked after the decode, and a wrong hint falls back to a linear re-decode. CR3 and X3F have no TIFF/RAF header, so they keep the old two-decode path. Probe timings, same machine and session, before → after, full size: CR2 4.2 → 1.7 s, NEF 24.0 → 9.8 s, ARW 5.0 → 2.5 s, RAF 73.6 → 34.9 s, ORF 10.5 → 4.9 s, RW2 14.0 → 6.4 s, PEF 9.2 → 4.2 s, IIQ 61.7 → 28.8 s. Half size: RAF 16.8 → 8.5 s, IIQ 45.2 → 20.6 s. The full-resolution pixel SHA-256 is identical before and after for all 10 samples, at full and half size. The per-worker deadline is `withRawDecodeTimeout`'s 180 s; it was 45 s when these samples were first measured.
3. **The 3FR's magenta cast comes from the scene and the camera's as-shot white balance, not from a profile error.** The 3FR is TIFF-based. It carries ColorMatrix1 and AsShotNeutral, with no ForwardMatrix and no illuminant tag. `parseDngEmbeddedProfile` builds a profile from the colour matrix, so the file takes the "profile embedded in the DNG" branch. Mean colour of the top 40 % (overcast sky), as R−G / B−G in 8-bit sRGB:
   - the camera's own embedded preview: +10.2 / +19.2
   - LibRaw 0.22.2's sRGB render (rawpy): +10.2 / +20.3
   - Chromasmith's embedded-profile render: +5.8 / +19.0

   The app's render is slightly *less* magenta than the camera's own preview, so nothing was changed.
4. **Fixed by the 1.6.0 upgrade (note 5): the IIQ edge noise was a libraw-wasm 1.1.2 bug, not the app's crop or orientation.**
   - **What it looks like.** Roughly 10 rows at the top *and* roughly 10 at the bottom of the full-size frame are coloured noise (about 6 of each at half size). It is not a one-pixel row.
   - **The crop is right.** LibRaw reads `top_margin` 6 and `left_margin` 36 from the file's own IIQ tags. That is the same active area rawler 0.7.2 uses (`p65.toml`: `[36, 6, 16, 46]`). Decoding with `userFlip:0` gives the same rows.
   - **Native LibRaw is clean.** LibRaw 0.21.3 and 0.22.2 (rawpy) decode the same file with clean edges.
   - **Cause.** The vendored wrapper's `open()` copies the file into a local `std::vector` and hands that pointer to `open_buffer()`. The copy is freed when `open()` returns, but LibRaw reads the file again during `unpack()` inside `imageData()`. It is reading freed memory.
   - **Upstream has fixed it.** Upstream `libraw_wrapper.cpp` now keeps the buffer as a class member. `libraw-wasm@1.6.0` is now vendored and gives clean edges.
   - **The output also depends on call order.** Any allocation between `open()` and `imageData()` changes the result. Calling `metadata()` first changed pixels across the whole IIQ frame, not just the edges.
   - **With 1.6.0 the call order no longer matters.** Measured on the IIQ at full size: `metadata()` before or after `imageData()` gives identical pixels.
5. **Upgrade to libraw-wasm 1.6.0 (from 1.1.2).** Source, checksums and licence: `vendor/libraw/README.md`. Measured with `test/raw_decode_coverage.mjs`, same machine, before → after:
   - **All 10 samples still decode**, with the same dimensions at full and half size and the same colour path.
   - **Linear output (the DCP input that `GAIN`/`PW` in `loadRw2` linearise) is bit-identical for 9 of 10 samples.** Compared directly, both versions with `loadRw2`'s linear settings, half size. Only the IIQ differs, by the use-after-free. Likely reason: the `gamm:[1,1]` the app passes has 2 elements, and upstream's wrapper source (v1.6.0, and an older commit from the 1.1.x line) only reads a 6-element `gamm`, so LibRaw's default BT.709 curve stays on. That curve is what the `GAIN`/`PW` fit undoes. The fit is therefore still valid and was not changed. No sample uses a bundled DC-S9/RX100M5 DCP; that path shares the same linear decode.
   - **sRGB-fallback / embedded-profile output, full size.** Mean colour (8-bit RGB) is unchanged to 3 decimals for 9 of 10. A few hundred to a few thousand isolated pixels differ (0.00–0.03 % of the frame, mean |Δ| about 1 level on those pixels, none on the borders): LibRaw 0.22.1's demosaic, not a colour or exposure change. Mean absolute channel delta over the frame is 0.000 for all 9. The full-size SHA-256 changed for 8 of them (CR2 unchanged); at half size CR2, NEF, PEF and DNG are unchanged.
   - **IIQ:** mean RGB 123.6 / 149.1 / 125.1 → 124.6 / 150.2 / 125.9, mean abs channel delta 1.28 levels, 97 % of pixels changed (the 1.1.2 output was corrupted across the whole frame, not only at the edges). Row-to-row luma noise in the top 16 rows 48.1 → 3.8 and bottom 16 rows 46.6 → 3.2, against 4.0 in the rows just inside. Thumbnails at full and half size have clean edges.
   - **Times** (alternating runs, same session, LibRaw sRGB settings, full size): NEF 11.8 / 12.2 → 6.1 / 6.4 s, RAF 43.8 / 36.1 → 35.1 / 31.5 s, IIQ 26.3 / 25.8 → 13.2 / 11.3 s. The single coverage run measured RAF 30.3 → 48.9 s, but the alternating runs show that was machine load.
   - **Embedded previews** (centre 80 %, 8-bit mean RGB) differ from the app's LibRaw sRGB render for most samples, e.g. CR2 preview 129 / 102 / 70 vs app 172 / 138 / 105. That gap is identical before and after the upgrade, so it is not caused by it. The 3FR and IIQ carry no JPEG preview.

**Not covered.** The CC0 set has no Canon CR3, Leica DNG/RWL, Sigma X3F or OM System file, so those remain **unknown**. Pixel correctness was checked only by looking at thumbnails, by mean/spread of luma and by comparing against the previous decoder version, not against a reference render.

Re-run the measurement:

```bash
NODE_USE_ENV_PROXY=1 node tools/scripts/fetch-raw-samples.mjs   # download + SHA-256 verify (gitignored dir)
node test/raw_decode_coverage.mjs [--half] [--json out.json] [--only id,id] [--thumbs dir]
```

## Evidence and limits

Repository sources: `chromasmith-22.html` (`FMT_RAW`, `FMT_RAW_WEB`, `loadRw2`, camera-to-DCP mapping); `desktop/src-tauri/src/formats.rs` (`RAW_EXTS` and the rawler table coverage test); `desktop/src-tauri/src/raw_decode.rs` (decoder lookup and pixel-processing branches); `vendor/dcp/` (bundled DCP inventory); `desktop/src-tauri/src/lens_correct.rs` (runtime Lensfun lookup and the explicit DC-S9 pairing test). The only RAW-like test fixture under `desktop/src-tauri/tests/` is `iphone_ifd0_preview.dng`, used for preview/metadata coverage, not a full RAW pixel decode. No camera RAW sample is committed. The browser decode results above come from the external CC0 samples listed in `test/fixtures/raw-samples.json`.

The inventory uses the pinned rawler 0.7.2 source (`src/decoders/mod.rs`) and the repository's vendored LibRaw WASM integration. For broader upstream context, rawler/dnglab documents its format and camera support in [DNGLab's README](https://github.com/dnglab/dnglab/blob/main/README.md), while [LibRaw documents camera and format support as build- and release-dependent](https://github.com/LibRaw/LibRaw). Neither upstream's general list is treated as proof that this application's pinned build decodes a particular sample. The community [raw.pixls.us sample archive](https://raw.pixls.us/) is the source of the CC0 samples measured above (its `/data-unique/` set only).

## How to upgrade an entry from unknown

Record the camera make/model, suffix, decoder/backend and version, sample source and license, whether open/metadata/pixel decode completed, resulting photometric interpretation and component count, and whether the intended profile was actually applied. Keep sample status unknown when any of those checks are missing; do not infer it from the picker or decoder extension table.
