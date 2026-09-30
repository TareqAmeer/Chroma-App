<h1>Chromasmith</h1>

**The app that does it all.\* A whole photo studio, wherever inspiration finds you.**
<sub>\*ALMOST EVERYTHING. YOU STILL NEED TO TAKE THE PHOTOS.</sub>

Make a look in a click or take control of every detail. Chromasmith is a free photo studio with
113 calibrated film looks, real grain, halation and bloom, RAW development, masks and retouching,
a local photo library and full-resolution export — running entirely on your own device. No
account, no upload, no subscription. The web version is a single HTML file with no build step
and no server behind it.

**→ [Open the app](https://tareqameer.github.io/Chroma-App/app/) ·
[Product page](https://tareqameer.github.io/Chroma-App/) ·
[Mac download](https://github.com/TareqAmeer/Chroma-App/releases/latest)**

[![Export gate](https://github.com/TareqAmeer/Chroma-App/actions/workflows/export-gate.yml/badge.svg)](https://github.com/TareqAmeer/Chroma-App/actions/workflows/export-gate.yml)
[![iOS build](https://github.com/TareqAmeer/Chroma-App/actions/workflows/ios-ipa.yml/badge.svg)](https://github.com/TareqAmeer/Chroma-App/actions/workflows/ios-ipa.yml)
![Licence GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-d4903a)
![No build step](https://img.shields.io/badge/build%20step-none-52c97a)

<p align="center"><img src="site/assets/story/main6-1600.webp" alt="A beach photograph, finished in Chromasmith with a film look, grain, halation and a double film frame" width="100%"></p>

### From raw photo to finished frame

<table>
<tr>
<td width="33%"><img src="site/assets/story/main1-1600.webp" alt="Raw photo"><br><sub><b>1 · Raw photo</b></sub></td>
<td width="33%"><img src="site/assets/story/main2-1600.webp" alt="Edited"><br><sub><b>2 · Edit it</b></sub></td>
<td width="33%"><img src="site/assets/story/main3-1600.webp" alt="Coloured"><br><sub><b>3 · Colour it</b></sub></td>
</tr>
<tr>
<td><img src="site/assets/story/main4-1600.webp" alt="With grain"><br><sub><b>4 · Sprinkle some grain</b></sub></td>
<td><img src="site/assets/story/main5-1600.webp" alt="With halation and bloom"><br><sub><b>5 · Make it glow</b></sub></td>
<td><img src="site/assets/story/main6-1600.webp" alt="With a double film frame"><br><sub><b>6 · Frame it twice</b></sub></td>
</tr>
</table>

### A gallery for every shoot

Faces, pets, favourites and keywords are found for you, on your own machine. Click a photo to preview it, or try a filter.

<img src="site/assets/homepage/gallery.webp" alt="The Chromasmith gallery: a grid of photos with All, Tareq, Lucifer, Fav, Rejected and Beach filters" width="100%">

### A studio for every frame

Six tools, one editor: pick a look, shape the light and colour, add texture, then crop and frame for output.

<table>
<tr>
<td width="33%"><img src="site/assets/homepage/studio-1.webp" alt="Look panel"><br><sub><b>Look</b> · film presets and print</sub></td>
<td width="33%"><img src="site/assets/homepage/studio-2.webp" alt="Light panel"><br><sub><b>Light</b> · tone, curves, halation, bloom</sub></td>
<td width="33%"><img src="site/assets/homepage/studio-3.webp" alt="Colour panel"><br><sub><b>Colour</b> · mixer, wheels, point colour</sub></td>
</tr>
<tr>
<td><img src="site/assets/homepage/studio-4.webp" alt="Texture panel"><br><sub><b>Texture</b> · grain, sharpen, noise, masks</sub></td>
<td><img src="site/assets/homepage/studio-5.webp" alt="Output panel"><br><sub><b>Output</b> · crop, borders, film frames</sub></td>
<td><img src="site/assets/homepage/studio-6.webp" alt="Info panel"><br><sub><b>Info</b> · camera details, keywords, tags</sub></td>
</tr>
</table>

---

## Get it

| | How | Notes |
|---|---|---|
| **Browser** | [Open the app](https://tareqameer.github.io/Chroma-App/app/) | Nothing to install. Works offline after the first visit. |
| **Mac** | [Download the latest `.dmg`](https://github.com/TareqAmeer/Chroma-App/releases/latest) | Unsigned: **right-click → Open** the first time. Intel build; runs under Rosetta on Apple Silicon. Adds the photo library, card import, faces and local AI. |
| **iPhone / iPad** | Open in Safari → Share → **Add to Home Screen** | Or sideload the unsigned IPA from [Actions](https://github.com/TareqAmeer/Chroma-App/actions/workflows/ios-ipa.yml) with Flarestore / AltStore / Sideloadly. |
| **Android** | Open in Chrome → menu → **Add to Home screen** | Same app; the layout switches to a phone shell under 700px. |

Step-by-step instructions for each platform, in plain English, are on the
[product page](https://tareqameer.github.io/Chroma-App/#get).

## Highlights

- **One click is all it takes** — 113 film looks across Kodak, Fuji, cinema, instant, reversal and B&W, previewed live on your photo
- **Let the light linger** — grain, halation, bloom, dust, light leaks and film frames, each with room to be subtle or unmistakable
- **A studio for every frame** — curves, an eight-band colour mixer, lift/gamma/gain, masks, heal and clone, full-resolution export
- **A library for every shoot** — folders, culling, people and natural-language search, all on your machine (Mac app)
- **Works with no signal** — no account, no upload; the web app runs offline after the first visit
- **Beta, growing** — video grading, astro stacking and two-photo panorama

The [product page](https://tareqameer.github.io/Chroma-App/) has the full tour, with a directory of
every feature.

## What it does

**Looks and film**
- 113 film-look presets (Kodak, Fuji, cinema, instant, reversal, B&W), plus any `.cube` you own
- Kodak / Fuji **print profiles** applied after the film look, in the right order
- **Grain** calibrated per film format (8mm → 65mm), **halation** and **bloom** from a measured
  light-scatter model, film **artifacts** (dust, hairs, scratches, light leak)
- Procedural **film frames** — 35mm sprockets, rebate and edge printing drawn to ISO/SMPTE geometry

**Editing**
- Exposure, contrast, white balance (with eyedropper), dehaze, sharpening (incl. deconvolution), noise reduction, highlight roll-off
- **Tone curves** (master, R/G/B and parametric), an eight-band **colour mixer** and lift/gamma/gain wheels
- **Local adjustments** — up to 8 masks: radial, linear, brush, sky, AI subject, depth, colour range,
  luminance range; each with amount, texture, clarity and an edge-aware refine
- **Skin tone** — a contractive operator that evens out patchy tone instead of shifting all of it
- **Heal and clone** applied before grading, so a repair takes the same grain and look
- Crop, rotate, straighten, **auto-level**, perspective correction, borders and canvas mattes
- Collage layouts, **HDR merge** and **focus stacking** (desktop)
- Multi-photo batches with a filmstrip, shared edits, and **match a series to one reference**

**Input and output**
- **RAW** (RW2/RAW) decoded locally, with Adobe DCP camera profiles for LR-like colour
- **V-Log** input transform for Lumix footage and stills
- Full-resolution export to JPEG / PNG / WebP / TIFF, XMP sidecars, **HDR gain-map** HEIC from RAW
- Build a `.cube` LUT from a before/after pair, or match colour from a reference image
- Emitted `.cube` files are tagged for **Lumix Lab**, so a look can go back into the camera

**Desktop only** (the Mac app)
- A full **photo library**: folders, catalog, collections, keywords, duplicates, culling
- **Card import** from an SD card, organised by capture date, with a verified second copy
- **People** — local face detection, recognition and naming
- **Natural-language search** — describe a photo and find it, locally
- Virtual copies, offline edits, suggested tags, and a Lightroom **Edit In** round-trip with cloud browser

**Beta**
- **Astro stacking** — combine night-sky frames into a cleaner image (desktop library)
- **Panorama** — stitch two photos into a wider view; larger sets are still planned
- **Video** — grade a clip with the same stack as stills, trim it, and export with audio passed through
  untouched; scopes, safe-area guides, fades, gate weave and film breath

## Screenshots

| | |
|---|---|
| ![Looks](site/assets/ui/looks.webp) | ![Local adjustments](site/assets/ui/local.webp) |
| Film looks, one tap | Masks and local adjustments |
| ![Colour](site/assets/ui/color.webp) | ![Film](site/assets/ui/film.webp) |
| Tone curves and colour mixer | Grain, halation and artifacts |
| ![Gallery](site/assets/homepage/gallery-faces.webp) | ![Phone](site/assets/ui/mobile.webp) |
| The gallery, filtered to one person | The same app on a phone |

<sub>Captured from the running app with `node site/shoot-screenshots.mjs`, using a sample photograph.</sub>

## What's new

- **Card import** — copy a shoot straight off an SD card, organised into date folders, never moved
- **People and natural-language search** — find someone, or describe a photo, entirely on-device
- **Heal and clone** — spot removal that happens before grading, so repairs never look pasted in
- **Auto-level** — finds the dominant line and straightens it (worst error 0.30° on ground truth)
- **Match series to a reference** — fixes exposure/WB drift across a shoot without touching the look
- **Film frames** — sprocket holes and edge printing from real 35mm measurements
- **Video grading** — one clip, the full stack, audio remuxed rather than re-encoded
- **HDR export from RAW** — gain-map HEIC derived from the app's own extended-range decode

Full history: [commits on main](https://github.com/TareqAmeer/Chroma-App/commits/main).

## Privacy

No account, no telemetry, no uploads, no backend. Photos are read, processed and written on the
device you are using. The web build works with the network disconnected after its first load.

---

## For developers

### Run it

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

There is no build step. `chromasmith-22.html` is the entire web app — HTML, CSS, JS and GLSL
shaders in one file. `index.html` is the product page; the editor is at `/app/`.

RAW decoding in the browser needs cross-origin isolation (`SharedArrayBuffer`), which GitHub Pages
cannot set headers for — `coi-serviceworker.min.js` enables it client-side and reloads once on the
first visit. Everything else works without it.

### Tests

```bash
npm test              # everything below, in order
node test/export_harness.mjs           # 18 golden renders, byte-exact
node test/export_harness.mjs --golden  # regenerate goldens (only when a change is intended)
npm run ui:test       # desktop + phone layout audit
npm run perf:test     # performance budgets
npm run lib:test      # library grid scaling
npm run video:test    # video demux/seek/export
```

`test/export_harness.mjs` drives the real HTML in headless Chromium with software GL, so output
does not depend on the host GPU. After **any** shader edit, run it and watch for
`[console.error] GLSL compile error` — a failed shader compile does not break the page, it
silently switches the affected feature off.

### The site

```bash
node site/shoot-screenshots.mjs   # re-capture the UI screenshots from the real app
node site/build-assets.mjs        # optimise photos from site/photos-src/
node site/build-page.mjs          # inject them into index.html
```

See [site/README.md](site/README.md).

### Desktop app (macOS, Tauri)

```bash
cd desktop && npm ci
# fetch the AI models — each vendor dir's README has the exact curl commands
./install-app.sh                  # builds and installs into /Applications
```

Needs Rust, Node and Xcode command-line tools. The ONNX models (~1.1 GB) are not in git; see
`desktop/src-tauri/vendor/*/README.md` for where each one comes from and
[LICENSES-MODELS.md](LICENSES-MODELS.md) for their licences.

### iOS app (Capacitor)

```bash
npm ci && ./build-ios.sh && npx cap sync ios
```

CI builds an unsigned IPA on every push
([workflow](https://github.com/TareqAmeer/Chroma-App/actions/workflows/ios-ipa.yml)); this machine
has no Xcode, so CI is the only build path.

### Repository layout

```
index.html                 The product page (GitHub Pages root)
app/index.html             Clean /app/ URL → the editor
chromasmith-22.html        THE ENTIRE WEB APP — HTML + CSS + JS + GLSL in one file
coi-serviceworker.min.js   Cross-origin-isolation shim so RAW decoding works on Pages
site/                      Landing-page assets + the scripts that generate them
vendor/                    LibRaw wasm, DCP camera profiles, mediabunny, 102 look LUTs, frames
desktop/                   Tauri macOS shell: native RAW, the photo library, on-device AI
ios/                       Capacitor iOS shell
test/                      Export/UI/perf/mask/library/video regression gates
tools/calib/                     Python calibration + analysis tooling (not needed to run the app)
CLAUDE.md                  Developer handoff: architecture, calibration science, hard-won lessons
docs/ROADMAP.md                 Feature roadmap with measured notes
```

## Third-party components

LibRaw (wasm RAW decoder) · Adobe DCP camera profiles for the Panasonic DC-S9 ·
[mediabunny](https://github.com/Vanilagy/mediabunny) MP4 demux/mux, MPL-2.0 ·
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker), MIT ·
pako · utif2 · Inter and Instrument Serif (SIL OFL 1.1) · Lucide-shaped icon set (ISC) ·
the Monk Skin Tone scale (CC BY 4.0) · on-device ONNX models — see
[LICENSES-MODELS.md](LICENSES-MODELS.md).

## Licence

GPL-3.0. See [LICENSE](LICENSE).
