# Handover — UI_SPEC.md implementation

## Plan file
`/Users/tareqameer/.claude/plans/use-the-claude-design-mcp-memoized-abelson.md` — full gap
analysis + step order. Read this first.

## Zones just completed: steps 4, 5, 6

**Step 4 — Logo** (`chromasmith-22.html`, `desktop/library-ui.js`): embedded a downscaled
(384x84, 18.5KB) base64 copy of the wireframe's logo PNG as a data URI in both topbars,
replacing the plain-text "Chromasmith" wordmark. Kept inline (not a separate file) since both
apps are meant to stay single-file/offline.

**Step 5 — Theme store unification**: Library now reads/writes the Editor's `csTheme`
localStorage key instead of its own `chromasmith_lib_theme` — both apps share one page's
localStorage, so this was two keys for one setting, not real isolation. One-time migration on
boot carries over any existing legacy value, then deletes the old key.

**Step 6 — Editor Tools menu — CORRECTS AN EARLIER WRONG GUESS**: the plan originally said this
needed a native macOS `Submenu` in `desktop/src-tauri/src/main.rs`. Re-checked directly against
the wireframe and it's actually an **in-app HTML dropdown** (`#btn-tools`/`#tools-menu` in
`Editor (Developer) View.dc.html`) docked in the Editor's own topbar next to All FX/Export — a
different thing entirely from the native File/Edit/Photo/View/Window/Help menu bar, which was
already complete. Implemented as `#fx-tools`/`#fx-tools-menu` in `chromasmith-22.html`
(functions `toolsBuild`/`toolsToggle`/`toolsClose`), reusing the ⋯ overflow menu's own CSS. All
7 actions (rotate CW/CCW, flip H/V, gamut warning, copy/paste edit settings, reset photo)
already existed as standalone functions — this just wires a second always-visible entry point
onto them. **No Rust/main.rs change needed — don't redo the native-Submenu approach.**

**Verified**: `node --check` on every inline `<script>` block, `node test/export_harness.mjs`
(18/18 renders clean, no GLSL compile errors), `npm run lib:test` PASS, and browser-preview
walkthroughs of all three changes (logo renders in both apps, theme migration confirmed via
localStorage inspection, Tools menu opens/closes/toggles correctly at `?deskx=1`). BUILD stamp
bumped to `2026-09-07c`. None of this has been run through `bash desktop/install-app.sh` on the
real installed app yet.

Scratchpad preview servers added to `.claude/launch.json` for this session:
`chroma-desktop3` (port 8794, serves `/tmp/cs-desktop-verify3` — a staged copy of
`desktop/dist/` + fresh `library-ui.js`) and `chroma-editor` (port 8795, serves
`/tmp/cs-editor-verify` — `chromasmith-22.html` staged as `index.html` + `vendor/` +
`coi-serviceworker.min.js`). Future sessions should add their own numbered variant the same way
rather than trying to reuse a stale scratchpad path from a prior session.

## Next logical zone (per plan.md's step order)
**Step 7**: Editor — token pass. Apply the DS token/hex-audit pass (same kind of check as
Library step 3) to `#lib-overlay` (docked mode, spec's Filmstrip zone) and
`#fx-toolrail`/`.fx-panel` (Tool rail/Tool panel zones) in `chromasmith-22.html` and
`desktop/library-ui.js`. Note: `chromasmith-22.html` doesn't yet import the DS token vars
(`--surface-black`, `--primary-on-dark`, etc.) that `library-ui.js` already defines — see the
plan's "Reusable pieces" section — so this step likely needs its own token import first.

**Step 8**: Editor — right-click context menu. Restructure the existing context menu content
(currently a Transform panel, chromasmith-22.html ~L10348 area — verify this line number is
still current, several thousand lines have shifted since the plan was written) into the spec's
4 top-level items (Rate / Rotate & flip / Add to album / Export) with submenus.

Then step 9 (final verification pass): `?libtest=1` + direct Editor load side-by-side against
the wireframes, `node test/wireframe_diff.mjs` + `python3 calib/wireframe_diff.py`,
`npm run lib:test` + `npm test`, then `bash desktop/install-app.sh` + a real-app screenshot
before calling the whole UI_SPEC pass done.

## Type `/clear` now, then start the next session by asking to read `HANDOVER.md`.
