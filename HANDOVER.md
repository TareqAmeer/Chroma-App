# Handover — UI_SPEC.md implementation

## Plan file
`/Users/tareqameer/.claude/plans/use-the-claude-design-mcp-memoized-abelson.md` — full gap
analysis + step order. Read this first.

## Status: steps 1-8 all DONE. Only step 9 (final verification pass) remains.

**Step 7 (Editor token pass) — scope corrected**: audited `#fx-toolrail`/`.fx-panel`
(chromasmith-22.html) and `#lib-overlay:not(.full)` (library-ui.js) for raw hex — both clean,
already using each app's own working token scheme with a complete dark/light remap. Did NOT
rename to the DS tokens' own names (`--surface-tile-1` etc.) — that would mean importing the
whole DS light/dark remap into chromasmith-22.html for two zones only, high risk for zero
visual gain. Don't redo this as a full DS-token import unless explicitly asked.

**Step 8 (Editor right-click context menu) — scope corrected**: the plan's original "L10348 /
Transform panel" pointer was stale (that's now an unrelated background-color picker). The real
target — and what UI_SPEC.md's own text (L98-101) actually describes — is `buildPathsMenu` in
`desktop/library-ui.js`, already shared between Library grid right-clicks and the editor's own
right-click on its open photo. "Rate" and "Export" already existed; added the two real gaps:
- **Rotate & flip**: dimmed unless exactly one CURRENTLY OPEN photo is targeted (geometry is
  live per-photo editor state, no sidecar-only path exists) — reuses `geomRotate`/`geomFlip`,
  same functions step 6's Tools menu calls.
- **Add to album**: lists existing albums + "New album…", via `album_add`/`album_create` — the
  sidebar's drag-and-drop was previously the ONLY way to add a photo to an album at all.

**Verified** across steps 4-8: `node --check` on every inline script block, `node
test/export_harness.mjs` (18/18 clean, no GLSL errors), `npm run lib:test` PASS (run after each
step), and browser-preview walkthroughs of every change (logo in both apps, theme migration via
localStorage inspection, Tools menu open/close/toggle, full context menu render + Rotate&flip
dimming). BUILD stamp is `2026-09-07c`. **None of this has been run through
`bash desktop/install-app.sh` on the real installed app yet** — that's part of step 9.

Scratchpad preview servers in `.claude/launch.json` from this session: `chroma-desktop3` (port
8794, `/tmp/cs-desktop-verify3` — staged `desktop/dist/` + fresh `library-ui.js`) and
`chroma-editor` (port 8795, `/tmp/cs-editor-verify` — `chromasmith-22.html` staged as
`index.html` + `vendor/` + `coi-serviceworker.min.js`). Re-copy the edited file into the staged
dir before each preview if you pick these back up — the servers serve the STAGED copy, not the
repo file live. Future sessions should add their own numbered variant rather than reusing a
stale scratchpad path from a prior session.

## Next: Step 9 — final verification pass
Per the plan's own checklist:
1. `?libtest=1` browser harness + direct Editor load, side-by-side against
   `chromasmith-design/project/*.html`.
2. `node test/wireframe_diff.mjs`, `python3 calib/wireframe_diff.py` (regression guards).
3. `npm run lib:test` + `npm test` (full suite, not just lib:test).
4. `bash desktop/install-app.sh` + a real installed-app screenshot before calling the whole
   UI_SPEC pass done — every verification so far has been against staged copies in a browser
   preview, never the actual Tauri desktop app.

Worth a final skim of `chromasmith-design/project/UI_SPEC.md` end-to-end before declaring done,
in case there's a zone the plan's original gap-analysis missed entirely (steps 3, 6, 7, and 8 in
this session each turned out to need a real correction against the plan's own wording — the
plan was written before enough of the actual code/spec had been read closely).

## Type `/clear` now, then start the next session by asking to read `HANDOVER.md`.
