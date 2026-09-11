# Render pipeline (`FXR`, tiled export, preview/loupe)

(moved from CLAUDE.md §3, 2026-09-11 — the two shader bug classes stayed in CLAUDE.md)

Everything is in one file. Key pieces:

- **`FXR` class** — the WebGL2 renderer. 5 shader programs: `lut`, `src`, `blur`,
  `blur_hal`, `comp`. Pipeline per frame:
  1. **lut pass** — full grading chain, in order: [optional **V-Log input transform**
     (`useVlog`): analytic inverse V-Log EOTF + exact V-Gamut→Rec.709 matrix, before anything
     else] → sharpen/clarity unsharp mask (on source pixels) → look LUT → [**HSL mixer**
     (`useHsl`): a 2nd 33³ LUT re-baked on the CPU from `applyHSL()` whenever a band slider
     moves] → `basicAdjust()` (exposure/contrast/WB/etc.) → [**local-adjust masks** (`mskN`):
     up to 8 analytic radial/linear masks passed as vec4 uniform arrays (`MSK_MAX=8`), global-uv mapped via
     `uvOffL/uvScaleL` so preview/loupe/export tiles place them identically; per mask
     exp/con/temp/sat/**Texture** + luminance-range gate + **colour-range gate + skin-tone
     uniformity** (docs/skin-tone.md) + **Amount** (`mskE.w`, one master scale over the finished selection;
     muting rides this slot at 0) + invert. Mask **"type 2" is SHAPELESS** — weight 1 everywhere,
     so the range gates alone select; that is the Colour Range / Luminance Range mask, and for it
     `invert` flips the GATES rather than the shape (inverting a full-frame shape gives zero).
     ⚠️ Texture reuses `srcHP`, the source high-pass hoisted to the top of `main()` and shared with
     the global Sharpen/Clarity, gated on `mskAnyTex` so its 4 extra taps are never paid by
     default] → [**tone curves** (`useCurve`):
     256×1 table baked from monotone-cubic point curves, sampled at texel centers so identity
     is byte-identical]. Each optional stage is gated off (and identity-gated in
     `getFXParams`) by default. ⚠️ **Saturation & vibrance are NOT applied here** — they moved
     to the comp pass (see below). ⚠️ GLSL functions must be DECLARED BEFORE USE — `maskAdjust`
     once referenced `s2lp` above its definition and blacked the whole pipeline.
  2. **emit pass** — computes the halation/bloom *emission* map from the graded image.
  3. **blur passes** — per-channel Gaussian blur of the emission (σ_R ≫ σ_G ≫ σ_B).
  4. **comp pass** — screen-blends bloom+halation, then **grain** (value-noise, see calib/CLAUDE.md’s grain model section), then
     **film artifacts** (procedural dust/hairs + wobbling vertical scratches + warm light leak;
     image-relative coords + a stable seed `fxState.artSeed`/Reshuffle so preview==export, and
     tile renders are byte-identical), then (if a Print profile is selected) a 2nd 3D LUT
     `printLut` via `usePrint`/`setPrintLUT`, then **saturation/vibrance** (`adjSat2`/`adjVib2`),
     then vignette. Order mirrors Dehancer:
     negative → halation → **grain** → **artifacts** → **print** → **grade (sat/vib)** → vignette.
     - ⚠️ **Grain is BEFORE print** (it's in the negative; the print stock then modulates it).
       Identity vs after-print when no print profile is selected.
     - ⚠️ **Saturation/vibrance run AFTER print** on purpose: pulling saturation to 0 must
       collapse the PRINTED pixel to its luma (neutral), not re-tint an already-grey pixel. If
       they ran before print (the old order), a print profile re-tinted neutrals and
       0-saturation no longer matched Dehancer (`calib/*lut print 0 sat*.png`: DH grey→neutral).
- **`render(P,w,h,opts)`** — `opts.glowScale` downsamples the blur buffers (cheap preview);
  `opts.scOverride` forces the sigma-scale (= fullWidth/REF) so a tile/crop blurs with the
  *whole image's* radius; `opts.uvOff/uvScale/seed` keep grain continuous across tiles.
- **Tiled export** (`renderTiled`) — processes huge images in overlapping tiles with a
  halo ≥3σ so peak GPU memory stays tiny and seams are mathematically invisible. The 1:1
  loupe reuses the same mechanism.
- **Preview** renders at `devicePixelRatio` (capped 2×) into a ~1800px backing store, then
  CSS-fits it. The **1:1 loupe** instead renders a native-resolution crop with
  `scOverride=fullWidth/REF` so grain & halation appear at *true export* scale.
