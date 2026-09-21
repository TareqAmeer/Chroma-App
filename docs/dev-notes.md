# Dev notes (moved out of CLAUDE.md §2)

- **RAW support needs cross-origin isolation** (`SharedArrayBuffer` → COOP/COEP). GitHub Pages can't set those headers, so `coi-serviceworker.min.js` (first `<head>` script) enables isolation client-side and reloads once on first visit.
- **Build stamp:** `chromasmith-22.html` has `const BUILD='YYYY-MM-DDx'` near the top of its
  `<script>`, shown in the header + startup log, so users can spot a stale Pages/Safari cache.
  A `PostToolUse` hook (`.claude/settings.json`) auto-bumps it to today's date on any Edit/Write
  to the file — nothing to remember manually.
- ⚠️ **Watch the payload.** "Single-file" is about the app CODE, not about inlining bulk data.
  The preset library grew 11 → 113 as base64 string literals and took the file to **17.7 MB
  (10.2 MB gzipped)** — parsed in full on every web cold load, every iOS launch and every
  desktop `dist/` read. `calib/split_lut_presets.py` moved the 102 non-core presets into
  `vendor/luts/<key>.bin` as raw bytes (**3.02 MB / 1.76 MB gzipped**, a 5.8× cut in transfer).
  Before inlining any new bulk asset, check what it does to `gzip -9 -c chromasmith-22.html | wc -c`.
  - Load order in `presetBytes()`: inline `LUT_PRESETS` → IndexedDB `lutcache` → `fetch`.
  - The 11 `User Looks` stay inline **on purpose**: a bare copy of the HTML opened over
    `file://` cannot `fetch()`, and those are the looks that have to survive that.
  - ⚠️ The cache is a **second object store** (`lutcache`, DB v2). It must not share the `luts`
    store — `lutLibList()` is a bare `getAllKeys()` feeding the "My library" optgroup, so 102
    cached built-ins in there would all appear as the user's own uploaded LUTs.
  - `lutWarmCache()` pulls the rest into IndexedDB on idle after `load`, so the WEB build is
    genuinely offline-capable after one visit. Desktop/iOS read `vendor/` off local disk and
    never depended on it. Both build scripts already `cp -R vendor`, so nothing to wire up.
- **Heavy JS goes in the pixel worker** (`_cpuRun`, next to `srgbG`). `bakeDcpLUT` (65³ =
  274,625 iterations; **1157 ms of frozen UI** on every RAW load / profile change) and
  `exportSharpen` (a ~72M-channel loop over a 24MP export) both run there now.
  ⚠️ The worker source is **built from the real functions** via `Function.prototype.toString`,
  never hand-copied — `bakeDcpLUT` is an exact DNG-SDK transcription (docs/raw-dcp.md) and a drifting second
  copy would show up only as "RAW colour is subtly wrong". `perf_bench.mjs` asserts the worker
  and main thread agree to **max|Δ| = 0** over all 823,875 LUT entries, and that adding a
  dependency the worker can't see fails loudly rather than silently.
  ⚠️ Transferred `ArrayBuffer`s are **detached** in the main thread, so `_cpuRun` falls back to
  running inline only *before* dispatch, never after a job is in flight.
- **Local preview gotcha (macOS):** sandboxed preview servers can't read `~/Documents` (TCC).
  Serve a copy from `/tmp/` instead.
