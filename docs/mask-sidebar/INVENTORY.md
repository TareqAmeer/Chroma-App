# Masks sidebar control inventory (native app scan, pre-redesign build 1.1025G)

170 unique controls across 26 states (none, radial, linear, brush, sky, skin, coat, ai, color, lum, depth, coatEye, manual-teeth, radial+colorrange, skin+samples, skin+swatch, skin+custom, skin+ref, coat+match, lum+samples, depth+on, brush+painting, brush+erase, ai+prompts, multiple, muted+inverted).
Source: `test/lib_mask_panel_scan.js` run inside the real app; machine-readable copy in `test/baselines/mask_sidebar_inventory.json`.
Identity = kind|label|key. Columns: group the control sat in, number of states it appears in.

| control | group | states |
|---|---|---|
| `button|Advanced coat tone matching|mskGroupToggle` | Advanced coat tone matching | 2/26 |
| `button|Deepen coat|mskSkinPreset` | Advanced coat tone matching | 2/26 |
| `button|Even out coat|mskSkinPreset` | Advanced coat tone matching | 2/26 |
| `button|Fix sun-bleaching|mskSkinPreset` | Advanced coat tone matching | 2/26 |
| `button|Warm undertone|mskSkinPreset` | Advanced coat tone matching | 2/26 |
| `button|Color|mskGroupToggle` | Color | 25/26 |
| `input:color|Color|msk-col-picker` | Color | 25/26 |
| `input:range|Color amount|colAmt` | Color | 25/26 |
| `input:range|Hue (fine-tune)|colHue` | Color | 25/26 |
| `input:range|Hue|hue` | Color | 25/26 |
| `input:range|Saturation|sat` | Color | 25/26 |
| `input:range|Temp|temp` | Color | 25/26 |
| `input:range|Tint|tint` | Color | 25/26 |
| `input:range|Vibrance|vibrance` | Color | 25/26 |
| `button|Detail|mskGroupToggle` | Detail | 25/26 |
| `input:range|Noise Reduction|nr` | Detail | 25/26 |
| `input:range|Sharpen Mask|sharpMask` | Detail | 25/26 |
| `input:range|Sharpen|sharp` | Detail | 25/26 |
| `button|Effects|mskGroupToggle` | Effects | 25/26 |
| `input:range|Clarity|clarity` | Effects | 25/26 |
| `input:range|Dehaze|dehaze` | Effects | 25/26 |
| `input:range|Texture|tex` | Effects | 25/26 |
| `button|Eye brightness|mskGroupToggle` | Eye brightness | 1/26 |
| `button|Light|mskGroupToggle` | Light | 25/26 |
| `button|Reset|mskCrvReset` | Light | 25/26 |
| `canvas|msk-crv|msk-crv` | Light | 25/26 |
| `input:range|Blacks|bl` | Light | 25/26 |
| `input:range|Contrast|con` | Light | 25/26 |
| `input:range|Exposure|exp` | Light | 25/26 |
| `input:range|Highlights|hi` | Light | 25/26 |
| `input:range|Shadows|sh` | Light | 25/26 |
| `input:range|Whites|wh` | Light | 25/26 |
| `button|Red depth|mskGroupToggle` | Red depth | 2/26 |
| `button|Add Skin (Face Parse)|mskFaceSelectSkin` | Selection | 5/26 |
| `button|Add missed area|mskFixup` | Selection | 10/26 |
| `button|Advanced position|mskGroupToggle` | Selection | 1/26 |
| `button|Auto-exclude face features|mskFaceAutoExclude` | Selection | 5/26 |
| `button|Clear paint|mskPaintClear` | Selection | 14/26 |
| `button|Clear prompts|mskAiPointsClear` | Selection | 9/26 |
| `button|Color range|btn-msk-cr-eye` | Selection | 17/26 |
| `button|Erase|btn-msk-erase` | Selection | 14/26 |
| `button|Eyes & brows|mskFaceSelectFeature` | Selection | 5/26 |
| `button|Glasses|mskFaceSelectFeature` | Selection | 5/26 |
| `button|Hair|mskFaceSelectFeature` | Selection | 5/26 |
| `button|Import…|document` | Selection | 9/26 |
| `button|Invert|btn-msk-tool-invert` | Selection | 14/26 |
| `button|Lips|mskFaceSelectFeature` | Selection | 5/26 |
| `button|Painting|btn-msk-paint` | Selection | 2/26 |
| `button|Paint|btn-msk-paint` | Selection | 12/26 |
| `button|Pick tones|btn-msk-lum-eye` | Selection | 22/26 |
| `button|Preview depth map|btn-msk-depth-preview` | Selection | 2/26 |
| `button|Re-detect sky|mskSkyRedetect` | Selection | 1/26 |
| `button|Rectangle select|btn-msk-ai-box` | Selection | 9/26 |
| `button|Refine edges|mskFixup` | Selection | 10/26 |
| `button|Refine edges|mskRefineEdges` | Selection | 14/26 |
| `button|Remember this subject|subjTeach` | Selection | 9/26 |
| `button|Reset refinement|mskRefinementReset` | Selection | 12/26 |
| `button|Sample 1 — click to remove|mskCrDropSample` | Selection | 6/26 |
| `button|Sample 1 — click to remove|mskLumDropSample` | Selection | 1/26 |
| `button|Sample 2 — click to remove|mskCrDropSample` | Selection | 6/26 |
| `button|Sample 2 — click to remove|mskLumDropSample` | Selection | 1/26 |
| `button|Scribbling — drag on the photo|btn-msk-ai-tap` | Selection | 9/26 |
| `button|Selection|mskGroupToggle` | Selection | 25/26 |
| `button|Trim spill|mskFixup` | Selection | 10/26 |
| `input:checkbox|Auto mask|` | Selection | 14/26 |
| `input:checkbox|Color range|` | Selection | 17/26 |
| `input:checkbox|Depth range|` | Selection | 25/26 |
| `input:file|subj-import-input|subj-import-input` | Selection | 9/26 |
| `input:range|Amount|amount` | Selection | 25/26 |
| `input:range|Brush size|size` | Selection | 14/26 |
| `input:range|Color purity range|crRangeC` | Selection | 7/26 |
| `input:range|Density|` | Selection | 13/26 |
| `input:range|Depth ceiling|depHi` | Selection | 2/26 |
| `input:range|Depth floor|depLo` | Selection | 2/26 |
| `input:range|Edge|` | Selection | 12/26 |
| `input:range|End X|x1` | Selection | 3/26 |
| `input:range|End Y|y1` | Selection | 3/26 |
| `input:range|Erase floor|` | Selection | 1/26 |
| `input:range|Feather|` | Selection | 12/26 |
| `input:range|Feather|feather` | Selection | 20/26 |
| `input:range|Flow|` | Selection | 14/26 |
| `input:range|Height|ry` | Selection | 2/26 |
| `input:range|Hue range|crRange` | Selection | 2/26 |
| `input:range|Lum ceiling|lumHi` | Selection | 22/26 |
| `input:range|Lum floor|lumLo` | Selection | 22/26 |
| `input:range|Minimum similarity|` | Selection | 9/26 |
| `input:range|Refine|` | Selection | 3/26 |
| `input:range|Start X|x0` | Selection | 3/26 |
| `input:range|Start Y|y0` | Selection | 3/26 |
| `input:range|Width|rx` | Selection | 2/26 |
| `input:range|X|cx` | Selection | 2/26 |
| `input:range|Y|cy` | Selection | 2/26 |
| `button|10|mskTgtSwatch` | Skin tone | 1/26 |
| `button|1|mskTgtSwatch` | Skin tone | 1/26 |
| `button|2|mskTgtSwatch` | Skin tone | 1/26 |
| `button|3|mskTgtSwatch` | Skin tone | 1/26 |
| `button|4|mskTgtSwatch` | Skin tone | 1/26 |
| `button|5|mskTgtSwatch` | Skin tone | 1/26 |
| `button|6|mskTgtSwatch` | Skin tone | 1/26 |
| `button|7|mskTgtSwatch` | Skin tone | 1/26 |
| `button|8|mskTgtSwatch` | Skin tone | 1/26 |
| `button|9|mskTgtSwatch` | Skin tone | 1/26 |
| `button|Advanced|mskGroupToggle` | Skin tone | 7/26 |
| `button|Custom|mskTgtMode` | Skin tone | 8/26 |
| `button|Deepen tan|mskSkinPreset` | Skin tone | 5/26 |
| `button|Even out tan|mskSkinPreset` | Skin tone | 5/26 |
| `button|Even them out|mskTgtMode` | Skin tone | 7/26 |
| `button|Match face to chest|mskSkinPreset` | Skin tone | 5/26 |
| `button|Match shoot|mskTgtMode` | Skin tone | 7/26 |
| `button|Pick a shade|mskTgtMode` | Skin tone | 5/26 |
| `button|Picking — shift-click to add|btn-msk-cr-eye` | Skin tone | 7/26 |
| `button|Reset|mskToneReset` | Skin tone | 7/26 |
| `button|Sample from selection|mskAutoSamples` | Skin tone | 7/26 |
| `button|Set from this photo|mskSetSkinRef` | Skin tone | 1/26 |
| `button|Skin tone|mskGroupToggle` | Skin tone | 4/26 |
| `button|Warm up|mskSkinPreset` | Skin tone | 5/26 |
| `input:color|Target color|` | Skin tone | 1/26 |
| `input:range|Depth|tanDepth` | Skin tone | 7/26 |
| `input:range|Strength|` | Skin tone | 9/26 |
| `input:range|Warmth|tanWarm` | Skin tone | 7/26 |
| `button|Skin toneon|mskGroupToggle` | Skin toneon | 1/26 |
| `input:range|How similar|crRange` | Skin toneon | 5/26 |
| `button|Match picks|mskTgtMode` | Uniformity | 1/26 |
| `button|Swatch|mskTgtMode` | Uniformity | 1/26 |
| `button|Uniformity|mskGroupToggle` | Uniformity | 1/26 |
| `input:range|Preserve modeling|preserve` | Uniformity | 1/26 |
| `list-row|button|msk-li-ctl.msk-li-act|Add` | list-row | 25/26 |
| `list-row|button|msk-li-ctl.msk-li-act|Intersect` | list-row | 25/26 |
| `list-row|button|msk-li-ctl.msk-li-act|Invert` | list-row | 25/26 |
| `list-row|button|msk-li-ctl.msk-li-act|Subtract` | list-row | 25/26 |
| `list-row|button|msk-li-ctl.msk-li-mute|Mute` | list-row | 25/26 |
| `list-row|button|msk-li-ctl.msk-li-mute|Unmute` | list-row | 1/26 |
| `list-row|button|msk-li-ctl.msk-li-solo|Solo` | list-row | 25/26 |
| `list-row|button||` | list-row | 25/26 |
| `button|+ Add|mskComposeMenu` | top | 25/26 |
| `button|+ Mask|mskAddMenu` | top | 26/26 |
| `button|Auto Subject|mskAddSubjectMatte` | top | 26/26 |
| `button|Background|mskAddBackground` | top | 26/26 |
| `button|Brush|mskAdd` | top | 26/26 |
| `button|Buildings|mskAddLandscape` | top | 26/26 |
| `button|Cancel|mskAiBusyCancel` | top | 1/26 |
| `button|Color|mskAdd` | top | 26/26 |
| `button|Compact mask slider layout|mskCompactLayoutToggle` | top | 25/26 |
| `button|Depth|mskAdd` | top | 26/26 |
| `button|Ground|mskAddLandscape` | top | 26/26 |
| `button|Hide all masks|btn-msk-hideall` | top | 26/26 |
| `button|Invert|mskInvert` | top | 25/26 |
| `button|Landscape|mskLandscapeToggle` | top | 26/26 |
| `button|Linear|mskAdd` | top | 26/26 |
| `button|Luminance|mskAdd` | top | 26/26 |
| `button|Mountains|mskAddLandscape` | top | 26/26 |
| `button|Objects|mskAddObjects` | top | 26/26 |
| `button|Radial|mskAdd` | top | 26/26 |
| `button|Rename, reorder, mute, solo, eraser, delete|mskMoreMenu` | top | 25/26 |
| `button|Skin|mskAdd` | top | 26/26 |
| `button|Sky|mskAdd` | top | 26/26 |
| `button|Sky|mskAddLandscape` | top | 26/26 |
| `button|Subject|mskAdd` | top | 26/26 |
| `button|Update all AI masks|msk-update-all` | top | 26/26 |
| `button|Vegetation|mskAddLandscape` | top | 26/26 |
| `button|Water|mskAddLandscape` | top | 26/26 |
| `button|− Subtract|mskComposeMenu` | top | 25/26 |
| `button|∩ Intersect|mskComposeMenu` | top | 25/26 |
| `input:checkbox|Edge only|ck-msk-selview-outline` | top | 26/26 |
| `input:checkbox|Show edit pins|ck-msk-pins` | top | 26/26 |
| `input:checkbox|Show overlay|ck-msk-overlay` | top | 26/26 |
| `input:checkbox|Spotlight|ck-msk-spotlight` | top | 26/26 |
| `input:color|Show overlay|msk-selview-color` | top | 26/26 |
| `input:range|Overlay opacity|sl-msk-selview-opacity` | top | 26/26 |
| `select|Overlay style|msk-selview-style` | top | 26/26 |
