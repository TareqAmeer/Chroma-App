# Labelled mask quality fixtures

This directory intentionally contains no downloaded photographs. Add a small, reviewed fixture set only after confirming the image and alpha-label redistribution terms. Do not accept click-through terms, indemnities, or dataset agreements for the project on someone else's behalf.

The evaluator consumes PNG exports for the source photo, ground-truth alpha, original AI mask, and refined mask. Keep source/refined masks at the app's canonical source dimensions. Coverage images must be opaque grayscale PNGs; the photo must be RGB/RGBA PNG. Each fixture needs an ID and one or more category tags. The first release gate requires at least one fixture tagged `hair`, `foliage`, and `fine-edge`; use separate tags for separate images where appropriate.

Create a manifest outside version control or in this folder after adding reviewed fixtures:

```json
{
  "version": 1,
  "provenance": {
    "source": "dataset name and stable source URL",
    "license": "exact license and attribution requirement"
  },
  "thresholds": {
    "alphaMae": "SET_BEFORE_RUN",
    "boundaryMae": "SET_BEFORE_RUN",
    "falsePositivePercent": "SET_BEFORE_RUN",
    "blackCompositeMae": "SET_BEFORE_RUN",
    "whiteCompositeMae": "SET_BEFORE_RUN"
  },
  "fixtures": [
    {
      "id": "hair-001",
      "categories": ["hair"],
      "photo": "hair-001/photo.png",
      "groundTruth": "hair-001/alpha.png",
      "sourceMask": "hair-001/ai-mask.png",
      "refinedMask": "hair-001/refined-mask.png"
    }
  ]
}
```

Fix thresholds before evaluating candidates and record how they were chosen. Run `node test/mask_refinement_quality.mjs --manifest <path-to-manifest.json>`. The report includes normalized alpha MAE, boundary-band MAE, hard-background false-positive coverage, and RGB composite MAE over black and white. A passing report is a quantitative gate, not proof that no visible halos exist: inspect each labelled image at 100% and record that visual review alongside the report. Keep synthetic evaluator tests separate from photo results.

`npm run mask:quality:self-test` checks metric behavior without claiming photographic quality. Do not check downloaded fixture data or manifests containing private paths into Git unless their redistribution and privacy terms are approved.
