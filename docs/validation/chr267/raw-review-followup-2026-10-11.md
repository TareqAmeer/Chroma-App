# RAW-first review follow-up — 11 October 2026

## Evidence

- Navigation: synthetic 50,000-record Library gate passed; 48 keyboard moves took 585.8 ms with zero order rebuilds. Virtual End/Home mounting, metadata filter invalidation and undo passed. Open 2836.1 ms, mounted 112/240 initial cards, selection 135.9 ms, 16,668 groups displayed in pages of 50.
- Existing Library culling and Survey regressions passed before RAW wiring; latest focused reruns passed after RAW wiring. RAW browser regression passed saved settings/editor-global isolation, display-only IPC, stale A→B→A, failure without embedded fallback, warm cache hit and recipe-key invalidation.
- Native synthetic display-cache hit test passed. Real Nikon Z7 45.75 MP NEF test passed in 55.10 s cold; fit proxy longest edge <=2560, correct 3:2 aspect, no full persistent decode and no RAW_EDITOR_CACHE insertion. Test-specific proxy removed. Shared source fixture reused without copies.
- Native tests: `cargo test --offline --bin chromasmith raw_display_only_cache_tests -j1`; real fixture additionally `-- --ignored --nocapture` with `CULL_RAW_PATH`. Existing shared Cargo target and browser reused, no installs.
- Full editor gates failed inventory, responsive, wireframe-diff, snap-check, token-check, axe-check, icon-check, motion-token-check, hover-focus-matrix, surface-coverage, components-check and catalog-visual. No blanket editor pass claimed. Separate unified-view regression timed out waiting for its full-window transition (line 39), before RAW review assertions.

## Limits

This proves developed RAW provenance and bounded persistent fit-cache behavior, not fast cold development, multiple camera compatibility, full saved creative FXR edit parity or native 100% focus inspection. Those remain open in CHR-267/CHR-276. RAW decoding still transiently requires full sensor buffers; one active review request limits concurrency but does not establish a measured RSS ceiling. Display proxies share the existing pruned native cache tier; no new repository build/cache directory is created.

## CHR-200 scheduling follow-up

Display-only development now dispatches demosaic and colour conversion to the existing interactive pool; full-cache batch placement stays unchanged. Targeted offline dispatch/cache suite passed 2 tests; real Nikon fixture passed again in 55.81 s. The dispatch test also preserves CS_INTERACTIVE_POOL=0 caller fallback. No native foreground/background latency or wall-time improvement claim follows from these unit/integration test timings.

## Combined RAW review UI verification

Selected preparation, developed RAW face crops and rendering-boundary captions passed their focused browser tests. Legacy JPEG close-up/People compatibility passed after making its fixture explicitly non-RAW. Native synthetic face-crop source/pixel/cache-key/missing-source test passed. Combined full Editor gates completed with 20/33 PASS and 13 failures; structural inventory has exactly the same 879 finding strings as the saved earlier run. The extra tokens-check failure was CRLF formatting drift: generator regeneration produced no Git content diff, and the targeted check then passed (12 other failures remain). No blanket UI or native desktop pass is claimed.

Remote main advanced with HDR-cache handling during publication. It was merged without conflicts; RAW Quick Look, preparation and face browser contracts all passed again against the merged code. Cold speed, native portrait crop quality, creative-edit parity and native foreground-load measurements remain open.
