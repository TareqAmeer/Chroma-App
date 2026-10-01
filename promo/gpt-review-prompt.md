You are a senior motion designer and product-marketing scriptwriter. Review and then rebuild a promo video for **Chromasmith**, a free photo app that edits photos with film looks entirely on your own device (gallery/library → studio/darkroom → film lab → export/print). It runs on Mac, Windows, iPhone and the web.

## Files I'm giving you
1. `promo/script.md`: the v4 script and storyboard (scene table, on-screen text, picture, motion device, sound per scene, plus research notes).
2. `promo/video/out/promo-16x9.mp4`: the current render of v4 (62s, 1920×1080, 30fps).
3. `promo/video/`: the Remotion project that renders it (`src/Promo.tsx` holds all the scenes; `src/theme.ts` holds the palette and easing; `src/ui.tsx` holds shared pieces; `make-sfx.sh` synthesises the sound effects; `public/` holds images, fonts, sound effects and music). Render with `npx remotion render src/index.ts Promo out/promo-16x9.mp4`.
4. Reference images and motion in `promo/moodboard/`:
   - `sheet_1..3.jpg`: frames every 0.5s from a Swiss-style motion reference.
   - `konstruktive-grafik.gif`, `societe-radio.gif`, `tonhalle-quartett.gif`: animated Swiss posters.
   - `full screen but buttons pop up.png`: a "spotlight the active control" UI reference.
   - `motion-notes.md`: my notes on these.

## Step 1: Review (be blunt and specific)
- Watch the video and read the script. For **each scene**, say whether a first-time viewer with the sound off would understand what is happening and why it matters, and what to change.
- Does the whole film tell one clear story (problem → Chromasmith → demo → benefits → call to action)? Where does the story break?
- Judge the motion against real Swiss / International Typographic Style motion: grid, masks, hard cuts, typographic scale contrast, modular repetition, a planned beat "score". Name the scenes that feel like PowerPoint, stock templates or cheap mockups.
- Check text legibility at phone size, reading time per card, pacing, and how the sound effects and music fit the cuts.
- Compare it with strong launch videos (e.g. Apple product films, Raycast, Linear, Warp, Oura) and say what they do that this doesn't.
- List the top 15 changes in priority order.

## Step 2: Rebuild the video in the same Remotion project, following ALL of these requirements
**Story**
- The story must be easy to follow and make sense to someone who has never heard of the app. Name **Chromasmith** early, within the first ~15s, with a one-line promise. Don't hold it for the end.
- Problem: making a photo look like film usually takes **three apps (name them: Lightroom, Dehancer, Darkroom)** and several exports, and every export loses quality. Show this on the same photo, so viewers *see* the cost.
- Show the simplified workflow: one app, one export.
- The journey metaphor: too many photos, organised for you in the **library** → find the right one → take it to the **studio/darkroom (film lab)** → pick a look and print from **133 film looks** → add grain, glow (halation/bloom) and a border → export once at full resolution → **print it and hang it in a gallery**.
- **Show before and after photos clearly.**
- Show what the user saves: **time** (22 min → 2 min per photo), **money** ($83/month in subscriptions → $0), and **quality** (use the wording "Preserve full image quality").
- Show that it works on a computer, a phone and the web, on any device: **Mac, Windows, iPhone, web**. Make this look designed, not like cheap device mockups.
- End with a clear call to action: **Download free**, the platforms Mac · Windows · iOS · Web, and the URL `tareqameer.github.io/Chroma-App`.

**Look and motion**
- Use only the app's colour scheme: ink `#0b0b0a`, paper `#f2efe8`, mid `#c9c5bb`, dim `#8b877e`, line `#24231f`, accent red `#ff3b1f`, plus favourite-blue `#1238ff` only in the library. Font: Gramatika (in `public/fonts/`). The real logo is `public/img/chromasmith-logo-dark.svg`.
- Use **Swiss design motion** throughout: grid-locked moves, masked reveals, hard cuts and flat slides, ease-out timing, no bounce, no crossfades.
- **Text is central and large,** the thing the viewer reads, never small captions parked bottom-left. Animate it more, the Swiss way.
- No small top-left labels or chapter text. No app logo in the corner.
- Open with a **camera-shutter sound** and the photo shown **large but not full-screen**. No logo at the start.
- In the studio, **start with a real screenshot of the app** (`public/img/studio-*.webp`, `library.webp`), then move to a simplified, stylised version that explains each edit as it happens.
- The gallery/print ending must show the images at their **correct aspect ratios**, hung like a **museum** (shared centre line, mats, frames, gallery lighting, wall labels).
- Avoid: a "number of photos" stat with no meaning, flipping squares, laptop/phone stock mockups, and film-strip sprocket holes.

**Sound**
- Sound effects should match the beat of the video and land on the animations, with silence before the big moments.
- Add calm, not-too-exciting open-source background music. Current track: "Drifting Piano" by HoliznaCC0, CC0 (`public/music/`, credited in `CREDITS.txt`). Any replacement must be CC0 or similarly free for commercial use, with the source recorded.

**Format**
- First cut: 16:9, 1920×1080, 30fps. Make it **long enough to explain everything** (60–90s is fine); we will cut a shorter version later. Keep each scene a separate component so it can be trimmed later.
- Keep `promo/script.md` in sync: update the script and storyboard table to match what you build.

## Step 3: Deliver
- The updated `script.md`, the updated Remotion source, and a rendered `out/promo-16x9.mp4`.
- A short changelog that maps each of your top 15 changes to the scene it fixed.
- Any requirement you could not meet, and why.
