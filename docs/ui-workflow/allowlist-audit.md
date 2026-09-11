# Gate allowlist audit (2026-09-11, read-only — nothing deleted yet)

185 accepted-mismatch entries across 4 files. Classified by reading every entry's reason and
grepping the app for whether the thing it describes still exists. **S7b applies this** (needs a
quiet machine: every deletion must be confirmed by re-running its gate).

| File | Entries | Delete / re-baseline | Verify, then delete | Real fix needed | Intended — keep | Checker artifact |
|---|---|---|---|---|---|---|
| `test/editor_wireframe_accepted.json` | 20 | 1 | 8 | 6 | 4 | 1 |
| `test/editor_responsive_accepted.json` | 5 | 2 | – | 3 | – | – |
| `test/editor_wireframe_inventory_accepted.json` | 68 | – | 20 | 27 | 21 | (overlaps verify) |
| `test/wireframe_accepted.json` (Library) | 92 | 14 | – | 3 | 67 | 8 |
| **Total** | **185** | **17** | **28** | **39** | **92** | **9** |

Expected result after S7b: roughly 140 entries, and the ~45 that go are the ones hiding nothing
but stale history — so the allowlists stop masking new regressions.

## 1. Delete / re-baseline (17) — confident
- **editor_wireframe: rail order/content (older entry)** — its own reason says "Stale… left for history". Delete.
- **editor_responsive: `#db-title-status` overlaps `#fx-tools` / `#fx-view`** (2) — neither id exists any more
  (merged into the `#fx-settings` gear). Delete.
- **Library: `topbar#0`…`topbar#13` icon-shape entries** (14) — all "downstream of the logo removal": the icon
  baseline still has the removed logo in it, so every icon diffs against its neighbour. Re-record the
  Library icon-shape baseline (the logo removal was a deliberate decision), then delete all 14.

## 2. Verify, then delete (28) — probably fixed; remove each, re-run its gate, keep only if it still fires
- **editor_wireframe: undo/redo cluster borderRadius + borderColor** (2) — `.undogrp` now exists in the app.
- **editor_wireframe: 6 borderColor "token drift" entries** (topbar, All FX, tool rail, tool panel, docked
  filmstrip ×2) — all say "fixed by the Phase D token split"; `--bdr-panel`/`--bdr-pill` now exist (S3/S4).
- **inventory: 20 entries written against the old separate Tools / View / overflow menus** — Gamut warning,
  Show gamut warning, EXTRA 7x/3x/8x/2x button, the ✓ Editor / Match & Refine / Color Copy / Collage /
  Guide / Library (L) / Reset all edits / About rows, and the topbar aggregates (EXTRA 10x button, 8x icon,
  atom count, font-size 11px, order@0, dynamic-data row count). S5 found those menus are now panes of ONE
  settings menu, so the gate may map them differently now. Each needs re-running, not assuming.

## 3. Real fix needed (39) — keep until fixed; make sure each is a backlog item in editor_ux_spec.json
- **Needs a design decision from you first** (wireframe vs app — which is right?):
  docked filmstrip width 150 vs 120px; tool rail 64 vs 72px; tool panel 300 vs 320px (rail and panel differ in
  light mode only — cause not understood); newer rail order/content entry; Library "Square crops /
  Original dimensions" (a missing feature, 2).
- **Scheduled UI work**: status bar `#fx-statusbar` not built (2 entries, still absent); topbar height 44 → 48px
  (still 44); title block overlaps flag/favourite buttons at desktop width (3, item 3.1.10); rail label
  font-size tallies (2, Phase F); tool-panel icons 3.4.11 + atom count 3.4.12 (2); Library gear icon hardcoded
  15×15 (1, tiny fix).
- **Looks/Adjust panel restructuring (Phase H)** (16): Highlight response + its 3 options, Preset/Presets
  labels, Filter presets, Strength ×2, No LUT applied, Standard/V-Log options, and 4 downstream tallies.
- **Test gap, not a UI bug** (6): the Raw-profile entries only fire because the test photo isn't RAW. Adding a
  RAW fixture (backlog T11) clears them.

## 4. Intended — keep (92)
Deliberate decisions with a recorded reason: Crop in the rail (4), Print profile + options (4), preset
search + 9 category chips (10), Presets & Looks title, 1:1/Full res (B1, 2), Settings-gear entries (3), Export
button accent border, and ~67 Library entries (logo removal, Library/Develop tabs, gear-menu drill-down,
drives/keywords/no-date extras, deferred sync indicator ×5, superset menu groups).

## 5. Checker fixes that would shrink the list further (recommended, separate from S7b)
1. **Aggregate checks double-count accepted differences.** Atom count, font-size tallies, `order@N` and
   dynamic-row counts fire again for every already-accepted extra — ~40 entries are "downstream of the entry
   above". Make aggregates skip atoms already covered by an accepted entry.
2. **`<div class="opt">` vs `<button>` classification** — the wireframe builds menu rows as divs, the app as
   buttons; the inventory counts them as different kinds (≥8 entries). Treat them as the same kind.
3. **Font-stack normalisation** — the zoom-control fontFamily entry is `BlinkMacSystemFont` vs `system-ui`,
   which `normFont()` already treats as equal elsewhere; apply it in this check too.
