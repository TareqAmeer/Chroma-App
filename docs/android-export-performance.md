# Android export performance — CHR-284

## Changes

- Ordinary Android JPEG exports use 2048px tile centers when reported memory is at least 2GB. Glow and skin masks require at least 4GB. Float/HDR, lens geometry, noise reduction, deconvolution and depth/tilt blur retain the existing tile layout pending separate pixel validation. Unknown/low memory and other platforms retain 1024px centers. Expanded tiles are bounded by texture, renderbuffer and viewport limits, with a 2560px working-side cap.
- Reuse the two temporary tile canvases, resize only when needed, clear transparent source pixels, and release both canvases and incomplete output on cancellation/errors. Preserve full output resolution, quality, halo math, global grain coordinates and the separate export renderer.
- Completion notifications check existing permission and use `isExactNotification:false`. They run without blocking export completion. Long exports previously requested notification permission and could open Android's Alarms & reminders settings after saving.

## Measurements

Android 35 Pixel AVD `chroma_pixel`, WebView 124, Google SwiftShader renderer, 2GB reported `deviceMemory`. Fixtures are the same brand JPEG resized to 4000×3000 and 6000×4000 with Pillow LANCZOS and saved at source quality 92. These are synthetic enlarged fixtures, not real Pixel camera captures. Exports are full-resolution JPEG, quality 99, no glow, Files destination.

Fresh APK comparison: one warmup and three measured runs per image size. Baseline is current main at `ec193cab`, including the separate export renderer; it is not the older agent checkout. The benchmark wraps `FXR.prototype` once per fresh app process. `render()` measures submission; `getPixels()` also includes GPU completion. Total includes encoding, metadata, native saving, history and preview restoration. Every saved file was pulled back and decoded at the requested dimensions. Notification/media/exact-alarm permissions were granted before measuring; interrupted permission-dialog runs were discarded.

| Median of three warm runs | Baseline | Optimized | Result |
| --- | ---: | ---: | --- |
| 24MP total | 10.381s | 7.397s | 28.7% faster |
| 24MP processing | 6.972s | 4.160s | 40.3% faster |
| 24MP readback + GPU completion | 2.538s | 2.030s | 20.0% faster |
| 24MP tile count | 24 | 6 | 75% fewer |
| 12MP processing | 1.057s | 1.015s | Essentially unchanged |
| 12MP total | 3.690s | 5.900s | Slower in this sample; encoding varied |

The 12MP path does not tile and its rendering/encoding algorithm is unchanged. Its median encoding time varied from 1.267s to 2.932s. There is no demonstrated 12MP speedup. First 12MP warmups were about 25s on both APKs, dominated by software-renderer GPU completion; these are recorded separately, not hidden in the warm medians.

To check order/environment effects, the same running optimized APK alternated the original `renderTiled` function from `ec193cab` and the optimized implementation: baseline, optimized, optimized, baseline, baseline, optimized. Everything else, including the source, renderer, settings and save path, remained the same.

| Median of three alternating runs | Original tiles | Optimized tiles | Result |
| --- | ---: | ---: | --- |
| 24MP total | 9.861s | 7.246s | 26.5% faster |
| 24MP processing | 6.719s | 4.072s | 39.4% faster |
| 24MP encode | 1.655s | 1.588s | Similar |

Raw timings, fixture SHA-256 hashes and settings: [benchmark data](benchmarks/android-export-2026-10-06.json). Full JPEGs and diagnostic scripts remain in ignored `test/android/out/`. All 22 benchmark JPEGs decode at full dimensions. 12MP decoded pixels match exactly. 24MP decoded JPEG differences average 0.003649/255 per channel, maximum 5/255; JPEG encoding amplifies small renderer rounding differences. Differences in six-column strips around tile boundaries average at most 0.006973/255 in this fixture. This does not establish equivalence for every image/effect/device.

## Regression checks

`node test/export_tiles.mjs` compares the original fresh-canvas/1024px algorithm against canvas reuse and larger tiles with basic processing, fixed grain, halation/bloom, skin uniformity and transparent pixels. It also checks cancellation cleanup, low/unknown memory, iOS fallback, GPU/halo bounds and completion notifications. Canvas reuse must match exactly; larger tiles must stay within two channel levels and mean/seam difference below 0.01/255.

`node test/export_live_preview.mjs` checks frozen export pixels while the preview look/depth changes. `node test/export_harness.mjs` plus `python tools/calib/export_scorecard.py` check the existing export goldens.

Verification passed: tile/notification regression and preview isolation; 35 fixture/recipe renders; all 23 checked-in goldens matched exactly (12 additional orientation combinations have no goldens). On Windows the scorecard needed `python -X utf8` for its console output. A separate optimized Photos export returned a successful receipt and MediaStore row; its pulled JPEG decoded as 6000×4000. This single Photos run took 8.876s, including 1.835s native saving; it is a destination correctness check, not a Photos before/after comparison.

The suites passed again in the clean current-main integration checkout. The native inexact completion notice was also checked after denying exact-alarm permission: the app stayed foreground instead of opening settings. Implementation published to `origin/main` at `f41e82cd3e05b83458f7266e97330d9fb86c3bbc`, verified against `git ls-remote` after push. CHR-284 remains In Review for physical Pixel testing.

## Reproduce

Build/stage/install the debug APK using the repository Android workflow. Grant emulator test permissions before timing. Generate `test/android/out/bench-4000x3000.jpg` and `bench-6000x4000.jpg` from `assets/brand/og-image.jpeg` with Pillow RGB/LANCZOS resize, `quality=92,optimize=True`. Keep identical fixture bytes across APKs.

Run `node test/android/export_benchmark.mjs baseline` against the baseline APK, then `node test/android/export_benchmark.mjs optimized` against the changed APK. The script grants notification/media permissions, verifies source dimensions, captures one warmup plus three repeats, verifies successful native receipts and pulls outputs back for independent decoding.

## Limits and next targets

These measurements establish a relative improvement on the emulator, not physical Pixel timing or parity with iPhone/other apps. A real 24MP camera fixture and physical Pixel run remain necessary. Heavy effects on a 2GB device retain smaller tiles. Encoding and native saving still consume time; the export is not instant.

Further changes should be measured separately: avoiding synchronous readback/CPU row flipping; reusing source GPU textures; calculating overlap only for enabled neighborhood effects; rendering at requested smaller export dimensions; replacing base64 transport with supported binary transfer; writing Photos directly to MediaStore; unchanged-source/cached export shortcuts; and comparing worker/native JPEG encoding without lowering quality. Larger tiles and canvas reuse are the measured changes shipped here; those candidates need separate correctness and device evidence.
