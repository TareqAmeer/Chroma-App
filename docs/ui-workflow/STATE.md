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
- S1 tested the four open assumptions — see the S1 entry below.

## Session log
<!-- S1, S2, … append below. Format: **Sx — date — verdict**, then ≤10 lines. -->
**S1 — 2026-09-11 — (a) works w/ caveat · (b) works w/ caveat · (c) works w/ caveat · (d) works w/ caveat (no refactor)**
- (a) Token mapping, authored non-trivial decls. Retouch 95: by value 44 exact/17 ambiguous/28 none (+6 font-weight, no app weight tokens); role-aware (fontSize→--fs-*, padding/gap→--sp-*, radius→--r*) 53/0/36. Export 248: by value 119/47/66 (+16); role-aware 128/0/104. Only 11/95 and 23/248 decls use a `_ds` var() — the wireframe is mostly literals, so `_ds` names are NOT a usable bridge; match on computed value + property role. No-match causes: off-grid spacing (2/6/7/9/10/14px), control heights (4–32px, app has no size tokens), pill radius (9999px/50%), letter-spacing .8px, 0.15s (app has 120/200ms), 3 colours (on-primary text rgb(16,34,42), rgba(255,255,255,.28), danger rgba(135,15,19,.16/.5)).
- (b) Rule "one entry per `.grp[data-fxsec]`, else whole panel→`.fx-ctrl[data-fxsec=<key>]`, alias masks→local" regenerates Retouch exactly (0 field diffs), 20/21 panels overall in 0.6s. Info differs (wireframe grp keys info-meta/info-people aren't app sections). `label` isn't derivable. Per-CONTROL pairs can't be generated: wireframe controls carry no ids/hooks (Retouch block has none).
- (c) Changed-line lint: 0.28–0.41s (git diff -U0 on the 17.7MB file is ~80% of it; regex 1–3ms). Edit-hook variant (lint the Edit's new_string, `str.find` to confirm it's inside `<style>`) 0.12–0.26s. But `<style>` already holds 940 raw literals (115 are `1px`): whole-line linting flags old debt, so lint only literals NEW vs old_string, allow `1px`, skip `--x:` definitions, strip multi-line comments.
- (d) Bare page = app `<style>` + Retouch markup + `selectToSeg` matches 221/228 computed props (.fx-ctrl/.fx-row/.fx-toggle/seg buttons), no console errors, ~1.5s vs 5s app load. The 7 diffs are all `.fx-val`: `initEditableVals()` adds contenteditable at runtime. Copying the real ancestor chain HIDES the card — it needs `.sec-active` under `body.fx-single`. Inline handlers (toggleFX, healSyncUI…) need stubs.
- Scripts were scratchpad-only (not kept). Prompts edited: S3, S4, S6, S8, S11.

**S3 — 2026-09-11 — done, decisions made (2026-09-11)**
- `design/tokens.json` (DTCG): every var in chromasmith-22.html's `:root` (50–98, 39 vars),
  `body.light` override (1271–1301, 16 vars) and desktop/library-ui.js's DS block (695–776,
  63 DS pass-through + 10 remapped app vars + 1 new `--hover-tint`) — 107 total, each with
  `$extensions.chromasmith.{appVar,role,modes,source}`. Matched by value+role per S1(a), not
  `_ds` var() names.
- `design/token-conflicts.md`: every family where app and DS disagree or DS has no analog —
  border alphas (dark `--bdr*` has no white-alpha DS token), `--acc2`/`--ok`/`--err` (app
  lightens DS colours for dark-surface contrast, neither mode is an exact DS literal), `--mono`
  (no DS family), off-grid `--fs-1/3/4/7` and `--sp-4/5`, `--fs-2`=12px ties two DS tokens,
  `--r-sm` vs `--radius-xs` (1px off), missing control-height/pill-radius/font-weight families,
  `--ease`/`--dur-2`, `--lift-1/2` vs `--shadow-product` (DS reserves shadow for imagery only),
  `--sl-thumb*` (dark has no real value, only an inline CSS fallback), `--sat`/`--sab` (device
  geometry, proposed exclusion).
- `design/verify_tokens.py` re-parses all three source blocks and asserts every declared var is
  in tokens.json or token-conflicts.md — passes (107/107). Re-run after any edit to the three
  source blocks or the two files.
- Decisions made 2026-09-11 (user: "DS where DS has one, else your recommendation"): `--acc2`
  now aliases `--acc` (DS has no second brand accent), `--ok`/`--err` adopt DS's green-pine/
  red-oxide in light mode only (dark mode's DS literals measure ~1.3:1 on near-black, kept
  app's brighter values), `--hov` unified with library-ui.js's `--hover-tint` value (also fixed
  a real bug: light mode had no `--hov` override at all). Everything else kept as-is with
  reasoning recorded in token-conflicts.md — mostly "different product context" (dense editor
  vs DS's marketing scale). Proposed-only families (heights, weights, pill radius, on-primary
  text, danger-subtle) left unwired — no app call site yet. Applied directly to
  chromasmith-22.html's `:root`/`body.light`; verified pre-existing `ui:test` failure
  (fx-info-i tap target) is unrelated by diffing against pre-edit tree. Pushed (68f194f).

**S4 — 2026-09-11 — done**
- `scripts/build-tokens.mjs` writes chromasmith-22.html's `:root`/`body.light` and
  desktop/library-ui.js's DS block between new `/* TOKENS:*:START/END */` markers (marker
  pattern reused from site/build-page.mjs), from design/tokens.json values +
  `$extensions.chromasmith.emit.<block>.commentBefore` (hand-written rationale comments, copied
  verbatim including markers/indentation — user chose this over moving comments out of the
  blocks). Mechanical layout (declaration order, inter-decl whitespace) lives in
  `scripts/token-layout.json`, captured once from the file as it existed pre-generator — NOT
  re-derived from tokens.json, so tokens.json only needs to change when a value/comment changes.
  First run was byte-identical to the prior source (`--check` flag added for CI use). Surfaced
  and fixed a real S3 data bug: tokens.json's `blue_mist_soft` held the DARK-REMAP override value
  instead of the base DS token's own `#e3edf0`.
- `test/editor_token_check.mjs`: added a role-mismatch pass (selector-name heuristic vs
  design/tokens.json's `role` field) — advisory, same exit semantics as the existing check.
- `.claude/hooks/token-lint-on-edit.sh` (PostToolUse/Edit, both files): lints only literals the
  Edit's `new_string` adds vs `old_string` (not the 940 pre-existing `<style>` literals),
  confirms containment via string search (S1(c)'s reasoning — no git diff), advisory/non-blocking.
- Verified via a stashed-baseline `editor:gates` run (git stash / stash pop stash@{0} by name —
  ⚠️ a bare `git stash pop` after a plain `git stash` is unsafe on this repo: an unrelated WIP
  stash from another in-progress fix already existed in the stack, so an un-named pop could have
  popped the WRONG one) that `editor:gates`' FAIL was pre-existing and identical (same 7 advisory
  gate names) before this change. `export_harness.mjs` 18/18, no GLSL errors. Pushed.
