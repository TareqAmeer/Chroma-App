# Component visuals in the token report — plan

Scope: the token report's Components tab (`scripts/token-report.mjs` → `componentSections()`,
rendered into `scripts/token-report.html`) currently lists each family as a text row (name,
selectors, instance count). This plan covers replacing that with real rendered visuals
(actual sizing/color/state), what that takes, what Apple/Adobe/Material do for cross-app
consistency, what AI-assisted ("vibe coding") teams recommend for avoiding component sprawl,
and the resulting maintenance process for this repo.

## 0. Screenshots already exist — check before capturing anything new

Before generating anything, checked whether the design workflow already captured this.
`design/asbuilt/` already holds **96 surfaces / ~470 webp images** from the S6c capture pass
(`test/surface_capture.mjs`, audited by `test/capture_audit.mjs`, per-surface plan in
`docs/ui-workflow/STATE.md`): light + dark, full + cropped, each with a `spec.json` that records
computed color/typography/spacing values **already mapped to their token names**
(`design/asbuilt/imp-bar/spec.json` — e.g. `backgroundColor → /color/action/primary → --acc`).
That is a more complete version of what §1 originally proposed building — reuse it, don't
recapture it.

The gap is **granularity and identity, not existence**:
- `design/asbuilt/` is keyed by *surface* id (`fxsec-adjust`, `cs-modal`, `fx-toast`, `imp-bar` —
  96 named panels/menus/modals), matching `docs/ui-workflow/STATE.md`'s capture plan.
- `design/components.json` is keyed by *family* id (`section-card`, `control-row`, `fx-toggle` —
  29 reusable atoms), matching the token report's Components tab.
- The two taxonomies overlap (a `fx-toggle` atom appears inside many of the 96 surfaces) but
  neither indexes the other today. `?catalog=1` (§1 below) is the only place atoms are shown in
  isolation, and only for 8 of the 29 families.

Revised plan for the report: **first build the family↔surface cross-reference** (which
`design/asbuilt/<id>/spec.json` trees contain a given family's selector — a tree-walk over
already-captured `spec.json`, no new screenshots), and reuse those existing webp crops directly
in the report wherever a family already appears in one. Only fall back to generating a fresh
`?catalog=1` capture (§1) for a family that never appears in any of the 96 captured surfaces
(e.g. a Library-only or Guide-tab atom the S6c pass didn't reach). This cuts new capture work to
whatever's left uncovered, not all 29 families.

## 1. What it takes to show real visuals, not text (for the families §0 doesn't already cover)

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

## 5. Animation review — nothing captures this today

Checked `editor:motion-token-check` (`test/editor_motion_token_check.mjs`): it only verifies
that `transition-duration`/`transition-timing-function` values resolve to `--dur-*`/`--ease`
tokens instead of raw literals. It never plays the animation — a smooth transition and a janky
one that happen to use the same token pass identically. No existing gate or capture (`asbuilt`
included — those are static webp) shows motion; `docs/ui-workflow/STATE.md` says so explicitly
("PNG pixels cannot establish intended tokens, fonts, hidden states, accessibility, **motion**,
or visual correctness"). This is a real gap, not a duplicate of existing tooling.

**Components in this app with real, reviewable motion** (grepped every `transition:`/`@keyframes`
in `chromasmith-22.html`):
- `.fx-toggle` — the switch knob uses a custom overshoot easing,
  `cubic-bezier(.75,.02,.86,1.31)` (line 245), distinct from the rest of the app's standard
  `var(--ease)` — worth watching at real speed to judge whether the overshoot reads as lively or
  glitchy.
- `.fx-ctrl-chev` / `.msk-group-chev` / `.fx-preset-chev` — section/group disclosure chevrons,
  simple rotate transitions.
- `fxSecIn` keyframe — mobile section-card entrance (opacity + translateY), `.18s ease`.
- `.fx-split-popover` — entrance uses `cubic-bezier(.2,.8,.3,1.15)`, another custom (slightly
  overshooting) curve worth checking against the toggle's for consistency.
- `body.mobile-fx .fx-panel` — bottom-sheet open/close height transition, `.28s ease`.
- `.fx-layout` grid-template-columns transition (desktop panel resize), `.2s ease`.
- Progress fills (`#eo-fill`, `#fx-export-prog-bar`, `#nr-high-progress-bar`, `#boot-splash-bar`)
  and the `fxspin` spinner keyframe.
- Compliant already: line 460 zeroes every `transition-duration`/`animation-duration` under
  `prefers-reduced-motion` — matches the Apple/Material guidance in §5b below, nothing to fix
  there.

### 5a. How to actually capture motion for review

Playwright (already the driver for `test/component_runtime_check.mjs` and `surface_capture.mjs`)
can record video per page (`context.video`) or do a CDP screencast — either gives real frames,
not a described transition. Plan:
1. For each animated selector above, script the real trigger (click the toggle, open the
   popover, expand the section) inside a short Playwright run, recording a 1–2s clip through the
   transition.
2. Save as `design/asbuilt/<id>/motion.webm` (or a re-encoded GIF for easy inline embedding),
   next to that surface's existing static webp captures from §0 — same directory, same review
   flow, no new taxonomy.
3. Pull real frame timestamps from the trace (not just the declared `--dur-*` token) to flag
   **dropped frames or a rendered duration that drifts from the declared one** — a token-correct
   transition can still stutter under real paint cost, which `motion-token-check` cannot see.
4. Review is manual (a human judging "smooth" is not something a pixel-diff threshold captures
   well) — the report's job is surfacing the clip next to its declared duration/easing token so
   you can watch it and flag anything that needs re-tuning, not auto-passing/failing it.

### 5b. How others handle animation review

- **Material Design 3**: ships explicit **duration tiers** (`short1`=50ms … up through `long4`/
  `extra-long4`) and two **easing families**, "Standard" (short/inexpensive, non-attention-
  grabbing motion) vs "Emphasized" (bigger, choreographed transitions) — every component's
  motion spec cites one of these named tokens, never a bespoke curve per component. This repo
  has the same *shape* (`--dur-1`/`--dur-2`/`--ease`) but the toggle and split-popover above have
  their own one-off `cubic-bezier(...)` outside that scale — worth deciding whether those are
  intentional "emphasized" exceptions or drift.
  ([Easing and duration – Material Design 3](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs))
- **Apple HIG**: keep motion subtle and infrequent — system components already animate
  consistently, so custom motion should be reserved for moments that need it, and must respect
  Reduce Motion (crossfade instead of slide, no autoplay) — already satisfied here (§5 above).
  ([Motion – Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/foundations/motion))
- **Storybook + Chromatic** (the closest analogue to "review a component's animation before
  shipping"): Chromatic snapshots every story in a real browser, waiting for animations to settle
  before diffing — but for pixel-diff purposes it **disables** animation entirely and instead
  uses interaction "play" functions plus a human review dashboard (accept/deny per changed story)
  for anything animation-related, because pixel-diffing mid-animation is inherently noisy. The
  transferable idea isn't the tool, it's the pattern: **separate the deterministic gate (token
  literal check — already have it) from the human judgment call (does this look right — needs a
  clip, not a still)**, and keep both, rather than trying to make one check do both jobs.
  ([Chromatic Storybook visual testing guide](https://qaskills.sh/blog/chromatic-storybook-visual-testing-guide))

### 5c. What to add

- A `motion.webm`/`.gif` per animated selector in §5, generated by the Playwright step in §5a,
  reusing `design/asbuilt/<id>/` so it lives with that surface's existing static evidence.
  Priority order: `.fx-toggle` (custom easing, high interaction frequency) → `.fx-split-popover`
  → mobile sheet open/close → section chevrons/`fxSecIn` → progress fills/spinner (lowest
  priority — simple linear/width fills, least likely to look wrong).
- Embed those clips in the token report next to the family's static thumbnail (§1/§4) whenever
  `design/tokens.json`'s `--dur-*`/`--ease` values changed, so a token-scale change shows its
  real on-screen effect, not just the new number.
- Flag the two one-off `cubic-bezier` curves (toggle, split-popover) in the report as "custom
  easing, not on the `--ease`/`--dur-*` scale" — visible today only by reading source; the
  report should call this out the way it already calls out color/spacing literals.

## Completeness check

Every family in `design/components.json` (currently 29) gets a catalogue entry, a screenshot
per state × theme, and a computed-value row — `families.length` from the same JSON this doc's
plan reads is the literal count to match, not a hand-typed list. `npm run components:check`
already fails on registry drift; the new visual step should fail the same way when a family in
that JSON has no corresponding screenshot (reused from `design/asbuilt/` per §0, or freshly
captured per §1 only when no existing surface contains it).

Every selector with a non-token-default `transition`/`@keyframes` declaration in
`chromasmith-22.html` (the literal grep list in §5 — re-run that grep, don't hand-maintain the
list) gets a `motion.webm` clip. That grep is the completeness scan for animation coverage the
same way `families.length` is for the static catalogue.
