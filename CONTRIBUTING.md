# Contributing to Chromasmith

Thanks for helping. This covers running, testing and building every version of the app.

## Run it

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

There is no build step. `chromasmith-22.html` is the entire web app — HTML, CSS, JS and GLSL
shaders in one file. `index.html` is the product page; the editor is at `/app/`.

RAW decoding in the browser needs cross-origin isolation (`SharedArrayBuffer`), which GitHub Pages
cannot set headers for — `coi-serviceworker.min.js` enables it client-side and reloads once on the
first visit. Everything else works without it.

## Tests

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

## The site

```bash
node site/shoot-screenshots.mjs   # re-capture the UI screenshots from the real app
node site/build-assets.mjs        # optimise photos from site/photos-src/
node site/build-page.mjs          # inject them into index.html
```

See [site/README.md](site/README.md).

## Desktop app (macOS and Windows, Tauri)

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

## iOS app (Capacitor)

```bash
npm ci && ./build-ios.sh && npx cap sync ios
```

CI builds an unsigned IPA on every push
([workflow](https://github.com/TareqAmeer/Chroma-App/actions/workflows/ios-ipa.yml)); this machine
has no Xcode, so CI is the only build path.

## Android app (Capacitor)

Same shell as iOS: `./build-ios.sh` stages `www/`, then `npx cap sync android`. CI builds a debug-signed
`Chromasmith.apk` ([workflow](https://github.com/TareqAmeer/Chroma-App/actions/workflows/android-apk.yml));
this machine has no Android SDK, so CI is the only build path. See [docs/android-shell.md](docs/android-shell.md).

## Repository layout

```
index.html                 The product page (GitHub Pages root)
app/index.html             Clean /app/ URL → the editor
chromasmith-22.html        THE ENTIRE WEB APP — HTML + CSS + JS + GLSL in one file
coi-serviceworker.min.js   Cross-origin-isolation shim so RAW decoding works on Pages
site/                      Landing-page assets + the scripts that generate them
vendor/                    LibRaw wasm, DCP camera profiles, mediabunny, 102 look LUTs, frames
desktop/                   Tauri desktop shell (macOS + Windows): native RAW, the photo library, on-device AI
ios/                       Capacitor iOS shell
android/                   Capacitor Android shell
test/                      Export/UI/perf/mask/library/video regression gates
tools/calib/               Python calibration + analysis tooling (not needed to run the app)
CLAUDE.md                  Developer handoff: architecture, calibration science, hard-won lessons
docs/ROADMAP.md            Feature roadmap with measured notes
```

Architecture, calibration science and hard-won lessons are in [CLAUDE.md](CLAUDE.md) and [docs/](docs/).
