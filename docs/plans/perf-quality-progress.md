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

## BLOCKERS
- Item 1/7: large-image exports (bloom sigma > ~16px, i.e. sources wider than ~3100px) now get the true calibrated
  Gaussian bloom instead of one truncated at ~1.5 sigma, so their bloom halo is visibly WIDER than before. That is the
  calibrated look (calibration was done at 2400px where nothing truncates) and matches the preview, but it changes existing
  exports. Revert switch: set `BLUR_MAX_SIG` / `HBLUR_MAX_SIG` to 1e9 in the renderer (restores old truncation).
  Needs the user's taste call.
- Item 1: Fit view is 0.77x the export's sharpness in the default (non-Full-res) mode; closing that needs the preview buffer
  to be rendered at exactly 2x the displayed device size.
- TM6636 itself was not on disk; measured on /Users/tareqameer/Pictures/4083778060.jpg (6240x4160).

## Not verified
- Windows (WebView2 is Chromium: crisp view disabled there by design, unaffected).
