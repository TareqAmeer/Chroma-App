# v12: a hostile review, 100 changes, and the v13 concept

The brief: make something that stops a Reddit scroll, tells a story, and convinces people to download the app.
I reviewed v12 from dense contact sheets (2 fps over the first 12 s, then 0.5 fps) and full-size frames.

**Verdict:** v12 is a tidy product walkthrough, not a Reddit video. It opens on 4 s of a small static logo on
beige, waits 27 s before showing the product, spends most of the screen on a dark UI with small text, and its two
"wow" effects (grain, halation) barely read at feed size. A scroller decides within about 1.7 s. v12 gives them
nothing in that window.

## What the research says (and what v12 ignored)
- **The hook is the first 2–3 s.** Mobile viewers scroll past within about 1.7 s, and most watch with the sound off.
  ([Segwise, video ad hooks](https://segwise.ai/blog/video-ad-hooks-drive-conversions))
- **Length:** 30–60 s is the sweet spot, and the median top performer is about 37 s. v12 is 82 s.
- **Readable captions:** about 2–3 words per second of screen time.
  ([Movidmo](https://movidmo.com/blog/15/5-tips-for-using-captions-in-video-ads))
- **Kinetic type works when motion reinforces meaning.** Scale words up to fill the frame for tension, keep a strict
  baseline grid, and use a restrained palette (black on warm cream, which is literally our brand).
  ([Abduzeedo, kinetic typography](https://www.abduzeedo.com/kinetic-typography-motion-design-words-move-bodies))
- **The transitions that read as "designed":** match cut, infinite zoom through a frame, mask/morph, and the hard cut
  on the beat. ([School of Motion](https://schoolofmotion.com/blog/six-essential-motion-design-transitions-tutorial))
  v12 uses none of them; it only pans a camera around one layout.
- **Springs:** critically damped for things that just arrive, a little bounce only where there is momentum
  (a flick or a throw). ([Apple-style motion notes](https://mcpservers.org/vi/agent-skills/emilkowalski/apple-design))
  v12 overshoots everything, including captions.

## 100 things to change

### Hook and first impression (1–15)
1. The first frame is a small logo on beige. It should be the most striking image in the film: the photo, full-bleed.
2. Show the payoff (raw → film) inside the first 2 s, not at 64 s.
3. The logo intro (0–3 s) is a scroll trigger. Move the brand to after the hook.
4. "You shot something beautiful." is generic, and it's wrong too: the photo on screen is flat and unappealing.
5. The raw photo appears at 750 px wide on a big empty canvas. Go full-bleed.
6. The square is 56 px on a 1920 frame, so it's invisible on a phone feed. The hero needs presence in the hook.
7. Nothing moves for the first 1.3 s. Motion has to start on frame 1.
8. There's no sound-off hook: the first caption arrives at 3.2 s.
9. The opening has no promise. Say what you get ("RAW → film, in one app") inside 2 s.
10. Reddit loops autoplay. v12's loop point (lockup → lockup) is boring. Loop on the photo instead.
11. Total length of 82 s is double the median performer. Target about 50 s, with a 30 s cutdown possible.
12. The hook never names the category (film looks / film emulation), so a scroller can't tell if it's for them.
13. "Free" appears only at 74 s. Free is a hook-level fact.
14. The first cut lands at 7 s. That's too slow; the first change should come within 1 s.
15. The old-way section opens at 7 s, so the problem comes before any desire for the product. Show the desire first.

### Story (16–30)
16. The old way runs 7–20 s (13 s) on small grey windows. Compress it to about 6 s of big kinetic type.
17. The old-way windows are about 300 px on screen with 14 px text: unreadable on a phone.
18. "Four apps for one photo" is a claim with no stakes. Make the cost felt ("Every edit. Every time.").
19. The turn ("Meet Chromasmith") is a headline on an empty beige screen: no transformation, no spectacle.
20. The app arrives with a pop-scale. It should arrive through a signature transition (an infinite zoom through the square).
21. Feature beats are serial and identical in shape (tab, toggle, drag, chip). The rhythm gets predictable by the third.
22. There's no escalation. Grain and halation get the same treatment as exposure, but they're the differentiators.
23. Exposure and contrast are generic (every editor has them). Cut that beat and spend the time on film-specific magic.
24. Export is shown as a dialog with a progress bar, the least interesting thing an app does. Make it a 2 s button.
25. The before/after wipe comes at 64 s; by then most people have left. The comparison belongs in the hook.
26. The benefits roll is a static bullet list that reads like a slide deck.
27. The ending tagline appears under a small lockup with no build-up.
28. The story never shows *different* photos, so it can't prove the looks generalise beyond one beach.
29. The square has no arc in the new-way section. It just hops between controls; its personality vanishes after 22 s.
30. There's no call to action ("Free download") at the end.

### Hierarchy and readability (31–45)
31. Paper captions now sit on top of the photo and cover the subject (the woman, the umbrella).
32. Panel text renders at about 13–21 px on a 1080 frame. On a phone that's about 6 px. Zoom in or enlarge the UI.
33. Slider labels and values are unreadable at feed size, so the viewer never sees the numbers change.
34. The tab rail is visual noise in every shot and is never the subject.
35. Halation close-up: the sliders are cut off at the frame edge and the thumb is off-screen, so control and effect are disconnected.
36. Grain close-up: at 2× on a 1600 px render, the grain is resampled mush. Show real pixels, 1:1 or larger.
37. Halation on the beach is subtle even at Amount 100. Use a subject built for it: bright sky behind dark silhouettes.
38. The five look thumbnails look nearly the same. Choose looks that differ (B&W, bleach bypass, Velvia, cross-process).
39. The look-name toast is 22 px at the photo's bottom-left, far from the cursor.
40. Headlines at 76 px on a 1920 frame look timid. Kinetic type should fill the frame.
41. The benefit bullets (37 px) are bigger than the cap height and fight the words.
42. The benefits sit beside a shrunken app showing an irrelevant Halation panel: dead pixels.
43. The bottom of the frame is empty during benefits (about 40% of the screen).
44. The top bar is cut off in every zoomed shot ("gallery studio" half-visible): sloppy crops.
45. There are three different caption treatments (headline, chip, plain) with no single system.

### Motion craft (46–65)
46. Everything uses the same ease-in-out. Ease choice should differ by intent: arrive, depart, impact, follow.
47. Overshoot on captions and panels feels cheap. Captions should arrive critically damped; reserve bounce for throws.
48. Camera moves are pans and zooms only; no shot uses a match cut, mask or morph.
49. Camera holds are long and static. The 1.5% drift is invisible, so frames still feel dead.
50. There's no use of scale for drama: nothing ever fills the frame.
51. The cursor is decoration. In a film like this the cursor should lead the camera, with the camera anticipating it.
52. Hop arcs all have the same timing (0.4–0.6 s) and height, so the character feels mechanical.
53. The squash and stretch amount is identical whatever the hop distance or speed.
54. There's no follow-through or overlap on UI elements: panels arrive as one rigid block.
55. Panel switches are instant opacity swaps. Use a staggered build (title, then rows).
56. The look change is a 0.3 s crossfade. A hard cut on the beat would be crisper and more confident.
57. The slider drag is a constant-ease 1.2–2 s move. Real hands accelerate, overshoot slightly and settle.
58. The old-way pile-up (windows falling) is slow and small; it should be a physical, satisfying collapse.
59. The 48 fps delivery has no motion blur at all, so fast hops strobe on some displays.
60. The camera never moves *with* the action (no tracking on the square), only between framings.
61. The square's flight path never interacts with type (landing on letters, pushing words).
62. Word-by-word headline reveals are uniform 0.12 s staggers. Group the words by meaning and rhythm.
63. The before/after handle moves on smooth easing without hitting music beats.
64. Benefit lines slide in 30 px from the right; that's a slide-deck transition.
65. The end lockup simply fades in. It should be built by the square (the square docks, then the type unpacks).

### Edit and rhythm (66–75)
66. Edits aren't locked to a tempo. Cut on the beat grid; v12's 112 BPM groove and its picture are unrelated.
67. The music starts at 21.6 s; the first 20 s run on sparse piano. The hook needs energy from frame 1.
68. The old way should be the *same* track low-passed (muffled), opening up on the turn. That's a classic filter-sweep cue.
69. There are no musical hits on the big moments (expand reveal, logo dock).
70. The sound effects all have the same loudness and pitch, so there's no hierarchy.
71. Whooshes are uniform noise. Pitch them to the move's speed and direction.
72. There's no silence or drop before the payoff. Use a one-beat drop before the reveal.
73. The look montage plays at 1 look per second. It could run at 1 per beat (0.54 s), or per eighth note in the hook.
74. The tail (76–82 s) is 6 s of almost nothing.
75. No beat is longer than about 6 s, yet nothing feels fast. The pacing is uniformly medium.

### Brand and identity (76–85)
76. **Bug:** the app's top-bar logo shows only the ink block whenever the square isn't docked, so the logo looks broken for 50 s.
77. The prism mark appears at feed size (about 70 px) only at the very start and end.
78. The square's "is the control" metaphor is clever but invisible at this scale. Make it read big at least once.
79. Red is used for UI fills, bullets, chips, sliders, buttons and the hero, so it's diluted. Reserve big red for the hero.
80. The cream canvas shows mostly as letterbox margins, not as a designed space.
81. Paper chips on a dark UI read as stickers, not as part of the system.
82. The wordmark never moves; kinetic type could make CHRO-MA-SMITH itself perform (the hyphens snapping in).
83. There's no signature visual moment a viewer would remember or screenshot.
84. Grey generic windows in the old way look like a wireframe, not like the pain of real tools.
85. The end card has no platform badges or URL; "Free · Mac · Windows · iOS · Android" is small red text.

### Product proof and honesty (86–92)
86. Only one photo is ever graded. Show the looks on several real library photos.
87. Grain needs a real 1:1 loupe on a 2400 px render (true pixels) to prove "real grain".
88. Halation needs a subject with hard highlights, an A/B toggle in the same frame, and the slider visible.
89. The before/after should compare the raw file with the full grade full-bleed, not inside a UI frame.
90. Claims shown are true but unprioritised. "Free" and "offline / private" are the Reddit-winning facts; lead with them.
91. RAW decoding (a key differentiator) is never mentioned or shown.
92. "Full-resolution export" is shown as a dialog; a resolution readout on the image would be stronger proof.

### Technical finish (93–100)
93. The 48 fps master has no motion blur. Render 4 subframes per output frame and blend them (2 ghosted text).
94. Baked frames are 1600 px wide; zooms past 1.2× go soft. Bake at 2400 px for close-ups.
95. Crossfading slider ladders between 7 renders makes the grain "breathe". Use more steps, or hold on discrete values.
96. Chromium text rendering at fractional zoom shimmers. Render type in screen space where possible.
97. Every close-up is a CSS scale of the whole world. Rebuild close-ups as real layouts sized for the frame.
98. The contact sheet is the only review tool. Add a per-shot safe-area and min-text-size check.
99. Audio: whooshes and clicks are mono-centred noise. Use stereo width and a proper limiter.
100. There's no 30 s cutdown and no thumbnail frame. Both are needed for Reddit (and a poster frame for autoplay-off).

## v13 concept: "Develop"

One idea carried by the square: **the red square is a window onto the finished film.** Wherever it goes, it shows
the photo as it will look. It's a loupe, a mask, a reveal and a progress bar, and every one of those
is the real app's output.

Everything is cut to a 112 BPM grid (one bar = 2.143 s). The track runs from frame 1, low-passed in the old way and
opening on the turn.

| Bars | Time | Beat |
|---|---|---|
| 0–1 | 0–4.3 s | **Hook.** Raw beach, full-bleed: "Your RAW photo." The square drops in and becomes a window. Inside it, real looks flip on every eighth note. On the downbeat it **expands to full frame** and the raw becomes film: "On film." |
| 2–3 | 4.3–8.6 s | **Brand.** The photo-filled square shrinks, turns red, and **docks into the prism logo**. CHRO-MA-SMITH unpacks letter by letter. "133 film looks for your RAW photos. Free." |
| 4–6 | 8.6–15 s | **The old way, as kinetic type.** IMPORT. EDIT. PLUGIN. EXPORT. Huge words, one per beat, slamming in as app cards pile onto the square. The music is muffled. "Every photo. Every time." |
| 7 | 15–17.1 s | **The turn.** The square punches out of the pile, red. "One app." **Infinite zoom** into the square, which is the app's logo, then out to reveal the app. The filter opens. |
| 8–10 | 17.1–23.6 s | **Looks.** A tight frame on the Look grid with high-contrast real looks. The square selects one per beat; hard cuts on the photo. |
| 11–13 | 23.6–30 s | **Grain.** A big toggle flip, then the slider rolls (seen at 2.5×). The square becomes a **loupe** over a 2400 px render: real 65mm grain at true pixels. |
| 14–16 | 30–36.4 s | **Halation.** A cut to a dusk pier (sky against posts). The loupe sits on the silhouette; the toggle flips off/on per beat. Real red glow. |
| 17–18 | 36.4–40.7 s | **Proof on more photos.** Four library photos, one look each, in square masks on the beat. "Works on every photo." |
| 19–20 | 40.7–45 s | **Raw vs film**, full-bleed. The square is the split handle, swept on the beat. |
| 21–23 | 45–51.4 s | **Claims, kinetic:** FREE. OFFLINE. 133 LOOKS. MAC · WINDOWS · iOS · ANDROID. Then the square docks into the lockup: "Raw Digital. Pure Film." Cut to frame 1 (loop). |
