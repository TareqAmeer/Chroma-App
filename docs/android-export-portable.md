# Android export portability — 7 October 2026

CHR-284; BUILD 1.1007A. Additional implementation follows [the first export changes](android-export-performance.md) and [the methods/Snapseed comparison](android-export-methods.md).

## Changes selected

* Read only the usable center of each rendered tile into the output canvas. This removes the intermediate canvas upload/copy and avoids reading halo pixels. Shader math, tile overlap, resolution, quality and metadata remain the same. Android capability checks retain the existing path elsewhere.
* Detect when WebView has reduced a JPEG by comparing its loaded dimensions with the encoded JPEG SOF. A bounded native decoder restores the original pixels, including EXIF orientation and sRGB conversion. This fallback runs only for reduced sources; ordinary exports keep the browser decoder.
* Transfer decoded rows through the supported AndroidX binary bridge, restricted to the local app's main frame. Older bridge capabilities use bounded base64 rows. Release native bitmaps and temporary canvases, avoid retaining pixel payloads in Capacitor debug logs, and use software-backed temporary canvases for this low-memory fallback.

The previous larger tiles, JPEG worker and binary Photos save remain active with their memory/capability gates. The native decoder fallback is capped at 24 MP and 16,384 pixels per side to bound its working set; larger reduced JPEGs fail clearly rather than silently exporting a reduced image. It does not cap ordinary browser-decoded exports.

## Measurements

Same synthetic 6000×4000 JPEG, exposure +0.25 EV, JPEG quality 99, production exportFX and verified native Photos saves. One warmup plus three measured runs per method, alternating order. Controls replace only the tile function with the previously published implementation. Stage medians do not sum to the median total.

| Emulator / batch | Previous tile control | Selected center readback | Result |
| --- | ---: | ---: | --- |
| Android 35, 2 GB, confirmation | 4.875 s | 4.201 s | 13.8% faster |
| Android 35, independent dirty-rectangle batch | 6.100 s | 4.404 s | 27.8% faster |
| Android 35, first noisy batch | 6.191 s | 9.094 s | slower; retained in raw data |
| Android 29, actual 1 GB, full-resolution native source | 15.240 s | 6.525 s | 57.2% faster |

Android 29's control also restores the full-resolution source. Comparing it with the old application's silently reduced 1.5 MP export would be misleading. Twelve consecutive final full-resolution exports completed, including four per method counting warmups. Binary native source preparation had a 1.426 s median versus 16.397 s with legacy base64 rows; full exports were 6.525 s versus 21.391 s. The legacy route is compatible but materially slower.

Android 35 processing remained dominant: 4.060 → 3.264 s, with encoding about 0.4 s and saving about 0.1 s. Android 29's selected medians were preparation 1.426 s, processing 1.708 s, encoding 1.616 s and saving 0.548 s. Instant 24 MP export has not been demonstrated.

### Methods rejected or retained conditionally

Direct GPU-canvas copying changed JPEG pixels (maximum RGB difference 5), so it is not shipped. Full readback with dirty-rectangle upload was slower than center readback. Timer yielding and forcing software output canvases on ordinary sources did not show a useful improvement. Software contexts are selected only for the native reduced-source fallback, where memory pressure was observed. No original-file shortcut bypasses edits, and quality/resolution are not reduced to improve timing.

### Failed and invalid runs

* The first Android 29 test loaded the 24 MP JPEG at 1500×1000 through HTML Image, createImageBitmap and ImageDecoder. Its eight quick exports are invalid as 24 MP performance evidence. This led to the source-dimension assertion and native restoration.
* An initial full-resolution fallback with verbose base64 transfers completed six exports, then WebView terminated the renderer and the app exited. Android logged renderer termination under its OOM-or-update category; no update was performed during that run. Memory pressure is the diagnosis, not a uniquely proven cause. Binary transfers, bounded rows, cleanup, selective logging and software temporary canvases were added before the successful twelve-export stress run.
* The final Android 35 integration check initially failed during library import with IndexedDB `DataError: Failed to read large IndexedDB value`, before export began. Storage had 3.9 GB free and usage was only 36 MB. The existing 40 MB emulator WebView profile was archived locally before resetting this test app's data. This is an observed profile/database failure with an undetermined cause, not an export speed result or a production database repair.
* Cold starts and host scheduling caused large outliers, including 17–26 s in Android 35 batches. All measured rows and warmups are preserved. Three repeats establish useful direction, not universal phone timing.

## Verification

* Eleven tile comparisons: exact raw RGBA parity for ordinary/unknown/constrained memory, odd dimensions, transparency, grain, glow, skin, detail, lens, NR, tonemap and red-eye. Independent readback rectangle/vertical-flip checks pass.
* Native decode: all eight EXIF orientations through both binary and legacy transfers, odd final row count and embedded sRGB ICC. Maximum Android-versus-Chromium conversion difference is one 8-bit level, mean 0.03018 on Android 29 and 0.02392 on Android 35; orientations and dimensions match. Invalid input, concurrency, token/range/expiry checks, cancellation and reopen pass.
* Pure protocol tests cover source/platform gates, selective logs, binary token/coordinates, malformed messages, native errors, timeout, bridge exception, cleanup and legacy errors.
* Existing tile/seam/cancellation, worker byte parity and fallbacks, binary Photos status recovery and live-preview isolation tests pass, including reruns on the clean current-main integration.
* All 35 integrated fixture PNGs are byte-identical to unmodified main `5c5062c1`. The same five existing wavelet golden mismatches remain (18/23 exact); no goldens were regenerated.
* Independently decoded 66 saved JPEGs: 58 were full 24 MP and eight were the explicitly excluded 1.5 MP discovery outputs. All 54 full-resolution outputs outside the rejected direct-copy variant were byte-identical to their same-batch control; all twelve final Android 29 outputs were exact.

The ordinary integrated APK also completed four full-resolution saves on each configuration: warm medians 6.489 s on Android 29 and 3.322 s on Android 35. These are acceptance reruns without a paired control, not an additional before/after percentage. All eight JPEGs decoded at 6000×4000, with byte-identical repeats within each device. Native orientation/transport safeguards passed again on both OS versions.

Raw rows, device records, hashes and pixel checks are in [the benchmark data](benchmarks/android-export-portable-2026-10-07.json). Reproduce with `test/android/export_portable_methods.mjs`, `test/android/create_jpeg_decode_fixtures.py`, `test/android/export_jpeg_decode.mjs`, `test/android/check_portable_outputs.py`, `test/export_center_readback.mjs` and `test/full_jpeg_transport.mjs`.

## Coverage and recommendation

Android 35 used SwiftShader; Android 29 used the host AMD Radeon RX 7700 XT through the emulator's GLES translator, with a true 1 GB guest. Both used WebView 124. Android 29 required the emulator's documented GLESDynamicVersion feature to expose WebGL2 ([Android emulator configuration source](https://chromium.googlesource.com/android_tools/+/refs/heads/main/sdk/emulator/lib/advancedFeatures.ini)). No experimental WebView command-line override remains. The old stock WebView 74 cannot run the existing application's JavaScript/WebGL requirements and is not claimed as supported.

Ship the capability-based improvements without requiring a Pixel. They apply across Android vendors; actual speed still depends on GPU, memory, WebView and effects. Emulator results do not prove every Android device or match physical phone timing. Keep full-resolution checks and the bounded fallbacks. Further large gains would require profiling remaining shader/readback work and validating a native render pipeline for effect parity; this work does not justify sacrificing output fidelity. Prior Snapseed timings used different edits/codecs and are contextual, not a precise speed ratio.
