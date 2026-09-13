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

Use this same evidence-driven loop with Codex, Claude, or another coding assistant. Commands and
repository evidence are shared; no vendor-specific helper or subagent is required. Complete one
component or panel at a time:

1. Identify the exact component family and affected declarations with
   `node scripts/query-components.mjs --family <family>` (and `--icon <name>` for a semantic icon).
   Record the source files, lines, and selectors that the query returns.
2. Run `npm run components:check` before editing.
3. Read only `docs/ui-workflow/component-contracts/contracts/<family>.json` for the family being
   changed. Treat draft observations as evidence, not approved design decisions.
4. If a visual reference is involved, create a reference specification using
   `docs/ui-workflow/reference-to-spec/README.md` and its template, resolve its approval-blocking
   questions, and obtain approval before implementation.
5. Record the active panel in the task prompt or task notes.
6. Read only the approved panel specification and, when applicable, the approved reference
   specification, plus the grep-located production section needed for the named targets. Do not
   read the production file in full.
7. Implement with existing markup and shared components; move existing markup when possible.
8. Run the focused typed diff, `node test/editor_wireframe_diff.mjs --panel <panel> --json`, and
   the panel-specific checks required by the approved specification. For layout changes, preserve
   the every-width requirement in §3 and in the wireframe-transplant skill.
9. Capture the panel pair with `node test/panel_pair_shots.mjs --panel <panel>`.
10. Review the result against explicit acceptance criteria in a fresh, separate chat. Give the
    reviewer no implementation context beyond the approved specification, affected files, and
    validation evidence. The reviewer reports mismatches against those criteria.
11. Run `npm run components:check` and the focused contract/specification validations again.
12. Commit implementation and validation evidence separately when that separation is useful.

The query is authoritative for source-locatable shared declarations; dynamic declarations and
instances without stable selectors remain visible coverage debt and must be considered. Component
contract validation is `node scripts/validate-component-contracts.mjs --family <family>`. A
reference specification is checked with `npm run reference:spec:validate -- <spec-path>`.

### Optional model guidance

Use Luna for deterministic checks and small documentation changes, Terra for bounded
implementation, and Astra only for difficult visual interpretation or unresolved review. These
are optional role suggestions; the workflow, checks, and evidence do not depend on a model choice.

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

- **Never invent a colour. Strict rule, no exceptions.** Every colour used in implementation
  must be an existing design-system token (`var(--acc)`, `var(--mut)`, `var(--bdr)`, `var(--txt)`,
  etc. — see `DESIGN 2.md`'s palette) or copied verbatim from the wireframe. If the wireframe
  didn't specify a colour for something, that is not license to pick one — use the token the
  nearest equivalent real control already uses, or ask. Caught once already: Retouch's primary
  button reused the app's pre-existing `.bpri` class (an amber/orange gradient) because it
  already existed and looked like a plausible "primary button" — but it predates the design
  system and violates its own explicit "one interactive color" principle. `.bpri` is legacy;
  never reach for it in new redesign work. The fix, `.fx-btn-primary`, uses `var(--acc)` alone
  — the same solid-fill recipe `#fx-add-btn` already uses elsewhere in the app — precisely
  because that recipe was independently verified against `DESIGN 2.md`, not assumed compliant
  from precedent. Verify every new colour choice against the design doc before using it, the
  same way — "an existing class already does this" is not verification.
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
