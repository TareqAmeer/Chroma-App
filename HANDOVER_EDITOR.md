# Handover — Editor view wireframe alignment, starting point

Read this before touching Editor code. It exists so the next session doesn't repeat the same
back-and-forth the Library pass went through: tooling that reported PASS while defects shipped,
a "final validation" that got skipped and had to be pointed out, and several rounds of "found N
more" after a round that claimed completion. Everything below is written from direct experience
in that pass, not guessed.

**Companion reading, in order:** `HANDOVER.md` §8-10 (the Library pass, what went wrong and how
it was fixed) and `CLAUDE.md` (app architecture, the shader-comment/backtick bug class, the
"render-and-look before point-samples" lesson). This file assumes both.

---

## 0. What's already true when you start (don't redo this)

- **`editor_wireframe_diff.mjs` now hard-gates.** It used to gate on regressions-only (compare
  to the previous run, overwrite that report in the same run — a new defect failed exactly once
  and read as "persisting" forever after; on a clean checkout it always exited 0). Fixed
  2026-09-08, same bug and same fix as Library's `wireframe_inventory.mjs`. Verified round-trip:
  deliberately broke `--deskx-topbar-h` (44px→61px), confirmed `RESULT: FAIL` + non-zero exit,
  restored, confirmed PASS again.
- **The pre-existing ~59 findings are seeded into `test/editor_wireframe_accepted.json`**, each
  as an exact-string match with the reason "untriaged — pending Editor alignment work." This is
  not a claim that they're fine. It's an honest snapshot so the gate can be hard from day one
  without instantly failing every commit on a backlog nobody has looked at yet. **Your first
  real task is triaging this file** — see §2.
- **A shared checks module exists: `test/wireframe_checks_lib.mjs`.** Five page-agnostic checks
  (border-radius consistency, WCAG contrast, menu-viewport-overflow, control-height uniformity,
  icon-colour differentiation) plus the colour-math helpers and the zone-scoped
  allowlist/hard-gate pattern, extracted from Library's tooling so Editor (and any later page)
  configures them with its own selectors instead of re-implementing the logic. **Editor's own
  script does not use these yet** — wiring them in with Editor-specific selectors is real,
  useful early work (see §3).
- **`python3 test/verify.py --editor`** runs every fast gate (lint ×3, wireframe:test,
  library:responsive-test, mask:test, editor:wireframe-test) in one call, prints a compact
  PASS/FAIL table, and only dumps full output for a gate that actually failed. Add `--full` for
  the Playwright behaviour suite too (~5 min), `--no-build` to skip the rebuild. **Use this
  instead of running `npm run X` five times by hand** — see §5 for why that matters here
  specifically.
- **App install target is the repo root**, not `/Applications`. `desktop/install-app.sh`
  installs to `"<repo root>/Chromasmith copy.app"`. Don't reintroduce `/Applications` anywhere.

---

## 1. The single biggest thing Editor's tooling is missing, and the decision you need to make

`editor_wireframe_diff.mjs` is built on the design Library's tooling **deliberately moved away
from**. Quoting its own header, which is still accurate about Editor today:

> "This is a CHECK, not a search": it takes a hand-written map of [10] element pairs and
> verifies their [12] properties. That design can only ever confirm assumptions already baked
> into the map. It structurally CANNOT see an element the app has that the wireframe doesn't, an
> element the wireframe has that the app doesn't, a control count mismatch, a row rendered under
> the wrong section, or a wrong font size on a row type nobody listed.

Concretely, for the Editor today:
- No structural inventory (Library's `wireframe_inventory.mjs` walks every visible atom in a
  zone; Editor only ever looks at the 10 named pairs).
- No self-consistency checks (the ones that found the folder-tree regression, the flag-chip
  contrast bug, mixed menu idioms — all found things nobody had reported yet).
- **No behaviour suite at all.** Library has 78 Playwright tests covering menus, keyboard,
  hover, focus, drag targets. Editor has zero interaction-state coverage — a menu that doesn't
  close, a keyboard shortcut that stopped working, a hover state that's invisible: none of it is
  checked by anything.
- **No responsive sweep.** Library's `library_responsive_qa.mjs` checks 11 viewports for
  overlap/wrap/truncation. Nothing does this for the Editor's tool rail / panel layout.
- **No photo-loaded state at all.** The harness never drops a file in, so `#fx-zoom-ctrl`,
  `#fx-tools`, and the gear menu — hidden until a photo is open (`relocatePreviewTools`) — are
  invisible to every existing check. Two of the 10 PAIRS entries are flagged unverified for
  exactly this reason.

**This is a real decision, not a small addition — flag it to the user rather than picking
silently:** port the full Library-style approach (structural inventory + self-consistency +
behaviour suite + responsive sweep, using the now-shared `wireframe_checks_lib.mjs` module for
the generic parts) before starting alignment fixes, the same order Library went through — or
work with the narrower PAIRS-based tool and accept it will structurally miss the same classes of
bug that shipped invisibly in Library for months. Given how much of the Library rework was
"the tools said it was fine and it wasn't," the recommendation is the former, but it's real
scope (a day, not an hour) — say so and let the user decide, don't just start building.

---

## 2. Step 1 (whichever tooling path is chosen): triage the 59 seeded findings

Read `test/editor_wireframe_accepted.json`. Every entry needs one of three outcomes:
1. **Real bug** — remove the allowlist entry, fix the actual CSS/markup, verify live.
2. **Justified difference** — keep the entry, but rewrite its `reason` from "untriaged" to the
   actual reasoning (mirroring how Library's `test/wireframe_accepted.json` entries read — see
   any entry there for the bar: specific, falsifiable, cites the source line).
3. **Test-tool artifact** — the check itself is measuring the wrong thing; fix the check, not
   the app (see §4's lint-formats-style bug class).

**Before triaging, look for a shared root cause.** A fast skim of the 59 shows the same handful
of properties (`lineHeight: "normal" vs "24px"`, `height`, `borderColor`'s exact rgba alpha)
repeating across nearly every pair (topbar, undo/redo cluster, zoom control, tool rail, tool
panel, status bar — all four themes × pairs). That shape — one property, same wrong value,
repeated across every unrelated zone — is almost always ONE root cause (a base rule, a token, a
line-height reset) producing N symptoms, not N independent bugs. Confirm this **live** (open
`chromasmith-22.html?deskx=1` in the preview, read the actual computed `line-height` on a real
element, trace which CSS rule wins) before fixing — the Library pass burned real time on this
exact mistake once (HANDOVER_NEXT's own §0, now folded into HANDOVER.md §8): a plain-English
symptom guessed into a CSS property from memory, when the real cause was a different property
entirely. **Read the computed style. Don't guess from the property name in the diff output.**

The `.filmstrip`→`#lib-overlay` and `.statusbar`→`#fx-deskbar` mappings in `PAIRS` are marked as
approximations in the tool's own NOTEs — resolve whether they're actually correct mappings before
trusting any finding under those two labels; if wrong, the findings under them are noise.

---

## 3. Order of work (once the tooling decision from §1 is made)

1. **Fix the photo-loaded coverage gap first**, regardless of which tooling path is chosen — it's
   the same "the wireframe pass structurally can't see this" bug class Library had with
   `?libtest` (CLAUDE.md §10.14: "Library bugs being invisible without ?libtest=1 only holds if
   the mock actually emits the kinds of entry the grid has to render"). Find how
   `test/export_harness.mjs` loads a fixture image into the real app (it does this already, for
   shader verification) and reuse that mechanism to get a real photo open before extracting
   Editor styles. Until this exists, `#fx-zoom-ctrl`/`#fx-tools`/gear-menu findings are
   unverified — don't fix them off the current no-photo report.
2. Triage the 59 seeded findings (§2), starting from whatever the shared-root-cause search turns
   up.
3. If porting the full approach: build the Editor's structural inventory + self-consistency
   checks using `wireframe_checks_lib.mjs` for the five generic ones, plus new Editor-specific
   self-consistency checks in the same spirit as Library's (shared control-family chrome, count/
   badge presence, one state idiom per menu — whatever's structurally analogous in the Editor's
   own DOM). Add a behaviour suite (`editor_wireframe_behaviour.mjs`) covering the tool rail's
   own menus/hover/keyboard the way Library's covers the sidebar/topbar. Add a responsive sweep
   for the panel/rail layout.
4. **Only then** start fixing individual Editor-vs-wireframe defects, using the exact same loop
   Library used for every fix: reproduce live in the preview → read the actual computed style of
   the specific element → change → re-read → screenshot → re-run the specific check that now
   covers it.
5. Before declaring anything "done": run `python3 test/verify.py --editor --full`, take real
   screenshots across states (hover/selected/open-menu/narrow-viewport/photo-loaded), and
   actually look at them — don't report completion on tool output alone. See §6.

---

## 4. Lessons from the Library pass — apply them here from the start, don't rediscover them

- **A check that always passes is worse than no check.** Four checks in Library's own tooling
  could never fail before this pass (a fetched-then-discarded hover pair, a test whose only
  `expect()` sat inside an `if` that stopped being true, a reduced-motion test the fixture's own
  setup made unfalsifiable, an `NO_ELLIPSIS` check whose precondition could only be true for
  elements that already had what it was checking for the absence of). Before trusting ANY
  check — old or new — trace every branch and confirm it's reachable and asserts something. This
  cost real time to find because nobody looked until told to.
- **A gate that overwrites its own baseline every run is not a gate.** Now fixed in both
  `wireframe_inventory.mjs` and `editor_wireframe_diff.mjs`. If you build a NEW checking script
  for anything (a third wireframe page, a different feature), use `wireframe_checks_lib.mjs`'s
  `hardGate`/`loadAllowlist`/`isAccepted` from the start rather than hand-rolling a "gate on
  regressions only" pattern that will silently regress into the same bug.
- **Copy the wireframe's literal values; don't re-derive them from memory.** Every case this
  session where a value was guessed instead of copied produced a bug (an invented squeeze
  breakpoint instead of the wireframe's own `fitTopbar()`; a re-derived hover mechanism instead
  of copying `rgba(255,255,255,.08)` verbatim). Every case where the literal value was copied
  worked first try. Open the wireframe file, read the actual CSS, copy the number — don't
  reconstruct "something like it."
- **Reproduce live before writing a fix, every time — not just for reported bugs.** The single
  most expensive mistake pattern in this whole engagement (documented across three separate
  handover sessions before this one) was translating a plain-English symptom into a guessed CSS
  property and fixing that property, when the real cause was a different property entirely (a
  "border" report whose actual cause was `background`). `getComputedStyle` on the real element,
  every time, before writing the fix.
- **Verify every new check can actually fail before trusting it.** Every check added or repaired
  this session was deliberately broken, confirmed RED, then restored and confirmed PASS. Twice
  this caught a bug in the CHECK itself (measuring a closed menu/filter-row as if it had nothing
  to check — silently skipped instead of failing) before it ever shipped. Budget for this — it
  roughly doubles the cost of adding a check, and is worth every bit of it.
- **A feature-vs-defect judgment call is the user's, not yours — but say what you think.** Every
  case this session where the app had more/different functionality than the wireframe's static
  mock (Filters' extra dimensions, the gear menu's Library-action group, sort's extra keys) got
  resolved by asking, not by guessing "wireframe wins" or "app wins" as a blanket rule. Keep
  doing this for the Editor — don't assume the wireframe is always right just because it's the
  source of truth for *style*.

---

## 5. Being efficient with Claude usage / context on this specific task

- **Use `test/preview_server.mjs` / `npm run preview`, not a full native build, for iteration.**
  No compile step, live-reloads on source edit. Only run `build-desktop.sh` before a Playwright/
  gate run (they read `desktop/dist/`, not the live preview).
- **Use `python3 test/verify.py --editor` for the "did I break anything" loop**, not five
  separate `npm run` calls each dumping full output. It was built during this session
  specifically because the old way — run gate, read wall of text, run next gate, read wall of
  text — burns a full turn per gate for what's usually a one-line answer. Reserve the individual
  `npm run wireframe:test` etc. calls for when a gate actually fails and you need its full
  output to act on it.
- **`--tail N`** on `verify.py` if the default 20 lines of a failure isn't enough — cheaper than
  re-running the underlying script directly just to see more.
- **Kill stray Chromium/preview-server processes before a verification run**, or just use
  `verify.py` (it does this automatically now — found live during this session: 9 leftover
  processes from earlier one-off debugging scripts caused two unrelated gates to fail with
  `page.screenshot`/`waitForFunction` timeouts that had nothing to do with the code being
  tested, and cost a full diagnostic round-trip to realize it was resource contention, not a
  real regression).
- **Batch Playwright test runs with `-g "pattern"`** while iterating on a specific fix instead
  of the full suite — `npx playwright test --config=playwright.config.mjs -g "sort|filter"` —
  and only run the complete suite as the final gate before committing.
- **Don't screenshot everything.** A `getComputedStyle` read via a small Playwright probe script
  answers "is this hover/contrast/position correct" far more precisely and cheaply than a
  screenshot you then have to eyeball. Reserve actual screenshots for genuinely visual
  judgment calls (does this layout read correctly, does this icon look right) — used well by the
  end of this session, but the early part of it defaulted to screenshots for things a computed-
  style probe would have answered in one line.
- **Don't declare a task complete and then do the promised verification step afterward, if
  asked about it.** This happened once this session — the plan explicitly listed a final
  screenshot/state-sweep pass, it got skipped under the pressure of "wrap this up," and had to
  be pointed out by the user before it actually happened. Do the verification the plan commits
  to BEFORE reporting done, not after being asked "did you actually do that."

---

## 6. What "done" needs to include (don't skip this again)

For every Editor fix, before calling it finished:
1. Reproduce live in the preview, read the actual computed style.
2. Make the change.
3. Re-read the computed style — confirm the specific property actually changed to the intended
   value, in the specific state it applies to (hover/selected/open/narrow — not just at rest).
4. Screenshot it, actually look at the image (not just "the tool says PASS").
5. Re-run the specific check that now covers this — confirm it goes from FAIL to PASS, not just
   "no new failures."
6. Run `python3 test/verify.py --editor --full` before considering the batch complete.
7. Update this file (or `HANDOVER.md`, whichever the team prefers by then) with what was
   actually fixed, and be explicit about anything a first diagnosis got wrong — that's the
   record that made this file possible to write accurately.

---

## 7. What NOT to do — steps that would be pure waste of time regardless of what they produce

- **Don't touch `/Applications/Chromasmith.app`.** It's not the install target any more (§0).
- **Don't hand-roll a new "gate on regressions only" pattern for anything.** Use
  `wireframe_checks_lib.mjs`'s `hardGate`. This exact mistake shipped independently in TWO
  different tools before being caught — assume it'll happen a third time if not actively avoided.
- **Don't fix an Editor-vs-wireframe finding from the diff tool's raw output without opening the
  live app first.** Every finding in `editor_wireframe_diff.mjs`'s report is a computed-style
  DELTA, not a diagnosis — `lineHeight: "normal" vs "24px"` doesn't tell you WHY, and guessing
  will send you down the same wrong-property-fixed path documented in §4.
- **Don't trust the "no photo loaded" report's zoom-control/Tools-button findings as real bugs**
  until the photo-loaded harness gap (§3 step 1) is closed — they may just be comparing the
  wireframe against a legitimately different app state.
- **Don't re-run the full Playwright suite after every single small edit.** It's ~5 minutes;
  batch several related fixes, verify with `-g` on the specific tests, then run the full suite
  once before committing that batch.
