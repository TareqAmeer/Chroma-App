# Android export methods and Snapseed — CHR-284

## Setup

All eight remaining ideas from the [first investigation](android-export-performance.md) were exercised on the Android 35 Pixel AVD, native x86_64, WebView 124, SwiftShader and 2GB reported deviceMemory. The same synthetic 6000×4000 brand JPEG was used (source quality 92), not a real Pixel camera capture. Chroma exports use JPEG quality 99. Stage timings exclude other stages; conditional shortcuts are not general export performance.

Snapseed **4.1.10.992428248**, versionCode 1884095, was downloaded from [APKMirror](https://www.apkmirror.com/apk/google-inc/snapseed/snapseed-4-1-10-992428248-release/snapseed-4-1-10-992428248-4-android-apk-download/), signature checked and installed with native x86_64, English and xxhdpi splits. APKM SHA-256: `D132A6E6ABA160B43D6716782F5D52F3CFE981FAAB2801D1AA2B1196AA33F76B`. All split signer certificates matched `3d12cc11f4c4be82235f70f90469be0b9c9629aec5fcb949cb32b1fa375bfc3e`, matching the source listing. The APK is retained locally, not redistributed in Git.

Snapseed settings: **Do not resize / JPG 100%**. Input details and all eight decoded exports were verified at **6000×4000**. Timing starts at flattening **Export**, ending at a new completed MediaStore JPEG (`is_pending=0`, size positive). One warmup and three measured repetitions were taken; photo loading/edit application are excluded. ADB input and publication polling add overhead. Google's [Save / Export guidance](https://support.google.com/snapseed/answer/6155519?hl=en) documents the distinction.

## Complete exports

| Batch and method | Warm median | Warm range |
| --- | ---: | ---: |
| Snapseed unchanged, JPG 100% | 2.761s | 2.512–3.008s |
| Snapseed Brightness +7, JPG 100% | 4.416s | 4.006–4.497s |
| Earlier Chroma control, exposure +0.25 EV, JPG 99% | 8.659s | 5.141–16.737s |
| Earlier Chroma worker + binary prototype | 6.278s | 4.342–8.010s |
| Final batch: previous production path | 17.641s | 13.680–26.127s |
| Final batch: implemented worker + binary Photos | **11.910s** | **10.114–14.161s** |

The final batch alternated previous and implemented paths in one APK, using identical input, exposure and quality: **32.5% median improvement**. Processing was slower in implemented samples (median 8.677s versus 7.238s), while encoding fell from 4.721s to 0.874s and saving from 2.574s to 0.310s. Individual stage medians need not sum to median total. The stalled first warmup was investigated, excluded from warm medians, and retained in the data; three measured samples per method followed it.

The earlier four-way prototype trial also measured worker alone (7.934s) and binary saving alone (9.763s). Binary alone did not improve total latency in that batch: main-thread encoding varied. Prototype saving bypassed some production receipt/album behavior; **6.278s is not the shipped implementation's measurement**.

Snapseed was materially faster in its measured batch. Neither app was instant for these edited 24MP exports. Brightness +7 and exposure +0.25 EV are different operations; JPEG quality numbers are not standardized between codecs. Snapseed may reuse internal results, but that was not measured. Large drift between batches prevents a precise cross-app ratio or prediction of physical Pixel speeds.

## Results for all ten ideas

| Idea | Evidence and decision |
| --- | --- |
| Larger bounded tile centers | Previously shipped: paired 24MP total 9.861→7.246s. Heavy/low-memory paths retain guarded fallbacks. |
| Reuse temporary canvases | Previously shipped: exact raw-pixel parity, cancellation and cleanup tested. |
| Avoid readback / CPU flip | Balanced edited trial total 21.164→9.292s; initial neutral trial was slower. Android pixels change slightly and deferred GPU work moves into encoding. Advanced Android paths unvalidated; keep experimental. |
| Reuse source textures | Exact pixels in five recipe tests and edited Android fixture. Rendering median 4.881s versus control 4.099s; no demonstrated rendering improvement. Keep existing path. |
| Smaller disabled-glow overlap | Rendering 3.773s; raw seam mean 0.01132/255 exceeds prior 0.01 gate, max difference 4. Keep experimental. |
| Render at requested smaller size | 2400×1600 median 5.839→1.072s; pixel sampling/effect scale changes and outputs varied. Not a full-resolution improvement; keep current quality behavior. |
| Binary finished-JPEG transport | **Implemented** with supported, origin-restricted Android WebMessage ArrayBuffer transfer. Avoid base64 and temporary CACHE copy on supported JPEG Photos exports. |
| Direct Photos writes | **Implemented** in the existing Chromasmith album, atomic completed-file publication, gallery scan acknowledgement and unique filenames. Other destinations/formats preserve existing behavior. |
| Original / cached shortcuts | About 0.26s save-stage timing, conditional on already available identical bytes. Original passthrough preserves source quality 92 and cannot apply edits or deliver requested quality 99. Not shipped as a general bypass. |
| Worker / native encoding | **Worker implemented**, same browser codec/quality, bounded memory. Native RGBA experiment took 9.016s including readback, 96MB transport, encoding and save; do not ship that transfer path. |

Balanced edited renderer trial: one warmup plus three measured samples per method, reversing order on alternate passes:

| Method | Processing median | Total with main-thread JPEG/save |
| --- | ---: | ---: |
| Current | 4.099s | 21.164s |
| Direct canvas copy | 2.751s | 9.292s |
| Trim overlap | 3.773s | 17.050s |
| Source texture reuse | 4.881s | 17.545s |
| Combined | 2.710s | 16.275s |

Encoding often hit a roughly 13-second tail, making totals sensitive to scheduling. Direct raw-pixel difference averaged 0.001375/255, maximum 2; overlap/combined averaged 0.008605/255, maximum 4, seam mean 0.011322/255. Texture reuse/control matched exactly. None of these renderer variants is shipped. The initial neutral renderer batch has only two measured control/direct samples and is explicitly marked incomplete.

Save-stage Photos medians: 2.065s existing base64/cache/Media, 1.410s base64/direct prototype, 0.339s binary/direct prototype. Files: 1.753s existing path, 0.250s binary. Worker encode-stage median: 2.735s versus 11.147s main-thread; native RGBA total: 9.016s. Do not add these to another batch's total.

Raw timings, stage medians and independent output checks: [benchmark data](benchmarks/android-export-methods-2026-10-06.json).

## Implemented changes

Chromium's [CanvasAsyncBlobCreator source](https://chromium.googlesource.com/chromium/src/%2B/lkgr/third_party/blink/renderer/core/html/canvas/canvas_async_blob_creator.cc) schedules main-thread canvas encoding using idle work and includes mobile idle-start/completion deadlines. Worker encoding avoids that scheduling path. Repeated multi-second tails are consistent with this behavior; this is an inference from source and experiments, not a trace-proven cause on physical Pixels.

`fxEncodeExportCanvas` transfers an ImageBitmap to a worker, calls OffscreenCanvas.convertToBlob at requested quality, and releases bitmap/canvas/worker/object URL resources. Timeout/errors fall back to the original encoder. Eligible Android JPEGs are over 1MP with known memory ≥2GB, capped at 24MP at 2GB or 32MP at ≥4GB. iOS/desktop, PNG/WebP, unknown/low memory and unsupported APIs retain original encoding. Metadata stays in the normal export pipeline.

The native bridge uses the repository's pinned AndroidX WebKit 1.14 and [feature checks](https://developer.android.com/reference/androidx/webkit/WebViewCompat). It accepts only the app's `https://localhost` main frame, bounded JPEG bytes and validated filenames, with one active save. It writes once and acknowledges gallery registration. Overlapping JS saves cannot replace a pending handler. Unsupported WebViews fall back before dispatch; a dispatched error never silently retries another path and risks duplicates. Repeated filenames preserve both outputs.

## Reproduction and limits

`test/android/build_export_experiments.ps1` stages the benchmark-only loopback endpoint/debug cleartext override temporarily and restores sources after build/install. Never package either in an ordinary build. `export_methods.mjs` measures stages; `export_complete_methods.mjs` reproduces the original four-way prototype; `export_production_methods.mjs` compares actual previous/implemented paths by injecting the mobile export module from `5b451902` and switching the encoder. Native receipts must succeed and saved files are pulled for decoding. Keep the emulator awake, foreground, and free of other benchmark/test workloads during timing.

`snapseed_ui.py` inspects the real UI; `snapseed_run.py` times observed Export actions after confirming input/settings/edit. `check_method_outputs.py` independently checks decoding, dimensions, SHA-256, JPEG quantization/sampling and RGB differences. Full fixtures/JPEGs/APK remain in ignored `test/android/out/`.

Focused regressions cover worker JPEG byte parity at three qualities with opaque/partially transparent pixels, cleanup/fallback gates; binary byte offsets, fallback destinations, errors/concurrency; renderer pixels/seams and frozen preview/export isolation. Existing tile and export goldens are retained. Physical Pixels, real camera fixtures, HDR/RAW/heavy effects and other WebView versions remain unmeasured here.


## Verification results

All 122 saved benchmark JPEGs decoded at requested dimensions. All eight production before/after JPEGs are **byte-for-byte identical**, including normal metadata; the 16 prototype outputs match decoded RGB exactly. Worker regression: six byte-exact JPEG comparisons at three qualities; cleanup and seven fallback gates pass. Binary protocol/offset/fallback/error/concurrency and delayed acknowledgement status tests pass. Tile, live-preview isolation and 20 method/recipe pixel cases pass. On the task baseline, the export harness rendered 35 outputs and all 23 checked-in goldens matched exactly (12 orientation combinations have no goldens). Current-main integration passes 18/23 goldens: five wavelet goldens already mismatch on unmodified main. All 35 integration PNGs are byte-identical to that unmodified-main baseline, so this task introduces no rendering change. Worker/protocol/tile/preview checks pass again in integration.

The ordinary APK excludes ExportExperimentPlugin and its debug cleartext override. Repeated native saves preserve both unique filenames and exact source JPEG bytes. An initial receipt assertion under concurrent startup/test load failed even though both photos reached MediaStore; three repeats passed. Added bounded native completed-save status lookup before reporting a timeout, preventing an unnecessary duplicate retry when acknowledgement delivery is delayed. This safeguard is separately regression tested; it does not change the normal path measured above.

Snapseed evidence: [settings](benchmarks/android-snapseed-settings.png), [24MP input details](benchmarks/android-snapseed-input.png), [Brightness +7 edit](benchmarks/android-snapseed-edit.png).

Final integrated APK live checks pass: duplicate filenames preserve both byte-exact JPEGs and native status confirms each. Deliberately dropping the saved acknowledgement also returned a successful receipt through status lookup after the 30-second test timeout; its pulled JPEG matches exactly. This induced delay is a resilience test, not an export-speed measurement. The ordinary integrated APK has no experimental endpoint.

Published implementation: `e27bde4d`; integration verification: `9ecef3ae382ec4310e234d6f44eb0d559b67e24c`, confirmed on remote main after fast-forward push. CHR-284 remains In Review for physical-device testing.
