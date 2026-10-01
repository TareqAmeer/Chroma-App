# Chromasmith promo storyboard: "Gallery → Darkroom → Print"

16:9, 1920×1080, about 38s, music with burned-in captions and no voiceover.

## Visual system (taken from the homepage, `index.html`)
| Role | Value |
|---|---|
| Ink / background | `#0B0B0A` (bg), `#121210` (bg2), `#24231F` (line) |
| Paper / white boxes | `#F2EFE8` |
| Secondary text | `#C9C5BB` (mid), `#8B877E` (dim) |
| **Accent (the chosen photo)** | `#FF3B1F` |
| Second accent (Fav) | `#1238FF`, used sparingly |
| Type | Gramatika, small and lower-weight; one huge element per scene at most |

## Motion rules (from `moodboard/`)
- Text builds **one word at a time** and each word rises a few px as it settles (reference video).
- **Hard cuts** and **panels sliding in flat** only. No crossfades, blur or 3D.
- Moves **ease out** and last about 0.5s each, and nothing holds longer than about 1.5s.
- **Grid logic everywhere:** boxes snap to a 12-column grid.
- **Lines that draw, then retract** link the stages (Konstruktive Grafik): a single 8px paper/accent bar travels between scenes.
- **Rotating segments** recolour a shape in place (Société Radio-Canada), used for the film-look cycling.
- **Overlapping circles drifting** on a parchment field (Tonhalle) for the "print hung in a gallery" end frame.
- **Spotlight focus** (the "full screen" ref): the UI dims and the one active control lifts forward with an accent glow.

## Scenes

| # | Time | Stage | On screen | Caption (word-by-word) |
|---|---|---|---|---|
| 1 | 0.0–3.0 | Hook: before/after | Full-bleed photo, flat RAW. A paper bar wipes left→right and the graded version appears behind it. Hard cut. | *Before.* / *After.* |
| 2 | 3.0–7.0 | **Too many photos** | Black field. Paper-white boxes pop in on a grid at a fast rhythm: 4 → 16 → 64 → 256. The grid fills the frame. A counter in the corner rolls up like an odometer: 2,481 photos. | *Too many photos.* |
| 3 | 7.0–10.5 | **Organised for you** | The boxes slide into clean rows grouped by shoot, and thin labels type on (date, place, faces). Rejects drop to `#6B685F`, and favourites get a `#1238FF` corner tick. | *Organised for you.* |
| 4 | 10.5–13.5 | **Find the one** | Everything dims to `#24231F` except one box, which turns **accent red**. The camera pushes in until the red box fills a third of the frame. | *Find the one.* |
| 5 | 13.5–15.0 | **Flip** | The red box flips on its vertical axis (one flat flip, 0.4s). Its back face is the **raw photo**. | *(no text: beat)* |
| 6 | 15.0–24.0 | **The darkroom** | A real app capture (Playwright) frames the photo in the Studio. Each tool gets a spotlight-focus beat of about 1.5s: **Look** (thumbnail segments cycle colour like the radio-canada rings: Portra → Tri-X → CineStill) · **Grain** · **Halation / Bloom** · **Border**. A split line keeps a before/after visible during the whole scene. | *Pick a film.* / *Add grain.* / *Make it glow.* / *Frame it.* |
| 7 | 24.0–30.0 | **Simpler workflow** | Left: the old chain of 12 steps as small paper boxes in a row (Upload → Lightroom → Export → Dehancer → Export → Darkroom → Export…), each "Export" in dim. They collapse sideways into **one** accent box: *Chromasmith*. | *12 steps.* → *1 app.* *1 export.* |
| 8 | 30.0–34.0 | **Time · Quality · Money** | Three columns, each with a big number that rolls like an odometer from the old to the new value: **$83 → $0** /month · **22 min → [new] min** · **88% → 100%** quality. Small labels underneath. | *Save time.* *Keep quality.* *Keep your money.* |
| 9 | 34.0–38.0 | **Print & hang** | The finished photo shrinks into a paper-white print with a border and slides onto a parchment wall, beside 2 other prints. Soft circles drift behind (Tonhalle). End card: wordmark **CHRO-MA-SMITH** with the line "Gallery. Studio. Film Lab." and the URL, with a red dot as the full stop. | *Free. Offline. Yours.* |

## Assets
- Photos: `site/photos-src/` + `site/assets/homepage/` (before/after pairs already rendered for the homepage).
- App footage: Playwright at a fixed 1920×1080, dark theme, Studio tab, scripted look → grain → halation → border.
- Workflow numbers come from the homepage's Old/New Workflow sections (see the open questions below).

## Open questions before building
1. **Film look count**: the homepage says "100 film looks", "over 130 film presets" and "133 film looks", while the repo docs say 113. Which number goes on screen?
2. **New workflow time**: the homepage gives 22 min for the old workflow but no figure for Chromasmith. Use about 2 min, or leave it as "minutes → seconds"?
3. Is the music track already chosen, or should one be picked from a royalty-free library?
