# CHR-268 private RAW Compare validation

Native validation passed on Windows with frontend BUILD `1.1012E`, source `baeb2de7efd50a568e283180ffd390b6e18ba874`. The backend was compiled from `4ef365cd`; Rust sources are unchanged between those commits. Only changed frontend assets were synchronized into the existing debug resource directory and SHA256-verified; no second native build or model copy was required.

The fixture is the existing CC0 Nikon Z 7 sample documented in `../chr267/raw-fixture.md`: 51,279,219 bytes, SHA256 `e54a6c4264bf685214f538036fd9d39088e510b2bfedf288e568f0db1897880e`. Three hard-linked paths share one capture. This exercises path identity and traversal, not varied-camera photographic quality. Catalog and cache are disposable directories under `_shared-test-runtime/native/chr268-20261012`; the harness refuses any other catalog contents.

Four checkpoints passed: fitted A/B, cycle to A/C, Enter promotion to C/A, and linked native 100% C/A. Every pane used an 8256×5504 developed source. Observed maximum retained private canvases: two; concurrent private decodes: one. The Editor image collection, persistence target, lens-status global and input selector remained unchanged. No page errors or detach events were recorded in the successful run. An actual native screenshot was inspected after completion; both detail panes contain rendered photographic pixels.

The earlier native run exposed the global `library.open` Enter shortcut consuming Compare promotion. Real-card selection now covers the keyboard cursor that selection-only browser fixtures omitted. Delayed/failed replacement browser checks also ensure flags and ratings cannot act on a source whose pixels have not been presented.

The native source cache may be warm after earlier attempts; no cold-decode, presentation-latency or total-RSS target is asserted. Native sensor/editor caches remain separate from the two private canvas limit. Creative/HDR renderer parity, varied captures, mixed orientations and representative large-library native performance remain open.

Machine-readable results: `private-compare-native-2026-10-12.json`. The final required Editor gates passed 21/33 with the same twelve failures and identical 879 inventory findings; no blanket UI pass is claimed. Gate log: `_shared-test-runtime/reports/chr268-final-editor-gates-20261012.txt`. Publication hashes are recorded in DEVLOG and Linear.
