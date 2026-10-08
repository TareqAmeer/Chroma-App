# CHR-249 Lightroom reference kit

Inputs are five deterministic 2048×1536 16-bit RGB TIFFs, tagged sRGB. They have controlled edges/frequencies, independent luminance/chroma noise, fine fibres/texture, atmospheric veil, and colour/neutral ramps. Seed 249; see manifest.json for hashes. These are measurement fixtures, not natural-photo quality sign-off or sensor RAWs. Do not convert them to fake RAW/DNG.

## Import and establish the baseline

Use Lightroom Classic's Develop module. Import the five TIFFs from inputs with **no Develop preset**. Record your Lightroom Classic and Camera Raw versions in versions.txt. Disable auto adjustment, HDR editing, automatic lens correction, grain/vignette, masks and any import preset.

Reset each image, then explicitly set:
- Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Vibrance, Saturation: **0**.
- White balance: **As Shot**, no added temperature/tint shift. Record the profile and Process Version shown; keep them identical for every run. Leave colour mixer/calibration at reset and tone curve **Linear**.
- Detail: Sharpening **Amount 0, Radius 1.0, Detail 25, Masking 0**; manual Noise Reduction **Luminance 0, Detail 50, Contrast 0; Color 0, Detail 50, Smoothness 50**.
- No crop, transform, lens correction, effect or mask. Denoise/Raw Details off; Super Resolution off except the two SR runs below.

Save a Develop preset named CHR249 Neutral with all these settings, or create baseline virtual copies. Apply that same neutral state before EVERY run. Change ONLY the values specified in the run sheet. Do not accumulate adjustments between runs. Any controls unavailable for TIFF should be noted rather than substituted.

## Export settings for every run

TIFF; **16 bits/component; sRGB; compression None or ZIP; HDR output off**. Image sizing: **Resize to Fit unchecked**. Output Sharpening: **unchecked**. Watermark: off. Metadata: **All Metadata**. Export to the exports subfolder, using the exact filename from runs.csv. Resolution 240 ppi is fine: with resizing disabled it does not change pixels. Regular outputs must remain 2048×1536; Super Resolution outputs 4096×3072.

## Runs (20 exports total)

Export baseline copies of all five inputs first (five files ending __baseline.tif). Then reset to CHR249 Neutral before each:

| Input | Filename suffix | Change only |
|---|---|---|
| 01_edges_frequency | __sharp_base | Amount 40; Radius 1.0; Detail 25; Masking 0 |
| 01_edges_frequency | __sharp_detail0 | Amount 40; Radius 1.0; Detail 0; Masking 0 |
| 01_edges_frequency | __sharp_detail100 | Amount 40; Radius 1.0; Detail 100; Masking 0 |
| 01_edges_frequency | __sharp_radius2 | Amount 40; Radius 2.0; Detail 25; Masking 0 |
| 01_edges_frequency | __sharp_mask75 | Amount 40; Radius 1.0; Detail 25; Masking 75 |
| 02_luma_chroma_noise | __nr_luma25 | Luminance 25; Detail 50; Contrast 0; Color 0 |
| 02_luma_chroma_noise | __nr_luma50 | Luminance 50; Detail 50; Contrast 0; Color 0 |
| 02_luma_chroma_noise | __nr_color25 | Luminance 0; Color 25; Color Detail 50; Smoothness 50 |
| 03_fibres_texture | __texture_p25 | Texture +25 |
| 03_fibres_texture | __texture_m25 | Texture -25 |
| 03_fibres_texture | __clarity_p25 | Clarity +25 |
| 04_atmospheric_veil | __dehaze_p25 | Dehaze +25 |
| 04_atmospheric_veil | __dehaze_m25 | Dehaze -25 |
| 01_edges_frequency | __sr2x | Enhance: Super Resolution ONLY; all Develop settings neutral |
| 03_fibres_texture | __sr2x | Enhance: Super Resolution ONLY; all Develop settings neutral |

For SR use Enhance on a separate neutral original/copy, then export the enhanced image with resizing disabled. If unavailable, skip the two SR runs and note the message. Do NOT apply standard upscaling instead. AI Denoise and Raw Details are not tested by these TIFFs: genuine supported sensor RAWs are needed later.

Please return the exports folder plus versions.txt and, if practical, the saved CHR249 Neutral .xmp preset or screenshots of its Develop settings. Avoid JPEG conversion or resizing during transfer. The five neutral exports let us separate Lightroom's baseline colour/transfer changes from each individual effect.

## Reproduce and validate

Run `python tools/fixtures/create_chr249_references.py --output <folder>` (numpy, Pillow and tifffile required). The generator rereads every TIFF and asserts exact pixels. Generated files belong in ignored test/output; the generator and this run sheet are versioned.

Adobe references:
- https://helpx.adobe.com/lightroom-classic/desktop/export-photos/export-files-disk-or-cd.html
- https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/enhance-details.html
