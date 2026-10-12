# Native varied RAW culling — 12 October 2026

The actual Windows Tauri debug app, BUILD `1.1012B`, frontend source
`2e4ee5556ca5703660dd03ca58f46b2a4a620f50`, passed the extended gate using two checksum-distinct
CC0 originals: Nikon Z 7 NEF (8256×5504) and Canon EOS R5 CR3 (8192×5464).
Canonical sources and licensing are in [varied-raw-fixtures.md](varied-raw-fixtures.md).

| Warm operation | Observed milliseconds | Budget | Result |
| --- | ---: | ---: | --- |
| Six keyboard focus/presentation transitions | 38.040–46.560; median 46.048 | <100 | PASS |
| Nikon fit → native detail | 26.680 | <500 | PASS |
| Canon fit → native detail | 26.750 | <500 | PASS |

This is **same-process warmed-cache resume**, not cold-open performance. Initial disk/OS cache
state is unspecified. A preceding preparation attempt reached both full sources in 44.107 s,
outside the measured presentation intervals; that attempt then stopped at a harness identity
check because native path-backed files use `rawFile.__csSourcePath`. The corrected harness
checks that exact path and `fullImg || img` against each cell's rendered source dimensions.
It does not require the editor's intentionally smaller `img` fit frame to be full resolution.
The original attempt report was preserved with SHA-256
`74a7dbe525163a1806053876b2539c7aa3cb0e005d77817937c19396d56efa40`.

The final [machine-readable report](native-varied-perf-2026-10-12.json) records the exact app
source, executing harness hash (`1f0634c2cc729db8af9539225a479d5ada3151195293621f92c751a0f3cca3f7`),
source paths/hashes, actual decoded dimensions, two consecutive qualifying frame geometries,
and observed decode settings. Both sources used as-shot profile, fast NR, default demosaic,
lens correction off, and full cleanup off. They do not test distinct saved recipes.

Hardware: Windows 10.0.26300, Ryzen 5 5600X, 32 GB RAM, Radeon RX 7700 XT; WebView CSS viewport
1366×672, devicePixelRatio 3. Each sample must match the focused source path, dimensions and
fit/native geometry. This is presentation/source proof, not rendered pixel or creative-colour
parity, a representative camera matrix, native peak-RSS measurement, or Quick Look byte-bound
validation. The broader RAW-first criterion remains open.

The catalog was isolated to exactly the two hardlinked fixture paths; background indexing was
paused. Exact prior Library preferences in the shared test profile were restored and only the
owned native process was closed. No new checkout, dependencies or native rebuild was needed.
The last ordinary-file workspace audit was 49.511 GB, with hardlinks deduplicated and dependency
junctions excluded. [Native detail screenshot](native-varied-detail-2026-10-12.png).
