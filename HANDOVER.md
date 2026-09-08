# Handover — Library wireframe fidelity & behaviour coverage

Read this first, then `chromasmith-design/project/design.md` (the design-system spec the
wireframes were built from — tokens, type ladder, spacing, divider philosophy). Prior sessions
never opened `design.md`, which is part of why divider/spacing decisions drifted.

---

## 1. Where things stand

| check | command | state |
|---|---|---|
| Structural fidelity | `npm run wireframe:test` | **PASS** — 19 findings, all allowlisted with reasons |
| Icon-shape regression | same command (baseline: `test/baselines/wireframe_icons.json`) | **PASS** — 47 glyphs baselined |
| Behaviour + UI quality | `npm run behaviour:test` | **67/67 PASS** — the §3 defect queue (2026-09-08 session) is empty |
| Desktop UI audit | `npm run ui:test` | PASS |
| Library perf | `npm run lib:test` | PASS |
| Export/shader goldens | `npm run export:test` | PASS (18/18) |

`npm run behaviour:test` asserts CORRECT behaviour rather than whatever today's code happens to
do, so a genuine defect shows as a failure instead of being baked in as "expected". **Any future
failure that doesn't map to a fresh, deliberately-added test is a real regression — investigate
it, don't wave it off.**

### Live-source preview (2026-09-08)

`npm run preview` — `test/preview_server.mjs`. Serves the Library from SOURCE (synthesises
`desktop/dist/index.html` in memory from `chromasmith-22.html` + the two injected `<script>`
tags, and serves `desktop/library-ui.js`/`desktop-native.js`/`vendor/` straight off disk) with
file-watch auto-reload. Opens at the same `?libtest=1&libcat=1&libn=60` mock state the behaviour
suite drives, so what you see in a browser is what the tests exercise. This exists because
looking at a Library change previously meant `bash build-desktop.sh` + manual refresh every time
— now it's edit, save, look.

⚠️ It does **not** replace the build. `desktop/dist/` stays the tests' actual source of truth
(`test/wireframe_behaviour.mjs`, `test/library_perf.mjs`, etc. all read it from disk) — `bash
build-desktop.sh` is still mandatory before any check. The preview is for the loop in between.

`build-desktop.sh` itself is now incremental — `rsync -a --delete` for `vendor/` instead of
`rm -rf` + full recopy, so a no-op run costs ~0.3s instead of walking 39MB every time. Output is
unchanged; only how much gets rewritten to produce it.

---

## 2. What was built this session

- **`test/wireframe_behaviour.mjs`** (new, 66 tests) — the interaction coverage that never
  existed. Uses `@playwright/test` for auto-retrying assertions; the older harnesses stay on raw
  `playwright`. Config: `playwright.config.mjs` (scoped by `testMatch` so it never tries to run
  the other `test/*.mjs` scripts as specs).
  - **Safety:** every run is `?libtest=1`, where the Tauri `invoke` layer is swapped for mocks
    (`library-ui.js:16`). No real file, library root or setting is reachable, and Playwright uses
    a throwaway profile. Destructive actions are exercised against mocks only.
  - Assertions are on **observable state only** — DOM classes, text, localStorage, inline custom
    properties, and the app's two debug hooks. `state` is module-local and deliberately not
    exposed; per Playwright's own guidance that's the right thing to assert against anyway.
- **`test/wireframe_inventory.mjs`** — gained **icon shape signatures**. Counting icons could
  never catch a *wrong* icon, which is how the view toggle shipped a crop-tool glyph and a log
  glyph for several sessions under a green PASS. Now every icon's geometry is hashed and diffed
  against a committed baseline. Verified working by deliberately corrupting a baseline entry and
  confirming it was caught and named.
  - ⚠️ It compares the app against **itself over time**, not against the wireframe's icons. The
    two use different icon sets on purpose (`design.md` records that no icon assets were supplied
    and Lucide was substituted). Diffing those geometries would flag every icon on the page —
    pure noise, which is how an earlier attempt at a structural diff died.
  - Re-baseline after an intentional icon change: `npm run wireframe:icons`.
- **Icon fix shipped** (commit `8a94947`): the view toggle now uses a real 2×2 grid glyph and
  three-line list glyph, literal to `Library View.html:220-221`.

### Dependency change to be aware of
`npm install @playwright/test` also bumped `playwright` 1.48 → 1.63 and required
`npx playwright install chromium` (the cached browser was too old). All existing harnesses were
re-run afterwards and still pass. On a fresh checkout, run `npx playwright install chromium`.

---

## 3. Defect queue — CLEARED (2026-09-08)

All 12 defects below were fixed this session. `npm run behaviour:test` is 67/67 green (66
original tests + one new keyword-tree chevron test, §3.2). Left in place as a record of what
each was and where the fix landed — useful if any of these regress.

1. **Sidebar separators rendered ~7px thick instead of a 1px hairline.** ~~`.lib-coll-sep`
   (`:986`) was `height:1px;background:var(--bdr);padding-top:6px` — no `box-sizing:border-box`,
   so the box was 7px and `background` painted all of it. Wrong token too.~~ **Fixed:** now
   `border-top:1px solid var(--divider-soft,var(--bdr));margin-top:6px;padding-top:6px;height:0`,
   and `--divider-soft` is mapped in both theme blocks (`#lib-overlay` dark default, `.lib-light`).

2. **All three trees' chevrons loaded/navigated instead of just expanding.** `buildTreeNode`
   (folder tree) and the keyword tree's row handler each wired ONE `onclick` that toggled
   expansion *and* triggered a full load/navigate; only the date tree had the correct split.
   **Fixed:** chevron = expand only (`data-chev-toggle`, stops propagation, no load); row body =
   load/navigate only, no expansion toggle — same contract in all three trees now. The folder-tree
   regression test now asserts on `catalogQuery` staying flat, not `listDir` (expanding a
   never-before-seen folder legitimately costs one `list_dir` call to discover its children,
   before or after the fix — that's not the bug, `openFolder()` firing is).

3. **Get Info couldn't be closed.** `#lib-info-btn` always set `showInfo = true` instead of
   toggling. **Fixed:** `window.__libInfo(!state.showInfo)`.

4. **Develop tab contradicted its own tooltip.** `title="Develop — not yet available"` but the
   click already performs the real navigation (same as the header button / `L` key) — the
   wiring was correct, the stale title was the lie. **Fixed:** title now says "Switch to
   Develop"; `#lib-side-tab-library` also got a real (no-op) handler instead of a static class.

5. **Escape closed nothing.** The sort menu, gear menu and filters panel each closed on outside
   click but ignored Escape. **Fixed:** one keydown branch closes whichever is open, placed
   before the full-window-exit Escape handler so the topmost menu dismisses first.

6. **Sidebar rows were unlabelled clickable `div`s.** Every `[data-coll]`, `[data-catalog]`,
   `[data-sec-toggle]` row had no role/keyboard reach. **Fixed:** `role="button" tabindex="0"`
   at each template site, plus one delegated Enter/Space handler on `#lib-side`.

7. **Destructive-action menu had no role.** `showCacheMenu`'s popover was a bare styled `div`.
   **Fixed:** `role="menu"` on the container, `role="menuitem"` + `tabindex="0"` per item.

8. **The sidebar resizer had a ~2px effective hit target**, not the ~3px HANDOVER guessed.
   Root cause, confirmed via `elementFromPoint`: `#lib-side{overflow:auto}` (needed for the
   tree's vertical scroll) clips its own child's `right:-3px` overhang — only the portion still
   inside `#lib-side`'s box was ever hit-testable; the rest fell through to the editor canvas
   placeholder underneath. **Fixed:** moved the hit box fully inside `#lib-side` (`right:0`, no
   overhang) and widened it to 11px. No rest-state visual change — the permanent divider line is
   `#lib-side`'s own `border-right`, not this element.

9. **`clearAllLibFilters()` left `state.ratingFilter` stale.** **Fixed:** added alongside the
   other eight fields it already reset.

10. **`syncFilterControls()` called a nonexistent function** (`updateFilterChips`, silently
    no-op'd by a `typeof` guard). **Fixed:** calls the real `syncFilterUI`.

11. **Two comments contradicted their code.** Search-Enter's comment claimed CLIP only fires on
    an empty plain-text match (it always fires); the flag row's comment claimed a
    multi-selection fallback (it reads `state.openedPath` only). **Fixed:** both comments now
    match the actual, defensible behaviour.

12. **List view was a no-op while docked.** `renderGrid`'s own `!docked` guard was correct — a
    table in the 340px strip is unusable — the *button* was what claimed an effect it didn't
    have. **Fixed:** the list-view button disables itself while docked (title explains why),
    re-synced whenever full/docked state changes.

### Known fidelity gaps (not defects — deliberate or unbuilt)
- **Sidebar drag-to-collapse doesn't exist.** Settled after being an open question for several
  sessions: the resizer clamps `Math.max(150, …)` (`:5966-5989`), so it can never collapse. The
  wireframe has this; the app doesn't. A test pins the current 150px-floor behaviour so
  implementing collapse is a deliberate, visible change.
- **Filters is a different UI pattern.** Wireframe (`Library View.html:375-392`) has an inline
  chip row: a "Types" label + single-select pills (All/RAW/JPEG/Video + a "…" expander revealing
  HEIC/TIFF/PNG/DNG), a vertical divider, a "Flags & tags" label, and four circular icon-only
  chips (pick/reject/fav/none). The app has a slide-out drawer of `<select>`s. This is a rebuild.
- **List/table view is out of scope** — the wireframe isn't finished there. (For when it is:
  wireframe has 6 columns — thumbnail, Name, Type, Date taken, Flag (★/—), Size; the app has 9.)
- **Statusbar sync indicator** deferred; needs a real `catalog_scan` progress signal.
- 19 allowlisted structural findings in `test/wireframe_accepted.json`, each with a reason
  (Drives block, Keywords section, Albums "+", no-date bucket, mock-data naming, one
  test-tool artifact).

---

## 4. How to action findings efficiently

The reason earlier sessions burned context is that findings were prose lines that forced
re-investigation per item. Keep them self-contained:

- Each finding above carries its own `file:line` and, where applicable, the literal corrective
  declaration — applyable without opening anything else first.
- **Group by fix locus.** Several findings often share one rule or one handler.
- **Verify narrowly:** `npx playwright test --config=playwright.config.mjs -g "<test name>"`
  re-runs one test in seconds instead of the ~6 minute full suite.
- `wireframe_inventory.mjs` already tracks resolved/persisting/new between runs — a cheap signal
  that a fix landed without re-reading anything.
- **Report-first, per an explicit decision** — no autonomous fix loop. Propose grouped edits,
  get approval, then apply and re-run the affected test only.
- ⚠️ **`bash build-desktop.sh` before any check.** `desktop/dist/` is a staged copy; editing
  `desktop/library-ui.js` alone does nothing and has silently wasted fix attempts before.

---

## 5. Retrospective — what should have been done from the start

Checked against Anthropic's published Claude Code best practices. Every failure here is one they
name explicitly; none of this was bad luck.

1. **"Give Claude a way to verify its work" was skipped for the visual dimension.** Their example
   for exactly this case: *"[paste screenshot] implement this design. take a screenshot of the
   result and compare it to the original. list differences and fix them."* The transplant sessions
   read the wireframe, hand-translated values into a differently-named `.lib-*` class system, and
   moved on. That loop, run once per zone at transplant time, catches the icon swap and the
   separator box-model bug in the session they were introduced — not five sessions later.
2. **The trust-then-verify gap.** Their fix: *"Always provide verification (tests, scripts,
   screenshots). If you can't verify it, don't ship it."* A three-zone structural check was
   treated as proof of full fidelity. It never covered the grid, list view, filters panel,
   icon shapes, colours, or any behaviour.
3. **No adversarial second opinion.** *"a verification subagent… has a fresh model try to refute
   the result, so the agent doing the work isn't the one grading it."* Every check was written and
   graded by the same session that wrote the implementation, so its blind spots were invisible by
   construction. The user ended up being the verification loop, repeatedly.
4. **No spec extracted before implementing.** A good spec *"names the files and interfaces
   involved, states what is out of scope, and ends with an end-to-end verification step."* There
   was no wireframe-selector → literal-value → app-selector table to implement against, so values
   were hand-copied by reading — exactly where transcription drift enters.
5. **Worth adopting: a Stop hook.** *"runs your check as a script and blocks the turn from ending
   until it passes"* — strictly stronger than this repo's pre-commit gate, which only fires at
   commit time and can't stop a session claiming "done" while checks are red.

### Tooling research — settled, don't re-litigate
- `pbakaus/impeccable`, `vercel-labs/agent-skills` (`web-design-guidelines`),
  `nextlevelbuilder/ui-ux-pro-max-skill`: all real, all **generative design-quality guidance**,
  none of them compare an implementation against a *specific* wireframe. The Vercel rule list was
  useful and its assertable rules are now encoded in the `quality` block of the behaviour suite.
  `ui_audit.mjs` already covers the overlapping ground (tap targets, font floor, contrast, focus).
- `tugkanboz/awesome-ai-testing` lists ten pixel-diff tools (Percy, Chromatic, Applitools,
  BackstopJS, Pixelmatch…). **None do wireframe comparison** — that is inherently custom, which is
  why `wireframe_inventory.mjs` exists. Of the ten, only Pixelmatch fits an offline repo with no
  SaaS account, and **it's already a devDependency** used by `test/visual_scorecard.mjs`.
- **`test/visual_scorecard.mjs` already implements pixel diffing** (threshold 0.1, max diff ratio
  0.001, writes diff PNGs to `test/output/visual_diffs/` on failure). Extending *that* is the way
  to add wireframe-vs-app visual diffing — do not build a new one. (Not done this session.)

---

## 6. Next steps, in order

Steps 1–3 (all 12 §3 defects) are DONE as of 2026-09-08. What's left:

1. Decide on the Filters chip-row rebuild — wireframe (`Library View.html:375-392`) has an
   inline chip row (Types pills + Flags & tags icon chips); the app has a slide-out `<select>`
   drawer. A real rebuild, not a bug fix.
2. Decide on sidebar drag-to-collapse — the wireframe collapses past a threshold, the app clamps
   at a 150px floor (a test pins this current behaviour deliberately, per §3's "known fidelity
   gaps"). Also a feature decision, not a defect.
3. Optional: extend `visual_baseline.mjs`/`visual_scorecard.mjs` with wireframe-vs-app zone
   captures; wire a Stop hook to `wireframe:test` + `behaviour:test`.
4. Optional: use `npm run preview` (§1) for the next session's iteration loop instead of
   round-tripping `build-desktop.sh` + manual refresh on every look.

## 7. Verification
```bash
bash build-desktop.sh                 # ALWAYS first — dist/ is a staged copy (now incremental)
npm run wireframe:test                # structural + icon regression; must PASS
npm run behaviour:test                # 67/67 as of 2026-09-08; any failure is new — investigate it
npm run ui:test && npm run lib:test   # must stay green
npm run export:test                   # shader goldens, 18/18
npm run preview                       # live-source Library preview, no build step needed to look
```
