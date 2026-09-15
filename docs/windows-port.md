# Windows port — status + plan

Chromasmith's desktop shell (Tauri 2 + Rust, `desktop/`) has run on macOS only. This doc is the
entry point for continuing the Windows port — read it first instead of re-exploring the repo each
session (it's linked from `platform/mod.rs` and CLAUDE.md §5). Update the status table at the end
of every session that touches Windows work.

Ground rules for how changes should be made (so most future edits land on both platforms with no
extra work), the phased plan, the tools/feature comparison, and the completeness/verification
checks all live below. This file **is** the plan from the review session that produced it — kept
here rather than only in a local Claude Code plan file so the reasoning survives across sessions
and machines.

---

## 1. Review of the prep work (Phase 1 commit `8c00191`)

### Solid, keep as-is
- `platform/` design: flat fns, no `cfg` at call sites, macOS bodies moved verbatim (150/150 tests
  passing on macOS at the time).
- `windows.rs`: KnownFolder dirs, `GetDiskFreeSpaceExW`, drive enumeration, Explorer `/select`,
  `SetFileTime`, Recycle Bin via `IFileOperation` **on a dedicated STA thread** (correct and easy
  to get wrong).
- ORT UTF-16 path ABI in `sam.rs`/`rawdenoise.rs`; `trash_file` Windows variant in `library.rs`.
- macOS-only modules already cfg-gated in `main.rs` (gainmap, fastthumb, videothumb); the
  `bgwork.rs` QoS/throttle fns have no-op fallbacks, so the crate compiles on Windows.

### Gaps and defects found (verified on a real Windows 11 PC)
| # | Issue | Where | Consequence on Windows | Status |
|---|---|---|---|---|
| G1 | This doc didn't exist yet — `platform/*.rs` linked to a "Windows-port plan" with nothing to find | `platform/mod.rs` | Every session rediscovers it from scratch | **Fixed** (this file) |
| G2 | Window URL hardcoded `cs://localhost/index.html`; WebView2 serves custom schemes as `http://cs.localhost/` | `tauri.conf.json` | Blank window on launch | **Fixed** — `tauri.windows.conf.json`'s `url` is `http://cs.localhost/index.html`. Note: an earlier version of this fix used `https://` — WRONG, WebView2 always serves a registered custom scheme protocol over plain `http://<scheme>.localhost/`, confirmed via a maintainer's own explanation ([tauri-apps/tauri discussion #10868](https://github.com/orgs/tauri-apps/discussions/10868)), caught before ever running the app |
| G3 | `titleBarStyle:Overlay`, `hiddenTitle`, `transparent`, `macOSPrivateApi`, `.icns`-only icon, `targets:["app"]`, resources list `libonnxruntime.dylib` | `tauri.conf.json` | Bundle fails or looks broken | **Fixed** — split into `tauri.conf.json` (shared) + `tauri.macos.conf.json` / `tauri.windows.conf.json`; generated `icons/icon.ico` (multi-res, via Pillow). Native decorations + `nsis` target on Windows, per the session's title-bar/installer decisions. The native app menu bar (`Menu::with_items` in `main.rs`) is macOS-shaped — an "app name" first menu is a macOS Application-menu convention with no Windows equivalent, and the in-app command palette already covers every action — so it's now `#[cfg(target_os = "macos")]`-gated entirely rather than half-ported. NSIS build itself not yet run (needs `tauri build`, not just `cargo check`) |
| G4 | File-open + Adobe OAuth deep link only handled via `RunEvent::Opened` (macOS-only); on Windows they arrive in **argv of a second process** | `main.rs` | Double-click in Explorer / Adobe sign-in silently do nothing | **Fixed** — `tauri-plugin-single-instance` (`deep-link` feature) registered on non-macOS, first plugin in the chain per its own docs. Its callback parses the second instance's argv (explicit matching — an existing file, or exactly the Adobe scheme prefix — not a loose "else", since raw argv can contain the exe's own path, which parses as a URL with scheme `c` on Windows) and feeds the SAME `dispatch_open_files`/`dispatch_oauth_url` helpers macOS's `RunEvent::Opened` now also calls (factored out, behavior-neutral). `deep_link().register_all()` added for dev builds (Linux, or debug-mode Windows) since the OS-level scheme registration otherwise only happens via the NSIS installer. Real end-to-end verification (actually double-clicking a file while the app runs) still needs the app running, not just `cargo check`/`test` — tracked for the Phase 1b "install + click through" pass |
| G5 | No `onnxruntime.dll` in tree, **and `C:\Windows\System32\onnxruntime.dll` exists** (Windows ML's own copy) | `vendor/onnxruntime/` | Its dependent DLLs may resolve from System32 → version mismatch | **Fixed** — new `platform::load_dylib(path)` (macOS: plain `libloading::Library::new`; Windows: `libloading::os::windows::Library::load_with_flags` with `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR \| LOAD_LIBRARY_SEARCH_DEFAULT_DIRS`, converted into a generic `libloading::Library`), wired into `sam.rs`'s single ORT-loading call site. Forces the bundled DLL's own directory to be searched before System32 for its dependent DLLs, without narrowing the search so much that `onnxruntime.dll`'s own dependencies (kernel32 etc.) fail to resolve |
| G19 | `windows` crate 0.58 doesn't wrap `DRIVE_REMOVABLE`/`DRIVE_FIXED` as typed constants (`GetDriveTypeW` returns a bare `u32`), and `CreateFileW` is gated behind a `Win32_Security` Cargo feature the port didn't enable | `platform/windows.rs`, `Cargo.toml` | `cargo check` failed outright — this had never compiled on real Windows before this session | **Fixed** — replaced with local `const DRIVE_REMOVABLE: u32 = 2` / `DRIVE_FIXED: u32 = 3` (documented Win32 values) and added the `Win32_Security` feature |
| G20 | `Cargo.toml` unconditionally enabled the `tauri` crate's `macos-private-api` feature; Tauri's build script cross-checks a dependency's enabled features against the *merged* `tauri.conf.json` and fails the build if they disagree — Windows's merged config correctly has no `macOSPrivateApi: true` (G3's fix), so the two disagreed | `Cargo.toml` | `cargo check` failed with "does not match the allowlist defined under tauri.conf.json" | **Fixed** — moved the feature into `[target.'cfg(target_os = "macos")'.dependencies]`, same crate, extra feature merged in only on macOS |
| G21 | Two separate bugs made the app 404 on literally every asset the first time it was actually run (`npm run dev`, not just `cargo check`/`test`): (1) `main.rs`'s dev-fallback dist path was `$CARGO_MANIFEST_DIR/dist` — missing a `../`, since the real staged output (`build-desktop.mjs`'s target, matching `tauri.conf.json`'s own `build.frontendDist: "../dist"`) lives at `desktop/dist`, one level above `desktop/src-tauri`, not inside it; (2) the `cs` protocol handler built its file path via `format!("{}/{}", dist_dir().display(), path)` — a **verbatim** (`\\?\`-prefixed) path, which `resource_dir()` can return, disables Win32's normal path parsing entirely, so a `/` inside one is a literal invalid character, not a separator; the manually-concatenated string named a file that could never exist | `main.rs` | Blank/404'd window on first real launch, on any platform (bug (1) is not Windows-specific at all — it was just never exercised, since this app's actual macOS dev-iteration loop is `npm run preview`/`test/preview_server.mjs`, not `cargo tauri dev`; `install-app.sh` builds a real release bundle instead, where the CORRECT "bundled resource" branch is what runs) | **Fixed** — `../dist` in both dev-fallback call sites; the protocol handler now builds the path via `dist_dir().join(&path)` (structured components, always rendered with real backslashes) instead of raw string concatenation, matching how every other resource path in this file was already built. **Verified live**: `npm run dev` now renders the actual Chromasmith Library UI (folder tree, Favorites count from real persisted state, Welcome panel) — the first real end-to-end proof this port works, not just that it compiles |
| G6 | `std::fs::canonicalize` returns `\\?\C:\…` on Windows; catalog canonicalises paths as keys. Windows paths are also case-insensitive | `catalog.rs`, `library.rs` | `\\?\` paths leak into the UI/JS; duplicate rows for `C:\Photos` vs `c:\photos` | **Mostly fixed** — this turned out to be FOUR distinct bugs discovered by chasing one hanging test (`catalog::tests::corruption_is_distinguished_from_an_edit`; see the write-up below the table). Case-insensitive dedupe (the `c:\photos` vs `C:\Photos` half of this row) is still open |
| G7 | `long_path()` prefixes UNC paths wrongly (`\\server\share` needs `\\?\UNC\server\share`) and doesn't accept `/` | `platform/windows.rs` | NAS libraries fail | **Fixed** — a UNC path's leading `\\` is now replaced with `UNC\` (not glued to a `\\?\` prefix, which produced 4 leading backslashes) and forward slashes are normalized to backslashes before either case, since Win32's verbatim (`\\?\`) form requires backslashes even where the non-verbatim form accepts either |
| G8 | `volume_identity_hint` returns just the drive letter; letters change between plug-ins | `platform/windows.rs` | External drive shows "offline" or duplicates after reconnect | **Fixed** — `volume_identity_hint` now calls `GetVolumeNameForVolumeMountPointW` for a `\\?\Volume{GUID}\` path, stable across a drive-letter reassignment. Wired into `catalog.rs`'s `volume_identity`: the read-only-media `fp:` fingerprint fallback now prefers this GUID form over the mount point's own basename (the drive letter) when it's available — platform-conditional (macOS's own hint, `f_mntfromname`, is deliberately NOT preferred there, per that function's pre-existing doc comment on why it's less stable on macOS) |
| G9 | `eject` is a stub | `platform/windows.rs` | Card ingest can't eject | **Implemented** — via the standard volume-handle sequence (Microsoft KB165721: `CreateFileW(\\.\D:)` → `FSCTL_LOCK_VOLUME` → `FSCTL_DISMOUNT_VOLUME` → `IOCTL_STORAGE_MEDIA_REMOVAL` (allow) → `IOCTL_STORAGE_EJECT_MEDIA`), **not** the `CM_Request_Device_EjectW` PnP-device-tree approach this doc originally proposed — the volume-handle sequence is simpler (one handle, no DEVINST walk) and doesn't need admin rights for ordinary removable media, unlike ejecting a physical-drive handle directly. ⚠️ **Unverified against real hardware** — no removable drive was available on the dev machine this was written on; only `cargo check` confirms the Win32 call shapes are correct, not that ejection actually happens. Verify with a real USB drive/card before relying on it |
| G10 | Adobe DCP profile tree hardcoded to the macOS path | `dcp_store.rs` | User-installed camera profiles not found (Windows: `%ProgramData%\Adobe\CameraRaw\CameraProfiles`) | **Fixed** — new `platform::adobe_profile_roots()` (macOS: `~/Library/...` + `/Library/...`, unchanged; Windows: `%APPDATA%\Adobe\...` per-user + `%ProgramData%\Adobe\...` all-users) replaces `dcp_store.rs`'s own hardcoded `HOME`-based paths; both `candidate_roots`/`root_for_source` now derive from the one platform call instead of two independently-hardcoded copies |
| G11 | No Windows fast thumbnail or video poster path (ImageIO/AVFoundation only) | `fastthumb.rs`, `videothumb.rs` | Slow grid (~800ms/24MP JPEG through `image`), no video thumbnails | **Thumbnails fixed** — new `winthumb.rs` (sibling module to `fastthumb.rs`, not nested under `platform::`, matching that file's own architecture) does the same job via WIC: `IWICBitmapDecoder` → `IWICBitmapScaler` (Fant interpolation) → `IWICFormatConverter` (24bppBGR) → `IWICBitmapEncoder`(JPEG) → a growable in-memory `IStream` (`CreateStreamOnHGlobal`), read back into a `Vec<u8>`. Wired into `library.rs`'s three call sites (mirroring the macOS `#[cfg(target_os = "macos")]` blocks with `#[cfg(windows)]` ones). ⚠️ **Known, deliberate gap**: does NOT read/apply EXIF orientation — WIC exposes it via a metadata-query-language string returning a `PROPVARIANT` that needs per-VARTYPE unpacking, real additional complexity this pass scoped out rather than guess at blind; a photo whose camera wrote a non-Normal orientation tag will thumbnail sideways/upside-down until this is added. Verified with a real test: generates a 1200×800 JPEG, decodes+scales+re-encodes via `thumbnail_jpeg`, confirms the output is exactly 360×240 (aspect-preserving) and re-decodes as a valid JPEG. **Video posters fixed** — new `winvideothumb.rs` (sibling module, same pattern) via `IShellItemImageFactory::GetImage` (`SHCreateItemFromParsingName` → the shell's own registered video thumbnail handler, the same one Explorer uses — no codec/dependency of our own), `SIIGBF_RESIZETOFIT \| SIIGBF_THUMBNAILONLY` (the latter load-bearing: without it a file the handler can't decode silently returns the generic file-type icon instead of failing, which would cache a wrong poster forever). The returned `HBITMAP` is read back to pixels via `GetDIBits` (top-down 32bpp BGRA) and re-encoded to JPEG with the `image` crate. Wired into `library.rs`'s 360px thumbnail cache path (the only call site the macOS poster path uses). Unlike AVFoundation there is no seek-time control — the shell handler picks its own frame — so `duration_secs` is accepted for signature parity but unused. |
| G12 | JS assumes macOS: `split('/')` basenames, "Reveal in Finder", ⌘ shortcut labels, traffic-light padding/drag region | `library-ui.js` (43 hits), `desktop-native.js` | Wrong filenames, wrong labels | **Fixed** (basenames + labels) — new `#[tauri::command] platform_capabilities` (main.rs) is the single Rust-side source of truth (`{os, hdrExport, eject, haptics, fastThumb, videoPoster, revealLabel, modKey}`, ground rule 1). `desktop-native.js` sets `window.CS_PLATFORM` synchronously from a `navigator.platform` sniff (so nothing that runs before the IPC round-trip resolves ever sees `undefined`), then corrects it from the real command and fires `cs-platform-ready`; also exposes `window.csKbd(mods, key)` and `window.csBaseName(p)` (splits on either `/` or `\`, so it's correct without even checking `CS_PLATFORM.os`). `library-ui.js` wraps both with a LIBTEST-safe fallback (`?libtest=1` runs this file in a plain browser with no `desktop-native.js` loaded) and replaces the real basename call, the "Reveal in Finder" menu label, and all six hardcoded ⌘-shortcut label sites (Copy/Paste/Reset edit, Undo last reset, Duplicate, Quick export). The two-hit `split('/').pop()` count above included one in the file's own `?libtest=1` mock IPC layer, which fabricates always-`/`-separated fake paths on purpose and correctly stays untouched. Keydown handlers already checked `e.metaKey \|\| e.ctrlKey` throughout — verified, nothing to change there. **Traffic-light padding/drag-region: fixed** — the 84px left clearance on `#fx-deskbar` (chromasmith-22.html) and `#lib-top` (library-ui.js), previously unconditional under `body.deskx`, now lives under a new `body.mac-titlebar-overlay` class that `desktop-native.js` only adds when `CS_PLATFORM.os==='macos'`; the base `body.deskx` rule dropped to a plain 12px (matching the right side) for Windows' native-decorations title bar and for a bare web-browser tab (GitHub Pages / no Tauri), neither of which ever had traffic lights to begin with. Same gate gets `-webkit-app-region:drag`/`data-tauri-drag-region` — Windows' native title bar already provides its own drag handle. The `?deskx=1` browser-test escape hatch also adds `mac-titlebar-overlay`, since every wireframe/visual reference this mode is checked against was built for the macOS layout. Verified via `test/export_harness.mjs` (30/30 clean renders, no GLSL errors) and a clean `test/wireframe_inventory.mjs` rerun. |
| G13 | Rust unit tests use `/Volumes/...` and `~/Library/...` literals | `catalog.rs` tests (~15 sites) | `cargo test` fails on Windows before any real bug is found | **Resolved** — re-verified on this Windows machine: `cargo test --bin chromasmith` runs 243 tests, 242 pass, and the one intermittent failure (`cache_usage_by_root_and_clear_are_scoped_correctly`) is the pre-existing, already-documented shared-thumbs-directory race (100% pass rate alone/`--test-threads=1`, confirmed again here), unrelated to path literals. The remaining `/Volumes/...` sites are opaque DB text fixtures (volume `last_path`/label columns), never touched by `std::fs`, so they carry no OS path semantics to break; the two sites that DO build a real path (`paths_survive_a_remount_at_a_different_mount_point`) already construct the expected value via `Path::new(...).join(...)` (same call `abs_path` itself uses) rather than a hand-typed separator, with a comment explaining exactly why — already portable. Done-when criterion (`cargo test --bin chromasmith` passes on Windows) is met |
| G14 | `build-desktop.sh` needs `rsync` + `python3` (rsync not installed on Windows; `python3` on PATH is the Microsoft Store stub, not real Python) | `build-desktop.sh`, `desktop/package.json` | `npm run build:dist` fails | **Fixed** — `build-desktop.sh` is now a thin wrapper (`set -euo pipefail; node scripts/build-desktop.mjs`); the real staging logic moved to `scripts/build-desktop.mjs` (Node, `fs.cpSync`-based, cross-platform), and `desktop/package.json`'s `build:dist` calls the `.mjs` directly, so Windows never shells out to bash/rsync/python3 at all. Re-verified on this Windows machine: `npm run build:dist` (from `desktop/`) staged `desktop/dist/` (54.1M) clean |
| G15 | `bump-build-stamp.sh` used `jq` (not installed), BSD `sed -i ''` (no-op under GNU sed), a bash-built POSIX path compared against a Windows path, and a `python -` + heredoc that ate its own piped stdin | `.claude/hooks/` | BUILD-stamp hook silently did nothing off macOS | **Fixed** — rewritten as `bump-build-stamp.py` + a thin `.sh` wrapper that picks a working `python`/`python3`; tested with 4 cases (stale+relative path, stale+native Windows path, already-today no-op, wrong-file no-op) |
| G16 | `core.autocrlf=true`, `.gitattributes` only covered the two LFS globs | repo root | CRLF risk in `.sh` hooks and byte-compared goldens/hashes | **Fixed** — `.gitattributes` now sets `* text=auto eol=lf` plus explicit `binary` for onnx/image/icon formats |
| G17 | `diagnostics/` + the `chromasmith-debugger`/`hang-diagnose`/`chromasmith-diagnostics` skills assume macOS (`sample`, dtrace, `~/Library/Logs`, `.app` bundle) | `diagnostics/*.py` | CLAUDE.md's debugger-agent rule doesn't work on Windows yet | **Fixed — Phase 6 done.** Every OS-specific module now has a Windows implementation, verified live against a real running Windows app (`cli.py inspect`/`start`/`mark`/`db` all exercised end to end, not just `cargo check`'d): process discovery (`find_process.py`, psutil-based, no `pgrep`/`lsof`), freeze detection (`freeze_detector.py`, `user32!IsHungAppWindow` on the app's main HWND via new `win_helpers.py`, the same API Task Manager uses for "(Not Responding)"), log tailing (`log_file.py`, `%LOCALAPPDATA%\com.tareq.chromasmith\logs\Chromasmith.log` — path confirmed against a real log file, not guessed), `catalog.db` access (`db.py`, `%APPDATA%\Chromasmith\catalog.db` — note the PRODUCT NAME not the identifier, a real cross-platform naming split already in `platform/windows.rs`'s `data_root()`, confirmed against a real live db), child-process/stall tracking (`child_watch.py`, `psutil` children/cpu; pipe-fd-count is `None` on Windows — a genuine capability gap, documented, not silently faked), a window screenshot (`screenshot.py`, pure-ctypes GDI `PrintWindow` capture + a from-scratch minimal PNG encoder using stdlib `zlib` — no Pillow — verified against a real captured, correctly-rendered app window), and a best-effort stack dump (`sample_capture.py`, Sysinternals `procdump -ma`, degrades cleanly to "unavailable" like macOS's `sample` when not installed). `pipe_dtrace.py` is a documented no-op on Windows (no ETW equivalent wired up). **Also fixed as a prerequisite**: `diag_state_path` — the native diagnostics bridge (`chromasmith-22.html`'s `writeDiag()`, `write_file_bytes`) had a hardcoded `/tmp/chromasmith_diag_state.json` literal that silently failed on Windows (`std::fs::write` there resolves a leading `/` to the CURRENT DRIVE's root, not a real temp dir, and the JS side's own `catch(_){}` swallowed the error) — replaced with a new `diag.rs::diag_state_path()` Tauri command (`env::temp_dir()`), matched on the Python side by `tempfile.gettempdir()`; confirmed live that the bridge file now writes and is read correctly on Windows. |
| G18 | Toolchain missing: no Rust, no Node, no VS Build Tools; `sam2/*.onnx` + `rawdenoise/*.onnx` not fetched (gitignored on both platforms); no `onnxruntime.dll` | this PC | Nothing builds | **Fixed** — Rust (rustup stable-x86_64-pc-windows-msvc), Node LTS, and VS Build Tools (Desktop C++ workload) all installed via winget; sam2/rawdenoise models and the win-x64 ORT dll all fetched. `cargo check --bin chromasmith` passes clean (warnings only) — **first-ever successful Windows compile of this port** |

### G6, in full: one hanging test, four real bugs
`cargo test` initially looked hung (400+ CPU-seconds and climbing on one test, no progress in the
output). Killing it and re-running with `--test-threads=1` proved it wasn't system load — the
SAME single test, run alone with nothing else competing, still didn't finish in 180s. Reading the
actual code (not more guessing) found the real cause, and fixing it surfaced three more bugs the
hang had been masking:

1. **`std::fs::canonicalize`'s `\\?\` prefix breaks `add_root_run`'s prefix-strip.** `canon_str.
   strip_prefix(&mount_point)` fails silently (`canon_str` is `\\?\C:\Users\...`, `mount_point`
   from `GetVolumePathNameW` is `C:\`, they don't share a prefix), so `rel_path` becomes the
   WHOLE canonical path. `hash_run`'s `loop {}` re-selects the same never-hashed row every pass
   (its `WHERE content_hash IS NULL` never stops matching) — a genuine infinite loop, not just a
   cosmetic path issue. **Fix:** swapped all 7 `canonicalize` call sites (`catalog.rs` ×5,
   `dcp_store.rs` ×2) for `dunce::canonicalize` — a drop-in replacement (added as a dependency)
   that strips the verbatim prefix when safe, and is a pure passthrough to std's canonicalize on
   macOS/Linux.
2. **`abs_path()` and `find_photo_by_abs_path()` both hardcoded a bare `"/"` for local-volume
   paths** — correct only because macOS's boot volume mount point happens to BE `/`; on Windows
   it's `C:\`, so every reconstructed/looked-up path was garbage (`/Users\Tareq\...` — a leading
   POSIX slash glued onto a backslash path, naming no real file). This is what produced the
   cascade of "not in the catalog" panics that persisted even after fix #1. **Fix:** both now use
   `Path`/`Path::join`, which correctly uses the volume's real mount point and the platform's
   native separator, for local and external volumes alike — no more special case.
3. **`is_ancestor_rel` checked for a hardcoded `b'/'` segment boundary** — `rel_path` strings use
   the native separator (`\` on Windows after fix #1's `canon_str` is native, not `\\?\`-escaped),
   so a Windows rel_path like `Users\a\2026` never registered as a descendant of `Users\a`,
   breaking nested-root collapse. **Fix:** compare against `std::path::MAIN_SEPARATOR` instead.
   Two existing tests (`is_ancestor_rel_is_segment_aware_not_a_string_prefix`,
   `collapse_nested_roots_cleans_up_rows_already_in_the_db_and_keeps_photos`) had hardcoded `/`
   in their own fixture strings for the same reason and needed the same separator fix — a preview
   of G13 (portable test literals) showing up as a real assertion failure, not just a style nit.
4. **The ONNX Runtime dylib path was hardcoded to the macOS filename at 14 call sites** —
   `platform::ort_lib_filename()` already existed (returns `"onnxruntime.dll"` on Windows) but was
   never actually called; every site (the real runtime path in `main.rs`, plus one `#[cfg(test)]`
   helper each in `arcface.rs`, `catalog.rs` ×5, `clip.rs`, `depth.rs`, `faceparse.rs`,
   `petdetect.rs`, `sam.rs`, `scrfd.rs`, `subject.rs`) built the path with the literal string
   `"vendor/onnxruntime/libonnxruntime.dylib"`. Every ONNX-backed test failed with `LoadLibraryExW
   failed` even after the crate itself compiled and linked cleanly. **Fix:** added
   `platform::ort_lib_dev_path()` (the dev-tree source path, which differs by OS — Windows keeps
   its dll under `vendor/onnxruntime/win-x64/`, not flattened like the bundled resource) and swapped
   every hardcoded literal for it.

Net result: `cargo test --bin chromasmith` went from hanging indefinitely to **235/236 passing**
(the one remaining failure, `cache_usage_by_root_and_clear_are_scoped_correctly`, is a
pre-existing, self-documented flaky test — a real, shared, unisolated disk cache directory raced
across parallel test threads; confirmed passes reliably alone, not a Windows-specific regression).

### Research: the G4 fix (Windows file-open / deep-link)
`tauri-plugin-single-instance` with its `deep-link` Cargo feature is the standard pattern: it
fires a callback with the second instance's `argv` (and cwd), and — when built with that feature
— runs *before* `tauri-plugin-deep-link`'s own event so a deep-link URL arriving as an argv
element gets handled the same way on the second launch as on the first. One documented pitfall:
naively scanning argv for anything that parses as a URL can false-positive on the executable's own
path (`C:\Users\...` parses with scheme `c`) — filter by the registered scheme *inside* the
`find_map`, not after. Wire both the file-path and Adobe-OAuth-URL branches into the **existing**
`PendingOpen`/`PendingOAuth` state (main.rs) so the frontend-facing contract (`open-file-path`,
`adobe-oauth-callback` events) doesn't change — only how those two get populated on Windows.
Sources: [tauri-plugin-single-instance docs](https://docs.rs/tauri-plugin-single-instance/latest/tauri_plugin_single_instance/),
[Tauri deep-linking guide](https://v2.tauri.app/plugin/deep-linking/).

### Note: disk space
A full `cargo test` (not just `cargo check`) pulls in extra dev-dependencies `cargo check --bin`
never touches (webview/regex/CSS-selector crates for Tauri's own test harness), and a later
`cargo build --release` needs a **separate** `target/release/` tree. This PC's drive filled
completely (0 bytes free) mid-session from unrelated pre-existing data (a 1.36TB `C:\Games`, not
from this port's build artifacts — `target/debug` alone was ~2GB, `~/.cargo` ~664MB) and a `cargo
test` run failed outright with `os error 112`/`STATUS_ACCESS_VIOLATION` (not a real code bug —
rustc mid-write with no space to write to). Keep at least 15-20GB free before an iteration
session; freeing space mid-build can still leave partially-corrupt `target/` artifacts if the
build wasn't fully clean before it ran out — rerun rather than trust a build that hit ENOSPC.

---

## 2. Ground rules so changes carry over (set up before feature work)

1. **One frontend, capability-gated, never OS-gated.** Add a `platform_capabilities` Tauri command
   (Rust decides per OS: `{os, hdrExport:'heic'|'uhdr'|null, eject, haptics, fastThumb, videoPoster,
   revealLabel:'Finder'|'Explorer', modKey:'⌘'|'Ctrl'}`). `desktop-native.js` exposes it once as
   `window.CS_PLATFORM`, plus helpers `csKbd('shift','E')` and `csBaseName(p)`. Shared JS checks
   capabilities, never `os`. A feature built on macOS then turns up on Windows as either working
   or cleanly hidden, never broken.
2. **Rust: all OS calls through `platform::`.** OS-specific decoders follow the same pattern as
   submodules: `platform/{macos,windows}/thumb.rs` with identical signatures, returning `None` so
   callers fall back to the shared `image` crate path.
   New **parity gate** `test/platform_parity.mjs`: parses `pub fn` names in `platform/macos*` and
   `platform/windows*`, and fails on a mismatch (the same check done by hand in this review).
3. **Config split:** shared `tauri.conf.json` holds only what's common; Tauri 2 auto-merges
   `tauri.macos.conf.json` / `tauri.windows.conf.json` (window style, bundle targets, icons,
   ORT resource).
4. **Cross-platform scripts in Node, not bash:** `scripts/build-desktop.mjs` (replaces rsync/python
   staging; `build-desktop.sh` becomes a one-line wrapper), `scripts/fetch-models.mjs` (sam2,
   rawdenoise, pinned ORT for the current OS, with SHA-256 checks). CI and local both call these
   same scripts. Hooks that still need portability fixes get the same treatment as
   `bump-build-stamp.sh` did (a real script file the `.sh` wrapper calls, not inline heredocs).
5. **CI catches drift immediately:** add a `windows-latest` job to `editor-gates.yml` running
   `cargo check` + `cargo test --bin chromasmith` + the parity gate on every push; the macOS job
   runs `cargo check --target x86_64-pc-windows-msvc` too. A macOS-only change that breaks Windows
   fails that same day, not at release time.
6. **`.gitattributes`:** done (G16).
7. **Docs:** this file (fixes G1); CLAUDE.md §5 gets one pointer line to it, keeping every other
   session's context small.

---

## 3. Phased implementation

### Phase 0 — machine + groundwork (in progress)
- `winget install Rustlang.Rustup OpenJS.NodeJS.LTS Microsoft.VisualStudio.2022.BuildTools`
  (Build Tools with the **Desktop development with C++** workload, needed by rusqlite-bundled,
  onig and ort-sys).
- Ground rules 3/4/6/7 above; port the hooks (G15 done, G16 done, G14 still open).
- `scripts/fetch-models.mjs` fetches sam2 + rawdenoise (the README URLs) and **ORT for
  win-x64** (current release, pinned + hashed) into `vendor/onnxruntime/win-x64/`; gitignore the dll.
- Done when: `npm run build:dist` and `cargo check` work on Windows; editing the HTML bumps BUILD.

### Phase 1b — first launch
- `tauri.windows.conf.json`: `url: "index.html"` (let Tauri map the custom protocol; G2), native
  decorations, `bundle.targets:["nsis"]`, `icon.ico`, ORT dll resource, NSIS
  `installMode:"currentUser"`, WebView2 `downloadBootstrapper`.
- `tauri-plugin-single-instance` (feature `deep-link`) + argv parsing, fed into the **existing**
  `PendingOpen`/`PendingOAuth` handlers (G4); `deep_link().register_all()` at runtime for dev.
- ORT loading: `libloading::os::windows::Library::load_with_flags(abs_path,
  LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)` so dependent DLLs resolve
  next to ours, not from System32 (G5). Put it behind `platform::load_ort(path)`.
- `dunce::canonicalize` everywhere canonicalize is used; a Windows-only key normalisation
  (lowercase drive letter + path, `\` separators) in the catalog path-key function (G6).
- Fix `long_path` UNC + separators (G7).
- Make tests portable (G13): tempdir-based roots and a `test_volume_root()` helper instead of
  `/Volumes` literals.
- Windows app menu: skip it (the in-app UI + ⌘K palette already cover it); cfg-gate `Menu::with_items`.
- Done when: `cargo test --bin chromasmith` passes on Windows; the app launches; RAW opens; export works.

### Phase 2 — native parity
- **Thumbnails (G11):** done — `winthumb.rs` using WIC scaled decode. See the G11 table row above
  for detail, including the deliberate EXIF-orientation gap.
- **Video posters (G11):** done — `winvideothumb.rs` using `IShellItemImageFactory::GetImage`.
  See the G11 table row above for detail. Media Foundation `IMFSourceReader` remains the fallback
  plan only if exact-frame selection ever turns out to matter.
- **Volume identity (G8):** done — `GetVolumeNameForVolumeMountPointW` → `\\?\Volume{GUID}\`,
  wired into `catalog.rs`'s fingerprint fallback. A `GetVolumeInformationW` label is still open
  (not needed for identity, only cosmetic — e.g. showing a friendly volume name somewhere).
- **Eject (G9):** done, via the KB165721 volume-handle sequence instead of the
  `CM_Request_Device_EjectW` approach originally planned here (simpler, no admin needed) — see
  the G9 table row for the reasoning. Unverified against real hardware.
- **DCP (G10):** done (Phase 1b) — `platform::adobe_profile_roots()`.
- **Background work:** done — Windows 11 **EcoQoS** via `SetThreadInformation(ThreadPowerThrottling)`
  in `mark_current_thread_background`; `throttle_pause` reads battery saver via
  `GetSystemPowerStatus` (Windows has no public thermal-state API, so only that one signal exists
  there, unlike macOS's two).
- **Haptics:** still open — the no-op already exists; needs the `platform_capabilities`/
  `window.CS_PLATFORM` plumbing (ground rule 1) to actually surface `haptics:false` to the
  frontend, which hasn't been built yet as of this phase.

### Phase 3 — frontend (mostly mechanical → a cheaper model is fine)
- ~~`window.CS_PLATFORM` + helpers; replace `split('/')`, "Reveal in Finder", and hard-coded ⌘
  labels in `library-ui.js`/`desktop-native.js` (G12). Keydown handlers already accept `ctrlKey`;
  check each one.~~ **Done** — see the G12 table row above for detail. Keydown handlers were
  already correct; verified, not changed.
- ~~Traffic-light padding + `data-tauri-drag-region` only when `CS_PLATFORM.os==='macos'` (native
  frame on Windows, per the decision above).~~ **Done** — see the G12 table row above for detail.
- Any `chromasmith-22.html` touch is a shader-free edit but still run the export harness (CLAUDE.md
  contract rule 2 — even a comment-only change needs a live reload + harness run).

**Phase 3 complete.**

### Phase 4 — HDR export (Ultra HDR JPEG)
- Pure-Rust `ultrahdr-rs` / `ultrahdr-core` (imazen): ISO 21496-1 APP2 + MPF, no C deps, fits the
  project's crate policy. New `gainmap_uhdr.rs` reuses the **existing** headroom-map computation
  that `write_gainmap_heic_from_map` already receives from JS — only the container/encoder is new.
- Offer it on **both** platforms (capability `hdrExport` lists formats); macOS keeps HEIC too.
- Verify output in Chrome/Edge on an HDR display and in Lightroom import; check Windows Photos by
  hand (support there wasn't confirmed by research — see §5).

### Phase 5 — packaging + CI release
- **Done** — `desktop-dmg.yml` renamed to `desktop-release.yml` with a new `nsis` job
  (`windows-latest`) alongside the existing `dmg` job (`macos-13`), rather than one shared
  `strategy: matrix` block — the packaging step (hdiutil vs locating the NSIS `.exe`) and the
  resource-verification step (windows also merges `tauri.windows.conf.json`'s `onnxruntime.dll`
  resource) differ enough that a shared step list would need almost as much per-OS branching.
  Both jobs now call the same new `scripts/fetch-models.mjs` (ground rule 4) instead of each
  having their own curl/python steps — it fetches sam2 + rawdenoise on both platforms and the
  win-x64 ONNX Runtime DLL only on Windows (`--windows-ort` forces it elsewhere). The nsis job
  renames Tauri's default NSIS output to `Chromasmith-<ver>-windows-x64-setup.exe` and uploads it
  to the same `v*` tag release the dmg job publishes to; the dmg job's release body now also
  covers Windows SmartScreen ("More info → Run anyway") and points at LICENSES-MODELS.md.
  Verified live: `node scripts/fetch-models.mjs --windows-ort` on this dev machine correctly
  resolved the latest ONNX Runtime release via the GitHub API, downloaded the win-x64 zip, and
  extracted a valid 16MB `onnxruntime.dll` via bsdtar (`%SystemRoot%\System32\tar.exe`, which
  understands zip unlike Git Bash's bundled GNU tar — the same PATH trap G14 already
  documented for a different tool). **Not yet verified**: an actual `windows-latest` CI run of the
  new job (this session had no way to trigger GitHub Actions), and whether NSIS's default output
  filename/path assumptions in the packaging step hold on a clean runner.
- **Still open**: NSIS file-association + Adobe deep-link scheme registration on install. The
  `fileAssociations` list already lives in the shared `tauri.conf.json` and Tauri's NSIS bundler
  registers those automatically; the deep-link scheme (`tauri.conf.json`'s `plugins.deep-link`)
  needs verifying it's also picked up by the NSIS installer (Tauri 2's deep-link plugin docs say
  yes for Windows via registry, but this hasn't been confirmed against a real installed build on
  this port).

### Phase 6 — Windows diagnostics + real-engine testing
- **Diagnostics tool: done** (2026-09-15), see G17 above for the full module-by-module list and
  live verification. `log_file.py`/`db.py` branch to the real Windows paths (confirmed against a
  live app, not guessed); `find_process`/`process_metrics`/`child_watch` via psutil; native stacks
  via Sysinternals `procdump` when present, degrading cleanly when not (matches macOS's `sample`
  degrade). `hang-diagnose`'s CDP stack sampling needed no change — it already drives the WebView's
  own JS debugger, and WebView2 supports CDP the same as WKWebView.
- **Still open**: launching dev/test builds with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and adding
  `test/attach_app.mjs` (Playwright `chromium.connectOverCDP`), so selected gates (`ui_audit`,
  export determinism, a library smoke) run **inside the real Windows app** rather than a bare
  Chromium instance — this closes, for Windows, the "tests drive Chromium, not the shipping
  engine" gap CLAUDE.md §2 warns about for macOS. Not attempted this pass.

---

## 4. Token-efficiency practices for this work
- **Start each session by reading this file's status table** instead of re-exploring; each phase
  ends by updating it. That replaces most Explore-agent sweeps.
- **One phase/topic per session**; don't carry COM work and JS relabelling in the same context.
- **Compile-first loop:** `cargo check` (seconds) before `cargo build`/`tauri dev` (minutes); gate
  output stays terse (`quick-checks` skill); screenshots only for the final visual check.
- **Cheaper model for mechanical phases** (script ports, Phase 3 relabelling); a stronger model for
  COM/WIC/ORT/catalog path-key work where mistakes are subtle and hard to notice without a
  compiler running (see the hook-fix debugging notes in G15 — a heredoc/stdin conflict and a
  path-flavor mismatch, neither of which produced an error message, both only found by actually
  running the fixed version with test inputs).
- Parity gate + Windows CI job catch drift automatically, instead of a model re-auditing both
  platforms by hand later.
- Keep the Windows notes out of CLAUDE.md apart from one pointer line (the size hook already warns
  on CLAUDE.md growth).

---

## 5. Tools, plugins, and features: Windows vs macOS

| Area | macOS today | Windows option | Verdict |
|---|---|---|---|
| WebView | WKWebView (SAB unreliable, no CDP, differs from the Chromium tests) | **WebView2 = Chromium**: same engine as all Playwright gates, CDP attach, SAB works | **Windows better** |
| ONNX Runtime | Pinned 1.20 Intel dylib, CPU, Rosetta on Apple Silicon | Current x64 release; optional **DirectML** EP (GPU on any DX12 GPU), to measure behind a flag | **Windows better** (watch G5) |
| Fast thumbs | ImageIO | WIC scaled decode | Equivalent |
| Video posters | AVFoundation | Shell image factory / Media Foundation | Equivalent |
| HEIC read | Built in | Needs Store HEIF/HEVC extensions | macOS better; fail cleanly |
| HDR export | HEIC + gain map (ImageIO) | **Ultra HDR JPEG** (pure Rust), usable on both. Widest current viewer support: Chrome/Edge/Brave/Opera by default, Lightroom/ACR, Android. AVIF gain maps are smaller and gaining support but need a C AV1 encoder (project avoids that dependency class), so treat as a later option. JPEG XL isn't viable (off by default in Chrome as of this research) | Ultra HDR is the right choice now, for both platforms |
| Trash | ~/.Trash rename | IFileOperation Recycle Bin | Windows slightly better (real API, real undo) |
| Eject | diskutil | cfgmgr32 `CM_Request_Device_EjectW` | Equivalent |
| Volume identity | APFS UUID | Volume GUID path | Equivalent once G8 is done |
| Background QoS | pthread QoS + thermal/low-power | EcoQoS + battery saver (no thermal API) | Roughly equal |
| Haptics | Force Touch | None | macOS only |
| File open / deep link | Launch Services event | argv + single-instance plugin | Equivalent (more wiring on Windows) |
| Title bar | Overlay + traffic lights | Native frame (Win11 snap layouts included) | Equivalent — decided: native on Windows |
| Installer / signing | Unsigned dmg, Gatekeeper right-click | Unsigned NSIS, SmartScreen warning; later Azure Trusted Signing (~$10/mo, much cheaper than an Apple Developer cert) | Windows cheaper to sign later |
| Logging | ~/Library/Logs | %LOCALAPPDATA%\…\logs (same tauri-plugin-log) | Equivalent |
| Diagnostics | sample/dtrace | CDP (JS) + procdump/cdb/WPR (native) | JS side better on Windows; native side a different toolset |
| `hang-diagnose` skill | CDP against test Chromium only | CDP against the **real app** (WebView2 = Chromium) | **Windows better** |
| `editor:webkit-smoke` gate | WebKit proxy for WKWebView | Irrelevant for Windows; keep for macOS only | — |
| Claude Code hooks | bash + BSD tools | Portable rewrite needed (in progress — see G15) | Improves both platforms once done |
| Calibration (`calib/` Python) | python3 | `py` launcher or a real venv `python`; same code — watch for the Store-stub `python3` issue found in G15/G18 | Equivalent once the interpreter is right |
| Browser pane / Claude in Chrome | Available | Available | No difference |
| Figma plugin | Needs auth | Needs auth (unauthorised on this account as of this session) | No difference |
| Camera tethering (ROADMAP R14) | libgphoto2 | WPD driver conflicts, per ROADMAP.md | macOS better |

Sources for the HDR format research: [Greg Benz – HDR display support](https://gregbenzphotography.com/hdr-display-photo-software/),
[Greg Benz – ISO gain maps](https://gregbenzphotography.com/hdr-photos/iso-21496-1-gain-maps-share-hdr-photos/),
[Ultra HDR (Wikipedia)](https://en.wikipedia.org/wiki/Ultra_HDR), [imazen/ultrahdr](https://github.com/imazen/ultrahdr),
[Mark Heath – HDR formats](https://www.mark-heath.com/hdr-image-formats/),
[Uploadcare – AVIF vs JPEG XL 2026](https://uploadcare.com/blog/avif-vs-jpeg-comparison/).

---

## 6. Critical files
`desktop/src-tauri/src/platform/{mod,macos,windows}.rs` · `main.rs` (handlers, `cs` protocol,
`RunEvent::Opened`, menu, log plugin) · `library.rs` · `catalog.rs` (path keys, tests) ·
`dcp_store.rs` · `bgwork.rs` · `sam.rs`/`rawdenoise.rs` (ORT load) · `tauri.conf.json` (+ new
platform overrides) · `Cargo.toml` · `desktop/desktop-native.js` · `desktop/library-ui.js` ·
`build-desktop.sh` · `.claude/hooks/*.sh` (+ new `.py` companions where a hook needs real logic) ·
`.github/workflows/desktop-release.yml`, `editor-gates.yml` · `scripts/fetch-models.mjs` ·
`diagnostics/` · this file.

## Completeness check
"Done" is measured by scans of the code and the running app, not by the lists above:
1. **Commands:** extract every name in `generate_handler![…]` (`main.rs`) and every `invoke('…')`
   in the JS. Each one is exercised on Windows or listed as capability-disabled. Scan result = done list.
2. **OS gates:** `grep -rn 'cfg(target_os\|cfg(windows' src/` outside `platform/` must return only
   entries recorded in this file with a reason. `platform_parity.mjs` must pass.
3. **Frontend strings:** `grep -n "⌘\|Finder\|split('/')\|metaKey"` in desktop JS returns only uses
   that go through `CS_PLATFORM` helpers.
4. **Real-app UI:** via CDP attach, run `ui_audit` + the responsive checks in the Windows app at the
   900px min width, default, and maximised; for each resizer at min/default/max; light + dark
   theme; Library and Editor modes; 125%/150% display scaling (a Windows-specific axis).
5. **OS entry points:** every `fileAssociations` extension opened from Explorer (app closed, and
   app already open); the Adobe deep link; drag-drop from Explorer; UNC path and external drive
   reconnected on a different letter.
6. **Each gate must fail first on the real defect** (e.g. the parity gate fails before its fix; the
   hook test fails against the pre-fix `sed -i ''`/`jq` version — confirmed for G15).
7. **Fresh-context gap review** of this file against scans 1–5 before Phase 5 ships.

## Verification
- Per phase: `cargo check` → `cargo test --bin chromasmith` (Windows) → `npm run build` in
  `desktop/` → `npm run dev` launch → `node test/export_harness.mjs` (CLAUDE.md contract rule 2) →
  CDP-attached gates (Phase 6 onward).
- End-to-end manual: install the NSIS build on a clean user profile, open an RW2 from Explorer,
  apply a look, export JPEG + Ultra HDR, import a card and eject it, trash a photo (check the
  Recycle Bin), run an AI mask (SAM2) and a denoise (ORT loaded from app dir, confirmed in the log).
- CI: Windows job green on `main`; tag `v*` produces both the dmg and the setup.exe.
