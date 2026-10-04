# Chromasmith — Ep 1 v13 "Develop" (first pass)

The review and the 100 changes are in `video/REVIEW-v12-100.md`. Build: `video/motion-cut/`.
- `bake13.mjs`: real-app renders, up to 2400 px, multiple photos.
- `v13.html`: the film.
- `render.mjs --page=v13.html`: frame capture.
- `finish13.sh`: encode.
- `../make-v13-audio.py`: score.

Format: 16:9, 48 fps, 51.4 s = 24 bars at 112 BPM. Every cut sits on the beat grid.

**Idea:** the red square is a window onto the finished film. Wherever it goes, it shows the photo as the real app renders it.

| Bars | Time | Beat |
|---|---|---|
| 0–1 | 0–4.3 s | **Hook.** Raw beach, full-bleed, moving from frame 1: "Your RAW photo." The square drops in, opens into a window, and real looks flip inside it on every eighth note (Kodachrome 64, Tri-X 400, Vision3 500T, Velvia 50, Bleach Bypass, Aerocolor, Portra 400). On bar 2 it expands to full frame: **"On film."** |
| 2–3 | 4.3–8.6 s | **Brand.** The frame collapses back into a square carrying the photo, floods red, and docks into the prism logo. CHRO-MA-SMITH unpacks. "133 film looks for your RAW photos. **Free.**" |
| 4–6 | 8.6–15 s | **The old way.** IMPORT. EDIT. PLUGIN. EXPORT., one huge word per two beats, while app windows slam onto the square. "Every photo. Every time." The same groove runs through a closing low-pass filter. |
| 7 | 15–17.1 s | **The turn.** A held-breath beat, then the square punches out and the windows blast away. "One app." The square dives at the camera. |
| 8–10 | 17.1–23.6 s | **Infinite zoom** out of the app's own logo into the app; the filter opens. One look per beat on the photo, with the square as the selection marker. Paper chip: "133 looks. One tap each." |
| 11–13 | 23.6–30 s | **Grain.** 2.3× on the Texture panel: the toggle flips, Amount 0→40 at 65mm, with the square as the rolling thumb. Then a **2.5× loupe** over a 2400 px render (true pixels) travels from the man in the hat to the woman's face: real grain inside, clean photo outside. |
| 14–17 | 30–38.6 s | **Halation** on a rainy neon street. A floating Halation card (big enough to read on a phone): toggle on, Amount 0→100, then **Extreme** flips on. The A/B flips off/on twice on the beat. "Light that bleeds like film." |
| 18–19 | 38.6–42.9 s | **Every photo.** Four photos (two library, two placeholder); the square sweeps across each and develops it. |
| 20–21 | 42.9–47.1 s | **RAW vs FILM**, full-bleed. The square is the split handle, moved on the beat. |
| 22–23 | 47.1–51.4 s | **Free. Offline. 133 looks. No subscription.** One word per beat, with the square as the full stop. Mac · Windows · iOS · Android. The square docks, the logo builds: **"Raw Digital. Pure Film."** It loops back to frame 1. |

## Placeholder imagery
The user allowed internet imagery. It's listed in `video/motion-cut/web/CREDITS.md` (Unsplash License).
- **Neon street:** masahiro miyagi.
- **Golden-hour seashore.**

Library photos come from `site/assets/lib/full` (lib07, lib12, lib22), cropped inside their baked borders.
Every graded state is still rendered by the real app.

## Applied from the 100
- **Hook and first impression:** 1–3, 5–9, 12–15.
- **Story:** 16, 18, 20, 22–25, 28.
- **Readability:** 31, 32, 35–38, 40, 42–43.
- **Motion craft:** 46–48, 50, 56, 58, 61, 65.
- **Edit and rhythm:** 66–69, 72–73.
- **Brand:** 76–79, 82–83.
- **Proof:** 86–89.
- **Finish:** 94.

## Still open (next pass)
- **10:** loop polish, so the last frame matches the first.
- **11:** a 30 s cutdown.
- **27, 30:** an end CTA / URL.
- **51:** the camera leading the cursor; there's no cursor in v13 yet.
- **52–55:** hop timing variety and staggered panel builds.
- **57:** human-feel slider drags.
- **59 / 93:** four-subframe motion blur.
- **63–64:** beat-locked handle easing.
- **70–71, 99:** SFX hierarchy and stereo.
- **91:** RAW decoding shown.
- **92:** a resolution readout.
- **95:** finer slider ladders.
- **96–98:** text in screen space, layout rebuilds for close-ups, and safe-area checks.
- **100:** a 30 s cut and a poster frame.
