# Design tokens & typography

(moved from CLAUDE.md §3b, 2026-09-11)

Values live in `design/tokens.json` (W3C DTCG); the `:root`/`body.light` blocks are GENERATED from it by
`node scripts/build-tokens.mjs` (`--check` to verify). Rationale comments are stored verbatim in
tokens.json (`$extensions.chromasmith.emit.<block>.commentBefore`). `.claude/hooks/token-lint-on-edit.sh`
flags new raw literals on edit. **Use the tokens; don't reintroduce literals.**

- **`--sans` = SF Pro Display/Text, `--mono` for numerals/code/build stamp.** SF Pro is
  embedded as base64 `@font-face` data URIs (Apple system font, licensed for software built
  for Apple platforms — see the licence comment above the `@font-face` blocks in
  `chromasmith-22.html`). The app is offline and single-file, so there is no CDN to fetch from
  and no `font-display` to worry about.
- ⚠️ **`--mono` is for numerals, code and the build stamp — it is not a UI voice.** It was used
  81× against 8 of `--sans`, with 23 `text-transform:uppercase` rules on top, which is what made
  the app read as generated "technical" UI rather than a photo tool. **Uppercase now survives in
  exactly one role: the panel/section eyebrow** (`.fx-ctrl-title`, `.fx-sub`). Numeric readouts
  carry `font-variant-numeric:tabular-nums` so figures don't jitter as they change.
- `--fs-0..7` type scale, `--sp-1..6` spacing, `--ease`/`--dur-1`/`--dur-2` motion. Smallest UI
  text is 11px (`--fs-1`); `test/ui_audit.mjs` enforces that floor.
- **Accent (`--acc`) is an information channel, not decoration**: primary action, active
  navigation, and "you changed this" (`.fx-row.fx-mod`). It is deliberately NOT used for active
  segmented-control items or for every slider fill.
- **Icons**: one stroke set in `ICONS` (Lucide-shaped, ISC), rendered via `icon(name,size)`.
  ⚠️ As of 2026-09-11 (T53 finding), the app uses sizes beyond the documented 16/20/22px —
  28 call sites use 12/14/18/34px. `test/editor_icon_check.mjs` scans call sites for a missing
  `ICONS` key or degenerate drawable body (hard fail) and flags non-standard sizes (advisory).
  **No emoji and no unicode glyphs in desktop chrome** — they render per-platform and never
  match a stroke weight.
- **Sliders** fill from the CENTRE on symmetric ranges (`fxPaintSlider` derives bipolarity from
  each element's own min/max, so dynamically built rows need no wiring) and stay neutral grey
  until the value leaves its default.
- **A section that is switched off is dimmed (`.fx-fields.ff-off`), not `display:none`** — and
  touching any control inside it turns the section on. See docs/process-lessons.md #13 for why hiding it was actively
  harmful.
