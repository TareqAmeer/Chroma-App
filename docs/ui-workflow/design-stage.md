# Redesigning a surface marked "Redesign"

One page: how to take a surface the Surface Triage review marked **Redesign** (the `triage` db
collection on the Surface Triage artifact, S7c) from "here's what exists today" to a real proposal
that merges into the wireframe. Written from what the `design` skill (Claude Design's canvas
editor, packaged for this preview) actually supports — nothing here assumes a capability the skill
doesn't have.

## 1. Start the canvas from real material, not memory

The `design` skill's own workflow (§0, "Match the existing app pixel-perfectly") requires lifting
exact values from the real source before drawing anything. For a Redesign surface, that source is
already sitting in the repo from S6c/S6d, not the live app:

- **`design/asbuilt/<surface-id>/`** — the real screenshots (`rest.webp`, `hover.webp`, etc.),
  `spec.json` (element tree + computed color/typography/spacing/radius/motion values, each already
  matched to a `design/tokens.json` token by value+role where one exists) and `block.dc.html` (the
  surface's real outerHTML, already wrapped in the `.tp-panel[data-panel]` shell the approved
  wireframe uses). `block.dc.html` is the right starting point for a new `.dc.html` artboard: it is
  real markup, not a redrawn approximation, so copying it in is exactly what §0 asks for.
- **`design/tokens.json`** — the only place a colour, spacing or radius value the redesign uses is
  allowed to come from, per `docs/editor-redesign-plan.md` §3 ("don't invent colours") and the two
  `test/panel_proposals.mjs` fabrication incidents this whole validator exists because of. If the
  surface needs a value with no token (S1(a) found roughly a third of the current wireframe's own
  values don't have one — control heights, pill radius, font weights, several off-grid spacing/
  colour literals), that's a real gap: add it to `design/token-conflicts.md` and flag it for a
  token decision rather than inventing a literal to fill the hole.

Read `design/surfaces.json`'s entry for the surface for its real states (which of rest/hover/
disabled/empty/loaded/longText/on/off actually fire) and its `group` — that tells you which other
S6c-captured surfaces sit in the same panel, in case the redesign moves a control between them (as
several already-approved proposals in `panel_proposals.mjs` do).

## 2. Author the canvas

Follow the `design` skill's own steps: one `.dc.html` per artboard, named for the artboard
(`Main.dc.html` for the leading candidate), a `canvas.json` if there's more than one. What this
means concretely for a Redesign surface:

- **Required state artboards**: one artboard per state `design/surfaces.json` records as actually
  firing for this surface, at minimum **rest** and, if the surface has one, the **edited** state
  (`panel_proposals.mjs`'s own convention: at least one section is shown edited so the reset-control
  rule is visible in review, not just described). Skip states the app doesn't actually have — don't
  invent a hover/disabled artboard for a surface `surfaces.json` never recorded as having one.
- **If the redesign changes structure** (splits a panel, regroups controls, changes a control's
  kind), show a **before** artboard (the `block.dc.html` as-is, or close to it) beside the
  **after** artboard(s) — the side-by-side is what `panels/*.compare.html` already does for the
  nine Editor panels, and it's the format the surface triage / review page already expects.
- Use the skill's own component vocabulary (`sec()`/`secPlain()`-equivalent groups, `.slider-row`,
  `.seg`, `.rlist`, etc. if this surface is an Editor panel section) so the output is structurally
  compatible with `test/panel_proposals.mjs` and this validator, not a one-off shape that has to be
  hand-translated later.
- The skill's own rule applies without exception here: **do not invent copy, controls, or values**
  the real surface doesn't have. If a control's real range/options aren't in `test/output/
  panel_inventory.json` (regenerate with `node test/panel_extract.mjs` if stale) or the surface
  isn't a `data-fxsec` panel section at all (many Redesign candidates won't be — Library rows,
  modals, chrome), read `design/asbuilt/<id>/spec.json` and the real DOM instead of guessing.

## 3. Validate before publishing

Run `node test/proposal_validate.mjs <file>` against the artboard's rendered HTML (or against the
generated `panels/<panel>.compare.html` if the surface is one of the nine Editor panels already
wired into `panel_compare_build.mjs`) before treating the design as reviewable:

- **Hard fail** (fix before publishing): a control whose label, kind or numeric range matches
  nothing in `panel_inventory.json` for this surface's panel scope, or a colour that isn't a
  `design/tokens.json` value. These are exactly the two fabrication classes commits `247110c` and
  `8eed9f0` had to fix by hand after the fact.
- **Report only** (note, don't block): a spacing/size/radius literal that isn't a token — expected
  and non-blocking per S1(a)'s finding that the approved wireframe itself is mostly off-grid
  literals; log it in `design/token-conflicts.md` if it looks like a real missing token family
  rather than a one-off.

The validator only checks what it can extract mechanically (sliders, toggles, `field()`+select
pairs, `ratioList()` rows, and inline/`.wf`-scoped colours) — it is not a substitute for reading
`spec.json`/the real DOM against the artboard before calling a surface done, the same way
`panel_proposals.mjs`'s own audits still needed a human pass after the automated one.

## 4. Merge into the wireframe with `data-app` links

Once a direction is picked (the skill's own canvas-exploration workflow — 2-4 candidates only when
a real direction decision is open, not for a mechanical translation), the picked artboard's markup
merges into the approved wireframe file the same way S8's `data-app` convention already works in
`Editor (Developer) View.dc.html`: every control that has a real app counterpart gets
`data-app="<app CSS selector>"` (the selector comes from that control's `id` in
`panel_inventory.json`/`spec.json`, never typed from memory), and a control with no real
counterpart gets `data-app="none"` plus a `data-note` explaining why. This is what lets
`test/wireframe_spec_extract.mjs` and `editor_wireframe_diff.mjs`'s generated `PAIRS` treat the
merged wireframe as machine-checkable against the live app afterward, instead of a static picture.

## What the `design` skill does NOT support here (stated, not assumed)

- It cannot import a real Figma file, an existing component library, or run against the live app
  itself — everything it draws from has to already be in the repo as files (screenshots, JSON,
  `.dc.html`/HTML markup) or described in the conversation. That's why step 1 exists: the S6c/S6d
  capture is what makes "start from real material" possible at all for this codebase, which has no
  Figma source of truth.
- It has no design-system colour-token picker or a "request tweaks" agent loop (both depend on the
  claude.ai/design backend, not this packaged preview) — token correctness here is enforced by
  `proposal_validate.mjs` against `design/tokens.json`, not by anything built into the canvas editor.
- Cross-artboard element drag and multi-artboard selection aren't implemented — moving a control
  from one panel's artboard to another means copy/paste (which the skill does support) or
  re-authoring it in the destination artboard, not a drag across the canvas.
- The editor baked into a published canvas doesn't update after publish (stated plainly in the
  skill itself) — a `design-stage.md` process change doesn't retroactively improve canvases already
  published under an older copy of the payload.
