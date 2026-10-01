# Android app shell (Capacitor → sideloadable APK)

`android/` wraps the same single file in the Android WebView (Capacitor 8), mirroring `ios/`
(docs/ios-shell.md). Not on Play — distributed as an APK.

- Staging reuses `build-ios.sh` (`www/`), then `npx cap sync android`.
- `.github/workflows/android-apk.yml` builds a debug-signed `Chromasmith.apk` on every app push
  (workflow artifact) and attaches it plus a `build-<BUILD>.txt` marker to `v*` releases. This
  Mac has no Android SDK — CI is the only build path.
- `patches/@capacitor+android*.patch` adds COOP/COEP in `WebViewLocalServer` for RW2 decode
  (same intent as the iOS patch; startup log "SAB/RAW yes/no" says whether it took).
- Manifest: `largeHeap` for full-res export / AI masks. `SystemBars.insetsHandling:"css"` keeps
  `env(safe-area-inset-*)` correct edge-to-edge.
- Android-only JS (gated by `capAndroid()`): exports write to `Documents/Chromasmith/` (share
  sheet fallback); `capUpdateCheck()` shows a "new version" banner when the latest release's
  build marker differs from the running `BUILD`. Releasing a tag is what triggers that banner.
- The same app ID as iOS (`com.tareq.chromasmith`) — newer APKs install over older ones and keep
  data, as long as they share a signing key. CI caches `~/.android/debug.keystore` for that; if
  the cache is ever evicted (unused 7 days) a new key is made and testers must uninstall once.

## Pixel tester checklist
1. Download `Chromasmith.apk` from the latest GitHub release, open it, allow "install unknown
   apps" for your browser/Files when asked.
2. Open a JPEG from the gallery, apply a look + grain; sliders should feel smooth.
3. Open a RAW (.RW2/.DNG). Note whether it opens or shows an error.
4. Export at full resolution; check the photo appears in Files → Documents/Chromasmith (and in
   Google Photos → Library → device folders).
5. Try an AI mask (subject / skin). Note crashes or the app restarting.
6. Rotate the phone; on a Pixel Fold, use both screens. Check nothing hides under the camera
   cutout or the gesture bar.
7. Report: phone model, Android version, what broke, a screenshot.
