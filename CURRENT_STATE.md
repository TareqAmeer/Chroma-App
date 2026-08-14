# Current state

_Last updated: 2026-08-15._

This file tracks **what is in flight right now**. Anything finished and durable belongs in
`CLAUDE.md`; anything planned belongs in `ROADMAP.md`. If this file is older than the last few
commits, trust `git log` over it.

## In flight — the performance / feature / UI plan

Full plan: `~/.claude/plans/identify-additional-performance-feature-elegant-boole.md`. It came
out of an audit across the three surfaces (Tauri desktop, Pages web, Capacitor iOS) plus a
comparison against Dehancer (the film lane) and RapidRAW/Lightroom (the editor lane).

### ✅ Phase A — payload and main thread (done)

The app file was **17.7 MB / 10.2 MB gzipped**, and 16.3 MB of that was 113 base64 LUT presets
(the original 11 plus 102 added since) parsed on every cold load. Four changes, none of which
touch a shader — all 18 export goldens stayed byte-exact throughout:

| | before | after |
|---|---|---|
| `chromasmith-22.html` | 17.68 MB | **3.02 MB** |
| gzipped (what Pages serves) | 10.19 MB | **1.76 MB** |
| look thumbnails rendered per gallery build | 114 / 114 | **11 / 114** |
| retained `_presetLutCache` | 48.7 MB | **9.87 MB** (LRU, 24) |
| main-thread freeze per DCP bake | 1157 ms | **~18 ms** (worker) |

- 102 presets moved to `vendor/luts/*.bin` (`calib/split_lut_presets.py`, idempotent, `--check`
  verifies). The 11 `User Looks` stay inline so a `file://` copy still works. `lutWarmCache()`
  pulls the rest into IndexedDB on idle, so the web build stays offline-capable.
- The Looks gallery renders only what is in view, and gained a name filter (113 looks had
  outgrown the category chips).
- `bakeDcpLUT` and `exportSharpen` run in an inline worker built by stringifying the real
  functions — verified bit-identical to the main thread, and to the inline fallback.
- New perf budgets guard all of it; see `CLAUDE.md` §2 and the `test/perf_bench.mjs` header.

### Next — Phase B

One Rust build covering both new native features:

1. **`ingest.rs`** — SD-card import (volume/DCIM detection, date-folder + filename templates,
   second-copy backup, verify, skip-duplicates, progress, eject). This is the piece that
   replaces Lightroom in the user's workflow; there is no card path in `library.rs` today.
2. **`subject.rs`** — "remember this dog": PerSAM-style one-shot subject recognition, reusing
   the existing `Embedding` / `encode` / `decode_points` in `sam.rs`. Training-free — a
   256-float prototype per subject, no new model.

Then Phase C (the UI for both, plus auto-seeded skin colour samples), Phase D (one shader cycle:
per-mask Clarity/Smoothing + Dehancer-parity film depth), E (heal/clone, perspective), F
(virtual copies, Library workflow), G (mobile polish).

## Open questions

- Nothing blocking. Phase B needs a real card and a few reference photos of the dog to verify
  against, in the same way `faceparse.rs` was verified against a real photo.
