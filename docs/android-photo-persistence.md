# Android exported-media persistence — CHR-285

## Cause and fix

Exports used `getExternalMediaDirs()/Chromasmith`, an app-specific folder removed during uninstall. Android recommends MediaStore for media that must survive uninstall ([Android storage guidance](https://android-developers.googleblog.com/2019/04/android-q-scoped-storage-best-practices.html)).

`PublicPhotoStore.java` now publishes images to shared Pictures/Chromasmith and videos to Movies/Chromasmith. Android 10+ uses MediaStore pending rows, publishing only after a complete native streamed write. Older Android uses public directories and the media scanner. Failures remove only the newly created destination. Duplicate filenames preserve previous files.

The binary JPEG bridge and staged-file fallback both use this store. Android no longer falls through to the app-specific Media-plugin album. Cache-file inputs are restricted to the app's cache directory. Missing native support or migration failure produces a recoverable export error.

On launch and before export, existing app-specific exports are copied to shared media. The original is removed only after full checksum verification, including original GPS EXIF, and a persisted migration receipt. Failed or corrupt originals remain untouched; completed retries do not duplicate migrated files. A crash between publishing and recording a receipt can leave a duplicate public copy, but retains the original.

## Verification

- Actual uninstall/reinstall on Android 10 (API 29, 1 GB emulator) and Android 15 (API 35, 2 GB emulator): all 16 media files retained their gallery records and exact SHA-256 bytes. Includes migrated and new JPEG, PNG and MP4, binary and fallback saves, duplicate names and GPS metadata.
- Failure checks: corrupt migration source retained, no false success, invalid MIME/cache escape rejected, temporary cache cleanup, completed migration retries idempotent. Modern broad storage permissions revoked during native tests.
- Twelve additional full 6000×4000 JPEG exports decoded at full resolution and remained byte-identical within each benchmark batch. New saves avoid migration's extra checksum readback. Emulator timing varies substantially between runs; this storage fix does not establish a paired performance improvement.
- Mobile binary protocol, native full-JPEG transport, live export/preview isolation, mobile edge cases and mobile UX regressions passed. Ordinary debug APK built successfully.

Raw evidence: [benchmark and persistence data](benchmarks/android-photo-persistence-2026-10-07.json). API 24–28 public-directory implementation compiled but was not exercised on a native emulator. No physical Pixel was used.

## Existing installations

Install the updated APK over the existing app and open it before uninstalling, allowing migration to finish. Already deleted exports require originals or backups; this update cannot recover removed files.
