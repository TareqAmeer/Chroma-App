# iOS app shell (Capacitor → sideloadable IPA)

(moved from CLAUDE.md §2, 2026-09-11)

`ios/` wraps the SAME single file in a WKWebView (Capacitor 8, CocoaPods). Pieces:
- `build-ios.sh` stages `chromasmith-22.html → www/index.html` + `vendor/` (never point webDir
  at the repo root — tools/calib/ would ship). `www/`, `node_modules/` are gitignored; `ios/` is
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

## Phone gallery + Photos album (both shells)
`mobile/mobile-library.js` (staged into `www/mobile/`, loaded only when `capNative()` or
`?mlib=1`) is the phone counterpart of the desktop Library: originals kept untouched in IndexedDB
`chromasmith-mlib`, recipes auto-saved through `chromasmithOnEdit`, export history through
`chromasmithRecordExport`/`chromasmithGetExportHistory`, named versions, revert/open-original.
The app launches into it; Back on the editor's home state returns to it. Exported images go to a
"Chromasmith" album via `@capacitor-community/media` (`capAlbumId()`), share sheet as fallback.

## Share sheet (iOS Share Extension / Android SEND)
- iOS: `ios/App/ShareExt/` is a Share Extension target (bundle `com.tareq.chromasmith.share`, embedded in the app's PlugIns). It copies shared images (RAW preferred) into the app group `group.com.tareq.chromasmith` (`shared/`), then opens `chromasmith://shared`; `PhotoPairPlugin.takeShared` moves them to temp and the web layer (`checkShared` in `mobile/mobile-library.js`) imports them. No app group (some sideload signers can't provide one) → it opens `chromasmith://import`, which launches the in-app Photos picker. Both targets carry `*.entitlements` with the group; the unsigned CI build ignores them, the signer decides. Not compiled on the dev Mac (no Xcode there) — CI is the first compile.
- Android: `SEND`/`SEND_MULTIPLE` intent filters on `MainActivity`; `SharedImportPlugin` copies streams to cache and the same `PhotoPair.takeShared` JS call drains them.
