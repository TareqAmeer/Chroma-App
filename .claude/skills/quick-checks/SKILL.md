---
name: quick-checks
description: Run Chromasmith's fast deterministic gates (halation scorecard, desktop UI audit, or both) and report PASS/FAIL — use before/after a shader edit, a halation/grain constant change, or a desktop panel/layout change, instead of round-tripping screenshots through the model.
effort: low
---

# Quick checks

Two fast, deterministic gates already exist in this repo. Prefer reading their PASS/FAIL
output over rendering/screenshotting when you just need to confirm a change didn't regress
something — see CLAUDE.md §6 lesson #1/#10 for why this is the cheaper and more reliable
signal.

## Halation scorecard

Run before AND after touching `FXR.CAL.halation`, the emission/blur shader math, or anything
in `calib/`:

```bash
python3 calib/scorecard.py
```

Requires `calib/IMG_5774_2x.PNG` and `calib/dehancer halation x2.png` (gitignored — supply if
missing) and the `.calibvenv` from CLAUDE.md §2. Reads as a PASS/FAIL table per requirement
(gap halo per colour, interior flood, bar softness) — a FAIL pinpoints exactly which
requirement regressed, no visual diffing needed.

## Desktop UI audit

Run after any change to `.fx-*` panel CSS, control layout, or new controls added to a tool
section:

```bash
npm run ui:test          # summary
npm run ui:test -- --json  # full detail, e.g. to locate a specific violation
```

Walks every tool section at three desktop breakpoints plus a phone-shell pass, asserting: no
panel fragmentation, no control painted before its own label, no overlapping siblings, a 28px
pointer-target floor (18px for checkboxes/swatches), an 11px font floor, 4.5:1 text contrast.
Baselines live in `test/baselines/` (not `test/output/`, which is gitignored). `CS_UI_NO_MOBILE=1`
skips the phone pass.

## Editor panel/layout changes (chromasmith-22.html) or Library UI changes (desktop/library-ui.js)

Run the full Editor gate set — it rebuilds `desktop/dist/` first (so it can't pass/fail against
stale code) and covers wireframe fidelity, structural inventory, responsive/squeeze behaviour,
coverage, the snap-list cross-check (T2), and HTML validity (T4) in one call:

```bash
npm run editor:gates
```

This is also what `githooks/pre-commit` runs for any commit touching `chromasmith-22.html`, and
what CI (`.github/workflows/editor-gates.yml`) runs on every push/PR. For a broader run that also
covers the Library's own wireframe/responsive gates and (with `--full`) the Playwright
click-through behaviour suite, use `python3 test/verify.py --editor [--full]` instead — see that
script's own docstring for flags.

⚠️ Neither of these closes the desktop-engine gap: every check here drives Playwright's Chromium
against `desktop/dist/index.html`, not the WKWebView (Safari engine) the real Tauri desktop app
renders with. A change that's green here can still render differently in the actual `.app` — see
CLAUDE.md's engine-mismatch note. Treat a clean run as "no Chromium-visible regression," not as
proof the desktop app is unaffected.

## When to reach for something heavier instead

- A shader edit that might not compile at all → `node test/export_harness.mjs` first (catches
  GLSL compile errors and the "quieter" no-op class from CLAUDE.md §3), then the scorecard for
  correctness.
- A change to Library/native-gated UI → the `?libtest=1` browser harness (CLAUDE.md §6 item 14),
  since it renders nothing under a plain page load.
- Anything where the numbers pass but you're not sure it *looks* right → still do one
  render-and-look pass per CLAUDE.md §6 lesson #1; the scorecard is a fast secondary
  guardrail, not a replacement for looking.
