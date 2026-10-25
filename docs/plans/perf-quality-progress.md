# Perf / quality run — progress log

Format: item | status | measured | commit. Real-app numbers come from `tools/diagnostics/parity_bench.mjs`
(WKWebView, retina dpr 2, 6240x4160 JPG, All FX on with borders, grain off; hfRatio = high-frequency energy
preview/export of the same region, 1.0 = same sharpness; diff = mean abs luma difference after +-6px alignment).

## Item 1 — Editor preview vs export (DONE, see numbers)
Root cause (measured): the preview backing store was already pixel-identical to the export (direct canvas diff 0.00),
but WKWebView rasterised the zoom wrapper's layer at its UNSCALED size (~1490 device px) and then magnified it with
`scale()`: a 6240px buffer shown at 100% looked like a ~1500px image stretched 4x (hfRatio 0.18). Chromium re-rasters
at the final scale, which is why no Chromium test ever showed it. Fixes:
1. Crisp view (`fxCrispDraw`): copy the visible part of the on-screen canvas from its full-res backing into a viewport-sized
   device-pixel canvas under the wrapper (exact pixel copy at 1:1); WebKit only.
2. Framed/matted zoom density tier cap 4 -> 16 (still bounded by source px, 8192 and 50MP).
3. Render exactly the source grid when within 1.5% (6240x4154 -> 6240x4160, no resample).
4. Bloom / halation blur kernels (r<=48 / r<=64) truncated wide glows on large images, so export halo was tighter than a
   Fit preview; wide sigmas now run as N passes of sigma/sqrt(N) (true Gaussian, N=1 unchanged => goldens byte-identical).

| zoom | before diff / hfRatio | after diff / hfRatio |
|---|---|---|
| Fit | 2.98 / 0.35 | 3.1 / 0.77 |
| 100% | 2.88 / 0.18 | 0.20 / 1.05 |
| 200% | 1.67 / 0.44 | 0.25 / 1.04 |
| 500% | 0.92 / 0.52 | 0.15 / 1.11 |

## Items 2-10 (commits: Rust 3d5eb524, library JS e29e1f9b, html+goldens bf69ee97)
| item | status | measured |
|---|---|---|
| 2 RAW instant first paint | already existed (embedded JPEG overlay `open-embedded-overlay`, stage 0 -> half -> full). Fixed what made it slow: the embedded preview + orientation each paged in the WHOLE file (rawler `RawSource::new` = mmap populate). New bounded 24MB head read (`raw_preview_head`), falls back to the old path | output pixel-identical to the whole-file path on 2 RAF + 1 RW2 (`CS_TEST_RAWS=... cargo test raw_preview_head`); cold RW2 quicklook (1920px decode+resize+encode) 220-370 ms in the real app. Old cold RAF was 975 ms; a cold RAF was NOT re-measured (all local RAFs are now page-cached) |
| 3 byte budgets | IMG_CACHE_BUDGET fixed 512MB desktop / 256MB touch or <=4GB; RAW_EDITOR_CACHE now 256MB by bytes (newest always kept); RAW_DECODE_CACHE and DEMOSAIC_CACHE are already single-slot and the refine already `take()`s the demosaic slot, left as is | cargo unit test `trims_oldest_first...` |
| 4 thumbnails | new `get_thumbnail_large` (512px, q85, own cache entry, only for cells wider than ~380 device px, max 3 in flight). THUMB_RENDER_VER NOT bumped on purpose: a bump regenerates the whole cache of a 50k-photo library and the 360px tier stays q75 | cold 26MP JPEG 841 ms -> 34KB; cached 35 ms |
| 5 leaks/waste | dropped thumbnail jobs now unobserve; `pruneThumbQueue()` drops jobs of unmounted cards on every virtUpdate (counted as settled); RAW identity hash is now length + head + tail + 256 strided 4KB samples instead of every byte (the decode request carries bytes, not a path, so path+mtime+size was not usable there) | cargo unit test for the sampled hash (stable, tail/head/length edits change it, no out-of-range index) |
| 6 16-bit + dither | stills export with RGBA16F intermediates + half-LSB TPDF dither (<=36MP single shot, always when tiled, off on memory-constrained devices); goldens regenerated | identity recipe mean diff 0.00; other recipes mean <=0.43 levels, max 1 level, halation max 67 (chart edge) / 18 (portrait). Real app 26MP export: steady state 2.8-3.5 s (8-bit 2.8-2.9 s); the FIRST export after launch is ~+2 s for float buffer allocation |
| 7 glow parity | done as part of item 1 (kernel cap -> N passes). Tiled vs single-shot glowScale: identical on desktop (both 1); on phones single-shot uses 2 by design for memory, left alone | `test/probe_glow_scale_parity.mjs`: 2x-width render vs 1x render: old 0.074 mean level diff, new 0.029 |
| 8 grid pool | scroll-only window shifts reuse card DOM (same entry, index, list, mode) instead of `innerHTML=''`; every other path still rebuilds | `test/probe_grid_card_reuse.mjs`: 168/182 cards kept on a 2-row scroll, forced render rebuilds all |
| 9 Windows sideways portraits | `orient_thumbnail_jpeg` (exif crate + image rotate) applied to WIC output; the helper is cross-platform and unit tested | rotate/untouched/undecodable cases unit tested on macOS. NOT run on Windows |
| 10 UX/a11y | roving tabindex on grid cards + `:focus-visible` ring; 44px hit areas via pseudo-elements for stars/flags/stack badge on touch; backdrop blur removed from popovers under `(hover:none),(pointer:coarse)` (their `--glass-bg` is already opaque) | probe_grid_card_reuse asserts tabindex; touch/Android visuals NOT checked on a device |

## Final gates (once, at the end)
- `npm run unit:test` PASS; `node test/export_harness.mjs` no GLSL errors, goldens regenerated; `npm run perf:test` PASS.
- `npm run ui:test` FAIL: `TOKEN --z-raised used 1x but never defined` at the `#msk-spotlight` rule. Not from this run (not in the diff).
- `node test/library_perf.mjs` FAIL on DOM-node budgets (n=200 8644>8000 ...). Identical on the pre-run `library-ui.js` (checked), so pre-existing.
- `npm run lint:src` FAIL: `src/catalog/keyword-tree.part: 4301 lines > 4300` (another session's file).
- probe_preview_px, probe_allfx_sharp, library_scroll_anchor PASS.

## BLOCKERS
- RESOLVED 2026-10-25 (user): old truncated bloom/halation look is the correct look. Export restored byte-for-byte; the preview emulates it (see 'Bloom decision' below). Original note:
- Item 1/7 (taste call): large-image exports (bloom sigma > ~16px, i.e. sources wider than ~3100px) now get the true calibrated
  Gaussian bloom instead of one truncated at ~1.5 sigma, so their bloom halo is visibly WIDER than before. That is the
  calibrated look (calibration was done at 2400px where nothing truncates) and matches the preview, but it changes existing
  exports. Revert switch: set `BLUR_MAX_SIG` / `HBLUR_MAX_SIG` to 1e9 in the renderer (restores old truncation).
  Needs the user's taste call.
- Item 1: Fit view is 0.77x the export's sharpness in the default (non-Full-res) mode; closing that needs the preview buffer
  to be rendered at exactly 2x the displayed device size.
- TM6636 itself was not on disk; measured on /Users/tareqameer/Pictures/4083778060.jpg (6240x4160).

## Not verified
- Windows (WebView2 is Chromium: crisp view disabled there by design, unaffected).
- Item 4: q85 on the 360px base tier needs a THUMB_RENDER_VER bump, i.e. regenerating every cached thumbnail of a 50k library. Not done; say if you want it.
- Item 9: needs one run on a Windows machine with a portrait JPEG.
- Item 10: touch hit areas and Android popovers need a look on a real device.
- Pre-existing red gates listed above (ui:test token, library_perf DOM budget, lint:src keyword-tree) are not mine and were left alone.

Next item: none (all 10 done or logged).


## Bloom decision (user, 2026-10-25): export keeps the old truncated-kernel look; preview matches it
- Export: the N-pass blur was removed. `capScale` is 0 for exports, i.e. the shader keeps its plain 48 / 64 tap caps.
  Proof, `test/probe_export_identity.mjs` (old app at b96045f3~1 vs working tree, 8-bit path, halation+bloom on, two images wider than 3100px):
  4800x3200 and 6240x2400 FNV hash IDENTICAL, coarse diff 0 / max 0. Golden harness: all 35 renders match the goldens (1 file differs by mean 0.007 = dither seed).
- Preview: `opts.truncRefW` (the export width = working copy width x `fxFullScale()`) scales the tap cap by sc/(truncRefW/REF)/glowScale, so a
  3000px preview gets the same truncated SHAPE a 6000px export gets (cap defined in ref-width units). Added to `mskPreviewRenderOptions`, so every
  preview path (Fit, crop, tiles, loupe) carries it. Settled previews also use the export's float intermediates + half-LSB dither.
- `test/probe_glow_scale_parity.mjs` (4800px export vs 2400px preview, bloom radius 30, halation 14): preview WITHOUT emulation 0.544 mean levels off the export, WITH emulation 0.031.
- Fit buffer is rendered at exactly 2x the displayed size (real app: 2681px backing for 671 css px at dpr 2 = 1.998x).
- Real-app parity (halation+bloom on, Full res off, composed with borders) after this change, before the float-parity fix: Fit 0.751 sharpness / diff 3.14; 100% 1.31 / 0.64; 200% 1.06 / 0.36; 500% 1.03 / 0.12. The 100% shift was the float-vs-8-bit emission mismatch, fixed afterwards by giving settled previews the export's quality options (re-measured below).
