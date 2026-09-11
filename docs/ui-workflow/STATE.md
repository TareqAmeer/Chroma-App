# UI workflow rebuild — shared state

Goal: add DESIGN and IMPLEMENTATION tooling (token source of truth, as-built wireframes of every
surface, per-panel spec JSON, build-time typed-diff loop, component catalogue) so UI work is more
accurate and uses less Claude context. Session prompts live in `sessions.md` (read only your own).

## Rules for every session
1. Don't open the planning file or other sessions' prompts — this file + your prompt is everything.
2. One session at a time (concurrent sessions collide in git).
3. Scripts over reading: never Read `chromasmith-22.html` in full. Any run whose output is long
   (npm gates, export_harness, capture/inventory scripts, Playwright suites) goes to a Haiku
   subagent — Agent tool with `model: "haiku"`, prompt: "run <cmd>; reply with PASS/FAIL counts and
   only the failing lines, max 15 lines". Use it by default; run inline only for a single quick check.
   Judgement work (reviewing, deciding, editing) stays in the main session.
4. Stop after 2 failed attempts at the same thing — record it below instead of pushing on.
5. On finish: append a ≤10-line entry to the Session log (what exists now, file paths, surprises,
   anything that changes later sessions), then commit + push.

## Facts verified during planning (2026-09-11)
- `_ds_manifest.json` (chromasmith-design/project/_ds/.../) lists ~150 design-system tokens; nothing reads it.
- Three token vocabularies, no bridge: `_ds` CSS tokens; app `:root` (chromasmith-22.html ~50–98,
  `body.light` override ~1263); hand-copied set in `desktop/library-ui.js` (~695–745).
- `editor:token-check` only checks a value is a legal app token, not the right one for the role.
- `.claude/hooks/stop-editor-gate-check.sh` can block (exit 2); today it runs only snap/html checks.
- Wireframes exist only for Editor (11 `.tp-panel` blocks in `Editor (Developer) View.dc.html`),
  Library (`Library View.html`), Splash. App has 5 pages (`#panel-fx/-match/-copy/-collage/-guide`),
  24 `data-fxsec` sections, ~15 menus/popovers/overlays, a mobile layout — mostly un-wireframed.
- Design proposals are hand-written HTML strings in `test/panel_proposals.mjs`; invented values
  were caught twice (commits 247110c, 8eed9f0).
- Unverified (S1 tests them): wireframe→token mapping cleanliness; generating PAIRS; token-lint
  speed on the 17.7MB file; rendering components in isolation.

## Session log
<!-- S1, S2, … append below. Format: **Sx — date — verdict**, then ≤10 lines. -->
