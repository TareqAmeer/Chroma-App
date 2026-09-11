# iOS app shell (Capacitor → sideloadable IPA)

(moved from CLAUDE.md §2, 2026-09-11)

`ios/` wraps the SAME single file in a WKWebView (Capacitor 8, CocoaPods). Pieces:
- `build-ios.sh` stages `chromasmith-22.html → www/index.html` + `vendor/` (never point webDir
  at the repo root — calib/ would ship). `www/`, `node_modules/` are gitignored; `ios/` is
  committed (its own .gitignore covers Pods/build/public).
- `.github/workflows/ios-ipa.yml` builds an **unsigned `Chromasmith.ipa`** on a macOS runner on
  every push touching the app (this Mac has no Xcode — CI is the only build path). The user
  downloads the artifact and signs via **Flarestore**.
- `patches/@capacitor+ios*.patch` (applied by patch-package on `npm ci`) adds COOP/COEP headers
  in `WebViewAssetHandler` so `crossOriginIsolated`/SharedArrayBuffer (RW2 decode) can work in
  the shell. ⚠️ This is why the iOS platform uses **CocoaPods, not SPM** — SPM pulls Capacitor
  from a remote package that can't be patched; CocoaPods builds from `node_modules`. Whether
  WKWebView honors it is probed at startup (log line "SAB/RAW yes/no"); RW2 fails gracefully.
- In-app native hooks are ALL gated on `window.Capacitor` (`capNative()`), so browser/Pages
  behavior is untouched: `capShareFiles()` writes exports to the app cache (Filesystem plugin)
  and opens the NATIVE share sheet (Share plugin) — no user-activation limits, so the
  multi-photo "Tap to save" fallback never fires natively. `Info.plist` carries
  `NSPhotoLibraryAddUsageDescription` (share-sheet "Save Image" runs in-process and needs it).
