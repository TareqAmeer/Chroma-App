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

**S5 — 2026-09-11 — done**
- `test/surface_inventory.mjs` (extends panel_extract.mjs's live-DOM-walk pattern): live-drives
  every surface and writes `design/surfaces.json` — 41 entries: 5 `#panel-*` pages, 23
  `data-fxsec` sections, `fx-settings-menu`/`fx-tools-menu`/`fx-view-menu`/`fx-overflow-menu`
  (all sub-panes of ONE settings menu, not independent popovers — see below), `fx-split-popover`,
  `fx-timeline-popover`, `cs-modal`, `fx-confirm-modal`, `fx-ask-modal`, `fx-toast`, the mobile
  (≤700px) sheet layout, and Library (`?libtest=1`). Per surface: how to open it (click/eval
  steps, actually replayed, not asserted), which of rest/hover/disabled/empty/loaded/longText
  actually fired, and `wireframe`/`wireframeFile` matched against STATE.md's known-3 list
  (Editor/Library/Splash) — not a filename grep. Haiku-verified: 40/41 opened=true, `splash`
  correctly opened=null with a note (no live DOM route — first-load native splash, not part of
  the SPA), 5 spot-checked openSteps confirmed to match the script's actual calls.
- 3 real bugs found and fixed while building it, all from guessing instead of reading source
  first — don't repeat the pattern: (1) guessed panel-switch function names (`showPanel`/
  `fxPanel`); the real one is `switchTab(name)`. (2) guessed that `fx-tools-menu`/`fx-view-menu`/
  `fx-overflow-menu` were independent popovers with `.on`/inline-display toggles; they are
  `.fx-settings-pane` sub-panes INSIDE `fx-settings-menu`, shown via `settingsShowCat(key)` per
  `SETTINGS_PANE_ID`, and the popovers open via `fxToggleSplitMenu()`/`fxToggleTimelinePopover()`,
  not manual style hacks. (3) `page.evaluate("window.x = confirmModal(...)")` HUNG THE WHOLE RUN
  for 10+ minutes with zero output — Playwright's `evaluate` awaits any Promise the expression
  resolves to, so assigning a still-pending user-input promise as the eval's return value blocks
  until someone clicks OK/Cancel, which never happens. Fixed by wrapping in `void (...)`. Also
  added `page.setDefaultTimeout(4000)` (was Playwright's 30s default × ~25 surfaces × several
  actions each, which can silently stack to 10+ min with no signal) and a `[surface] ...` log
  line per entry as it's collected — the original hang produced zero output for 10+ minutes,
  which is what made it look identical to "still working" until debugged. Pushed.

**S6 group A — editor-sections — 2026-09-11 — done**
- Added a `group` field (A–E) to every `design/surfaces.json` entry, via a `GROUPS` map added to
  `test/surface_inventory.mjs` (re-run to regenerate); 0/41 ungrouped. Filled `docs/ui-workflow/
  sessions.md`'s S6 `{GROUP}` placeholder with the A–E table (user-specified), plus a note that
  splash has no live DOM route — use `chromasmith-design/project/Splash Screen.html` as its
  as-built stand-in when group C runs, not a capture.
- `test/surface_capture.mjs` (new): for each of group A's 24 surfaces (`panel-fx` + 23 `fxsec-*`),
  captures `noPhoto.webp` (before any photo loads — user flagged only 4/41 surfaces.json entries
  have a recorded "loaded" state, so most sections would otherwise be captured empty by default),
  then loads `test/fixtures/portrait.png` and captures every state `surfaces.json` recorded as
  actually firing (rest/hover/longText/…), plus an explicit `on.webp`/`off.webp` pair for any
  surface with a `.fx-toggle` (sections dim rather than disappear when off, so "off" needs its own
  shot, not just the boolean surfaces.json recorded). Writes `spec.json` (element tree, `id` +
  nearest-ancestor `data-fxsec` per node — the only hooks S1 found the wireframe can be matched
  against later — and computed values for color/typography/spacing/radius/motion/elevation props,
  each matched to a `design/tokens.json` token by VALUE + property-role family, S1(a)'s approach,
  not `_ds` var() names) and `block.dc.html` (the surface's real outerHTML, scripts/on* attrs
  stripped, wrapped in a `.tp-panel[data-panel]` shell matching `Editor (Developer) View.dc.html`'s
  structure — generated from the live DOM, nothing hand-drawn).
- Result: 24/24 surfaces, 0 missing states, 24/24 noPhoto captures. 32,531 unmapped style decls
  across the group (expected per S1(a)/S3 — no tokens yet for control heights, font weights, pill
  radii, most off-grid spacing/colour literals); left as `unmapped` in each spec.json, no tokens
  invented. `fxsec-looks` (6,472) and `panel-fx` (13,029) dominate — both are large composite
  surfaces (preset grid; whole page containing all 23 sections), not signs of a mapping bug.
  Known imprecision: `panel-fx`'s on/off pair toggles whichever `.fx-toggle` is first in DOM order
  under the whole-page selector (not a specific section) — harmless for the page-level shot but
  don't read `panel-fx/on.webp` vs `off.webp` as "the page's own toggle state".
  Output: `design/asbuilt/<id>/{noPhoto,rest,hover,…,on,off}.webp`, `spec.json`, `block.dc.html`
  (14 MB total, gitignored-check: not excluded, committed as-is).

**S6 groups B–E — editor-overlays, other-pages, mobile, library — 2026-09-11 — done**
- Extended `test/surface_capture.mjs` for the non-`fxsec` kinds: `mobile-sheet`'s
  `surfaces.json` `openSteps` is a human-readable description, not runnable JS (viewport resize +
  `applyFxLayout()` were driven with dedicated code, matching `surface_inventory.mjs`'s own
  special-case, not `runStep()`/`eval`). Its sheet-open toggle needed a real fix, not a workaround:
  `chromasmith-22.html`'s `fxSection(name)` returns early into a CLOSE branch (mobile sheet-close
  or deskx panel-close) whenever the target section is already `sec-active` — calling it on
  whichever section happens to be pre-selected closes something instead of opening the sheet. Now
  picks a section key that ISN'T the currently-active one before opening. `splash` has no live DOM
  route (confirmed in S5) — per user instruction, its capture is skipped entirely and
  `chromasmith-design/project/Splash Screen.html` is copied verbatim into
  `design/asbuilt/splash/block.dc.html` as its as-built stand-in, with a `spec.json` note
  explaining why (no screenshots, no computed-value mapping — nothing to map from a static
  wireframe file).
- Result, all 4 groups: B (10 surfaces: 4 settings-menu panes, split/timeline popovers, cs-modal,
  confirm/ask modals, toast) 0 missing states, 8/10 noPhoto (split/timeline popovers require a
  photo to be enterable at all — real app behaviour, not a script gap). C (4 pages + splash
  stand-in) 0 missing states; one noPhoto flake on `panel-guide` (timing, not a real gap — reran
  `--id=panel-guide` alone, succeeded immediately). D (mobile-sheet) 0 missing — rest/loaded/empty
  all captured, plus on/off (the mobile panel's own `.fx-toggle` sections). E (library) 0 missing.
  Total across A–E: 41 surfaces (40 live-captured + splash stand-in), 58,339 unmapped style decls
  overall — same expected causes as group A (no tokens yet for control heights/weights/pill radii/
  off-grid literals), nothing invented. `design/asbuilt/` is 26 MB total, committed as-is (not
  gitignored). All 5 groups (A–E) now complete.

**S2 — 2026-09-11 — done (finished in a later review pass)**
- First pass (e27afba): moved §3b→docs/design-tokens.md, §4→docs/app-tabs.md, §6→docs/process-lessons.md;
  fixed fonts (SF Pro) + wireframe-transplant skill. T43–T53 deferral reverted (16e9f69) — they were already done.
- Review pass: CLAUDE.md 320→233 lines. Moved iOS shell → docs/ios-shell.md, render pipeline → docs/render-pipeline.md,
  calib venv commands → calib/CLAUDE.md; condensed the repo tree (kept every ⚠️ gotcha). Each move has a "load before
  touching X" pointer so it still gets read at the right time.
- Deleted-too-far line: §6 had become a bare pointer "read before tuning", so UI/test/flaky-bug lessons (#5,#8–17) would
  never load for UI work. Restored as 10 one-liners + contract rule 7. Rule of thumb used: keep in CLAUDE.md anything that
  prevents a SILENT costly failure or that has no other trigger (skill/hook/nested CLAUDE.md); move detail that has one.
- Added contract rule 6: token values live in design/tokens.json, :root is generated (was undocumented after S4);
  docs/design-tokens.md updated to match; stale "§10.13" ref fixed.
- Collage page now documented in docs/app-tabs.md (2026-09-11). Found: collage export has no iOS share-sheet path (unverified).

**Token generator gates — 2026-09-11 — done**
- `scripts/build-tokens.mjs --check` and `design/verify_tokens.py` (S3/S4) existed but nothing
  ran them — a direct edit to a colour/spacing literal in `chromasmith-22.html`'s `:root`/
  `body.light` or `desktop/library-ui.js`'s DS block would sit unnoticed until the next
  `build-tokens` run silently overwrote it back to `design/tokens.json`'s value. Added
  `npm run tokens:check`/`tokens:verify`/`tokens:gates`; wired into `npm test`/`test:ui`,
  `githooks/pre-commit` (fires on `chromasmith-22.html`/`desktop/library-ui.js`/
  `design/tokens.json`/`scripts/build-tokens.mjs`/`scripts/token-layout.json`, blocking), and
  `.github/workflows/editor-gates.yml` (new trigger paths + a dedicated step). Verified the
  pre-commit gate actually blocks: edited `--bg` directly in the generated `:root` block, staged
  it, hook failed with the drift message; reverted, re-ran clean.

**Gate baseline — 2026-09-11 — pre-existing failures, not introduced by this session**
Recorded so S8 ("done when gates pass") has a starting point — these predate this session's work
and are unrelated to it (S3 already noted the `ui:test` one; confirmed unchanged here):
- `npm run editor:gates` (`--advisory`): RESULT PASS with 7 advisory WARNs — `editor:inventory`,
  `editor:token-check`, `editor:axe-check`, `editor:icon-check`, `editor:motion-token-check`,
  `editor:hover-focus-matrix`, `editor:hidpi-check`. Advisory = printed, not blocking; the
  underlying findings (e.g. `.fx-select` hover/focus visually identical to rest, several
  `[MISSING]` selectors with no visible instance under the current fixture, hidpi canvas checks
  that don't fire under CDP DPR emulation) are pre-existing backlog, not this session's changes.
- `npm run ui:test`: RESULT FAIL — 2 findings, both on the same element: TAP
  `button.fx-info-i "i"` 14×14 < the 28px minimum, FONT same element 9px < 11px minimum. This is
  the tap-target gap S3 already flagged and confirmed unrelated to its own edits; still present,
  still not this session's.
Neither of these two commands is run by `githooks/pre-commit` on every commit today (only when
`chromasmith-22.html`/`desktop/library-ui.js` is staged, via `editor:gates --advisory` — which
is why the advisory 7 don't block locally either); `npm test`/CI run them non-advisory/strict via
`editor:gates` and `ui:test` respectively — `editor:gates` still exits 0 since the 7 are advisory,
but `npm run ui:test` on its own exits 1 (the fx-info-i gap), and `npm run test`/`test:ui` (which
call `ui:test`) will currently fail on that until it's fixed.

**Between S6 and S6b — 2026-09-11 — planning-session additions**
- sessions.md: added S6b (full scenario capture: every state × theme × width × sidebar + scenario states;
  full images gitignored, contact sheets committed) and S7b (token gates + allowlist cleanup + failure baseline).
  Order: S6 → S6b → S7 → S7b → S8.
- design/tokens.json: 5 families ADOPTED but unwired (status "proposed-unwired", not in token-layout.json, so
  :root unchanged — build-tokens --check still clean): --fw-regular/medium/semibold/bold, --h-ctrl-sm/--h-ctrl/
  --h-touch, --r-pill/--r-circle, --on-acc (#10222a, the wireframe's value), --err-subtle. Details in token-conflicts.md.
- docs/ui-workflow/allowlist-audit.md: 185 allowlist entries → 17 delete, 28 verify-then-delete, 39 real fix,
  92 intended, 9 checker artifacts. Needs user decisions: filmstrip/rail/panel widths, rail order, Square crops.
- User decisions 2026-09-11 recorded: filmstrip 120px (intended; gate must reset to default width), rail 64px →
  T55, panel 300px → T56, app's rail order is right (update the wireframe), Square crops/Original dimensions →
  T57 (exists as a hidden, 400-photo-limited "Real aspect ratio" toggle). All in editor_ux_spec.json.

**Tool-rail clipping — 2026-09-11 — root cause + prevention (planning session)**
- Bug: `#fx-toolrail` had hardcoded `width:72px`; narrow mode shrinks its grid track to 44px, so 28px
  (half of every icon) hung off the window. Fixed: `width:var(--rail-w)`.
- Why every step missed it: S5's prompt (written in planning) listed surface kinds and left out ALL
  app chrome; S5 verified only what it listed. S6/S6's prompt captured one theme at one width. S7 shows
  what S6 captured. On the test side, editor_responsive_qa ran the rail at its default width only, had
  no clipping check, and was advisory at commit. Completeness was never measured against the app.
- Prevention (all proven on the broken build first — 100 rail CLIP findings, then PASS after the fix):
  checkClipping + checkResizerCoverage (wireframe_checks_lib.mjs); editor_responsive_qa now 192 layouts
  (8 viewports × rail × panel × dock) and BLOCKING; library_responsive_qa sidebar × viewport clip sweep;
  test/surface_coverage_check.mjs (editor:surface-coverage, advisory until S6b) finds 11 uninventoried
  regions incl. both top bars and the Library status bar (#lib-bottom). The Editor has no status bar
  yet (#fx-statusbar unbuilt). New backlog: T58 canvas cut off at 700px, T59 Library grid cut off at
  640px + 420px sidebar, T60 chrome missing from surfaces.json. Lesson #18 in docs/process-lessons.md.
- responsive allowlist: 5 stale topbar-overlap entries removed (verified none fire), +1 for T58.

**S6b — layout matrix + scenario states, all groups A-E — 2026-09-11 — done**
- Extended `test/surface_capture.mjs` (phases 5-6): for every surface, a state x theme
  (dark/light via `fxSetTheme()`, confirmed real — not `toggleTheme()`'s bare flip) x width
  (`test/editor_responsive_qa.mjs`'s `VIEWPORTS` + 768 tablet + 390 phone, per instruction — no
  invented sizes) x sidebar (Editor: expanded/collapsed via the `panel-closed` toggle,
  `fxSection()`'s close-vs-open branch keyed off whether the target is already `sec-active`, same
  mechanism S6 groups B-E found for mobile-sheet; Library: docked/full via `#lib-expand`; n/a
  elsewhere) matrix, content-addressed by sha256 into `design/asbuilt-full/<id>/` (gitignored),
  with a resumable `spec.json.matrix` index and a labelled contact-sheet grid per theme
  (`design/asbuilt/<id>/contact-<theme>.webp`, built by rendering an HTML grid through the same
  Playwright browser — no new image-composition dependency, this repo has no `sharp`). Plus fixed
  scenario states (keyboard focus/pressed/`.fx-mod`, photo orientation, multi-photo, masks, export
  progress, split/loupe/crop, Library states, mobile states, zoom/forced-colors/reduced-motion,
  WebKit) at 1400x900 on `panel-fx`/`library`/`mobile-sheet` specifically — scoped to the surfaces
  each is actually about, not every surface (would have multiplied the matrix further for no
  benefit).
- New fixtures: `test/fixtures/orientation_portrait.png` (384x512) and `orientation_panorama.png`
  (1600x400) — every existing fixture (`portrait.png` included — its name is about CONTENT, a
  face stand-in, not aspect) is 512x384 landscape-shaped, so none exercised a portrait- or
  panorama-oriented photo. Generated via `test/fixtures/gen_fixtures.py` (PIL, `.calibvenv`), not
  hand-drawn.
- Real bugs found by running against the live app, not guessing (S5's own lesson, repeated
  successfully this time): `mskAdd(type)` takes a `MASKS` key string (`'radial'` etc, line 10904),
  not a number; the export trigger is `exportFX()`/`#btn-fx-export` (line 2424), not a guessed
  `exportRunAll()`; Library's grid/list toggle is `#lib-viewmode-seg [data-v]`, which CSS hides
  entirely while docked (`.lib-fullview-only`) — needs `#lib-expand` first; the local static
  server had no `.mjs`/`.mp4` MIME types, breaking `mediabunny`'s module import for the
  video-loaded scenario; `captureBuffer()` needed `settleForCapture()` + a longer screenshot
  timeout to survive in-flight CSS transitions (export progress bar, panel-close animation) — 3
  scenario timeouts before this fix, 0 after.
- Two bugs found running the REAL (non-smoke) group runs, not caught by smoke tests: (1)
  resumability's `doneKeys` included `failed` entries, so a re-run could never retry a transient
  flake — fixed to drop `failed` entries before rebuilding the set (group C: `panel-guide`'s
  `rest|dark|1024x768|n/a` hit a 10s font-load timeout once, retried clean). (2) `fx-toast`
  (~1900ms lifetime) can disappear in the gap between `captureBuffer()`'s visibility check and its
  element re-query, crashing with "Cannot read properties of null" instead of being recorded as
  skipped — 11 combos in group B before the fix, 0 after (correctly recorded as skipped: toast
  expired before capture, a real limitation of a transient/short-lived surface, not a bug).
- Execution note: the 5 group runs were first dispatched to Haiku subagents (per the instruction's
  rule 5), but each subagent's own `Bash` call returned after ~10s with a placeholder "still
  running" message instead of actually waiting — the `node` processes kept running correctly as
  orphaned OS processes regardless (confirmed via `ps`), so this session polled them directly
  (`ps` + `spec.json` counts) via `ScheduleWakeup` every 15-20 min instead of relying on the
  subagents' own completion signal. Total wall time ~90 min (group A, 24 surfaces, took the
  longest at ~85 min; B/C/D/E each under 15 min).
- Results, all 5 groups, 0 failures after retries: A 232 captured/744 dup/752 skipped (752 mostly
  `collapsed` sidebar skipped at <=700px widths, correct per the applicability rule) + panel-fx
  scenarios 35 captured/9 dup/2 skipped (raw-loaded, no fixture, T11). B 145+8(retry)/338/6+19(now
  correctly skipped, was 11 failed)/0 fail. C 79+1(retry)/0/0/0 fail, splash stand-in unchanged.
  D 8/52/0/0 fail + mobile-sheet scenarios 2/4/0/0 fail (fixed the same active-section trap as the
  phase-1-4 driver). E 28/36/8 skipped (docked/full n/a at mobile widths, `full` sidebar skip)/0
  fail + library scenarios 0 captured/10 duplicate/2 skipped (`library-large` — no `?libn=N` mock
  wired into this pass, would need one like `test/library_dock_states.mjs` uses;
  `library-lightroom-connected`, `library-grid-view`, `-list-view`, `-multi-select` all captured
  but as DUPLICATES of already-existing matrix images — `?libtest=1` alone likely seeds a
  near-empty grid, so toggling view mode or selecting items produces no visible pixel difference;
  a real fidelity gap, documented rather than silently accepted as success).
- NOT done this pass: S7's triage/review page does not exist yet (no earlier session has run S7),
  so the instruction's item 6 ("update S7's page... keeping the total under 255 files") has
  nothing to update — 80 contact-sheet files exist now (41 surfaces x up to 2 themes), noted here
  for whoever builds S7 next.
- `design/asbuilt-full/` (~7MB, content-addressed originals) is gitignored; `design/asbuilt/`
  (~33MB: contact sheets + updated `spec.json`) is committed.
- surface_coverage_check.mjs gained a static source pass (hidden-at-load containers): 82 uncovered, incl. crop/mask/guides overlays, histogram, history, export progress, multi-photo filmstrip, video thumbstrip, Collage cell panel/empty state, Library info panel, compare view, review grid, batch/import/offline bars, sort menu, 5 Library modals, Library empty state. S6b prompt updated to use `covers` for sub-parts.

**Coverage gap-fill — 2026-09-11 — done, `editor:surface-coverage` now blocking**
- Classified all 82 ids from `surface_coverage_check.mjs --json`'s `missing` list (only to-do list
  used, per instruction): **10 new real surfaces** (`fx-hist`, `fx-more-menu`, `lib-compare`,
  `lib-info`, `lib-astro-modal`, `lib-collage-modal`, `hq-offline-quit-modal`,
  `lib-blocking-wait-modal`, `lib-offq-modal`, `imp-bar`), **72 folded into an existing surface's
  `covers`** (metadata-only, no re-capture — e.g. `fx-deskbar-left/title/right/tools` → `fx-deskbar`,
  `hsl-hist` → `fxsec-hsl`, `lib-empty*` variants → `library`, `boot-splash-*` → `splash`), **0 "not
  UI"**. `node test/surface_coverage_check.mjs` now passes with 0 missing, 0 ignore-list entries
  added. Removed `editor:surface-coverage` from `ADVISORY_GATES` in `test/editor_gates.mjs` — now
  blocking, per instruction's done-condition.
- Of the 10 new surfaces, **4 are genuinely reachable** and captured with the full matrix:
  `fx-hist` (histogram overlay, `toggleHist()`), `fx-more-menu` (mobile-only "More tools" sheet,
  `fxMoreMenu()` — real function, found by reading the source, not guessed), plus the two chrome
  regions from the earlier `S6b` pass that had only smoke-test captures until now
  (`lib-grid`/`fx-rail-foot`/`fx-actionbar`/`fx-secnav`, run for real this session). **6 are
  unreachable this pass**, each with a real function found and a concrete reason recorded in
  `surfaces.json`: `lib-astro-modal`/`lib-collage-modal`/`imp-bar` are closure-local functions
  needing real astro-stack detection / N selected photos + the real collage-UI click / a real
  inserted card path; `hq-offline-quit-modal`/`lib-blocking-wait-modal`/`lib-offq-modal` fire only
  from native Tauri IPC events (`main.rs`), unreachable in a browser-only Playwright harness;
  `lib-compare` needs `enterCompareMode()` (closure-local, needs selected photos) with no direct
  call path found this pass. `lib-info` is a 7th: `window.__libInfo(true)` after clicking a real
  `.lib-card` (not the guessed `[data-id]`/`.lib-thumb` this file already had elsewhere) worked in
  an isolated debug script, but times out in this task's actual boot sequence (editor already has
  a photo loaded first) — stopped after 3 attempts per the 2-attempt rule and recorded unreachable
  rather than pushed further.
- Added `--only <id,id,...>` to `test/surface_capture.mjs` (works without `--group`, for capturing
  a handful of surfaces spanning multiple groups without re-touching the rest). Confirmed via
  `git status` that no existing `design/asbuilt/<id>/` folder from S6/S6b changed — only the 13
  new surfaces' folders were created.
- S7's Surface Triage artifact (`https://claude.ai/code/artifact/65fe070e-5a71-455a-a2a5-3c24f0291e61`,
  built by a concurrent session — exists, contrary to this session's earlier mistaken claim that it
  didn't) updated: uploaded hero + contact-sheet images for all 13 new surfaces (26 assets) and
  spliced 13 new cards into its `SURFACES` array, leaving the existing 41 untouched. Total 54 cards,
  well under the 255-file instruction.
