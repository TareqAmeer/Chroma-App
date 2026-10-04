# Reference review (three Claude launch films) + 50 improvements

Frames pulled automatically (`refs/grab.sh`: yt-dlp download → ffmpeg, 64 evenly spaced frames per film → one contact sheet each).

## What each reference does
**Meet Claude Slides, Design and Docs (95s)**: warm off-white canvas. A large headline animates word by word, with inline product chips sliding into the sentence. The real UI is rebuilt as crisp vector panels, and a cursor actually drives it: clicking, picking from menus, dragging, selecting text. The camera zooms into whatever region is being used, then pulls out. Hard cuts happen on actions. The ending is a tagline written as if typed and edited live ("Claude makes it. You steer it."), then the wordmark.

**Introducing Claude Opus 5.5 (20s)**: one shape (a curved horizon) is match-cut across scales: the Earth's limb, a desert planet, cells, grains. The surfaces are macro and organic, warm-to-cool. One serif phrase is split across shots ("There's / more to / discover"). It has visible film grain, slow drift and no UI, and ends on the name and then the logo.

**Introducing Claude Sonnet 5.5 (13s)**: the same idea built from analogue instruments: a VU meter, metronome, pen, dial, gas flame, gauge. Every shot is a macro on an arc with shallow depth of field, tactile and real. Each is held about 1s, ending on the name over a window to Earth.

## What we were missing
Our cuts showed the product as flat pictures. These films show either the *interaction* (Slides) or the *feeling* (Opus/Sonnet), never a screenshot glued to a slab.

## 50 improvements
### Ep 1 (Slides style): handed to its own session
1. Off-white canvas, big headline type that builds word by word.
2. Inline chips: "Looks", "Grain", "Halation" slide into the sentence as tokens.
3. Rebuild the app UI as vector panels, not screenshots.
4. A real cursor drives every change: click, drag, toggle.
5. Sliders move, and the photo updates from the real app render.
6. Grain shown at 100% crop, rendered by the app, never painted on.
7. Halation: drag Amount; the glow comes from the app.
8. The camera zooms into the control in use, then out to the whole UI.
9. Panels pop in with soft shadows and a slight overshoot.
10. Cut on the action (the click), not on a timer.
11. The square stays a flat square: a cursor-like hero, not a cube.
12. Old way told in about 6s with the same UI language, greyed and slow.
13. Library: thumbnails reflow into a grid as tags are clicked.
14. Export: a progress ring and a full-res number counting up.
15. Typed-and-edited tagline on the end card.
16. Wordmark CHRO-MA-SMITH on the end card.
17. 40–60s first cut, trimmed later.
18. Sound: soft UI clicks on every cursor action, the felt-piano bed kept.
19. Every claim checked against the app (113 looks, free, platforms).
20. Contact-sheet review of each beat before the full render.

### Halation film (Opus style): built in this session
21. One recurring shape, the arc, match-cut across scales.
22. Planet limb → filament → film cross-section → photograph.
23. Open with halation **off**: a hard, digital edge.
24. Turn it on and the glow blooms as the slider moves.
25. All glow comes from the real app (`processToCanvas`), never baked in.
26. The cross-section explains the physics: blue, green and red layers, base, remjet.
27. Remove the remjet on screen, then light bounces back through the red layer.
28. Copy is short and split across shots.
29. Centred, single-line type, regular weight.
30. Slow camera drift, no cuts mid-move.
31. Dark grounds so highlights carry the frame.
32. App grain at a low setting so it reads as film, not noise.
33. Real photo with bright highlights against dark (canal at sunset).
34. Portrait photo at native resolution, edges feathered (no rim glow on the frame edge).
35. The slider panel matches the app's real labels (Amount, Radius, No remjet, White glow).
36. Panel values track exactly what's applied each frame.
37. B&W beat with White glow on.
38. Avoid over-cooking (no-remjet flooded the photo red, so it's capped).
39. End on the CHRO-MA-SMITH lockup.
40. 32s length, Opus-like pacing.
41. Ambient felt-piano score, swell on the bloom.
42. A sound hit on the remjet removal and the red bounce.
43. Slider detent ticks while Amount moves.
44. −14 LUFS mix.

### Pipeline (both films)
45. Automated reference capture (download → frames → sheets) instead of manual review.
46. Base frames rendered with no effects; effects applied by the app per frame.
47. A per-frame params file drives both the app and the UI overlay, so they can't drift.
48. Text and UI composited after the app pass, so they stay crisp.
49. One command per stage (render → appfx → finish), each re-runnable.
50. Preview mode at 6–12 frames for fast iteration before a full render.
