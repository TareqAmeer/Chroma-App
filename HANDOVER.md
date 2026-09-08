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

Steps 1–3 (all 12 §3 defects) are DONE as of 2026-09-08 (morning session). A second pass the
same day found 16 MORE real defects the tools still couldn't see — see §8 for why and what was
built to close that. §8's defects are **diagnosed, tooled, and confirmed by source reading — NOT
YET FIXED.** That's the very next work, in the order below:

1. Fix §8's 16 defects — `npm run wireframe:test` + the new `behaviour:test` cases now surface
   every one of them concretely (finding text cites the exact CSS rule and file:line to change).
2. Decide on the Filters chip-row rebuild — wireframe (`Library View.html:375-392`) has an
   inline chip row (Types pills + Flags & tags icon chips); the app has a slide-out `<select>`
   drawer. A real rebuild, not a bug fix.
3. Decide on sidebar drag-to-collapse (with a re-expand affordance — a plain collapse-to-nothing
   has no way back, which the wireframe doesn't show either) — the wireframe collapses past a
   threshold, the app clamps at a 150px floor (a test pins this current behaviour deliberately,
   per §3's "known fidelity gaps"). Also a feature decision, not a defect.
4. Optional: extend `visual_baseline.mjs`/`visual_scorecard.mjs` with wireframe-vs-app zone
   captures; wire a Stop hook to `wireframe:test` + `behaviour:test` + `lint:library-content`.
5. Use `npm run preview` (§1) for the iteration loop instead of round-tripping
   `build-desktop.sh` + manual refresh on every look.

## 7. Verification
```bash
bash build-desktop.sh                     # ALWAYS first — dist/ is a staged copy (now incremental)
npm run wireframe:test                    # structural + icon/colour/overflow regression
npm run behaviour:test                    # interaction + state coverage; asserts CORRECT behaviour
npm run lint:library-content              # ellipsis / native-select dark-mode / tabular-nums
npm run ui:test && npm run lib:test       # must stay green
npm run export:test                       # shader goldens, 18/18
npm run preview                           # live-source Library preview, no build step needed to look
```
⚠️ `wireframe:test` and `behaviour:test` are BOTH expected to show real findings right now — §8's
16 defects, freshly surfaced by today's tooling. That's correct, not a regression: it's the
signal this session's tooling work exists to produce. Only a finding that ISN'T traceable to §8
(or an existing §3/known-gap item) is a new problem to investigate.

---

## 8. 2026-09-08 (afternoon session) — 16 new defects, and why the tools missed them

The user reported 16 concrete Library issues in one pass — filters, sidebar collapse, a
scrollbar covering sidebar counts, keyword/photo tree indentation, off-center topbar icons,
bordered flag chips, wrong zoom icons, all-three-flags-visible-on-a-card instead of just the set
one, wrong sort/gear dropdown markup, no reject-dimming, a responsive-squeeze rule missing
entirely, sidebar text wrapping instead of truncating, wrong sidebar font, and hover/selected
colours not matching the wireframe. **None of them were caught by `wireframe:test`,
`behaviour:test`, or `ui:test`** despite all three reporting PASS. Root-caused before touching
anything (an explicit instruction, not a shortcut):

- **`wireframe_inventory.mjs` only ever inventoried 3 static zones** (`#lib-top`, `#lib-side`,
  `#lib-bottom`). The **photo grid was never a zone at all** — flag-visibility and reject-dimming
  live entirely outside anything the tool looked at. It also only ever compared atom kind+text
  tallies, an icon-shape **self**-baseline (drift over time, not "wrong since day one"), and
  font-**size** — never colour, never font-family, never icon centering, never a **closed
  menu's contents** (sort/gear dropdowns aren't in the DOM until clicked, and nothing clicked
  them open before inventorying).
- **`ui_audit.mjs`** — the tool that *would* catch overlap/wrapping/squeeze — is scoped only to
  the editor's `.fx-panel` at `?deskx=1`. It has never once looked at the Library, so the
  responsive-squeeze rule (item 13/14 in the original report) had no gate anywhere.
- **`wireframe_behaviour.mjs`** asserts DOM state (classes/localStorage), never visual
  appearance — it can prove a click toggled something, not that the toggle is drawn correctly.
- **`.claude/skills/wireframe-transplant/SKILL.md`** (gitignored — local only, not in this repo's
  git history) still named the *retired* `wireframe_diff.mjs`/`calib/wireframe_diff.py` as the
  regression guard, and its manual-screenshot fallback only enumerated static *regions* ("top
  bar, sidebar, grid, status bar"), never *states* (hover/selected/open-menu/narrow-viewport/
  flagged-card) — so even the human fallback never prompted for the states that exposed most of
  these bugs.
- **Filters and sidebar-collapse** aren't tooling misses at all — both were already flagged as
  deliberately-deferred features in §6 the same morning, not defects the tools failed to catch.

Research grounding (not invented from scratch): [Vercel's
web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) (100 rules /
17 categories — only ~6 were ever encoded in `behaviour:test`'s `quality` block before today),
plus general visual-QA-checklist conventions ([Percy](https://percy.io/blog/visual-qa-testing),
[OverlayQA](https://overlayqa.com/blog/what-is-design-qa/)) and WCAG's own component-state and
non-text-contrast guidance.

### What was built (all committed, all re-runnable)

- **`wireframe_inventory.mjs`**: added a `grid` zone (seeded with a flagged AND a rejected card,
  clicked via each side's own click handler rather than simulated hover — headless :hover
  proved unreliable through a click sequence); menus now opened ONE AT A TIME immediately before
  their own inventory (batching opens first silently closed the first menu — `sortBtn`/
  `viewMenuBtn`'s own handlers each close the other); hover/selected colour-state diffing read
  from the wireframe's OWN computed values (not a hardcoded hex); an overflow/scrollbar-gutter
  check; icon-centering (icon bbox center vs. its nearest square/circular hit-shape — explicitly
  NOT exempting `<button>` from the squareness requirement, which is what produced a
  90+px-off-center false positive on ordinary icon+label menu rows during development); a
  font-family tally alongside the existing font-size one. Icon-shape baseline re-recorded
  (`--icons-baseline`) and the grid's own `<img>` thumbnails excluded from it — their `src` is a
  regenerated blob: URL every run, which is churn, not a shape regression.
- **`wireframe_behaviour.mjs`**: `#lib-tree-toggle`/`#lib-aspect-toggle` both carry
  `opt-action opt-toggle` together, and the gear menu's auto-close listener only checks for
  `.opt-action` — so toggling "Show sidebar" or "Real aspect ratio" wrongly closes the whole
  menu (the user's own report: "when I open a submenu... and select something, the menu
  shouldn't disappear"). Two new tests prove it (RED); a third pins that `data-theme`/
  `data-metaval` groups already behave correctly (GREEN, a regression guard) — plus the new
  keyword-tree chevron test from the morning session.
- **`test/lint_library_content.mjs`** (new, `npm run lint:library-content`): source-level checks
  for a real ellipsis character (never `...`), a native `<select>` with explicit dark-mode
  `background-color`/`color` (a Windows-only rendering bug otherwise), and
  `font-variant-numeric:tabular-nums` on live numeric readouts. Currently 1 real finding
  (`#lib-filters-badge`).
- **`.claude/skills/wireframe-transplant/SKILL.md`**: Step 3 repointed at the current tools and
  rewritten to require every STATE above, not just 4 static regions.

### Confirmed root causes (read from source, not guessed — fix targets for step 1 above)

1. **Flag visibility** — `.lib-flag{opacity:.55;filter:grayscale(1)}` / `.on{opacity:1}` renders
   all three flags always, dimmed; wireframe's `.ratebar.has-set button:not(.set){display:none}`
   removes the unset ones entirely.
2. **Reject dimming** — no `.rejected` class or filter exists anywhere in `library-ui.js`;
   wireframe: `.card.rejected .ph{filter:brightness(.45) saturate(.7)}`.
3. **Tree-row selected colour** — `.lib-tree-row.on{background:var(--bdr)}` (a light-grey
   overlay) where `.lib-coll-row.on` correctly uses `var(--blue-mist-soft)`. Same bug family as
   the morning session's §3.1 separator token miss: the right token exists, just not wired here.
4. **Menu-stays-open on toggle-click** — `#lib-tree-toggle`/`#lib-aspect-toggle` are
   `opt-action opt-toggle`; the close-on-click listener (`viewMenu.querySelectorAll('.opt-action')
   .forEach(...)`) doesn't exempt `.opt-toggle`.
5. Everything else — icon centering, dropdown markup, responsive squeeze, sidebar font-family,
   scrollbar-covers-counts — is now caught with a concrete finding line citing the exact
   selector/rule; read the tool output rather than re-deriving from this summary, which will go
   stale the moment a fix lands and the finding disappears.
