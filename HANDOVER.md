# Handover — wireframe fidelity pass, part 2 (structural inventory)

## What changed this session
Replaced the old "check, not a search" wireframe_diff.mjs approach's blind spot with
`test/wireframe_inventory.mjs` — a real structural diff (extras/missing/counts/geometry/font
sizes), gated for real in `githooks/pre-commit` (exit code, not a `touch`-able stamp file).
Raw findings: 75 → 29. `test/wireframe_accepted.json` holds deliberate divergences (Drives
block, Keywords section, Albums "+", no-date bucket, mock people/album/device names) — each
one an explicit user decision, not a guess.

Fixed this session: Needs Review / Not-Face-Scanned nested under Collections (was siblings of
All Photos), their label casing, "By date" casing, sort-pill default (date, not name), and a
missing logo-gap spacer between the logo and search pill.

**Near-miss bug, now guarded against**: a backtick inside a CSS comment (inside library-ui.js's
HTML template literal) silently truncated the template and crashed the whole Library UI at
boot ("gap is not defined", no visible syntax error) — the exact bug class CLAUDE.md warns
about for GLSL comments, just in a different file. Comment now warns explicitly; **always
rebuild + run `node test/wireframe_inventory.mjs` after ANY library-ui.js edit**, even a
comment-only one.

## Remaining findings (29 raw, un-allowlisted — real, not yet fixed)
**Topbar:**
- Search placeholder text differs from wireframe ("Search filename… (Enter for AI search)" vs
  "Search name, keyword, or filter") — app's wording documents a real AI-search behavior the
  wireframe doesn't have; needs a call on whether to reconcile wording or allowlist.
- Duplicate-looking search icon: `lib-clip-search-btn` (CLIP/AI search) reuses the plain search
  glyph — a real, distinct feature, but should probably get its own icon (e.g. sparkle) instead
  of visually duplicating the search icon next to it.
- View toggle has 3 buttons (Grid/List/Compare) vs wireframe's 2 (Grid/Table) — Compare is a
  real feature; likely allowlist, needs a user decision.
- Logo-gap spacer landed but only closes ~33px of the original 193px offset — the flex-basis
  may need tuning against the real (non-mock) topbar button set.
- Filters is a `<select>` dropdown vs the wireframe's chip row — larger, deferred UI change.

**Sidebar:**
- "March" (a date-tree month label) still MISSING — date-tree month rows may not be rendering
  in the ?libtest mock, or dateExpanded needs the month-level toggle opened before comparing.
  Needs investigation, not yet root-caused.
- Font-size distribution still doesn't match (10px/13px/16px counts) — likely the sidebar's
  base-font decision from the PREVIOUS session (16px) bleeding into rows the wireframe sets at
  13px; needs a pass through the CSS cascade, not a one-line fix.

**Statusbar:**
- No sync-spinner icon / "Syncing catalog files…" text — real feature gap (need
  `catalog_scan`/background-sync status surfaced there) or explicit "not building this now"
  allowlist decision.

## Next steps
1. Investigate "March" missing (likely a date-tree expand-state issue in the inventory harness,
   not a real UI bug — check `dateExpanded` before asserting).
2. User decision needed on: search placeholder wording, duplicate search-icon glyph, 3rd
   view-toggle button (Compare), filters-as-dropdown-vs-chips, statusbar sync indicator.
3. Re-run `bash build-desktop.sh && node test/wireframe_inventory.mjs` after each fix; commit
   allowlist additions with a `reason` field, never silently.
4. Editor wireframe pass (`test/editor_wireframe_diff.mjs`) still only regression-gated against
   its own ~57-item backlog from the PREVIOUS session — that backlog itself is still open.

## Verification
```bash
bash build-desktop.sh && node test/wireframe_inventory.mjs   # Library — must be 0 new regressions
node test/editor_wireframe_diff.mjs                          # Editor — must be 0 new regressions
```
