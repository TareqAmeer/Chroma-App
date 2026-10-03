# Android shell — acceptance criteria & emulator test

Acceptance criteria for the Capacitor Android shell (`android/`, see [android-shell.md](android-shell.md)),
verified on an Android emulator by `node test/android/android_sim.mjs`. It automates the manual
"Pixel tester checklist" in android-shell.md. Each criterion has an ID; the runner prints
PASS / FAIL / SKIP per ID and writes `test/android/out/report.md`.

Not part of `npm test` — it needs the Android SDK + an emulator (see Setup). Chromium-based gates
elsewhere in `test/` cannot see anything in this file: the Android WebView, the Capacitor bridge,
the native plugins and the system UI only exist here.

## Criteria

| ID | Criterion (must hold on Android 15 / API 35, x86_64 emulator, WebView 124) | How it is checked |
|----|-----|-----|
| AC-01 | Debug APK installs from a clean state and launches; the app process is still alive 30 s later with no `FATAL EXCEPTION` / ANR. | `adb install`, `pidof`, logcat |
| AC-02 | Cold start reaches the gallery UI within 120 s, and the boot watchdog (`[boot] watchdog fired`) never fires. | CDP: `.vtog` present; logcat |
| AC-03 | The page runs inside the native shell: `Capacitor.getPlatform()==='android'`, `BUILD` is defined, `Filesystem`/`Share`/`Media` plugins are present. | CDP |
| AC-04 | WebGL2 is available (the FXR renderer cannot run without it). | CDP |
| AC-05 | System bars are legible in both the dark and light theme: the status-bar glyphs contrast with their strip (>= 0.40 luminance difference). The strip is the window background, so it must follow the page colour. | screenshot: glyph vs strip contrast |
| AC-06 | RAW prerequisites hold: `crossOriginIsolated===true` and `SharedArrayBuffer` is defined (libraw-wasm needs it). | CDP |
| AC-07 | A photo imported into the gallery opens in the Studio and the preview canvas renders non-blank, within 300 s. | CDP + screenshot |
| AC-08 | Tapping a look thumbnail changes the preview (real touch event, pixels differ from the Original). | `adb input tap`, screenshot diff |
| AC-09 | Export with destination **Files** writes a valid JPEG/PNG (>5 KB, correct magic bytes) to `Documents/Chromasmith/`. | tap Export, `adb ls` |
| AC-10 | Export with destination **Photos** saves into a "Chromasmith" album visible to MediaStore, distinct from the Files export (the Media plugin stores it under `Android/media/com.tareq.chromasmith/Chromasmith/`, which gallery apps index). | tap Export, `content query` |
| AC-11 | Rotating to landscape and back: no crash, no horizontal page overflow, the editor preview stays visible. | `user_rotation`, CDP |
| AC-12 | Force-stop + relaunch keeps the imported photo in the gallery (IndexedDB persistence). | CDP |
| AC-13 | The Back button in the Studio does not exit the app. | `keyevent 4`, `dumpsys` |
| AC-14 | Sharing an image to Chromasmith from another app (`ACTION_SEND`) imports it. Uses a MediaStore `content://` URI with a read grant, as a real share sheet does (`file://` is blocked by scoped storage). | `am start -a SEND` |
| AC-16 | The "new version available" banner (`capUpdateCheck`) must not cover or intercept taps on the Studio bottom nav (Looks / Tools / Crop / Export). | `elementFromPoint` at the Export button |
| AC-15 | No uncaught JS errors / unhandled rejections (logcat `Capacitor/Console` level E) during the whole run. | logcat |

Informational (recorded, never gated): time to gallery, time to first Studio render, WebView version,
`navigator.deviceMemory`. The emulator renders with SwiftShader (software GL), so timings are an
upper bound, not a device benchmark.

## Setup (Windows, no admin; ~3 GB)

JDK 21 + Android command-line tools in `~/android-tools/`, then:

```
sdkmanager "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n chroma_pixel -k "system-images;android-35;google_apis;x86_64" -d pixel_7
```

`node test/android/android_sim.mjs --build` stages `www/`, runs `cap sync`, builds the APK, boots the
`chroma_pixel` AVD if no device is attached, then runs the criteria. Without `--build` it installs the
APK that is already in `android/app/build/outputs/apk/debug/`. `--only AC-05,AC-06` runs a subset.
Env overrides: `ANDROID_HOME`, `JAVA_HOME`.

## Findings from the first run, and how each was resolved

The first run on a Pixel 7 AVD (Android 15, WebView 124, build 1.1003L) passed 12/16. All four failures were real
app problems and are fixed in 1.2.8; the same run now passes 16/16.

| ID | Problem found | Fix |
|----|---------------|-----|
| AC-05 | Status/nav bar strips were near-white behind white glyphs (the window background, which DayNight makes white). | Dark `windowBackground`/bar colours in `styles.xml`, plus an Android-only `BarBackground` plugin that sets the strip to the current page colour so it also works in the light theme. It re-applies after `SystemBars.setStyle` (iOS-shared code in `mobile-editor.js`), which resets the bar colours. |
| AC-06 | RAW import threw "RW2 needs SharedArrayBuffer". The WebView never reports `crossOriginIsolated`, but libraw's wasm only needs *shared WebAssembly.Memory*, which it does create. | `rawSharedMemoryOk()` feature-detects shared wasm memory on Android only. Verified by decoding a synthetic DNG (`test/fixtures/make_dng.py`) through the real import path. |
| AC-16 | The "new version" banner sat on top of the Studio bottom nav; tapping Export hit its Download link. | `capUpdateCheck` lifts the banner above the nav while it is showing. |
| AC-02 | `[boot] watchdog fired: stalled on "walk"` on every cold start. The watchdog guards the desktop library scan; the phone shell has nothing for it to watch. | Not armed on Android. |

Everything shared with iOS is gated to Android (`capAndroid()` / `getPlatform()==='android'`); the iOS shell is untouched.

Test-harness notes (not app bugs): the first-run welcome modal (`#cs-modal-ov`) and the update banner both
intercept taps, so the runner dismisses them like a user would. A tap that leaves the app (e.g. the Download link
opening Chrome) now fails with the foreground package instead of silently misreporting later steps. Benign console
errors are allow-listed in AC-15 (Capacitor SystemBars' own safe-area injection during the service-worker reload, and
`Filesystem.stat` on a not-yet-existing export name).

## Not covered yet
A real camera RAW (AC-06 uses a synthetic DNG; a real RW2/DNG is still worth one manual pass), AI masks, video, Pixel Fold / dual-screen, and the system file picker.
