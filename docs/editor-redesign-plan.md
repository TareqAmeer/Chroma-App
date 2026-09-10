# Editor redesign — how to design the remaining panels and get them built correctly

Written 2026-09-09. Load this before any Editor layout/style work. It is the process document;
`test/editor_ux_spec.json` is the live backlog and `HANDOVER_EDITOR.md` is the (partly stale)
history of how the tooling got here.

---

## 0. What this redesign actually is

Not a restyle. The Editor's 23 tool sections are being **regrouped** into a smaller set of
panels, and each panel is being redrawn. Two facts set the whole shape of the work:

- The app already folds its 23 `data-fxsec` sections into 12 desktop rail buttons via
  `FX_GROUPS` (`chromasmith-22.html`). The grouping largely matches the wireframe already.
- **The wireframe only designs 2 of its 11 panels.** `looks` and `adjust` are real; the other
  nine are literal placeholders reading `"<X> tools live here."`

So the bottleneck is not implementation. **Nine panels have no design yet.** No amount of
tooling, prompting or agent time can produce a correct panel from a placeholder sentence — this
is why previous passes stalled: work was requested against a spec that did not exist.

Run `npm run editor:coverage` for the current state. Today:

| | |
|---|---|
| panels designed | 2 of 11 (`looks`, `adjust`) |
| app sections | 23 |
| sections with no wireframe home | `deconv`, `diag`, `image`, `wheels` (spec D2) |
| panels with no rail button | `crop` (spec D3) |

---

## 1. The division of labour

**You design. I wire and implement. A machine decides whether it matches.**

The third part is the one that has failed before, in both directions: a model judging its own
screenshot reported success on broken UI, and a property-only check reported PASS while whole
elements were missing. Neither of those is in this loop.

### What you do, per panel

Fill in the placeholder panel in `chromasmith-design/project/Editor (Developer) View.dc.html`.
It is a real HTML file — edit it directly, or through Claude Design's canvas, whichever you
prefer. Two requirements, both cheap and both load-bearing:

1. **Use the wireframe's own `_ds` tokens** for colour, type and spacing. A hard-coded hex is
   how token drift enters, and token drift is the single biggest category in the existing
   backlog (see `test/editor_wireframe_accepted.json` — nearly every entry is one border token
   used in the wrong role).
2. **Draw every state you care about**, not just the resting one. Hover, active, disabled,
   empty, and the long-content case. Anything you don't draw, I will invent, and my invention is
   what you'll be correcting later at ten times the cost.

You do **not** need to write a spec, a token table, or measurements. That was tried and it did
not help — the numbers get read off the wireframe programmatically.

### What I do, per panel

In this order, and none of it is optional:

1. **Add a `PAIRS` entry** in `test/editor_wireframe_diff.mjs` mapping the wireframe panel to
   its app counterpart. This is what makes the panel's 12 properties machine-comparable. Without
   it, the panel is invisible to every check.
2. **Add spec items** to `test/editor_ux_spec.json` — one per discrete change, each with a
   stable ID and a named `check`. An item with `check: null` is an item that will not get
   verified.
3. **Add behaviour tests** to `test/editor_wireframe_behaviour.mjs` for anything clickable,
   draggable or keyboard-driven in the panel. **This is the step that protects a re-layout.**
   Moving markup is what silently severs wiring, and the Editor has ~10 interaction tests where
   the Library has 78. Every control I move needs a test asserting it still does something
   *before* I move it.
4. **Implement**, moving existing markup rather than rewriting it — see §3.
5. **Run `npm run editor:gates`** and iterate until green.
6. **Screenshot the result and look at it.** Not to measure — to catch the class of defect no
   check has an opinion about (something ugly, something in a nonsensical place).

---

## 2. Order of work

Do these in order. The prep is done; start at step 2.

1. ~~**Prep** — gates wired into `npm test`, coverage map built, backlog seeded.~~ Done
   2026-09-09.
2. **Resolve D2 and D3** — the four homeless sections and the crop rail button. These are
   one-line decisions from you, and every later panel design depends on knowing what lives
   where. Blocking everything else on them is deliberate.
3. **Grow the behaviour suite before moving anything.** Target the panels you plan to redesign
   first. This produces no visible change and is the highest-value hour in the project.
4. **Design and build panel by panel**, one panel per session. Not two. Context exhaustion
   mid-panel is how half-old/half-new markup gets committed.
5. **Then the open bugs** (E1-E7, 3.1.x, 3.4.x) — separately, in their own passes.

### Sequencing rule: never mix the three kinds of change

Tokens/style, layout moves, and bug fixes go in **separate passes and separate commits**. Mixed
passes cannot be bisected, and "the redesign broke something" then costs a day to attribute.
The spec file can track them together; the work must not.

---

## 3. Rules that come from things that already went wrong

- **Move markup; do not rewrite it.** The Editor is 51 hand-written `.fx-ctrl` panels with
  behaviour wired through inline handlers and 317 distinct element IDs referenced from JS.
  Relocating a node keeps its ID and its handlers. Re-authoring it re-wires all of that by hand,
  in the area with the thinnest test coverage. A shell rebuild was considered and rejected for
  exactly this reason.
- **Both shells render from the same markup.** Desktop (`deskx`) and the ≤700px phone shell
  (CLAUDE.md §4) share it. Every layout change must be checked at both. `editor_responsive_qa`
  stops at 700px; the phone pass lives in `test/ui_audit.mjs`.
- **Read the computed style; never guess from a property name.** A plain-English symptom guessed
  into a CSS property has already cost this project real time (HANDOVER_EDITOR.md §2).
- **One property wrong across many unrelated zones is one root cause, not N bugs.** Check for a
  shared token or base rule before fixing anything individually.
- **A GLSL-adjacent edit is a different risk class** — if a change reaches shader source, follow
  the `shader-edit` skill. A failed shader compile does not break the page; the feature just
  silently does nothing.
- **`editor:wireframe-diff` has a documented flake (E7)** — light-theme colour reads on
  `#fx-deskbar` descendants intermittently return dark-theme values. It retries 6× in both the
  pre-commit hook and `editor_gates.mjs`. A real regression fails all six. Never "fix" a red gate
  by raising the retry count. ⚠️ **STILL NEEDS a dedicated non-headless confirmation pass**
  (2026-09-10): analysis so far points to a CSS transition read-race (`getComputedStyle` sampled
  mid `color`/`all` transition on `.hdr-btn`/`.tab`/`.fx-rail-btn`, disagreeing with the
  already-updated `--txt` custom property) rather than a theme-class reset during photo load — no
  code path was found anywhere that removes/reapplies `.light` or `body.className` on photo load.
  Not proven live; do not treat as resolved.
- **Another session may be editing this repo concurrently.** Check `git status` before
  committing and commit only your own files.

---

## 4. The checks, and what each one can and cannot see

| check | sees | blind to |
|---|---|---|
| `editor:coverage` | whether a panel is designed / mapped / checked | anything about correctness |
| `editor:wireframe-diff` | 12 CSS properties on hand-mapped element pairs | anything not in `PAIRS` |
| `editor:inventory` | structural atom counts per zone | behaviour, layout, states |
| `editor:responsive` | overlap/wrap/aspect across 8 viewports | ≤700px phone shell |
| `editor:wireframe-behaviour` | clicks, keyboard, menus (Playwright) | appearance |
| `ui:test` | touch targets, contrast, font floors, phone pass | wireframe fidelity |

`npm run editor:gates` runs the first four. `npm test` now includes it.

Both allowlists (`test/editor_responsive_accepted.json`,
`test/editor_wireframe_inventory_accepted.json`) require every entry to name the spec item that
tracks the real fix. **An allowlist entry is a deferral, not a verdict.** Entries seeded on
2026-09-09 are real defects with tracking IDs, not accepted differences.

---

## 5. Why not Figma, Stitch, or a from-scratch `/design` canvas

The failing step has never been "drawing a design". It has been carrying a design across a tool
boundary into a 21,000-line single-file app. Every additional tool adds a boundary. The
wireframe already lives in the repo, in the same language as the app, and the gate reads its
numbers directly — so a value you set in the wireframe is the value the check demands from the
app, with nothing in between to translate it wrongly.

Claude Design's canvas is fine for *authoring* the artboards, as long as the output lands back
in `chromasmith-design/project/*.html`. Anything that ends as an image or a React component
reintroduces the boundary.
