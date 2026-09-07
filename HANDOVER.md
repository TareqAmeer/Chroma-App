# Handover — wireframe fidelity pass (Library) — DONE

## Status: PASS
`node test/wireframe_inventory.mjs` → 0 unaccepted findings. Every real structural gap found
by the structural inventory (75 raw findings at the start of this pass) is now either fixed
or an explicit, reasoned entry in `test/wireframe_accepted.json`.

## What was fixed (real bugs)
- Needs Review / Not-Face-Scanned nested under Collections (were siblings of All Photos).
- Label casing: "By date", "Needs Review", "Not Face-Scanned".
- Sort-pill default: "date" (was "name").
- Search: one feature, one icon — removed the duplicate AI-search icon button (Enter still
  triggers CLIP search); placeholder text matches the wireframe literally.
- Compare view moved from the topbar segmented toggle into the gear's View menu (2-button
  Grid/List toggle now matches the wireframe; Compare is still one click away, "C" shortcut
  unchanged).
- Topbar layout math: `.lib-pill`/`.lib-btn-export` now 13px (were inheriting 12px from the
  base `.lib-btn`); `.lib-spacer` is flex:0 1 8px (was flex:1, splitting growth across two
  spacers); `.lib-zoomrow` is flex:1 1 30px (was non-growable) so it shares topbar growth with
  `.lib-logo-gap` the same way the wireframe's `.zoomrow` does. Together these had pushed the
  entire right side of the topbar 100-190px off — now within a few px.
- Date-tree rows (year/month/day) had no font-size, inheriting the sidebar's 16px base font
  instead of the wireframe's 13/12/11px hierarchy — added explicit per-level classes. The
  "No date" bucket row had the same bug via a missing function argument.

## What's allowlisted (real, reasoned divergences — see test/wireframe_accepted.json)
Drives-management block, Keywords section, Albums "+", statusbar sync indicator (deferred,
needs real backend wiring), mock-only People/Album/Device sample names, and one test-tool
artifact (a DOM-structure difference in how the wireframe vs. app mark up "By date" that
changes the inventory walker's atom-visitation order with no real visual difference).

## Gate
`githooks/pre-commit` runs `wireframe_inventory.mjs` on every `desktop/library-ui.js` commit
and blocks on NEW findings vs. the last recorded run (`test/output/wireframe_inventory_report.json`)
— not on the whole backlog, so normal commits aren't blocked by pre-existing, already-triaged
items. Adding a genuinely new divergence still requires either a real fix or a reasoned
allowlist entry.

## Next possible work (not required, not started)
- Editor wireframe pass (`test/editor_wireframe_diff.mjs`) still carries its own ~57-item
  backlog from an earlier session, gated the same way (regressions only). Nobody has gone
  back to burn that list down yet.
- Statusbar sync-in-progress indicator is deferred by explicit decision — would need a real
  `catalog_scan` progress signal wired from Rust before it's worth building.

## Verification
```bash
bash build-desktop.sh && node test/wireframe_inventory.mjs   # must print RESULT: PASS
npm run lib:test                                              # Library regression suite
```
