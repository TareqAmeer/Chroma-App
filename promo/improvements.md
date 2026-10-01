# Promo v3: 30 improvements

Sources: launch-video breakdowns of Raycast, Linear, Warp, Figma, Oura, Dyson and Pixel ([moonb](https://www.moonb.io/blog/product-launch-video)); Apple's kinetic type ([Optious](https://www.optious.com/apples-secret-weapon-kinetic-typography/)); Swiss style in motion ([GT3](https://gt3themes.com/swiss-style-in-motion-animation-in-international-typographic-style/), [FEVR](https://wearefevr.com/the-influence-of-swiss-design)); app promo structure and cursor guidance ([SmoothCapture](https://www.smoothcapture.app/blog/how-to-make-an-app-promo-video), [Tella](https://www.tella.com/features/zoom)); and the repo's own `site/animation-research.md` and `site/awwwards-motion-research.md`.

## Text: from "PowerPoint caption" to the thing you read
1. **Centre the words and show one idea per card.** Apple flashes words in one fixed place (rapid serial presentation), so the eye never travels and the message reads with the sound off. Text moves to the optical centre and is never parked bottom-left.
2. **Text and picture take turns.** When a statement is on screen it gets the frame to itself, and when the product is on screen the text is gone or reduced to a small functional label. Apple's reveal films hold one short statement in generous space, then let the footage prove it.
3. **Three to five words per card, set very large.** Use 140–220px headlines and drop the separate explanation line. The explanation becomes the next card, so a sentence plays across two or three beats.
4. **Make the type the motion.** Swiss style in motion animates the type on the grid: words slide along grid lines, cards split, a word scales to fill the frame. Typography is the main visual, not a caption.
5. **Use one fixed text anchor for the whole film.** Every card sits on the same centre line and baseline, which gives the steadiness of rapid serial presentation and the order of a Swiss grid.
6. **Mark the key word in accent red.** Only one word per card is red ("*one* export", "*133* looks"), so it reads before anything else.
7. **Give longer cards a reading floor.** Allow at least 0.3s per word plus 0.5s, so nothing disappears before it's read. This is the only rule allowed to slow the cut.

## Opening
8. **Start in silence with a black frame and a shutter sound.** The first sound is a camera shutter. The photo appears on that frame, large (about 70% of the width) on a dark field, not full-bleed, like a print on a table.
9. **Keep the first 3 seconds as one image with no text.** Retention is decided in the first three seconds, and the photograph is the hook. The first word arrives after the image has landed.
10. **Show before and after as one physical move.** Instead of a wipe across the whole screen, a paper strip slides across the framed photo, so the change is visibly the same picture being developed.
11. **No logo or brand in the opening seconds.** The brand appears once, at the end. Raycast and Oura both open on product or feeling, not identity.

## Story structure
12. **Problem → turn → proof → payoff**, the three-act shape the strongest promos share. Problem: too many photos and too many apps. Turn: one app. Proof: the edit, shown live. Payoff: the print on the wall plus the savings.
13. **Move the old workflow earlier.** The pain sells the product, so show "3 apps, 12 steps, 4 exports" before the studio, not after it. The studio then answers it.
14. **Follow one photo the whole way through.** The same beach photo travels from grid box to studio to print to wall. Spatial continuity (the same frame moving between chapters) beat scene resets in the Awwwards references.
15. **Number each chapter as part of the Swiss grid**: 01 Library, 02 Studio, 03 Print, in small numerals that also work as a progress index (Warp and Linear use labelled chapters).

## Showing a desktop app
16. **Use real footage of the app, with zoom on each click.** Desktop demos work when the camera pushes in on the control being used and a click pulse marks each click (Tella and FocuSee). Record the real Studio with Playwright and animate the camera, not the UI.
17. **Show a large cursor moving smoothly with a visible click ring.** Viewers need to see who is doing what. A default-size cursor disappears at 1080p on a phone.
18. **Crop the interface into dark fragments.** Raycast's teaser shows cropped pieces of the UI rather than whole windows. Show a slider, a film-look swatch and the export button as close-ups between the wide shots.
19. **Change scale on every shot.** Alternate between the full window, a close-up of one control and the photo filling the frame (`animation-research.md` point 4). Never show two shots in a row at the same scale.
20. **Use real labels as proof.** Show the actual film-look names, real slider values ("Grain 34") and the real export dialog showing the full pixel size. Functional labels prove authenticity, as in Raycast's "Getting active Linear Issues".
21. **Use the screenshot-to-simplified transition as an "X-ray".** The real app dims and the controls being used lift out into the simplified Swiss layout, which keeps the part you liked and links it to the real UI.

## Swiss motion language
22. **Every element snaps to a visible 12-column grid** that can flash on for a frame at chapter changes, showing the system behind it.
23. **Keep the palette strict:** ink, paper and one accent red. The favourite-blue appears only in the library, where it means something.
24. **Use hard cuts and flat slides, all eased out.** No crossfades and no spring bounce. Linear motion feels robotic, but ease-out reads as deliberate.
25. **Build geometric shapes from the logo.** The two overlapping squares (paper and red) are the transition device: the red square becomes the chosen photo, the paper square becomes the print, and the logo forms from them at the end.
26. **Swap counters for kinetic number cards.** "$83" fills the frame, gets struck through, and "$0" drops in. Time and quality get the same treatment, one number per card, centred.

## Sound
27. **Use foley from the real darkroom and camera world:** shutter, film advance, paper slide, print pinned to the wall, pen strike for crossed-out numbers. Every sound is tied to an object, not just a generic tick.
28. **Leave silence before the big beats.** Drop out for about 0.3s before the "one app" turn and before the logo. Contrast makes those moments land.
29. **Add a quiet low pulse as a click track.** A barely audible 90 bpm pulse that all cuts land on gives rhythm without music, and the sound effects sit on top.

## Ending
30. **Make the call to action its own centred card.** "Download free" is set large and centred, the four platforms build in one at a time (Mac · Windows · iOS · Web) on the grid, and the URL appears last. Hold it for 3s, longer than any other card, so viewers can act on it.

## Proposed v3 running order (~60s, then trim)
| # | Beat | Picture | Centre text |
|---|---|---|---|
| 1 | 0–3s | Black, shutter, beach photo lands at 70% width | none |
| 2 | 3–6s | Paper strip develops it: before → after | *Before.* / *After.* |
| 3 | 6–12s | Photo shrinks into one box of a grid that floods the frame | *2,481 photos.* → *Which one?* |
| 4 | 12–20s | Old workflow: 12 steps build, $ and time climb, quality falls | *3 apps.* *12 steps.* *4 exports.* |
| 5 | 20–23s | Silence, then all of it collapses into one red square | ***One*** *app.* |
| 6 | 23–28s | Library sorts itself and the red box is found and flips | *Find it.* |
| 7 | 28–44s | Real studio footage → X-ray → look, grain, glow, frame (zoom + cursor) | *Pick a film.* *133 looks.* *Add grain.* *Make it glow.* *Frame it.* |
| 8 | 44–50s | Print slides onto the wall | *Print it.* |
| 9 | 50–55s | $83 → $0, 22 → 2 min, 88 → 100% as single number cards | one number per card |
| 10 | 55–58s | Mac, phone, browser devices on the grid | *Edit anywhere.* |
| 11 | 58–62s | Logo forms from the squares, platforms, URL | *Download free.* |
