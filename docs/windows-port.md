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
| G2 | Window URL hardcoded `cs://localhost/index.html`; WebView2 serves custom schemes as `http://cs.localhost/` | `tauri.conf.json` | Blank window on launch | Open |
| G3 | `titleBarStyle:Overlay`, `hiddenTitle`, `transparent`, `macOSPrivateApi`, `.icns`-only icon, `targets:["app"]`, resources list `libonnxruntime.dylib` | `tauri.conf.json` | Bundle fails or looks broken | Open |
| G4 | File-open + Adobe OAuth deep link only handled via `RunEvent::Opened` (macOS-only); on Windows they arrive in **argv of a second process** | `main.rs` | Double-click in Explorer / Adobe sign-in silently do nothing | Open |
| G5 | No `onnxruntime.dll` in tree, **and `C:\Windows\System32\onnxruntime.dll` exists** (Windows ML's own copy) | `vendor/onnxruntime/` | Its dependent DLLs may resolve from System32 → version mismatch | Open |
| G6 | `std::fs::canonicalize` returns `\\?\C:\…` on Windows; catalog canonicalises paths as keys. Windows paths are also case-insensitive | `catalog.rs`, `library.rs` | `\\?\` paths leak into the UI/JS; duplicate rows for `C:\Photos` vs `c:\photos` | Open |
| G7 | `long_path()` prefixes UNC paths wrongly (`\\server\share` needs `\\?\UNC\server\share`) and doesn't accept `/` | `platform/windows.rs` | NAS libraries fail | Open |
| G8 | `volume_identity_hint` returns just the drive letter; letters change between plug-ins | `platform/windows.rs` | External drive shows "offline" or duplicates after reconnect | Open |
| G9 | `eject` is a stub | `platform/windows.rs` | Card ingest can't eject | Open |
| G10 | Adobe DCP profile tree hardcoded to the macOS path | `dcp_store.rs` | User-installed camera profiles not found (Windows: `%ProgramData%\Adobe\CameraRaw\CameraProfiles`) | Open |
| G11 | No Windows fast thumbnail or video poster path (ImageIO/AVFoundation only) | `fastthumb.rs`, `videothumb.rs` | Slow grid (~800ms/24MP JPEG through `image`), no video thumbnails | Open |
| G12 | JS assumes macOS: `split('/')` basenames, "Reveal in Finder", ⌘ shortcut labels, traffic-light padding/drag region | `library-ui.js` (43 hits), `desktop-native.js` | Wrong filenames, wrong labels | Open |
| G13 | Rust unit tests use `/Volumes/...` and `~/Library/...` literals | `catalog.rs` tests (~15 sites) | `cargo test` fails on Windows before any real bug is found | Open |
| G14 | `build-desktop.sh` needs `rsync` + `python3` (rsync not installed on Windows; `python3` on PATH is the Microsoft Store stub, not real Python) | `build-desktop.sh`, `desktop/package.json` | `npm run build:dist` fails | Open |
| G15 | `bump-build-stamp.sh` used `jq` (not installed), BSD `sed -i ''` (no-op under GNU sed), a bash-built POSIX path compared against a Windows path, and a `python -` + heredoc that ate its own piped stdin | `.claude/hooks/` | BUILD-stamp hook silently did nothing off macOS | **Fixed** — rewritten as `bump-build-stamp.py` + a thin `.sh` wrapper that picks a working `python`/`python3`; tested with 4 cases (stale+relative path, stale+native Windows path, already-today no-op, wrong-file no-op) |
| G16 | `core.autocrlf=true`, `.gitattributes` only covered the two LFS globs | repo root | CRLF risk in `.sh` hooks and byte-compared goldens/hashes | **Fixed** — `.gitattributes` now sets `* text=auto eol=lf` plus explicit `binary` for onnx/image/icon formats |
| G17 | `diagnostics/` + the `chromasmith-debugger`/`hang-diagnose`/`chromasmith-diagnostics` skills assume macOS (`sample`, dtrace, `~/Library/Logs`, `.app` bundle) | `diagnostics/*.py` | CLAUDE.md's debugger-agent rule doesn't work on Windows yet | Open — Phase 6 |
| G18 | Toolchain missing: no Rust, no Node, no VS Build Tools; `sam2/*.onnx` + `rawdenoise/*.onnx` not fetched (gitignored on both platforms); no `onnxruntime.dll` | this PC | Nothing builds | **Rust + Node installed** (`rustup` stable-x86_64-pc-windows-msvc, Node LTS via winget); VS Build Tools (Desktop C++ workload) installing; models/ORT dll not yet fetched |

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
- **Thumbnails (G11):** `platform/windows/thumb.rs` using WIC `IWICBitmapSourceTransform` scaled
  decode (the analogue of ImageIO's reduced-DCT path). HEIC only works if the user has the
  HEIF/HEVC extensions, so fail cleanly to the existing path.
- **Video posters:** `IShellItemImageFactory::GetImage` (uses whatever codecs Windows has, runs on
  a COM STA thread like trash). Use Media Foundation `IMFSourceReader` only if exact-frame
  selection turns out to matter.
- **Volume identity (G8):** `GetVolumeNameForVolumeMountPointW` → `\\?\Volume{GUID}\`, which
  survives drive-letter changes, plus a `GetVolumeInformationW` label.
- **Eject (G9):** `CM_Request_Device_EjectW` (cfgmgr32). No admin needed, unlike
  `IOCTL_STORAGE_EJECT_MEDIA`.
- **DCP (G10):** `platform::adobe_profile_roots()`.
- **Background work:** Windows 11 **EcoQoS** via `SetThreadInformation(ThreadPowerThrottling)` in
  `mark_current_thread_background`; `throttle_pause` reads battery saver via `GetSystemPowerStatus`
  (Windows has no public thermal-state API — note that limitation, don't try to fake it).
- **Haptics:** the no-op already exists; capability `haptics:false`.

### Phase 3 — frontend (mostly mechanical → a cheaper model is fine)
- `window.CS_PLATFORM` + helpers; replace `split('/')`, "Reveal in Finder", and hard-coded ⌘
  labels in `library-ui.js`/`desktop-native.js` (G12). Keydown handlers already accept `ctrlKey`;
  check each one.
- Traffic-light padding + `data-tauri-drag-region` only when `CS_PLATFORM.os==='macos'` (native
  frame on Windows, per the decision above).
- Any `chromasmith-22.html` touch is a shader-free edit but still run the export harness (CLAUDE.md
  contract rule 2 — even a comment-only change needs a live reload + harness run).

### Phase 4 — HDR export (Ultra HDR JPEG)
- Pure-Rust `ultrahdr-rs` / `ultrahdr-core` (imazen): ISO 21496-1 APP2 + MPF, no C deps, fits the
  project's crate policy. New `gainmap_uhdr.rs` reuses the **existing** headroom-map computation
  that `write_gainmap_heic_from_map` already receives from JS — only the container/encoder is new.
- Offer it on **both** platforms (capability `hdrExport` lists formats); macOS keeps HEIC too.
- Verify output in Chrome/Edge on an HDR display and in Lightroom import; check Windows Photos by
  hand (support there wasn't confirmed by research — see §5).

### Phase 5 — packaging + CI release
- Extend `desktop-dmg.yml` into a matrix (rename `desktop-release.yml`): `windows-latest` job runs
  `node scripts/fetch-models.mjs`, `npm run build`, uploads
  `Chromasmith-<ver>-windows-x64-setup.exe` to the same `v*` release. Release notes cover
  SmartScreen ("More info → Run anyway") and LICENSES-MODELS.
- NSIS registers file associations (from shared config) and the Adobe deep-link scheme.

### Phase 6 — Windows diagnostics + real-engine testing
- Launch dev/test builds with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  and add `test/attach_app.mjs` (Playwright `chromium.connectOverCDP`), so selected gates
  (`ui_audit`, export determinism, a library smoke) run **inside the real Windows app**. This
  closes, for Windows, the "tests drive Chromium, not the shipping engine" gap CLAUDE.md §2 warns
  about for macOS.
- `diagnostics/`: branch `log_file.py` to `%LOCALAPPDATA%\com.tareq.chromasmith\logs`;
  `find_process`/`process_metrics` via psutil; JS stack sampling via CDP (reuses the
  `hang-diagnose` approach); native stacks via `cdb`/`procdump` only when needed. Update the
  debugger agent + diagnostics skill with a short "on Windows" section.

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
`.github/workflows/desktop-dmg.yml`, `editor-gates.yml` · `diagnostics/` · this file.

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
