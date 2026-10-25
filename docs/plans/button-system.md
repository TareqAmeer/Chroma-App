# Button system (user vote 2026-10-25)

Source of the decisions: `design/explorations/button-balance-vote.html` (per-row variants A.., 12 research rules at its top). Square corners everywhere (radius 0).
**Hard rule:** never two outlined controls whose lines touch or double: gap >= 8px, or one shared collapsed divider, or no outline at all (shaded track / bare). Checked on the REAL DOM by `test/probe_button_system.mjs` (the vote page's touch checker, plus a self-test that it flags flush and 3px neighbours).

Everything lives in one block in the main stylesheet: `/* BUTTON-SYSTEM:START ... END */` at the end of `<style>` in `src/app/06-html.html` (so it wins ties over the older sk2 skin rules, which use `!important`), driven by `--bs-*` tokens in `design/tokens.json` (`button` group; layout in `tools/scripts/token-layout.json`). Library selectors are prefixed `body.sk2 #lib-overlay` so they beat the library's own injected styles without touching `desktop/library-ui.js` CSS.

## Tokens (design/tokens.json, group `button`; regenerate with `node tools/scripts/build-tokens.mjs`, then `node tools/scripts/app-split.mjs`)
`--bs-shade` / `-2` / `-3` (ink 8 / 14 / 22%: tile or track, hover, pressed-or-selected), `--bs-edge` (ink 52%), `--bs-hair` (ink 13%, field/select hairline), `--bs-muted` (ink 72% over bg: inactive label on a shaded track, clears 4.5:1 where `--k-color-muted` measured 4.2:1), `--bs-danger`, `--bs-on-acc` (#111), `--bs-gap` 8px, `--bs-gap-tight` 4px, `--bs-rule` 2px (accent rule), `--bs-hit` 28px, `--bs-hit-touch` 44px (used under `@media (pointer:coarse)`), `--bs-icon` 16px.

## Inventory: vote class -> variant -> real selectors
Completeness comes from the scan: `node test/probe_button_system.mjs --inventory` lists every distinct interactive control found in the running app (editor: all 12 sections x dark/light x panel 220/320/440, mask panel variants, export sheet, dialogs; library: top bar, filters row + panel, gear menu, dark + light) with the vote class it belongs to (`CLASSMAP` at the top of that file) or `-`.

| # | class | variant | selectors (real DOM) | where |
|---|---|---|---|---|
| 1 | Editor top-bar icon buttons | B Bare | `.fx-db-icon .db-btn .zc-ic #lib-overlay .lib-btn-icon .lib-zoom-btn .crop-orient>.btn .fx-panel .btn-row>.btn-icon .sk2x-close #btn-msk-hideall` | CSS block |
| 2 | Primary action (Export) | A fill, #111 label, new icon | `#btn-export-db .fx-db-pri #lib-overlay .lib-btn-export .btn.bpri .sk2x-btn` | CSS block + `ICONS.export` |
| 3 | Workspace switch | unchanged | `#cs-brand-tog` | - |
| 4 | Library toolbar triggers | C Bare (+ new All FX glyph) | `#lib-overlay .lib-pill` (Date taken, Filters, All FX), `.fx-db.js-allfx(-cfg)` | CSS block + `ICONS.enableAll` |
| 5 | Library search | E Hairline outline | `#lib-overlay .lib-search-wrap` | CSS block |
| 6 | Library filter chips | C Bare, no reflow | `#lib-overlay .lib-chip .lib-status-chip` | CSS block |
| 7 | View and size | B Shaded track, ink-filled active | `#lib-overlay .lib-seg>button` (grid/list; hidden in the shipped layout, no S/M/L exists in the app) | CSS block |
| 8 | Section header Reset + chevron | C Bare, Reset only when changed, space reserved | `.fx-ctrl-title-reset(-scoped) .fx-ctrl-chev` | CSS block |
| 9 | Slider value / per-slider reset | unchanged | `.fx-val .fx-slider` | - |
| 10 | Secondary text actions | C Shaded tiles, 2 columns | `.fx-panel .btn-row>.btn.bgh/.bsec` (rows that are not one-of-N groups) | CSS block |
| 11 | Mode segmented controls | A Shaded track, accent rule | `.fx-panel .seg>button .msk-prevmode-seg>button` | CSS block |
| 12 | Create New Mask | B Shaded tile | `#btn-msk-create` | CSS block |
| 13 | Add / Subtract / Intersect | A Shaded track | `.msk-compose-ops>.btn` (new wrapper span) | `c4-one-skin...js.html` + CSS |
| 14 | Paint / Erase | A Shaded track | `[aria-label="Brush mode"]>.btn` | CSS block |
| 15 | Invert | D Bare + square indicator, ONE per mask | `#btn-msk-invert.msk-invert` | `c4-one-skin...js.html` + CSS |
| 16 | Mask row eye and "..." menu | D Reveal on hover/selection; off eye always visible with slash | `.msk-li-ctl .msk-li-mute (eye/eyeOff) .msk-group-eye .msk-more` | `c4-one-skin...js.html` + CSS |
| 17 | Overlay switch and checkboxes | B Shaded switch / checkbox | `input[type=checkbox][role=switch]`, `.fx-panel input[type=checkbox]` (library gear-menu checkboxes keep the native look) | CSS block |
| 18 | Dialog footer | B Bare Cancel, filled primary | `dialog .btn.bgh`, `dialog .btn.bpri`, `#fx-confirm-*` | CSS block |
| 19 | Destructive | B Danger bare text, filled danger only on the confirm step | `.btn.bdng`, `.fx-panel .btn[onclick*="Delete" i / "Clear" i]`, `#fx-confirm-ok.bdng` | `tauri-native-save-path...js.html` + CSS |
| 20 | Export scope | F Shaded track, accent rule | `#fx-export-scope-row .btn-row>.btn #adj-scope-row>.btn .sk2x-opts>.btn` | CSS block |
| 21 | Section tabs | A Bare | `#sk2-sub button` | CSS block |
| 22 | Menu / select triggers | E Hairline outline | `select.fx-select .fx-panel select #lib-overlay select .k-fsel>button` | CSS block |
| 23 | Text links | A Underlined | `.msk-ai-update .ni-guide #cs-save-state button .lib-lr-signout .ni-hint a .sk2x-proof-toggle` | CSS block |
| 24 | Disabled | A Dim 40% + reason tooltip | `:disabled`, `data-why` -> title while disabled | CSS + `21-script.js.html` |
| 25 | Tool rail | B Bare, accent bar on active | `#fx-toolrail .fx-rail-btn` | CSS block |
| 26 | Panel/view toggles | A Bare | `.db-btn`, `.btn.msk-layout-toggle` | CSS block |

Also: chip lists that are one-of-N (`.chip-tap`, curve chips, export size/format) use the same shaded-track + accent-rule treatment as 11/13/14/20 so no outlined group is left in the panels.

## Decisions that were not obvious
- **#2 icon.** The old Export glyph (`ICONS.export`) was a box with a corner arrow, i.e. "open in a new window". Replaced by an arrow leaving an open tray (`M12 16V4 M7 9l5-5 5 5`, `M4 14v6h16v-6`), the standard export/upload mark, same 24px stroke set. Label colour is `--bs-on-acc` (#111) on the accent fill, hover = accent mixed 16% toward white.
- **#4 icon.** The old All FX glyph (`ICONS.enableAll`) was a sparkle plus a "+" (reads as "add"). Replaced by one large four-point sparkle with two small ones (the standard "effects" mark).
- **#15 Invert.** The vote page showed two buttons only because it demoed the off and the on state. In the real app a brush mask had TWO Invert buttons (the combine row's and the tool header's `#btn-msk-tool-invert`) plus a third surface, the row mini control (double-arrow). All three drove the same `mask.invert`, so they could not disagree, but they were redundant. Now exactly one button, `#btn-msk-invert`, in the combine row for every mask type; the other two are removed; the "..." menu entry stays (a menu command, shows Un-invert when on). Indicator is a square (outlined when off, ring-filled when on), `aria-pressed` mirrors `mask.invert`. Probes updated: `probe_mask_tool_header`, `probe_mask_sidebar_reachability` (REMOVED/RENAMED lists), `mask_sidebar_compare`, `mask_list_controls`.
- **#16 eye.** The row's old "M" (mute) mini control is now an eye / struck-through eye; the muted state shows the struck-through eye on every row at all times (only the quiet "on" eye hides until hover/selection). The group eye already used `eye`/`eyeOff`; its on state is quiet, off state is ink on a shade. The muted row dims its other children, not the eye (it used to dim the whole row with inline opacity).
- **#6 no reflow.** All chip states share one box: 1px transparent border, same padding, same font weight; selection is a fill + inset accent rule (box-shadow). Probe selects every chip and asserts no element x/y/width changed.
- **#7 hover on selected.** Selected = ink fill with page-coloured text; the hover rule for `.on` repeats the same two colours. Probe asserts text >= 4.5:1 and selected-vs-track >= 3:1 in both themes.
- **#8 Reset.** `visibility:hidden` instead of `display:none` (space reserved, nothing reachable by keyboard while hidden); the existing gate (`.fx-row.fx-mod`, heal/hsl/curve edit flags) is unchanged. Probe asserts header geometry is identical before/after.
- **#5 / #22 hairline (13%)** was the vote; it measures about 1.3:1 against the page, so the edge alone cannot identify the control. The fields keep an icon/placeholder/chevron, a hover edge (52%) and a 2px accent focus ring. Say the word to use `--bs-edge` as the resting edge instead.
- **#17 scope.** The shaded switch/checkbox applies to the mask overlay switch and every checkbox inside editor panels. Library gear-menu checkboxes (13px native inputs in menu rows) were not part of the vote's real selector and are unchanged.
- **Left as is:** #3 workspace switch, #9 slider value/reset, `.fx-toggle` section switches, menu rows (`.fx-ovf-item`), cards, tree rows.

## Verification
- `node test/probe_button_system.mjs` (88 scans) PASS: no touching outlines, hit >= 24 (inline inputs >= 18), icon-only controls named, label contrast >= 4.5:1 (disabled/dimmed exempt), selected-hover contrast, chips stable, one Invert, Reset header stable, disabled = 40% + reason, dialogs square/bare Cancel/filled danger confirm.
- Keyboard-focus tooltip for icon-only buttons (`#bs-tip`, script at the end of `src/app/21-script.js.html`): native `title` only shows on mouse hover.
- Native (installed build) screenshots, dark + light: see `docs/button-system/` and the "Button system" section of `docs/plans/perf-quality-progress.md`.
