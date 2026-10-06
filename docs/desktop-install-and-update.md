# Desktop install, update and recovery

Desktop releases are published on the [GitHub Releases page](https://github.com/TareqAmeer/Chroma-App/releases/latest). Each release currently provides a **macOS Intel (x86_64) DMG** and a **Windows x64 NSIS setup executable**. Apple Silicon Macs run the Intel app through Rosetta 2. This is deliberate: the bundled macOS ONNX Runtime library is Intel-only. Windows uses the NSIS per-user installer and downloads the WebView2 bootstrapper only when Windows does not already have WebView2.

## Install and update

1. Download the asset for your operating system from the latest release. Do not use the Intel DMG on a Mac that cannot run Rosetta 2.
2. On macOS, open the DMG and drag Chromasmith into Applications. To update, quit Chromasmith first, then install the new app over the existing copy.
3. On Windows, run the x64 setup executable for both a new install and an update. The installer is configured for the current user.
4. Start Chromasmith and confirm your catalog and photos are present. Your original photos remain at their chosen locations; the native catalog data is stored separately from the installed app.

Before a major update, close Chromasmith and make a copy of its application data folder:

- macOS: ~/Library/Application Support/com.tareq.chromasmith
- Windows: %APPDATA%\Chromasmith

A release asset's .sha256 file contains the SHA-256 digest of the matching installer. On macOS, verify it with shasum -a 256 -c followed by the checksum filename. On Windows, compare the digest in the file with the output of Get-FileHash using the -Algorithm SHA256 option. A matching checksum detects accidental corruption when the installer and checksum are obtained together; it does **not** establish who published them or replace a digital signature.

## Local AI models and disk space

The release workflow bundles the AI model files into the desktop app. There is no separate first-launch model download in this release path. Models retain their upstream licences; see [LICENSES-MODELS.md](../LICENSES-MODELS.md). The installer asset size shown on the Releases page is the download size; the installed app expands its bundled resources, so leave additional free disk space for installation. Exact installed-size requirements have not yet been measured on clean machines.

## If an install or update fails

- Do not delete the application data folder or your photo originals.
- Close the app and retry with the installer for the same OS and architecture from the Releases page. If a download may be incomplete, download the asset and .sha256 file again and verify the checksum.
- If Chromasmith no longer starts, keep the saved application data copy. Reinstall the previous release only after checking compatibility; automatic rollback of app data migrations is not provided.
- If recovery still fails, record the OS version, release tag, installer filename, and any error text when reporting the problem. Do not include private photo files.

## Current platform trust and update limits

The current macOS and Windows installers are unsigned. macOS may require the user to approve opening an unidentified app; Windows may show a SmartScreen warning for an unknown publisher. Signing can help identify a publisher, but neither signature nor reputation guarantees that every operating-system warning disappears.

Updates are manual: download and install the new release. There is no in-app updater. Adding one requires a trusted update endpoint and a separately managed Tauri updater-signing key; platform installer signing alone is not enough. Signed macOS notarization, Windows publisher signing, Apple Silicon-native packaging, clean-machine install/upgrade tests, and library-fixture preservation are not yet validated.

## References

- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri updater plugin](https://v2.tauri.app/plugin/updater/)
- [GitHub automatically generated release notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)
