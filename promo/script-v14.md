# Chromasmith — Ep 1 v14 (v12 × v13)

The review of v13 and the 50 changes are in `video/REVIEW-v13-50.md`. Build: `video/motion-cut/`.
- `v14.html`: the film.
- `render.mjs --page=v14.html --out=frames14`: frame capture.
- `finish14.sh`: encode.
- `../make-v14-audio.py`: score.

Format: 16:9, 48 fps, 87.9 s (41 bars at 112 BPM). It opens and closes on the same lockup frame, so it loops.
Every caption runs through one scheduler: one caption at a time, at least 2.2 s each, and the next one only after the
last has left. The page refuses to load if that's broken.

| Time | Picture | Caption |
|---|---|---|
| 0–0.75 | The CHRO-MA-SMITH lockup (prism mark), identical to the last frame | — |
| 0.75–2.2 | The square leaves the logo (prism → flat red), and the wordmark slides back behind the mark. The raw beach photo rises full-bleed; the square comes to camera and lands | — |
| 2.3–7.3 | The square opens into a window; real looks show inside it for 1.07 s each (Tri-X 400, Vision3 500T, Velvia 50, Bleach Bypass), each name under the window | "Your RAW photo." → "133 film looks." |
| 7.3–10 | The window expands to full frame: Kodachrome 64 + 65mm grain + halation (real app render) | "On film." |
| 10–23 | **The old way.** Four plain, unbranded apps carry the same photo, each for 3.2 s: 1/4 RAW Converter ("Converting 1 of 12 · 4 min left"), 2/4 Photo Editor ("Saving as TIFF · 148 MB…"), 3/4 Film Plugin ("Rendering preview…", tiles filling in), 4/4 Exporter ("Exporting 3 of 12…"). The square hops onto each title bar, heavier and greyer each time | "This used to take four apps." |
| 23–26 | The four apps pile onto the square | "And again, for every photo." |
| 26–30 | A held beat, then the square punches out red and the pile flies off. It dives at the camera | "One app." |
| 30–32 | Infinite zoom out of the app's own logo, with the app fading in | — |
| 32–41 | The cursor picks a look every 2.1 s (Tri-X, Vision3, Velvia, Kodachrome). The square is the selection marker | "133 film looks. One tap each." |
| 41–47 | Texture tab. The Grain toggle flips; Amount 0→40 at 65mm over 2.2 s; the square is the rolling thumb | "Real film grain, from the app's own engine." |
| 47–51 | A 2.5× loupe on the 2400 px render travels from the hat to the woman: real grain inside, clean photo outside | "True pixels at 2.5×. Real 65mm grain." |
| 51–62 | Neon street. The Halation card slides in; the cursor flips it on and drags Amount 0→100 (the square is the thumb), then flips **Extreme** on, held for 4 s | "Halation: the glow film gives light." → "Extreme, for the full glow." |
| 62–69 | Four photos rise into place; the square develops each one, half a bar apart, then holds | "Works on every photo." |
| 69–75 | RAW vs FILM on the neon street: the square is the handle, with two slow sweeps and holds | (RAW / FILM labels) |
| 75–81 | A claims list builds beside the neon photo, aligned to it: Free. · Works offline. · 133 film looks. · No subscription. · Mac · Windows · iOS · Android | — |
| 81–88 | The square hops home, the prism lights, and the wordmark slides out. The tagline fades before the final frame, so the last frame equals the first | "Raw Digital. Pure Film." |

The logo fix: every copy of the prism SVG now has unique gradient IDs (v13 shared them, so the overlap rendered flat).
Every graded photo is a real `chromasmith-22.html` render (`bake13.mjs`); the placeholders are credited in `motion-cut/web/CREDITS.md`.
