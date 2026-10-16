# Refactor baselines (Phase 0, 2026-10-16, main @ daac04f)

| Gate | Result |
|---|---|
| `node test/export_harness.mjs` | exit 0, 35 PNGs, no GLSL compile errors |
| `node test/perf_bench.mjs` | PASS (all budgets) |
| `node test/ui_audit.mjs` | **FAIL before any refactor**: CONTRAST 0 -> 1 (+1 worse); every other invariant unchanged. Treat as the known baseline; a refactor must not add to it. |
| `chromasmith-22.html` size | 4,365,137 bytes, 2,128,976 gzipped (CLAUDE.md's 17.7MB figure is stale) |

Map: `node tools/scripts/app-map.mjs` -> `docs/plans/app-map.json` (`--check` detects staleness).
Key finding: script block 13 (lines 7267-31808) holds 1,588 of 1,622 declarations; the other 20 blocks are small. Phase 2 work is almost entirely inside block 13.
Not yet run: `npm test` full suite, `editor:gates`, Playwright, `video_harness`.
