# Handover — wireframe fidelity pass (Library + Editor)

## Status
Library: 71 → 15 mismatches (`node test/wireframe_diff.mjs`).
Editor: 130 → 57 mismatches (`node test/editor_wireframe_diff.mjs`).
Every fix this session verified via the tools' own repair-loop recheck (resolved/persisting/new
against the previous run) — zero regressions shipped.

## Key decisions made this session (don't re-litigate without asking again)
- Library base font-size: **16px** (matches the wireframe literally, not the design-system
  readme's stated 17px).
- Editor: **switched app-wide to SF Pro Text** (embedded as base64 OTF, ~12MB — file is now
  15.5MB). No variable SF Pro font exists in this repo; explicit decision was to accept the
  size increase rather than slim it down.
- Editor base font-size: **16px app-wide** (not scoped — chromasmith-22.html has no equivalent
  to the Library's `#lib-overlay` scoping boundary).
- Editor color palette: **replaced with the wireframe's literal DS hex values app-wide**
  (--bg/--sur/--sur2/--bdr/--txt/--mut). `--acc`/`--acc2`/`--ok`/`--err` (brand/semantic colors)
  were explicitly left untouched — out of DS scope.
- Two button colors are *intentionally different* between the two apps' wireframes — don't
  "fix" one to match the other:
  - Library's Export button: always Slate Blue, never swaps in dark mode.
  - Editor's Export button: Mist Blue (`#61a0af`), replacing the app's amber `--acc` brand color.
- Library grid card background/hairline: **always the light parchment plate** (`#f5f5f7` /
  `#e0e0e0`), even in dark mode — matches the wireframe's own lack of a dark override for `.card`.
- Editor tool rail: **kept the extra "Image"/"Crop" items** (12 vs wireframe's 10) — explicit
  decision not to relocate those tools just to match item count.
- Grid card size (154px vs wireframe's 181px): **not a bug** — it's the user-configurable
  thumbnail-size default (140px, persisted via localStorage), confirmed already working as
  intended.

## Real infrastructure gotcha found this session
`test/wireframe_diff.mjs` serves `desktop/dist/`, a **built, staged copy** — editing
`desktop/library-ui.js` directly does nothing until you run `bash build-desktop.sh`. Two fix
attempts silently showed "0 resolved" before this was caught. Always rebuild before re-running
the Library diff tool. (The Editor tool serves `chromasmith-22.html` directly — no build step.)

## Remaining known items (deferred, not forgotten)
**Library (~15 mismatches):**
- Topbar height (52 vs 61px) — likely intentional macOS traffic-light clearance padding, not
  confirmed either way.
- Sidebar height (820 vs 811px) — minor, low-value to chase.
- Rest are 0-width-border-side computed-style artifacts (confirmed via `borderWidth` matching
  at 0 on both sides in the tool's own report) — invisible in practice.

**Editor (~57 mismatches):**
- Topbar/rail/panel height (48 vs 44, 826 vs 856) — not yet investigated for root cause.
- Undo/redo/history cluster: wireframe wraps them in one bordered box (`.undogrp`); the app has
  them as separate flat buttons. Real structural difference, deferred — needs a wrapper `<div>`
  added around existing buttons, low risk but not done yet.
- Zoom control height/border-radius, a few more 0-width-border artifacts.
- The "status bar has no real Editor equivalent" pair — acknowledged placeholder, not a real bug
  (the Editor topbar doubles as the deskbar; there's no separate statusbar zone to compare).
- `[dark]`/`[light]` rail order note is expected now (Image/Crop kept on purpose).

## Verification commands
```bash
bash build-desktop.sh              # REQUIRED before re-running the Library diff after any
                                    # library-ui.js edit — dist/ is a stale copy otherwise
node test/wireframe_diff.mjs       # Library — writes test/output/wireframe_diff_report.json
node test/editor_wireframe_diff.mjs # Editor — writes test/output/editor_wireframe_diff_report.json
node test/check_change_scope.mjs <expected-file>   # confirms a fix touched only what it should
npm run lib:test && node test/export_harness.mjs   # regression guards, run after any CSS/token change
```
Pre-commit hook (`githooks/pre-commit`, `core.hooksPath` already set) blocks commits to
`desktop/library-ui.js`/`chromasmith-22.html` unless the matching diff tool has run since the
file last changed — `touch .git/.wireframe_diff_ok` / `.git/.editor_wireframe_diff_ok` to
acknowledge a reviewed run.

## Type `/clear` now, then start the next session by asking to read `HANDOVER.md`.
