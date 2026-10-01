# Chromasmith promo: script v4 (for approval before any build)

**What v3 got wrong:** it never said what the app *is* until the last card. It showed numbers with no context ("2,481 photos") and showed the old workflow as boxes with no reason to care. The fix is to tell the story in plain sentences that make sense when read on their own, name the app early, and show everything on one photo.

## The story in one paragraph (the test: it should make sense read aloud)
> Every photo comes off the camera flat. Making it look like film usually means three apps and four exports, and each export costs a little quality. **Chromasmith** does it all in one app, on your own computer. Pick a photo from your library, choose one of 133 film looks, add grain, glow and a border, and export once at full resolution. It runs on Mac, Windows, iPhone and the web. Your photos end up ready for the wall. Download it free.

## How this compares to launch-video scripts
The usual six beats are **hook → problem → reveal → demo → benefit → CTA**. The product is named at the *reveal*, which comes around 3–20s into a 60s video, not at the end. 73% of viewers drop off before the 15-second mark, so the name and the one-line promise have to land before then ([Hera](https://hera.video/templates/product-launch-video-script), [ContentBeta](https://www.contentbeta.com/blog/product-launch-scripts/), [LunaBloom](https://blog.lunabloomai.com/product-launch-video/)). Raycast, Linear and Warp all show the real product within seconds ([moonb](https://www.moonb.io/blog/product-launch-video)).

| Beat | v3 | v4 |
|---|---|---|
| Hook | photo, no context | photo + "Every photo comes off the camera flat." |
| Problem | 12 abstract boxes, "2,481 photos" | the *same photo* passes through 3 apps and visibly degrades with each export |
| Reveal (product named) | never named until 60s | **"Chromasmith" at ~12s** with the one-line promise |
| Demo | screenshots + cards | the same photo being edited, one action per card |
| Benefit | counters | three plain sentences with numbers in context |
| CTA | logo + platforms | name + "Download free" + platforms |

## Script (≈60s @ 90 bpm, one beat = 0.67s)
Text cards are centred, 3–6 words each, and stay on screen for at least 0.3s per word plus 0.5s. **Bold** marks the word set in accent red.

| # | Time | On-screen text (exact) | Picture | Swiss motion device | Sound |
|---|---|---|---|---|---|
| 1 | 0–2.5 | none | Silence, then the flat RAW beach photo lands at 70% width | hard cut on the shutter | camera shutter |
| 2 | 2.5–5 | Every photo comes off the camera **flat**. | Photo slides up along the grid; the line rises from behind a baseline mask | masked text rise | music enters, very low |
| 3 | 5–8 | Making it look like **film** | Line 1 holds; line 2 pushes in from the right on the same baseline | words pushing on a baseline | |
| 4 | 8–11 | usually takes **three** apps. | Three app names (Lightroom · Dehancer · a border app) set as a type column; the photo steps through them | modular column shift | three soft clacks |
| 5 | 11–14 | and every export loses **quality**. | The same photo, exported four times: each "Export" stamp adds visible compression blocks; a thin bar falls 100 → 88% | repetition with progressive change (Basel "minimal shifts") | pen strike per export |
| 6 | 14–17 | **Chromasmith** does it in one. | The three columns slide shut into one; the wordmark resolves on the grid; the photo comes back clean | grid columns collapsing | 0.3s silence, then low tone |
| 7 | 17–19 | On your computer. Nothing **uploaded**. | Photo sits on a dark field; small lock-free "local" label | text only | |
| 8 | 19–23 | Open your **library**. | Real Library screenshot; camera pushes onto the beach photo; cursor click | camera push + click ring | click |
| 9 | 23–28 | Choose from **133** film looks. | Real Look panel; looks cycle on the photo (Portra → Tri-X → CineStill) | split panel wipe per look | film-advance per look |
| 10 | 28–32 | Add film **grain**. | Close-up of the grain slider being dragged; 1:1 crop of the photo shows the grain | scale jump: window → 1:1 crop | grain hiss |
| 11 | 32–36 | Make the highlights **glow**. | Halation/Bloom sliders, before/after split on the photo | vertical split moving along the grid | swell |
| 12 | 36–39 | Add a **border**. | Border toggle click; the photo gains its paper border | frame drawn as four lines | paper slide |
| 13 | 39–42 | Export once, at full **resolution**. | Export button click; "6000 × 4000" label | type scale shift | camera shutter |
| 14 | 42–48 | Save **$83** a month. / Save **20 minutes** a photo. / Lose **no** quality. | One sentence per card; the number does the moving (rolls in on a mask) | typographic scale contrast | soft ping per card |
| 15 | 48–53 | On **Mac**, Windows, iPhone and the web. | One photo stays centred; the *frame around it* changes shape on the grid: desktop window → phone → browser tab. Flat outlines in `--line`, no device renders. Each platform word lights red in turn | single shape morphing on the grid | tick per platform |
| 16 | 53–57 | **Ready** for the wall. | Museum wall (see below) | slow lateral camera move | room tone, footsteps-free |
| 17 | 57–62 | **Chromasmith**. Download free. / Mac · Windows · iOS · Web / URL | The logo's two squares slide in on the grid and overlap; text below | modular squares | music resolves; one tone |

## Changes the user asked for
- **No top-left chapter text.** Removed entirely.
- **No "2,481 photos".** The pile of photos was cut; the problem is now three apps and lost quality, shown on the same photo.
- **The old way is understandable.** The viewer *sees* the photo get worse with each export instead of reading box labels.
- **The app is named at 14s,** not 60s.
- **More text animation, done the Swiss way.** Not bounce or scale-pop but these, taken from the Basel School "score" method and kinetic-identity practice ([swissinfo](https://www.swissinfo.ch/eng/culture/flicker-form-future-how-swiss-design-learned-to-move/91568360), [Mitch Paone](https://mitchpaone.substack.com/p/time-is-the-material-from-motion), [FEVR](https://wearefevr.com/the-influence-of-swiss-design)):
  1. **Masked rise:** each line rises from behind an invisible baseline, so it is cut, not faded.
  2. **Baseline pushing:** a new word slides in on the same baseline and shoves the previous words along.
  3. **Scale contrast:** one word in a sentence jumps to 3× size while the rest stay put.
  4. **Column modules:** text and images move only in whole grid columns (12 columns, 24px gutter), so every move lands on a line.
  5. **A written score:** the timing for every element is planned on a beat chart (like a musical score) before animating, which is the Basel method. Everything lands on the 90 bpm grid.
- **Square/flip animation removed.** It is replaced by grid-column wipes, where the photo is revealed in 12 vertical strips staggered by 1 frame each. That is a true Swiss modular reveal.
- **Devices (scene 15) restyled.** No mockup renders. One photo stays put while its *frame* changes shape on the grid, drawn with thin flat lines, and the platform names are set as type. It's cheaper to make and reads as design, not stock.
- **Museum ending (scene 16).**
  - Off-white wall, prints at their **true aspect ratios** (beach 3:2, others as shot).
  - All prints hung on one shared **centre line**, as galleries do. Wide passe-partout mats, thin black frames, soft shadows below.
  - A warm **spotlight pool** above each print, and a small **wall label** beside each one, for example "Brighton, 2026 / Portra 400 · grain 34 · halation 28". The label quietly ties the print back to the edit.
  - A slow camera drift along the wall at a constant speed, with no zoom.

## Music
A calm, minimal track that is CC0 (no attribution needed), about 80–95 bpm, piano or soft synth pads with no drums, mixed about 18 dB under the sound effects. The candidates to audition are below. I'll pick one only after you approve, and I'll download it only after asking.
- [HoliznaCC0 — "Background Music" album](https://freemusicarchive.org/music/holiznacc0/background-music) (Free Music Archive, CC0)
- [SoundSafari CC0-1.0 music corpus](https://github.com/SoundSafari/CC0-1.0-Music) (public domain)
- [Erokia — ambient piano loop, CC0](https://freesound.org/people/Erokia/sounds/387588/) (Freesound)

The 90 bpm pulse will be dropped once music carries the rhythm, so the cuts follow the track's beat instead.

## Open questions
1. Is "Lose **no** quality" OK, or should it be "Keep **100%** quality"?
2. Should the old-way apps be named on screen (Lightroom, Dehancer)? Naming them makes the problem clearer, but it is comparative advertising. The alternative is "an editor · a film plugin · a border app".
