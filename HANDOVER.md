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
| Behaviour + UI quality | `npm run behaviour:test` | **58 pass / 8 fail — all 8 are real defects, listed in §3** |
| Desktop UI audit | `npm run ui:test` | PASS |
| Library perf | `npm run lib:test` | PASS |
| Export/shader goldens | `npm run export:test` | PASS (18/18) |

`npm run behaviour:test` is **expected to be red.** Per an explicit decision, it asserts the
CORRECT behaviour rather than today's, so genuine defects show as failures instead of being
baked in as "expected". **Every failure must map to a numbered item in §3. A failure that does
not is a new regression — investigate it, do not add it to the list.**

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

## 3. Confirmed defects — the work queue

All validated by reading the code (file:line given) and, where marked, **proven by a failing
test**. None are wireframe-fidelity issues; they are plain bugs.

1. **Sidebar separators render ~7px thick instead of a 1px hairline.** `desktop/library-ui.js:986`
   ```css
   .lib-coll-sep{height:1px;background:var(--bdr);margin:6px 0 0;padding-top:6px}
   ```
   No `box-sizing:border-box` applies, so `height:1px` + `padding-top:6px` is a 7px box, and
   `background` paints the whole padding-box. Also the wrong token: the wireframe's
   `.sec+.sec` (`Library View.html:134-135`) uses `--divider-soft` (`#f0f0f0`), which *is*
   defined in the app (`library-ui.js:718`) but referenced nowhere.
   **Fix:** use a real border, and map the token into both theme blocks (near `:718/:744/:751`):
   ```css
   .lib-coll-sep{border-top:1px solid var(--divider-soft,var(--bdr));margin-top:6px;padding-top:6px;height:0}
   ```
   *Introduced by `cafdb017`; the later "fix three confirmed mismatches" commit only changed
   which sections get a separator, never this rule — which is why it survived several rounds of
   "fixed".*

2. **Folder-tree chevron loads the folder.** `buildTreeNode` (`:3102-3107`) wires one
   `row.onclick` that toggles expansion *and* calls `openFolder()` *and* re-renders; the chevron
   has no handler of its own. Peeking at a folder's children triggers a full load — the exact bug
   the date tree fixed and documented at `:6475-6481`. Keyword-tree rows (`:8707-8735`) have the
   same shape. **Proven by a failing test** (`listDir` 0 → 1 on a chevron click).

3. **Get Info can't be closed.** `#lib-info-btn` (`:5430`) always sets `showInfo = true` instead
   of toggling; only the `I` key (`:5695`) toggles. **Proven by a failing test.**

4. **Develop tab contradicts its own tooltip.** `title="Develop — not yet available"` but it is
   wired (`:5991`) to close the Library. Also `#lib-side-tab-library` has no handler at all and
   its `on` class is static. **Proven by a failing test.**

5. **Escape closes nothing.** The sort menu, gear menu and filters panel all close on outside
   click but ignore Escape. **Proven by three failing tests.**

6. **Sidebar rows are unlabelled clickable `div`s.** Every `[data-coll]`, `[data-catalog]` and
   `[data-sec-toggle]` row is a `div` with no `role` and no button semantics — invisible to
   assistive tech and unreachable by keyboard. **Proven by a failing test.**

7. **Destructive-action menu has no role.** `showCacheMenu` (`:8569-8582`) appends a bare
   inline-styled `div` to `<body>` with no class, id or role. (The confirmation itself is fine —
   each item goes through `window.confirmModal`.) **Proven by a failing test.**

8. **The sidebar resizer has a ~2px effective hit target.** Its box is 6px (`right:-3px;width:6px`)
   but hit-testing shows `#lib-side` wins from `box.x+3` and `#lib-main` from `box.x+4`, so only
   the leftmost ~2px receives the pointer. `ui_audit.mjs` enforces a 28px pointer-target floor
   elsewhere; this is far under it. Measured, not inferred.

9. **`clearAllLibFilters()` leaves `state.ratingFilter` stale** (`:5707-5715`) — the `<select>`
   is reset to `'all'` but the state field is not. *No observable symptom in mock mode, so there
   is no test for it; it's a code-read finding.*

10. **`syncFilterControls()` calls a function that doesn't exist** (`:5314` → `updateFilterChips()`).
    `typeof`-guarded, so it's a silent permanent no-op. The real function is `syncFilterUI`.

11. **Two comments contradict their code.** Search-Enter (`:1459-1463`) claims CLIP fires only
    when a text match comes up empty — it always fires on non-empty input (`:5813`). The flag row
    (`:1480-1482`) claims it acts on "the first of a multi-selection" — it reads `state.openedPath`
    only and ignores selection entirely (`:3734-3755`).

12. **List view is a no-op while docked.** Clicking "list" persists the state and lights the
    button, but `#lib-grid` never gets `.list-view` because
    `isList = state.viewMode==='list' && !docked` (`:4604-4605`).

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

1. Fix defects §3.1 (separator) and §3.2 (folder-tree chevron) — highest user-visible impact,
   both small and well-specified.
2. Fix §3.3–§3.7 (Get Info toggle, Develop tab, Escape handling, sidebar row semantics, menu
   role). Each has a failing test that will go green.
3. Clean up §3.9–§3.12 (code-read findings, no tests).
4. Decide on the Filters chip-row rebuild and sidebar drag-to-collapse — both are real features,
   not bugs.
5. Optional: extend `visual_baseline.mjs`/`visual_scorecard.mjs` with wireframe-vs-app zone
   captures; wire a Stop hook to `wireframe:test` + `behaviour:test`.

## 7. Verification
```bash
bash build-desktop.sh                 # ALWAYS first — dist/ is a staged copy
npm run wireframe:test                # structural + icon regression; must PASS
npm run behaviour:test                # 8 known failures, all in §3; anything else is new
npm run ui:test && npm run lib:test   # must stay green
npm run export:test                   # shader goldens, 18/18
```
