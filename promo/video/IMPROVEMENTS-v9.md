# Ep 1 pilot (storyboard v8): 50 changes to stop it looking cheap

Based on a contact sheet of `out/ep1/ep1-16x9.mp4` (one frame per second) and `src/ep1/Ep1.tsx`. Not yet rendered or tested.

**The core problem:** the scene is "3D" only because CSS `perspective` tilts a flat board. Every object on it is a zero-thickness div with one flat colour and a blurred grey rectangle for a shadow. Nothing is lit and nothing has an edge, so it reads as a PowerPoint slide tilted on a table.

## A. Give things real depth (the hero first)
1. The red square becomes a solid block (about 24px thick) with lit side and top faces, not a flat card (`Hero`).
2. Squash and stretch apply to the whole block, so its sides bulge with it.
3. App windows get a visible slab edge (8–12px side face) so they read as objects lying on the board (`Card`).
4. The photo card gets a thin white print border and a paper edge, like a real print.
5. The logo's ink block gets thickness, so the red square docks *into* a solid slot.
6. Platform icons are extruded slightly (a stroke with a depth offset) instead of being hairline SVGs.

## B. Light and shadow (one consistent light)
7. Pick one key light (upper left) and derive every shadow offset from it. Right now the offsets differ (+20/+40, +0/+25%).
8. Two-part shadows: a tight dark contact shadow plus a wide, soft ambient one. At the moment there's one blurred box.
9. The shadow grows and softens with the hero's height when it jumps, so you can see it leave the board.
10. Each face gets a gradient lit from the key-light side; the `Box3` faces are all flat colours now.
11. A specular sheen sweeps across the red block when it lands on something important.
12. Every lifted card gets ambient occlusion: a darker band where it meets the board.
13. The `rgba(20,18,15,.14)` grey shadows become warm, multiplied shadows in the paper's hue (grey on cream looks dirty).

## C. Camera
14. Tilt changes stay under 10° between shots; the 14→26→16° snaps read as wobble.
15. Remove the roll (`roll` ±3–8°): Dutch tilts fight the Swiss grid.
16. Replace the 8-frame linear-weighted lag with a critically damped spring: smoother, no lurch.
17. Frame every caption fully. "Import in one app…" and "…edit in another…" are cut off at the bottom edge.
18. Keep the camera's horizon steady during each app window, so the grid lines don't swim.
19. The push-in to 104% during the pile-up (from the storyboard) isn't visibly there. Add it.
20. One snap push only, at "Meet Chromasmith"; tone down the other zooms (z 0.17 → 2.2 swings).

## D. Lens and finish
21. Real motion blur on fast moves (`@remotion/motion-blur` `CameraMotionBlur`, 180° shutter, about 6 samples).
22. Shallow depth of field: blur the far end of the tilted board (tilt-shift band via `backdrop-filter`) so the 3D reads instantly.
23. Paper texture on the board (subtle fibre noise); it's a flat `#e7e2d7` now.
24. Gentle vignette to hold the eye in the centre.
25. Fine film grain over the whole frame. On-brand for a film-emulation app.
26. The far-edge haze gradient has a hard top band. Use an exponential fade.
27. Bake the colour grade (slight warm highlights, cool shadows) into the final pass.

## E. The background clutter
28. Cut the 110 random floating solids to about 20; most are noise.
29. Put the remaining solids on grid intersections (the storyboard requires it; they're random now).
30. One material for all solids (paper-white with ink edges). The four beige tones look like stock clip-art.
31. Remove the solids that pass right in front of the lens. They block the subject (see the 4–5s frames).
32. Drop the "frame" outline squares spinning on X; they read as glitches.
33. Inside Chromasmith (dark world): replace the 30 brown tumbling cubes with a calm grid of dark tiles that light up in sequence.

## F. Type
34. Fix the wordmark tracking: −0.04em crushes "SMITH". Use the real logo SVG (`img/chromasmith-logo.svg`) or set it at 0.
35. Captions use the same −0.04em; open them up to −0.01em at 64–76px.
36. Captions sit on the board, but flat on a tilted plane they foreshorten into mush. Put them in screen space, flush left on the grid.
37. "You shot something beautiful." uses italic-looking skew from the tilt. Same fix as 36.
38. Captions hold at least 1.5s + 0.3s per word (some disappear mid-read).
39. Captions stay neutral ink, not each app's colour. Red and colour belong to the hero only (Swiss rule 3).

## G. The fake apps
40. The fake app windows look like wireframes. Add a hairline border, real UI type sizes and a toolbar.
41. Pastel window tints (blue/green/purple/yellow) make it look like a kids' app. Use greys with one accent per app.
42. The progress bars and sliders get real thumbs and tick marks.
43. "Export failed" gets a proper alert style, not plain text.

## H. Motion of the hero
44. Arcs use `EASE.move` on x but linear t on y. Use the same time base for both, or the peak drifts off-centre.
45. Rotation during flight follows the tangent of the arc, not a sine.
46. Each landing gets one frame of contact smear (directional blur) before the squash.
47. Vary the hop timings (10/12/9 frames, as the storyboard asks); they're identical now.
48. The portal (the red square filling the screen) needs an eased edge and a light flash, not a hard-edged square growing.

## I. Sound and finish
49. Run the −14 LUFS / −1 dBTP loudness check (the storyboard's done criterion; not done yet).
50. Length: the cut is 29s against the storyboard's 18s. Trim the holds in the app windows so it lands near 20s.
