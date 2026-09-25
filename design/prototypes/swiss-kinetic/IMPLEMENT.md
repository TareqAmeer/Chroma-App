Implement the approved Swiss Kinetic redesign in the real app (Library + Editor, desktop first).

Sources of truth — read these first, don't re-derive anything:
- design/prototypes/swiss-kinetic/approved.json — the approved values. Dark and light are separate sets; copy them, never retype or "improve" them.
- design/prototypes/swiss-kinetic/index.html — the reference implementation (CSS + the small vanilla JS for slab switch / spring / snap sound / rolling digits). Port its rules; don't redesign.
- design/prototypes/swiss-kinetic/inventory.md — every surface from the app scan: 28 new design, 111 restyle, 14 restyle-neutral (on-photo tools). This list is the done-check.
- ~/.claude/plans/i-want-to-redesign-velvet-deer.md — phases 2–7 and the completeness check.

Hard rules:
- Look-only: every existing control, function, id and behaviour stays (memory: redesign-look-only). Only components, colours, type and motion change.
- Fonts: Gramatika Regular/Bold (+ italic where the spec says) everywhere; remove SF Pro (chromasmith-22.html, desktop/library-ui.js, tokens face.mono/font_display/font_text). Done when grep -c 'SF Pro' = 0.
- 0px corners, no soft shadows (box-shadow only as a hard 0-blur offset block), no hover underlines. Honour Reduce Motion.
- Token values go in design/tokens.json and are regenerated with node scripts/build-tokens.mjs — never hand-edit inside the TOKENS markers. Light values go to body.light.
- Port by computed-style diff against the playground in the edited states (memory: draft-to-app-computed-diff), not by eye.
- Never read chromasmith-22.html in full: grep, then read with offset.
- One component family per commit, commit + push each (another session works this repo: pull --rebase before push).
- Gates after each family: npm run components:check, npm run ui:test, npm run editor:gates, npm run tokens:gates; node test/export_harness.mjs after any chromasmith-22.html edit; library_perf must stay green for grid/filmstrip work. A green run is Chromium only — check the real app (WKWebView) once per phase.

Order (fresh session per phase):
2. Freeze: add the approved.json values to tokens.json as new groups (accent a/b, ink/bg/muted per theme, offset, two-tone slab, segmented, motion, menu, borders, slider thumb) and regenerate. Show me the token diff before phase 3.
3. Shared components, one family per commit: font swap → colour/motion tokens → button → icon-button (hover + selected) → toggle → slider (rolling square, reset dot, double-click reset, filled when moved) → chip → segmented → select/dropdown → menu (+ submenu) → section card → search → info → control row. One shared kinetic helper (slab switch drag/spring, snap sound) in chromasmith-22.html, reused by desktop/library-ui.js.
4. Top bar: gallery|studio two-tone slab + tools slide, wordmark, custom window squares (hide native macOS buttons in Tauri, wire close/minimise/fullscreen; Windows keeps its frame), filter row, sort/view menus with squares. Verify in 3 real launches.
5. Library: grid (colour), filmstrip (B&W until hover/selected), selection + hover styles, flags (REJ grey / PICK A / FAV B), side menu, filters panel with in-dropdown labels and shared multi-select state.
6. Editor panels, one per commit, following docs/editor-redesign-plan.md.
7. Light theme from the light set in approved.json.

Start with phase 2 in plan mode: list exactly which token groups you'll add and the scan that proves every instance is covered, then wait for my OK.
