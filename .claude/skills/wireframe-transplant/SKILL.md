---
name: wireframe-transplant
description: Use whenever implementing or fixing a Chromasmith UI surface (Library, Editor, any panel) against one of the Claude Design wireframes in chromasmith-design/project/*.html. Enforces copying literal values from the wireframe instead of re-deriving them from memory, and requires a side-by-side visual check before declaring anything done. Triggers on "match the wireframe", "implement this design", "the UI doesn't match", or any request referencing Library View.html / Editor (Developer) View.dc.html.
---

# Wireframe transplant workflow

Built after the Library-view pass got this wrong three times in a row: colors
re-derived instead of copied (Export button silently changed color in dark
mode), icons swapped for "close enough" ones already in the app, sidebar
sections reordered to match the app's existing grouping instead of the
wireframe's, and completion declared off a computed-style diff tool that
can't see structure at all. Every rule below exists because one of those
specific things happened.

## Step 0 — read the actual wireframe file, not a memory of it

Before writing any CSS or markup, open the real file in
`chromasmith-design/project/` and its `_ds/` token set. Do not proceed from
a summary or a previous read earlier in the conversation — re-read it. For
every value you're about to write (a color, an icon, a spacing number, a
section's position in the DOM), find the literal line in the wireframe that
sets it and copy that value. Never write "the equivalent of X in our
system" — if the wireframe's `--primary` doesn't change between themes,
your app's stand-in token doesn't either, even if that seems inconsistent
with how the rest of your color system works. The wireframe is the spec;
consistency with your own prior assumptions is not.

Tag every non-trivial decision with its confidence, the way a teardown
would, and say so out loud when reporting:
- **CONFIRMED** — read directly off a `getComputedStyle()` value or the
  wireframe's own CSS/markup.
- **INFERRED** — no direct wireframe equivalent exists (a control the
  wireframe's simplified mock omits, a state it doesn't show); state the
  assumption explicitly rather than silently picking something.

## Step 1 — never substitute an existing app asset for a wireframe one

If the wireframe uses a specific icon, logo image, or asset, use that exact
asset (or its literal SVG path). Do not reach for a same-ish icon already
defined in the app's icon set because it's convenient — `ic('adjust')` is
not a gear just because it's round and already exists. If no equivalent
exists, inline the wireframe's own SVG markup directly rather than
approximating.

## Step 2 — copy DOM structure, not just DOM style

Section order, nesting, and grouping are part of the spec, same as color.
Before restructuring a sidebar/panel, list the wireframe's section order
top-to-bottom as plain text and diff your planned structure against that
list — don't map new content onto whatever grouping the app already
happens to have.

## Step 3 — the only two acceptable verification steps, in this order

`wireframe_diff.mjs`/`calib/wireframe_diff.py` are RETIRED (13 hand-picked
element pairs — structurally blind to anything not on that list). Current
tools, both current as of 2026-09-08:

1. **Side-by-side screenshots, at the same viewport, in both themes —
   FIRST, not last, and covering every STATE below, not just the four
   static regions.** A 2026-09-08 review found 16 real fidelity defects
   that a "top bar, sidebar, grid, status bar" region sweep never surfaced,
   because every one of them only existed in a STATE, not the rest view:
   - **default** (rest state, every region)
   - **hover** — sidebar rows, grid cards, buttons (grey lift, never blue)
   - **selected/active** — sidebar rows (must be blue-family, not grey),
     a flagged/rejected grid card (only the SET flag renders, thumbnail
     dims on reject)
   - **an open dropdown** — sort menu, gear menu, and any of its own
     sub-groups (Appearance, Metadata overlay) — closed by default, so
     "region by region" alone never looks at their contents at all
   - **narrow viewport** — verify no control-pair overlap, no button text
     wrapping to two lines, ellipsis truncation instead
   Read each state region by region before writing the "done" summary —
   this is what catches structural/behavioural drift no property-diff tool
   can see.
2. **`node test/wireframe_inventory.mjs`** (structural atom-tally +
   icon-shape regression + colour-state + overflow + icon-centering,
   covering `topbar`/`sidebar`/`statusbar`/`grid` zones plus the sort and
   gear menus opened before inventorying) **+ `npx playwright test
   --config=playwright.config.mjs`** (`test/wireframe_behaviour.mjs`,
   interaction/state coverage — asserts CORRECT behaviour, so it starts red
   on a genuine defect rather than baking today's behaviour in as
   "expected") **+ `node test/lint_library_content.mjs`** (ellipsis
   character, native `<select>` dark-mode styling, `tabular-nums` on live
   numeric readouts) as a regression guard once the screenshot check
   passes — not a replacement for it. A shrinking finding count from these
   is necessary, never sufficient, for calling a pass complete.

Never report a UI-matching task done off any tool's numbers alone — every
one of the 16 defects above WAS caught by fresh tooling built the same
session they were found; don't assume the current tool set covers
everything the wireframe specifies. If you find yourself checking a
region/state these tools don't cover, extend the tool, don't just note it
by hand and move on — that's exactly how the 3-zone version went stale.

## Step 4 — verify against the real installed app, not just the harness

`bash build-desktop.sh` stages `desktop/dist/` for the `?libtest=1`
Playwright/browser harness (fast iteration). Before telling the user it's
done, also `bash desktop/install-app.sh` (full rebuild, installs to
`/Applications`) and screenshot the actual app — a harness pass doesn't
prove the compiled app looks right, and two prior sessions on this project
shipped visual regressions that only the real app render surfaces.

## Common failure signatures from the last pass (check for these specifically)

- A CSS custom property redefined per-theme "because that's the usual
  pattern" without checking whether the wireframe's own token actually
  changes for that theme.
- An icon chosen because a same-shaped one already exists in `ICONS`,
  rather than the wireframe's actual glyph.
- A sidebar/panel section placed where it "made sense" relative to
  existing app rows, rather than where the wireframe's markup puts it.
- "Done" reported after `wireframe_diff.mjs`'s mismatch count went down,
  without a fresh side-by-side screenshot check.
