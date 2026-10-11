# RAW-first review follow-up — 11 October 2026

## Evidence

- Navigation: synthetic 50,000-record Library gate passed; 48 keyboard moves took 585.8 ms with zero order rebuilds. Virtual End/Home mounting, metadata filter invalidation and undo passed. Open 2836.1 ms, mounted 112/240 initial cards, selection 135.9 ms, 16,668 groups displayed in pages of 50.
- Existing Library culling and Survey regressions passed before RAW wiring; latest focused reruns passed after RAW wiring. RAW browser regression passed saved settings/editor-global isolation, display-only IPC, stale A→B→A, failure without embedded fallback, warm cache hit and recipe-key invalidation.
- Native synthetic display-cache hit test passed. Real Nikon Z7 45.75 MP NEF test passed in 55.10 s cold; fit proxy longest edge <=2560, correct 3:2 aspect, no full persistent decode and no RAW_EDITOR_CACHE insertion. Test-specific proxy removed. Shared source fixture reused without copies.
- Native tests: `cargo test --offline --bin chromasmith raw_display_only_cache_tests -j1`; real fixture additionally `-- --ignored --nocapture` with `CULL_RAW_PATH`. Existing shared Cargo target and browser reused, no installs.
- Full editor gates failed inventory, responsive, wireframe-diff, snap-check, token-check, axe-check, icon-check, motion-token-check, hover-focus-matrix, surface-coverage, components-check and catalog-visual. No blanket editor pass claimed. Separate unified-view regression timed out waiting for its full-window transition (line 39), before RAW review assertions.

## Limits

This proves developed RAW provenance and bounded persistent fit-cache behavior, not fast cold development, multiple camera compatibility, full saved creative FXR edit parity or native 100% focus inspection. Those remain open in CHR-267/CHR-276. RAW decoding still transiently requires full sensor buffers; one active review request limits concurrency but does not establish a measured RSS ceiling. Display proxies share the existing pruned native cache tier; no new repository build/cache directory is created.
