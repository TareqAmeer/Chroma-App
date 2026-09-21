# CHR-121 handover — RAW open speed (state at main 3e7c4ac)

Paste the "PROMPT" section into a new chat. Read this file, docs/handover/CHR-121-raw-processing.md, and skim CLAUDE.md first (grep -n + offset/limit; never read chromasmith-22.html whole).

## What is done (all on main)
- Interactive open runs only the chroma-wavelet NR (`NrTier::Chroma`, desktop/src-tauri/src/raw_decode.rs). Shadow NR, false-colour and hue defringe are deferred to export (`window.chromasmithApplyFullCleanup` in desktop/desktop-native.js, called from exportFX in chromasmith-22.html) or the Detail > Noise Reduction toggle "Full cleanup while editing" (`window.chromasmithRawFullCleanup`, localStorage). Batch cache (`cache_raw_decode`) always runs the full cleanup under a 'full' recipe key; opens prefer a 'full' entry (`window.__chromasmithFullCleanupPaths` makes export skip its own cleanup).
- Byte-identical speedups: race fix in `local_contrast_5x5`, vectorised a-trous smooth, level-synchronous wavelet pyramid (peak RSS 2.2GB -> 1.6GB; the 8GB Mac was swapping during refine, which made in-app 2-3x slower than headless).
- Decode-cache PNG is now encoded in a worker (canvas.toBlob froze the main thread 1.7s+ after each refine).
- Tooling: `dump_rw2` (headless stage timings, `CS_DUMP_UTILITY`), `diagnostics/app_control.py` (`start --automation --env K=V`, `run --action eval --code`, `screenshot --out`, `stop`, `status`), and precise cold-open marks via `window.__pm` -> `window.__rawPerfLog` (native-open-begin, loadRw2-enter/opened/imagedata/return, native-refine-invoke/returned, refine-applied).
- Rejected with data: GPU (wgpu/Metal) chroma NR on the Intel Iris 645 = 2.07s vs 1.48s CPU; AVX2 build (no gain, memory-bound); reduced-resolution chroma NR (saves ~0.6s, dE76 p99 1.8).

## Measured cold-open timeline (real app, high-ISO 24MP RW2 on /Volumes/Crucial; noisy, machine was busy)
click +0 -> thumbnail +0.3s -> file read done +1.0-2.1s -> native decode starts ~+3s -> first full-res image +6.4-8.5s -> refined image applied ~+15-21s.
Native stages in-app: fast pass ~2.3-3.7s; refine: orientation 0.5-1.0s, lens 0.9-3.4s (auto-lens on), chroma NR 2.9-5.6s (headless 1.5-2.0s). Non-native gaps: ~0.8-1.7s between read-source and native start; ~2.2-2.7s between loadRw2 return and open-decode; refine-applied gap 5.5s before the worker fix, 1.9s after (one run each).

## Next steps (in order)
1. Re-measure on a QUIET machine (quit Linear/Claude/other apps, no rsync backup to /Volumes/Crucial, `caffeinate -d`), 3 cold opens of different high-ISO RW2s, using `__rawPerfLog` + Chromasmith.log RAW_DIAG lines. Produce one clean timeline table.
2. Attack the non-native gaps: (a) read-source -> loadRw2-enter (new File copy, loadFXImages prep, any hashing/EXIF work; ~0.8-1.7s); (b) loadRw2 return -> open-decode (~2.2-2.7s of JS: metadata, geometry, texture upload, updateWork/renderPreview at 24MP); (c) refine-applied path (putImageData + updateWork + renderPreview ~1s idle). Profile with `__pm` marks + eval timing of updateWork/renderPreview; consider moving the 96MB RGBA IPC to a file/asset path and avoiding double LUT->RGBA conversion between fast and refine.
3. Fuse lens correction + orientation into one resample pass (in-app ~1.4-4s combined); lens does a per-pixel `apply_geometry_distortion` + bilinear on a cloned 144MB buffer.
4. Speed up false-colour (~0.9s) and shadow NR (~0.7s) byte-identically (min/max SIMD median, tiling, halo) — now export/toggle only.
5. Visible-region-first cleanup with a halo sized so tiled == whole-frame output (byte-compare).
6. Only with the user's explicit OK: approximations (must report dE and show crops).

## Known state / traps
- Uncommitted on purpose: `.claude/settings.json` (Stop hook removed locally at the user's request), `CLAUDE.md` (edited by another session; do not commit without checking what moved where). `Archive/` is gitignored (personal photos). Never commit tracked-file deletions (icons, iOS assets, test goldens, coi-serviceworker.min.js, capacitor.config.json are essential; `git restore` them if they reappear).
- The live app stops answering when the display sleeps: run `(caffeinate -d -u -t 7200 &)`. After `./install-app.sh`, the first launch sometimes doesn't respond to `app_control run`; stop/start again and wait (poll `run --action eval --code 1`).
- Screen capture needs the shell to have Screen Recording permission; `app_control.py screenshot` fails ("could not create image from window") when the display is asleep or the window is hidden.
- Wavelet NR only runs at ISO >= 1600. Test RAWs: ~/Documents/CHROMASMITH PHOTOS/2026/08/22/__TM6130.RW2 (ISO 6400), __TM6132 (12800), __TM6135 (1600); library RAWs in /Volumes/Crucial/PHOTOS/2026/2026-09-12/. Cold opens need photos not opened before (disk cache otherwise).
- Golden for byte-compares must be regenerated from HEAD: `CS_NR_TIER=fast|chroma target/release/examples/dump_rw2 <RAW> <out.bin>` then `cmp`.
- Known pre-existing: `npm run lib:test` times out on `[data-coll="edited"]` (a modal intercepts clicks).

## PROMPT (paste into the new chat)
```
Continue CHR-121 (RAW open speed) in /Users/tareqameer/Documents/GitHub/Chroma-App. Read docs/handover/CHR-121-next-steps.md and docs/handover/CHR-121-raw-processing.md first, then CLAUDE.md (grep -n + offset/limit only). Goal: a RAW's full-quality, colour-accurate image ready in <3s on the dev Mac (Intel i5-8257U, 8GB RAM) as far as achievable; report plainly what remains >3s and why.

Rules: terse, no narration between tool calls, 1-3 sentence end summary; measure before changing; one lever per commit; commit + push to main after each real edit with `git commit -- <paths>` (never `git add -A`; trailer Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>); byte-identical unless I approve a dE-quantified change with side-by-side crops; never assume - verify live. Do not commit Archive/, .claude/settings.json, CLAUDE.md, or tracked-file deletions.

Token efficiency: grep first, Read with offset/limit, pipe outputs through grep/tail/cut, write bulk output to the scratchpad and print summaries, batch independent tool calls, no subagents unless a chore is large and independent.

Start with step 1 of "Next steps" (quiet-machine timeline), then steps 2-5. Use diagnostics/app_control.py (start --automation --env CS_DIAG_RAW_STAGES=1; run --action eval --code ...; screenshot; stop) and window.__pm/__rawPerfLog for live timelines, dump_rw2 for headless stage timings and byte-compares. Keep the display awake (caffeinate). Validate every change with: byte-compare vs a fresh HEAD golden (fast + chroma tiers, ISO 6400 and 12800), node test/export_harness.mjs, node test/editor_snap_lists_check.mjs, node test/editor_html_validity_check.mjs, npm run perf:test, cargo build --release, and a live cold open (fast pass, refine, fully-loaded, peak RSS/swap) plus the Full-cleanup toggle, export cleanup and batch-cache checks. Finish with a before/after table (headless total; in-app first image, refined image, peak RSS).
```
