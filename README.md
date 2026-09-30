<h1>Chromasmith</h1>

**Gallery. Studio. Film Lab**

your photos. your workflow. your app.

Make a look in a click or take control of every detail. Chromasmith is a free photo studio with
132 calibrated film looks, real grain, halation and bloom, RAW development, masks and retouching,
a local photo library and full-resolution export — running entirely on your own device. No
account, no upload, no subscription. The web version is a single HTML file with no build step
and no server behind it.

**→ [Open the app](https://tareqameer.github.io/Chroma-App/app/) ·
[Product page](https://tareqameer.github.io/Chroma-App/) ·
[Mac & Windows downloads](https://github.com/TareqAmeer/Chroma-App/releases/latest)**

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
| **Windows** | [Download the latest `windows-x64-setup.exe`](https://github.com/TareqAmeer/Chroma-App/releases/latest) | Windows 10/11, 64-bit. Unsigned: if SmartScreen appears, choose **More info → Run anyway**. The same full desktop app as on Mac: library, card import, faces and local AI. |
| **iPhone / iPad** | Open in Safari → Share → **Add to Home Screen** | Or sideload the unsigned IPA from [Actions](https://github.com/TareqAmeer/Chroma-App/actions/workflows/ios-ipa.yml) with Flarestore / AltStore / Sideloadly. |
| **Android** | Open in Chrome → menu → **Add to Home screen** | Same app; the layout switches to a phone shell under 700px. |

Step-by-step instructions for each platform, in plain English, are on the
[product page](https://tareqameer.github.io/Chroma-App/#get).

## Highlights

- **One click is all it takes** — 132 film looks across Kodak, Fuji, cinema, instant, reversal and B&W, previewed live on your photo
- **Let the light linger** — grain, halation, bloom, dust, light leaks and film frames, each with room to be subtle or unmistakable
- **A studio for every frame** — curves, an eight-band colour mixer, lift/gamma/gain, masks, heal and clone, full-resolution export
- **A library for every shoot** — folders, culling, people and natural-language search, all on your machine (desktop app)
- **Works with no signal** — no account, no upload; the web app runs offline after the first visit
- **Beta, growing** — video grading, astro stacking and two-photo panorama

Every tool is in the [complete feature list](#complete-feature-list) below; the
[product page](https://tareqameer.github.io/Chroma-App/) has the full tour.

## What it does

**Looks and film**
- 132 film-look presets (Kodak, Fuji, cinema, instant, reversal, B&W), plus any `.cube` you own
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

**Desktop only** (the Mac and Windows apps)
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

## Complete feature list

<details><summary><b>Looks and film</b> (13)</summary>

- **132 film looks** — Start with calibrated colour, cinema, instant, reversal or black-and-white looks.
- **One-tap Looks gallery** — Preview a look on your photo and apply it with one click.
- **Custom .cube LUTs** — Load a LUT you already own and use it as the starting look.
- **Kodak and Fuji print profiles** — Add a print-film response after the base look.
- **Film grain** — Add grain shaped for formats from 8mm to 65mm.
- **Halation** — Let bright edges glow into neighbouring dark areas.
- **No-remjet halation** — Push halation toward a stronger, stylised glow.
- **Bloom** — Give bright areas a softer spread of light.
- **Film dust and scratches** — Layer procedurally placed dust, hairs and scratches onto the image.
- **Light leaks** — Add warm film-like light intrusions and reshuffle their placement.
- **Film frames** — Finish with sprockets, rebates and edge printing.
- **Vignette** — Draw attention inward by shaping the edge brightness.
- **Reusable Styles** — Save a finished editing recipe and apply it again later.

</details>

<details><summary><b>Light and colour</b> (15)</summary>

- **Exposure** — Brighten or darken the image without changing the chosen look.
- **Contrast** — Shape the separation between lighter and darker tones.
- **White balance** — Adjust temperature and tint to make the colour feel right.
- **White-balance eyedropper** — Click a neutral area to correct the colour cast.
- **Auto-enhance** — Set a quick starting point for levels and white balance.
- **Master tone curve** — Draw the overall tonal response directly.
- **RGB channel curves** — Shape the red, green and blue channels independently.
- **Parametric curves** — Adjust shadows, darks, lights and highlights with four controls.
- **Eight-band colour mixer** — Tune hue, saturation and luminance by colour band.
- **Lift, gamma and gain wheels** — Tint shadows, midtones and highlights separately.
- **Dehaze** — Recover clarity in flat or hazy scenes.
- **Noise reduction** — Quiet unwanted image noise while keeping useful detail.
- **Sharpening** — Restore crispness at the level the image needs.
- **Deconvolution sharpening** — Recover detail softened by lens or sensor blur.
- **Highlight roll-off** — Keep bright regions gentler with filmic tone-mapping options.

</details>

<details><summary><b>Masks and retouching</b> (14)</summary>

- **Radial masks** — Make a soft oval adjustment around a subject or light source.
- **Linear masks** — Grade one side of the frame with a graduated transition.
- **Brush masks** — Paint an adjustment exactly where it belongs.
- **Sky masks** — Separate the sky for its own grade.
- **AI subject masks** — Select a subject from the photo for local editing.
- **Colour-range masks** — Target pixels by colour rather than by location.
- **Luminance-range masks** — Target an adjustment to a chosen brightness range.
- **Depth masks** — Use estimated scene depth to separate near and far areas on desktop.
- **Mask edge refinement** — Snap rough mask edges toward real image boundaries.
- **Skin-tone tools** — Even out patchy skin colour while keeping the image's character.
- **Face-feature exclusion** — Keep eyes, lips and other facial details out of a skin adjustment.
- **Named-subject masks** — Teach a subject from examples and find it again in other photos.
- **Heal** — Blend away a spot before the film look and grain are applied.
- **Clone** — Copy a source area precisely to repair the frame.

</details>

<details><summary><b>Composition and multi-image</b> (10)</summary>

- **Crop and aspect ratio** — Reframe the photo for its final destination.
- **Rotate and flip** — Change image orientation without leaving the editor.
- **Straighten and auto-level** — Level the horizon manually or let the app find a dominant line.
- **Perspective correction** — Bring leaning lines back into shape.
- **Borders and canvas mattes** — Place the image inside a chosen border, aspect and background.
- **Collage layouts** — Place multiple images in adjustable rows, columns and grids.
- **HDR merge** — Blend bracketed exposures into one image on desktop.
- **Focus stacking** — Combine frames focused at different distances on desktop.
- **Astro stacking — beta** — Stack night-sky captures from the desktop library.
- **Two-photo panorama — beta** — Stitch a pair of photos into one wider image.

</details>

<details><summary><b>Desktop photo library</b> (13)</summary>

- **Local library** — Browse your archive on your machine without uploading it.
- **Folder and collection browsing** — Move through folders, dates and curated groups of images.
- **SD-card import** — Copy a shoot by capture date and make a verified second copy.
- **Keywords** — Add searchable words to describe and group photos.
- **Duplicate detection** — Find repeated files while reviewing the library.
- **Culling** — Pick the keepers from a shoot before editing.
- **People recognition** — Find and name faces with processing on your device.
- **Natural-language search** — Describe a photo in words and search locally for it.
- **Suggested tags** — Get on-device tag suggestions for a selected photo.
- **Virtual copies** — Keep more than one edit version of the same photo.
- **Offline edits** — Work from a cached preview and apply the edit when the source returns.
- **Lightroom round-trip** — Open a Lightroom photo in Chromasmith and return the result.
- **Lightroom cloud browser** — Browse connected Lightroom cloud photos from the desktop app.

</details>

<details><summary><b>Input, export and workflow</b> (19)</summary>

- **RAW decoding** — Open camera RAW files and develop them locally.
- **DCP camera profiles** — Use camera colour profiles for more faithful RAW starting colour.
- **V-Log input** — Convert Lumix V-Log material before grading it.
- **Multi-photo filmstrip** — Load several images and switch between their previews.
- **Shared and per-photo edits** — Apply a look to the batch, then adjust an individual frame.
- **Match a series** — Align exposure and white balance across a shoot to one reference photo.
- **Before-and-after comparison** — Check your grade against the original image.
- **Live histogram** — Watch tonal distribution while you edit.
- **1:1 loupe** — Inspect the full rendering pipeline at native image scale.
- **Undo and redo** — Move safely backward and forward through editing decisions.
- **Session save and restore** — Keep slider settings locally and return to them later.
- **Full-resolution export** — Render the finished image at its original resolution.
- **JPEG, PNG, WebP and TIFF** — Choose the output format that suits the job.
- **HDR gain-map HEIC** — Export extended-range highlights from a RAW source.
- **XMP sidecars** — Keep an edit record alongside the source file.
- **Export presets** — Save quality, format, resize and sharpening settings as a preset.
- **LUT from a before/after pair** — Build a reusable .cube look from two versions of one image.
- **Colour Copy** — Match a reference image's colour into a .cube LUT or XMP preset.
- **Lumix Lab LUT export** — Tag a .cube file for a look you can take back to a Lumix camera.

</details>

<details><summary><b>Video — beta</b> (8)</summary>

- **Clip grading** — Use the still-photo look stack on a video clip.
- **Trim in and out** — Choose the segment of a clip to export.
- **Audio passthrough** — Keep the source audio without re-encoding it.
- **Scopes** — Read the clip's signal as you grade.
- **Safe-area guides** — Check framing with overlay guides.
- **Fades** — Ease the picture in or out of a clip.
- **Gate weave and film breath** — Add restrained analogue motion to a graded clip.
- **Frame capture** — Export the current video frame as a still image.

</details>

<details><summary><b>Access and privacy</b> (8)</summary>

- **Browser editor** — Open the app without installing a desktop package.
- **Phone layout** — Edit with a touch-first tool sheet on a smaller screen.
- **Offline web use** — Keep editing after the first load when the connection goes away.
- **Home-screen install** — Add the web app to your phone's home screen.
- **Swipe between photos** — Move through a loaded batch with a touch gesture.
- **Hold to compare** — Press and hold on mobile to check the original.
- **On-device processing** — Keep your photos on the device where you edit them.
- **No account or subscription** — Open the free, open-source app without signing in.

</details>

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

## FAQ

**Is Chromasmith really free?**  
Yes. It's free, open-source software under the GPL-3.0 licence. There's no account, subscription or paywall.

**Do my photos get uploaded anywhere?**  
No. Everything runs on your device, in the browser or the desktop app. Your photos never leave your machine.

**What's the difference between the web app and the desktop app?**  
The web app has the full editor: looks, film effects, colour tools, masks and export. The desktop app adds the photo library, card import, on-device search, face tagging and the desktop-only tools such as HDR and focus stacking.

**Does it work offline?**  
Yes. After the first load the web app keeps working without a connection, and the desktop app never needs one.

**Which RAW files can it open?**  
Camera RAW files from any camera are decoded locally on your device. JPEG, PNG and TIFF open everywhere.

**Can I use my own LUTs?**  
Yes. Load any .cube LUT as a starting look, or build your own .cube from a before/after pair or a reference photo.

**How do I install it on iPhone?**  
Chromasmith isn't on the App Store yet. Download the .ipa and install it with a third-party signing service such as Flarestore. Or add the web app to your home screen, which needs no signing.

**Where can I see every feature in a list?**  
Open the [full feature list](#complete-feature-list). Every tool, grouped by what it does, with a one-line description.

**Is there a Windows version?**  
Yes. A 64-bit Windows 10/11 installer is published on the [releases page](https://github.com/TareqAmeer/Chroma-App/releases/latest) alongside the Mac build, with the same library, import and on-device AI features.

**What is it made with?**  
The whole editor is one HTML file with plain JavaScript and no framework or build step. Rendering runs on WebGL2, with GLSL shaders for the look, grain, halation, bloom and tiled full-resolution export. RAW files are decoded locally with LibRaw compiled to WebAssembly, plus Adobe DCP camera profiles. The desktop app is a Tauri shell with a Rust core and a local catalogue database, for Mac and Windows. On-device masks use ONNX Runtime models (EdgeSAM and SegFormer). Video uses mediabunny, the iPhone app is a Capacitor shell, and the film looks were calibrated with Python tooling. It works offline through a service worker, and the source is GPL-3.0.

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

### Desktop app (macOS and Windows, Tauri)

```bash
cd desktop && npm ci
# fetch the AI models — each vendor dir's README has the exact curl commands
./install-app.sh                  # macOS: builds the release bundle
npm run tauri build               # Windows: builds the NSIS installer
```

Needs Rust and Node, plus Xcode command-line tools (macOS) or VS Build Tools with the C++ workload
(Windows). Windows status and notes: [docs/windows-port.md](docs/windows-port.md). The ONNX models (~1.1 GB) are not in git; see
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
desktop/                   Tauri desktop shell (macOS + Windows): native RAW, the photo library, on-device AI
ios/                       Capacitor iOS shell
test/                      Export/UI/perf/mask/library/video regression gates
tools/calib/               Python calibration + analysis tooling (not needed to run the app)
CLAUDE.md                  Developer handoff: architecture, calibration science, hard-won lessons
docs/ROADMAP.md            Feature roadmap with measured notes
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
