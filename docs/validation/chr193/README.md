# CHR-193 counted geometry validation

`node test/geometry_batch_scope.mjs` drives the production Editor in a Playwright page. It uses
the existing tiny chart, portrait, and panorama PNG fixtures and checks cancel/stale confirmation,
one batch history edge, Undo/Redo, timeline preview versus commit, same-entry image replacement,
stale replaced-photo history behavior, and Reset All Undo/Redo across the batch edge. It reads
`desktop/dist/index.html`, so rebuild the desktop dist after changing the source HTML before
running it.

`node scripts/verify-geometry-batch-native.mjs` runs the same contract against an already-running
task-isolated Tauri WebView over CDP. The helper requires `CULL_EXPECTED_BUILD` and the exact
`CULL_NATIVE_COMMIT`; optional provenance fields are `CULL_NATIVE_APP_PID`,
`CULL_NATIVE_CATALOG_DIR`, `WEBVIEW2_USER_DATA_FOLDER`, `NATIVE_CDP`, and
`CULL_GEOMETRY_BATCH_REPORT`. It opens only the three PNG fixtures via the Editor's in-memory
`loadFXImages` workflow; it does not scan the catalog or decode RAW files. It writes a compact JSON
result report at `docs/validation/chr193/geometry-batch-native.json` by default and closes only its
CDP client, not the native app.

Run the browser contract after the CHR-193 source changes and again against the final built
candidate. Run the native helper only when the parent task has launched the exact isolated build
and supplied the matching environment values. A PASS proves these UI/history flows for ordinary
PNG entries; it does not validate RAW rendering or RAW cache behavior.
