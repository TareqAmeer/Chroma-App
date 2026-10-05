# v13: is it good enough to share? No. Here's why, and the 50 changes in v14

## Verdict
v13 has the best ideas so far: the square as a window onto the film, the grain loupe, neon halation with Extreme,
and RAW vs FILM. But it's not shareable:
1. **It's too fast to follow.** Looks flip every 0.27 s, claims last 0.54 s, and several shots are under a second.
   A first-time viewer can't read or understand them.
2. **Text overlaps.** Exiting words are still on screen when the next line arrives ("133 looks." over "Offline"),
   and there are three caption styles fighting each other.
3. **The logo is wrong.** The prism gradient never renders. The mark's SVG gradients share IDs with a hidden copy,
   so Chromium paints the overlap flat, leaving a red square and a hairline instead of the lit prism.
4. **The old way says nothing.** Grey boxes and the words IMPORT / EDIT don't explain what the pain is: no photo,
   no files, no waiting.
5. **The first and last frames don't match** (it opens on a photo and ends on the lockup), so it doesn't loop.
6. **It lost v12's strengths.** The cursor-driven app with the real slider roll and toggle flip, which made the
   product understandable, is gone.

## v14 = v12's clarity + v13's spectacle, at a readable pace

### Pace and readability (1–12)
1. **Slower beats:** every shot lasts at least one bar (2.14 s); every caption at least 2.2 s.
2. **One piece of text at a time:** captions run through a single scheduler that refuses to build if any two overlap or one is under 2.2 s.
3. **No overlapping text:** an exit finishes before the next line enters.
4. **One caption system:** white on a photo (soft shadow), ink on paper, and a paper chip only on the dark UI. All at least 56 px.
5. **Hook look flips slow down** from 0.27 s to 1.07 s each, with the name large and steady under the window.
6. **Looks in the app:** one click per bar, not per beat.
7. **The slider drag** takes 2.2 s with the cursor, so the rolling square thumb can be watched.
8. **Halation holds on Extreme** for 3 s instead of flickering A/B.
9. **"Every photo":** cells develop one per half-bar, then hold.
10. **The RAW vs FILM handle** makes two slow sweeps, then holds.
11. **Claims build as a persistent list** beside a photo (v12's layout, aligned to the photo), not one word per beat.
12. **The end card** holds long enough to read the tagline.

### Story (13–24)
13. **Opens and closes on the identical lockup frame,** so it loops.
14. The square leaves the logo (prism → flat red), and the raw photo rises under it like a print from the tray.
15. The window keeps v13's intro, slowed: 4 looks, then the square opens to full frame: "On film."
16. **The final grade is punchier** (Kodachrome 64 + 65mm grain + halation) so "On film." is obvious, and the same grade is used all the way through.
17. **The old way is concrete:** four recognisable (unbranded) apps, each carrying the same photo: RAW Converter → Photo Editor → Film Plugin → Exporter.
18. **Each old-way app shows its real cost:** "Converting 1 of 12 · 4 min left", "Saving TIFF · 148 MB", "Rendering preview…", "Exporting 3 of 12".
19. The apps switch like apps (slide in/out), the photo stays in frame, and the square hops along and greys.
20. **One persistent headline** frames the old way ("This used to take four apps."); no per-step headlines.
21. The pile-up resolves into "And again, for every photo."
22. The turn keeps v13's punch-out + "One app.", then a cleaner dive.
23. **The app is cursor-driven again** (v12): look picks, Texture tab, Grain toggle flip, a slow Amount drag.
24. Halation is demonstrated on the floating card by the same cursor: toggle, Amount drag, Extreme.

### Brand (25–31)
25. **Fix the prism:** unique gradient IDs per instance, so the mark matches `design/logo/chromasmith-logo.svg` exactly.
26. The light variant on paper (ink `#111` block), the dark variant inside the app (`#f2f0ea` block).
27. The square goes flat accent the moment it leaves a logo, and gets the gradient back when it docks (as asked in v12).
28. **The infinite zoom fades the app in** as it pulls out, so there are no giant fragments of top-bar text.
29. The wordmark unpacks from behind the mark, and packs back the same way at the open.
30. Red stays reserved: the hero square, toggles, slider spans and the platforms line.
31. The tagline "Raw Digital. Pure Film." appears once, at the end, alone.

### Motion craft (32–42)
32. Arrivals use the app's own curve `cubic-bezier(.16,1,.3,1)`. Departures accelerate away. Only throws bounce.
33. App switches in the old way use a shared-axis slide (left out, right in), which reads as "another app".
34. The square's hops get longer and heavier as it greys (old way), and quick and light after the turn.
35. The cursor travels on arcs, dips on press, and leaves a red ring.
36. Camera moves happen only between bars, and holds drift 1.5% so frames never freeze.
37. The loupe arrives with a scale-in and travels slowly over the grade, from skin to hat.
38. Neon: a slow 6% push towards the lantern across the whole section.
39. The split handle eases with the app curve and holds at least half a bar.
40. The cells rise into place staggered, and the develop sweep follows the square.
41. List bullets: the square lands first, then the line writes on beside it.
42. There are no sub-second shots anywhere, and the build fails if one appears.

### Sound (43–46)
43. The same hopeful 112 BPM groove as v12/v13, now 41 bars, with a softer intro under the logo.
44. The old way is low-passed and opens on "One app." (kept from v13).
45. One click per real click, a flip per toggle, detents under drags, and a single riser into "On film."
46. −14 LUFS / −1 dBTP, two-pass.

### Craft and verification (47–50)
47. A caption-overlap and minimum-duration check runs at load, and a bad timeline throws.
48. A first-frame / last-frame pixel-equality check runs after render.
49. A contact sheet at 1 fps plus full-size frames of every scene, reviewed before shipping.
50. Every graded image is still the real app's render (`bake13.mjs`); placeholders are credited in `web/CREDITS.md`.
