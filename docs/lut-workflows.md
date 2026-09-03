# LUT workflows

Deep-dive on LUT capture/round-trip, Lumix Lab compatibility, and device-link cubes. Load this when touching `chartToLUT`, `writeCube`, or preset capture.

## 8. LUT workflows

- **LUT chart round-trip**: "LUT chart" generates a 5640×3840 PNG of all 33³ colours; apply
  a look elsewhere, drop the export back, and `chartToLUT` reads patch means (inner 50%, so
  grain/sharpen/NR cancel) → an exact 33³ LUT. Identity round-trip verified (maxDiff =
  quantization 1/510). ⚠️ A LUT captures GLOBAL colour/tone only — not sharpen/NR/grain/
  local masks.
- **Lumix Lab compatibility**: every emitted `.cube` (`writeCube`) carries
  `#LUMIXPHOTOSTYLE STD` as line 2. Without it the camera assumes V-Log and colours go wrong.
  ⚠️ If a regenerate ever drops this tag, re-add it.
- **Device-link cube** (`a beach preset v5.7 lumix.cube`): maps camera-STD pixels →
  Chromasmith's beach-preset output, so applying it in-camera to STD reproduces the look.
  Fit from matched RW2+SOOC-JPEG pairs.
- ⚠️ **A LUT captured from a single photo / narrow gamut has GARBAGE in unobserved saturated
  corners.** Always sanity-check a captured preset on the **LUT chart** (full cube), not just
  a normal photo. When an original parametric `.xmp` with identity tone curves exists, prefer
  baking XMP→LUT analytically over capturing the rendered look. (The blind standalone
  "XMP→LUT" tab was removed — its `applyHSL` hue bands were too narrow to match Lightroom;
  Match & Refine / Colour Copy are the correct empirical tools.)

---

