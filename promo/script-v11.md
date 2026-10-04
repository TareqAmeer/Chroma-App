# Chromasmith — Square One Ep 1 "Old vs New" — v11 (motion-design cut)

**Format:** 16:9, 1920×1080, 24 fps, 82 s (built long so it can be trimmed later). One aspect ratio, for Reddit.
**Style reference:** Anthropic's "Meet Claude Slides, Claude Design and Claude Docs". Warm off-white canvas, big headlines that
build word by word, real UI rebuilt as motion graphics, a cursor that drives real interactions, a camera that glides into the
part of the UI being used, panels that pop in with soft shadows, quick confident beats, and an end card with the wordmark and a
short tagline.
**Build:** `promo/video/motion-cut/`. `bake.mjs` renders the photo through the real `chromasmith-22.html`, `index.html` is the
film, `render.mjs` captures the frames, `finish.sh` encodes them, and `../make-v11-audio.py` writes the score.

## Rules this cut keeps

- **Brand:** the wordmark is CHRO-MA-SMITH. Red #ff3b1f, ink #111, paper #f2efe8. There is no grade, vignette or post grain, so the colours stay exact.
- **The square is flat:** a flat red square with squash, stretch, tilt and hops. It is never a cube or a 3D slab, and no photo gets a fake thickness.
- **Motion design, not screenshots:** the app's panels are rebuilt as vector UI from `studio-1..6`: flat square slider thumbs,
  red/white toggles, the tab rail, and the red active-tab marker. Every control the viewer sees moving changes the photo.
- **Real effects only:** every photo state is a render from the app itself (`applyUISnapshot` → `processToCanvas(getFXParams(), img, w, h)`)
  with the same values shown on screen. Grain: Amount 0→30, Size 3, Film format 35mm. Halation: Amount 0→100, Radius 30,
  Shadow protect 20, with White glow, No remjet and Extreme off. As a slider moves, the film crossfades between neighbouring real renders,
  which share the same grain seed. Nothing is painted on in post.
- **One place to look:** the square *is* the thing being used. It becomes the app's logo, then the active-tab marker, the selected-look
  marker, the slider thumb the cursor drags, the export progress head, the before/after handle, and the bullet beside each benefit.
  Copy appears only while the square is resting and sits next to it.
- **True claims only:** 113 film looks, free, Mac/Windows/iOS/Android, works offline with nothing uploaded, full-resolution export.
- **Smooth camera:** eased moves only, with no shake and no weave.

## Script

| Time | On screen (copy) | Picture and motion | Square | Sound |
|---|---|---|---|---|
| 0–3 | — | The CHRO-MA-SMITH lockup on paper | Wiggles in its slot, then hops out | Open chord, tap |
| 3–7 | **You shot something beautiful.** (word by word) | The flat raw beach photo pops in with a soft shadow | Hops onto the photo's corner and leans in to look | Taps |
| 7–18 | **The old way: four apps for one photo.** | Camera pulls back. Four generic, unbranded windows (1 Import, 2 Edit, 3 Grain plugin, 4 Export) pop in. The photo shrinks into Import. Progress bars crawl: "Converting RAW…", "Rendering preview…", "Exporting 3 of 12…" | Each hop to the next app is heavier. It gets squeezed into a tiny slider thumb, greys and smears | Duller chords, heavier thuds |
| 18–21.5 | **Every change, another round trip.** | The windows fall into a pile and fade | Slumps flat and grey. Stillness, then a twitch | Silence, one heartbeat |
| 21.5–24 | **Meet Chromasmith** | Paper | Snaps back red, springs, and lands as the headline's full stop | Bright tap, swell |
| 24–26.5 | **One app. Raw file to finished film.** | The app (vector rebuild) pops in with a deep soft shadow | Hops into the app's logo slot | Big chord |
| 26.5–33 | Chip: *113 film looks. One click each.* | Camera glides to the Look panel. The cursor clicks Classic Neg → Portra 400 → Velvia → Eterna Bleach Bypass → A Beach Preset, and the photo changes each time (real LUT renders) | Becomes the red tab marker, then the selected-look marker that hops from thumbnail to thumbnail | Click per look |
| 33–39 | Chip: *Light: exposure and contrast.* | The cursor clicks the Light tab and drags Exposure 0→12, then Contrast 0→10 | The thumb the cursor drags | Slider detents |
| 39–50 | Chip: *Film grain from the app's own engine.* → *35mm grain, rendered by Chromasmith.* | The Texture tab. Grain toggle on. The Film format dropdown opens and 35mm is picked. Amount 0→30, then the camera pushes in 2× on the photo so the real grain is visible | The Amount thumb | Clicks, detents |
| 50–59 | Chip: *Halation: film's red glow on highlights.* → *It glows only around bright edges.* | Light › Halation. Toggle on. Amount 0→100 (Radius 30, Shadow protect 20, White glow / No remjet / Extreme visible and off). The camera pushes in on the umbrella and white skirt | The Amount thumb | Detents |
| 59–63.5 | Dialog: *Export · JPEG · Full resolution · Look, grain, halation baked in · Done.* | The cursor clicks Export and a dialog pops in | Rides the progress bar | Export-run ticks |
| 63.5–68 | *Before* / *After* | Camera on the photo. The cursor drags a wipe between the raw file and the finished frame | It is the wipe handle | Detents |
| 68–76 | **113 film looks. / Real grain and halation. / Offline. Nothing uploaded. / Full-resolution export. / Free · Mac · Windows · iOS · Android** | The app shrinks to the left and the benefits build on the right, one line at a time | The bullet, hopping down line by line just before each line writes on | One tap per line |
| 76–82 | **CHRO-MA-SMITH** · *Shoot digital. Finish like film.* | End card. The tagline fades before the last frame | Arcs home into its slot. The last frame matches the first, so it loops | Closing chord, tap |

Time split: old workflow ≈ 14 s (17%), new workflow ≈ 56 s (68%).

## 50 improvements over v10

### Story and structure
1. Most of the time now goes on the solution: about 56 s on the new way against about 14 s on the old.
2. Each feature gets a full beat, with the control, the change, the result and a one-line caption.
3. The film says what the app *does* (looks, light, grain, halation, export) instead of "one app".
4. The before/after wipe proves the whole result in one gesture.
5. A benefits roll lists the confirmed claims, one per line.
6. The film opens and closes on the same frame, so it loops cleanly on Reddit.
7. The old way stays short and is told spatially: four apps, heavier hops, crawling bars.
8. Old-way windows are generic and unbranded, never real competitor UI.
9. A low point (slump, silence, heartbeat) makes the turn feel earned.
10. "Meet Chromasmith" lands as a reveal, with the square as its full stop.

### Reading and following
11. The square is always the thing in use, so there is one place to look.
12. Captions sit next to the control being used, never across the screen.
13. Captions arrive only while the square is resting.
14. Only one caption is on screen at a time.
15. Headlines build word by word, so they are read rather than scanned.
16. Captions are 32 px or larger, in bold, on an ink chip, and readable on a phone.
17. There is no running header, timecode or chapter label.
18. Zoom-in captions sit bottom-centre, the one fixed spot, only during push-ins.
19. The cursor gives a press-dip and a red ring on every click, so actions read instantly.
20. The benefits bullet (the square) lands just before each line writes on.

### Motion design (after the reference film)
21. The real UI is rebuilt as vector motion graphics: panels, tabs, sliders, toggles and a dropdown.
22. A cursor drives real interactions: clicks, drags, and picking from a dropdown.
23. The camera glides into the region in use (Look grid, sliders, photo detail).
24. Panels and dialogs pop in with an overshoot ease and soft, deep shadows.
25. The warm paper canvas matches the brand and the reference.
26. Beats are quick and confident, and nothing holds longer than it needs to read.
27. The app's own design language is kept: a big panel title, red underline on the active sub-tab, flat square thumbs.
28. The active-tab marker *is* the square, a detail taken from the real app.
29. The selected-look marker is the square, as in the app's red corner tag.
30. The export dialog shows what is baked in, so the export step explains itself.

### The square
31. It is a flat square again, with no cube, bevel or 3D.
32. Anticipation squash before every hop.
33. Stretch in flight and a damped spring on landing.
34. A small tilt in the direction of travel.
35. In the old way it greys, smears and gets squeezed into a tiny thumb, so the friction shows on the character.
36. It slumps, twitches and snaps back red: the turn of the story.
37. Its size adapts to its job (lockup 68 px, thumb 16 px, logo 22 px) while staying a square.

### Real effects and honesty
38. Every photo state is rendered by the app itself through `processToCanvas`.
39. The grain is the app's grain (35mm, Amount 30), tuned down from v10's harsh look.
40. Halation is the app's halation, with the slider values shown on screen matching the render.
41. Slider moves crossfade between neighbouring real renders that share a seed, so the grain doesn't shimmer.
42. Exposure and contrast are baked separately, so each slider changes only what it claims to.
43. There is no post grade, post grain, weave or vignette, and the brand colours stay exact.
44. Claims match the brief: 113 looks, free, Mac/Windows/iOS/Android, offline.

### Camera and finish
45. The camera is smooth and eased, with no shake and no gate weave.
46. Push-ins are 2× at most, so the 1600 px renders stay sharp.
47. The film is 24 fps, x264 CRF 16, tagged bt709, and the paper stays #f2efe8.

### Sound
48. The v10 felt-piano score the user liked is kept, with the same instruments.
49. It is retimed to the new beats: a chord per tool, a click per UI click, detents under slider drags, and ticks for the export run.
50. It is mixed to −14 LUFS with a −1 dBTP ceiling.
