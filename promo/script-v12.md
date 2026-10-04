# Chromasmith — Square One Ep 1 "Old vs New" — v12

v12 builds on v11 (see `script-v11.md` for the full beat sheet and the reasoning behind the style). Same structure, 82 s, 16:9,
48 fps. Build: `promo/video/motion-cut/`. `bake.mjs` renders the photo through the real app, `index.html` is the film,
`render.mjs` captures frames at 48 fps, `finish.sh` encodes them, and `../make-v12-audio.py` writes the score.

## The user's v11 notes, and what changed

| # | Note | v12 |
|---|---|---|
| 1 | Logo is wrong | The lockup and the app's top bar now use the "Faithful prism" mark from `design/logo/chromasmith-logo.svg`: an ink block, then the red square on top with a prism gradient where they overlap. The app uses the dark variant (`#f2f0ea` block). |
| 1b | Square: flat accent when out, gradient when home | The square leaves the logo as flat `#ff3b1f` and gets its prism back only while docked: in the lockup at the start, in the app's logo at 25–27 s, and when it lands home at the end. |
| 2 | Music too sad | The felt-piano kit and sound effects are kept. From the snap back to red (21.6 s), a rising pickup leads into a hopeful I–V–vi–IV groove in A major at 112 BPM: eighth-note piano pulse, soft kick, shaker, offbeat claps. Its first downbeat lands on the app's pop. The drums drop out during the two close-ups so they can breathe. It resolves on A with a sparkle as the square docks. The old way keeps its dull, heavy contrast. |
| 3 | Captions blend into the black app | Captions are now paper (`#f2efe8`) with ink text, a red square bullet and a deeper shadow. |
| 4 | It's 133 looks | 133 everywhere, matching `LUT_META` on main. "+ 128 more looks" in the panel (5 shown). |
| 5 | Use the app's slider animation | Copied from `fxPaintSlider` and the Swiss Kinetic CSS. The square thumb rolls about its centre with the value (`(v−default)·6·200/(max−min)` degrees). The track span from the default to the value turns accent, the thumb fills accent once it's off its default, and a small dot marks the default. |
| 6 | 65mm grain | Film format 65mm (the app's default, finest format). Amount 0→40 so it stays visible. Re-baked through the app. |
| 7 | Toggle on, with the flip animation | Each section's toggle (Basic, Grain, Halation) is clicked on before its sliders move. The knob is an ink square that flips 90° about its bottom-right corner onto the accent fill, using the app's `cubic-bezier(.16,1,.3,1)` curve. |
| 8 | Bullets not aligned with the image | The benefit list is pinned to the shrunken app window. The first line's cap-top meets the window's top and the last baseline meets its bottom, with even spacing. Each line keeps a red bullet once the square has hopped on. |
| 9 | End line | "Raw Digital. Pure Film." builds word by word under the lockup. |

## 20 more improvements, applied

1. **48 fps delivery:** every hop, pop, roll and camera glide is twice as smooth (Reddit plays up to 60 fps). I tried a two-subframe 180° shutter first, but it double-exposed text on fast moves, so I dropped it.
2. **Brand colours:** the frames are pixel-exact (paper 242,239,232). The encode uses an explicit bt709 matrix and decodes within ±2 levels, which is the limit of 8-bit 4:2:0 video. There is no colour shift.
3. **Exact loudness:** two-pass loudnorm to −14 LUFS / −1 dBTP (v11 landed at −14.9).
4. **The app's motion curve** (`cubic-bezier(.16,1,.3,1)`) drives captions, headline words, toggles and the benefit lines.
5. **The cursor travels on gentle arcs** like a hand, but runs exactly along the track during drags.
6. **Hover before every click:** thumbnails get a light ring, tabs light up and Export brightens.
7. **Slider readouts turn accent while being dragged.**
8. **The default dot** appears on a slider once it has moved (an app detail).
9. **Look-name toast** on the photo after each look click, so the viewer knows what they're seeing.
10. **"133" counts up** as the first benefit writes on.
11. **One headline system:** every paper headline sits on the same top line at 76 px. Only the "Meet Chromasmith" reveal is bigger.
12. **Captions on a fixed offset** from the panel edge, plus a `plain` variant for the Before/After labels.
13. **Living holds:** every camera hold drifts in 1.5% and eases back out on the next move, so no frame is frozen.
14. **Whooshes** under every camera move.
15. **Pop sounds** for panels, windows, the dialog and captions. A two-tap **flip** for each toggle.
16. **UI sounds are panned** to where the cursor is on screen.
17. **The music turns exactly on the square's snap** back to red, and the groove's first downbeat lands on the app's pop.
18. **Real-app logo behaviour:** the prism lights up whenever the square docks in a logo, including the app's.
19. **Old-way friction:** a spinner, progress bars that stall and restart, and windows that desaturate.
20. **Reddit-safe captions:** the bottom-centre captions sit higher (y 930) to clear the player UI. Every caption arrives only while the square is resting.

## Rules kept from v11

- **Brand:** red `#ff3b1f`, ink `#111`, paper `#f2efe8`. The square is flat, never a cube or a fake 3D slab.
- **Real effects only:** every photo state is the real app (`applyUISnapshot` → `processToCanvas(getFXParams(), img, w, h)`) with the on-screen values: Light Exposure 0→12 then Contrast 0→10, Grain 65mm Amount 0→40 Size 3, Halation Amount 0→100 Radius 30 Shadow protect 20.
- **One place to look:** the square is always the control in use.
- **True claims only:** 133 looks, free, offline, full-resolution export, Mac/Windows/iOS/Android.
