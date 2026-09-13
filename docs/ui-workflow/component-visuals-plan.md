# Component visuals in the token report — plan

Scope: the token report's Components tab (`scripts/token-report.mjs` → `componentSections()`,
rendered into `scripts/token-report.html`) currently lists each family as a text row (name,
selectors, instance count). This plan covers replacing that with real rendered visuals
(actual sizing/color/state), what that takes, what Apple/Adobe/Material do for cross-app
consistency, what AI-assisted ("vibe coding") teams recommend for avoiding component sprawl,
and the resulting maintenance process for this repo.

## 1. What it takes to show real visuals, not text

The app already has the right mechanism — do not re-derive component visuals by hand (violates
the reference-to-spec rule in `docs/ui-workflow/reference-to-spec/`: use the app's own
tokens/markup, never redrawn approximations).

**`?catalog=1`** (`chromasmith-22.html:22261-22395`, see `docs/ui-workflow/STATE.md` S1(d))
already clones real DOM nodes out of the booted app — genuine computed styles, real markup,
real `.seg`/`.fx-toggle` internals — and renders `rest` / `disabled` / `modified` / `longlabel`
states per component. It only covers 8 hand-picked components today (`COMPONENTS` array,
line 22346), while `design/components.json` tracks 29 families and `components-runtime.json`
records 983 live appearances across 18 states. The gap is coverage, not mechanism.

Plan:
1. **Generalize `buildCatalogPage()`** to iterate every family in `design/components.json`
   instead of the hardcoded `COMPONENTS` array — one real selector per family (already present
   as `families[name].selectors[0]`), same 4 states.
2. **Screenshot each catalogue item** with Playwright (reuse `test/component_runtime_check.mjs`'s
   browser setup) — one crop per `[data-cat]` node's bounding box, light + dark theme. Write PNGs
   to `design/asbuilt/components/<family>-<state>-<theme>.png`, keyed by a content hash of the
   component's source line + the relevant token values, so a re-run only re-screenshots what
   actually changed (same idea as `perf_bench.mjs`'s baseline-diff, not a full re-render every time).
3. **Extract real metrics alongside the screenshot**, not hand-typed: `getComputedStyle()` on
   the cloned node for `width`/`height`/`padding`/`font-size`/`color`/`background`/`border-radius`,
   and cross-reference against `design/tokens.json` to label which token backs each value (or
   flag it as a literal — this reuses the existing color/spacing/font literal-detection already
   in `token-report.mjs`, just scoped to one component instead of the whole stylesheet).
4. **Embed in the report**: each `comp-row` gets a thumbnail (`<img>`) + a small computed-value
   table, sourced from the JSON written in step 3 — `token-report.mjs` stays a pure renderer of
   pre-computed data, it does not talk to a browser itself (keeps `npm run tokens:report` fast
   and dependency-free the way it is now).
5. **Wire into `npm run components:build`** as an additional output next to
   `components.json`/`components-runtime.json`, so the report step (`token-report.mjs`) only
   ever reads JSON/PNGs off disk, same pattern as the current components/icons sections.

Effort: the Playwright scaffolding and computed-style extraction are the only new work — the
cloning, state simulation, and theme toggle already exist in `buildCatalogPage()`. Rough size:
similar to `test/component_runtime_check.mjs` (currently ~70 lines) plus a small screenshot-diff
cache. Not a rewrite of the report.

**Do not**: hand-build mockup HTML/CSS from memory of what a component "should" look like, or
screenshot the live app and eyeball pixel values — both are exactly the failure mode
`docs/process-lessons.md` #19 and the reference-to-spec gate already exist to prevent.

## 2. How Apple / Adobe / Google manage cross-app component consistency

- **Apple (HIG)**: no token repo — consistency comes from *system-provided* components (people
  get the real control, not a redrawn copy) plus three stated principles: Clarity, Deference,
  Depth, with consistency as the connective thread across them. Docs are organized by
  Foundations → Patterns → Components → per-platform notes, and each component page states how
  it should behave and which system API backs it — behavior is specified, not just appearance.
  ([Apple Developer — Components](https://developer.apple.com/design/human-interface-guidelines/components))
- **Adobe Spectrum**: an explicit, versioned token repo (`spectrum-design-data`) — color,
  typography, and layout tokens, plus **component-specific tokens** so a component's design can
  evolve without re-deriving higher-level decisions each time, and a **component API schema**
  (properties/types/defaults) checked into the same repo as the tokens. There's a visual token
  viewer with component-usage analysis, so a designer/engineer can see which components consume
  a given token before changing it.
  ([Spectrum Design Data](https://opensource.adobe.com/spectrum-design-data/),
  [Design tokens](https://spectrum.adobe.com/page/design-tokens/))
- **Material Design 3**: each component ships a spec (annotated values/parameters that define
  its coded capabilities) and an explicit state model (rest/hover/focus/pressed/dragged/
  disabled) documented as its own foundation page, separate from any one component.
  ([Material 3 — Components](https://m3.material.io/components),
  [States](https://m3.material.io/foundations/interaction/states/overview))

Common thread across all three: **one machine-readable source of truth (tokens/schema),
component docs generated or checked against it, and states treated as a first-class enumerable
set** — never a component that only has an implicit "however it currently renders" definition.
That is already this repo's `design/tokens.json` + `design/components.json` shape; the report
gap in §1 is the presentation layer, not the underlying model.

## 3. What AI-assisted ("vibe coding") teams recommend for avoiding component sprawl

From current guidance on AI-assisted UI work: output quality is bounded by the structure fed
in — a well-structured component library with clean APIs and metadata produces reusable output,
an unstructured one produces one-off divergent copies per prompt. The specific failure mode is
sprawl: every new AI-driven UI request quietly invents its own near-duplicate of an existing
component instead of reusing one, because nothing forces a reuse check before generation.
Recommended countermeasures, all already partially present here:

- **Deterministic guardrails on what a generation pass can touch/create** — this repo already
  has this in the pre-commit design-token/color gates; the missing piece is the same kind of
  gate at the *component* level (a new hardcoded card/row/toggle markup pattern should fail the
  same way a new hardcoded hex color does).
- **Review and document decisions rather than silently accepting AI output** — the
  `docs/ui-workflow/component-contracts/` directory already does this (authored targets +
  approval metadata separate from generated observations); it's underused relative to the
  registry it sits above.
- **Hybrid workflow**: use AI freely for iteration, but gate anything reaching the real page
  behind the existing deterministic checks (`components:check`, the color/spacing literal
  scan, `ui:test`) — exactly this repo's current model, just needs the visual-diff gate below
  added to the same tier.

([Spectrum-style component/token guidance and 2026 AI-assisted design system practice,
consolidated from Adobe Spectrum's own component-token rationale and general 2026 vibe-coding
governance writeups — see search results in this session for source links.])

## 4. Maintenance plan going forward

**Source of truth stays generated, never hand-maintained:**
- `design/tokens.json` — token values (already the rule, §6 of root CLAUDE.md).
- `design/components.json` / `components-runtime.json` — family registry + live coverage,
  regenerated by `npm run components:build` / `:check`, never hand-edited.
- New: `design/asbuilt/components/*.png` + a small `components-visual.json` (computed values
  per family/state/theme) — regenerated by the same build step, gitignored or committed as
  binary evidence per team preference (proof/validation PNGs are currently gitignored elsewhere
  in this repo — follow that precedent unless the user wants them versioned for diffing).

**Three-tier gate, mirroring the tokens gate already in place:**
1. *Literal-level* (exists): color/spacing/font literals outside the token set fail
   `npm run tokens:check` / pre-commit.
2. *Component-level* (exists, extend): `components:check` fails on drift in family/variant/state
   coverage; extend it to fail when a new markup pattern duplicates >90% of an existing family's
   selector/structure instead of reusing it (a "did you mean `.fx-row`?" check) — this is the
   concrete sprawl guardrail from §3.
3. *Visual-level* (new, from §1): once every family has a real screenshot, a lightweight
   pixel-diff against the last approved baseline (same tooling class as the wireframe-fidelity
   gate) catches an unintended visual change to a shared component before it ships, the same way
   `perf_bench.mjs` catches a budget regression.

**Process discipline (from `docs/process-lessons.md` #19, still the sharpest lesson here):**
- A component's approved appearance is a recorded `approval.status: approved` entry in
  `docs/ui-workflow/component-contracts/`, not an implicit "it currently renders this way."
- Any redesign of a family with a non-null `appleComponent` mapping goes through a contract
  first (already the stated rule in `docs/ui-workflow/component-registry.md` — keep enforcing
  it, it's currently advisory only).
- Cadence: re-run `components:build` + the new visual step in the same CI/pre-commit path as
  `editor:gates` (already rebuilds `desktop/dist/` first, per root CLAUDE.md §2) so nothing
  gates against stale code.

## Completeness check

Every family in `design/components.json` (currently 29) gets a catalogue entry, a screenshot
per state × theme, and a computed-value row — `families.length` from the same JSON this doc's
plan reads is the literal count to match, not a hand-typed list. `npm run components:check`
already fails on registry drift; the new visual step should fail the same way when a family in
that JSON has no corresponding screenshot.
