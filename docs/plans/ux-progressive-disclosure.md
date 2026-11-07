# UX plan: progressive disclosure for the Editor

Status: proposal (2026-11-07). Look-only rule applies: **no control is removed**; every item
below changes where a control sits by default, never whether it exists. Token values go in
`design/tokens.json` and are regenerated (`node tools/scripts/build-tokens.mjs`). No film
sprocket motifs in any new affordance.

## 1. Inventory (derived from the code, 2026-11-07)

Sources: `CS_NAMES` (`chromasmith-22.html` ~L3408), `.fx-ctrl[data-fxsec]` cards (L4250-5130),
`FX_GROUPS` (~L33868), `_fxSecCollapsed` (~L35210), command palette (~L16423),
`test/editor_coverage.mjs`. Counts are a static scan of the card markup; controls built by JS
(HSL bands, curve points, mask rows, wheels) come on top, so treat totals as a floor.

- 34 named tools in `CS_NAMES`; 30 are `.fx-ctrl` cards; 6 rail groups (Look, Light, Colour, Texture, Masks, Crop).
- 125 sliders, 28 selects, 6 checkboxes, ~95 buttons, ~13 other inputs: about 270 static controls.
- Every card already starts folded on launch (only Info and Versions open), and the folded set persists in `chromasmith_fx_sec_collapsed`. So the app is not overwhelming by initial height; it is overwhelming by **flat card contents once a card opens** and by **number of cards on the rail**.

Per-card static counts (sliders / selects / buttons), largest first:

| Card | Sliders | Sel | Btn | Inner structure today |
|---|---|---|---|---|
| Exposure & Tone (`adjust`) | 31 | 0 | 3 | 5 sub-headers, no folding. Tone 6, Colour 5, Multiscale detail 4, Channel mixer 9, Lab 3, Colour toning 4 |
| Noise Reduction (`nr`) | 12 | 2 | 6 | RAW NR tiers inline |
| Film Negative (`filmneg`) | 10 | 1 | 3 | always listed even for positives |
| Transform (`straighten`) | 9 | 0 | 5 | |
| Borders | 8 | 5 | 2 | |
| Point Colour | 7 | 0 | 6 | |
| Grain | 5 | 1 | 0 | |
| Retouch | 5 | 1 | 8 | |
| Export (`export`) | 1 | 5 | 12 | 108 lines, 14 hidden hints |
| Metadata (`info`) | 0 | 0 | 3 | 82 lines, 4 `<details>` |
| Curves 4/0/6, Lens 4/1/1, Effects 4/0/0, Colour Mixer 3 (+bands), Wheels 3, others 0-3 | | | | |

Gaps found while scanning:
- No "modified" indicator exists (grep for modified/dirty class names finds nothing); only a per-card Reset/All in `.fx-title-right`.
- Highlight reconstruction (CHR-288) and Retinex DRC (CHR-289) are pure cores marked "NOT wired to any control yet" in this file. They must arrive already inside Advanced, never as new top-level cards.
- Palette (`add(group,label,run)`) already lists tabs/sections/looks/actions and `CS_ALIASES` gives synonyms, but it does not index individual sliders, so "Dehaze" or "Channel mixer" finds a card, not the control.
- `cs_railmode` / `cs_rail_flat` exist (rail variants) but there is no user-level "level" setting.

## 2. Proposals, with numbers

"Visible" means default-visible after opening the card; every control stays reachable.

### P1. Essentials / Advanced split per card, state remembered per card
Add one `Advanced` disclosure row at the bottom of a card (a native `<details class="fx-adv">`, token-styled, chevron only). Persist `{secKey: open}` in a new key `chromasmith_fx_adv_open`, and add that key to `CS_LAYOUT_KEYS` so workspace layouts carry it.

| Card | Essentials stay visible | Moves under Advanced | Visible before -> after |
|---|---|---|---|
| Exposure & Tone | Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Temp, Tint, Vibrance, Saturation, WB eyedropper (11) | Skin protect, Multiscale detail (4), Channel mixer (9), Lab (3), Colour toning (4) = 20 | 31 -> 11 sliders (-20) |
| Noise Reduction | Strength, Detail, Colour, mode (4) | RAW NR tier rows (8) | 12 -> 4 (-8) |
| Transform | Angle, Vertical, Horizontal (3) | remaining 6 (aspect, scale, offsets, Upright options) | 9 -> 3 (-6) |
| Borders | Size, Colour, Style (3 sliders/sel) | remaining 5 sliders + 4 selects | 13 -> 4 (-9) |
| Grain | Amount, Size (2) | Roughness, Shadow bias, Seed/mode (3 + sel) | 6 -> 2 (-4) |
| Export | Format, Quality, Size, Export button | Recipes, naming, metadata, web gallery, destination hints (~14 hints, 3 sel, ~8 btn) | ~22 -> ~6 (-16) |
| Metadata | Basic EXIF block | Keywords, Tags, raw fields (4 `<details>` already) | already folded, keep |
| Retouch | Heal, Clone, Brush size (3) | Feather, opacity, sampling, spot list actions (~10) | ~14 -> ~4 (-10) |

Subtotal when all cards are opened: about -73 controls on the cards that matter most (roughly 27% of the ~270 static controls), with zero removals.

### P2. First-run / Simple mode ("Level": Simple, Standard, Pro)
One setting in Settings and in the palette ("Editor level"), stored in `chromasmith_ui_level`, default **Standard** for existing users, **Simple** offered at the first-run tour (`tourMaybeShow`, ~L35083) with a one-line choice, replayable via the existing "Show welcome tour" palette entry.
- Simple shows 6 tools: Looks, Exposure & Tone (Essentials), Colour Mixer, Masks, Crop, Output (Essentials). Roughly 11 + 5 + 3 + 6 + 4 + 6 = about 35 visible controls vs about 270 (-87%).
- Standard shows all cards, Essentials open per P1 (about 120 visible when every card is opened, about 150 less than flat).
- Pro shows everything with Advanced open by default.
- Mechanism: a `body[data-level]` attribute that hides rail members and `.fx-adv` content with CSS only; no node removal, so `FX_GROUPS`, session save and undo are untouched. Hidden tools remain findable through the palette (P5), which temporarily reveals the card.

### P3. Default-hidden pro tools (Standard level)
Stay in the DOM, listed under a rail "More tools" row, revealed by the palette, by Pro level or by context:
- Film Negative card (10 sliders): auto-reveals when the loaded file is detected as a negative or when the user runs "Film negative" from the palette. -10 at default.
- Channel mixer, Lab, Colour toning, Multiscale detail (20 sliders): already counted in P1.
- RAW corrections / RAW NR tiers (8): appear only when the current item is RAW (`rawFile` present); on JPEG they are hidden entirely (-8 for non-RAW sessions, which is the majority case).
- Diagnostics card (`diag`): hidden unless the existing diag flag is on.
- Highlight reconstruction (CHR-288) and Retinex DRC (CHR-289): when wired, ship inside Exposure & Tone Advanced (RAW only for highlight recon). Adds 0 to default-visible.
- Lens, Sharpen (deconvolution), Red Eye: collapse into "More tools" at Simple only.
Net rail effect: Standard 30 -> 26 visible cards; Simple 30 -> 6.

### P4. "Modified" indicators and per-section reset
- Card header gets a 6px accent dot (token `--acc`, no new colour) whenever any control in the card differs from default, and the Advanced row gets its own dot plus a count ("3 changed") so a user never loses an edit hidden under a closed fold.
- Rail group buttons show the dot when any member card is modified (6 groups).
- The existing header Reset becomes always-visible on modified cards and hidden on untouched ones (fewer idle buttons: up to -30 header buttons when nothing is edited).
- Alt-click on a slider label resets that slider (matches Lightroom's double-click-label convention; the app already supports mobile double-tap reset).
- Implementation reuses the defaults the cards already reset to; one `fxCardModified(card)` helper compares live value to `defaultValue`.

### P5. Search-first discovery via the command palette
- Index every Essentials and Advanced control as a palette entry (about 125 sliders + 28 selects) in the format `Tool: Control` (for example "Exposure & Tone: Dehaze"), built at open time from `.fx-ctrl [data-label]` the same way Looks are read live. Selecting one opens the card, opens its Advanced fold if needed, scrolls to the control and pulses it (existing `sec-active` machinery).
- Rank: exact label, then `CS_ALIASES`, then fuzzy; modified controls get a small boost; recent selections persist (last 8) in `chromasmith_palette_recent`.
- Palette shows a "Modified" group when opened with an empty query (what have I changed on this photo).
- Adds 0 default controls; makes hidden controls (P1-P3) about 2 keystrokes away.

### P6. Smart ordering by workflow
Reorder rail groups and cards to the common edit order, via the existing `cs-tool-order-*` drag-order keys as the default value (user drags still win):
Look (Image, Looks) > Light (Exposure & Tone, Curves) > Colour (Colour Mixer, Point Colour, Wheels) > Masks > Texture (Grain, Halation, Bloom, Effects, NR, Sharpen) > Crop/Output.
Today `grain` and `nr` and `deconv` share one group with `lens`, `retouch`, `redeye`; split into "Texture" (look-defining: grain, hal, bloom, vig, art) and "Repair" (nr, deconv, lens, retouch, redeye), 8 -> 5 + 5 per group so no group exceeds 6 members. Output group today holds 10 members; split Crop/Transform/Borders/Canvas (5) from Export/Recipes/Watermark/Styles/Sharing (5). Max group size 10 -> 6.

### P7. Mobile limits (<=700px, bottom sheet 42vh)
- Sheet shows Essentials only; a single "More" row opens Advanced inside the same sheet (no second sheet).
- Simple level is the mobile default; Pro/Advanced-open states are not offered below 700px (palette search still reaches any control, opening it in a sheet with its fold open).
- Cap: 12 controls per sheet screen before scrolling (Exposure & Tone Essentials is 11, so it fits). Tool icons in the rail: 6 groups, not 30.
- Touch targets and 11px minimum text stay governed by `ui_audit.mjs`.

### P8. Reference conventions (general, no copying)
- Lightroom: collapsible panels, per-panel reset, "Basic" panel as the 90% panel, edited-panel indicator, searchable panel/slider help.
- Capture One: tool tabs customisable, workspaces, per-tool reset, separate Advanced tools hidden behind a toggle.
- Darkroom (iOS): minimal bottom toolbar, one tool open at a time, long list lives behind search/edit-history.
- Snapseed: a handful of named tools; parameters appear only after a tool is selected; swipe to change the parameter.
Takeaway used here: few top-level tools, one open at a time on phones, advanced parameters folded behind a remembered toggle, always an indicator that something changed.

## 3. Rollout order
1. P4 indicators and `fxCardModified` (pure addition, no layout change; unblocks trust in folding).
2. P1 for the 4 biggest cards: Exposure & Tone, NR, Transform, Export (accounts for about -50 of the -73).
3. P5 control indexing in the palette (must land before anything is hidden by default).
4. P3 context reveal (RAW, negative, diag), then P6 regroup.
5. P2 level setting and tour step; P7 mobile defaults last.
Each step: batch the change, one rebuild, one full run at the end (per project memory).

## Completeness check

Done means a scan of the **running app** classifies every control, not a hand-typed list.

Scan command (to add as `test/disclosure_scan.mjs`, wired into `npm run editor:gates`; until it exists, the baseline comes from `node test/editor_coverage.mjs --json` plus `node test/editor_gates.mjs`):

```
node test/disclosure_scan.mjs --json   # serve a copy of chromasmith-22.html from /tmp, drive Chromium
```

It enumerates `document.querySelectorAll('.fx-ctrl[data-fxsec] :is(input,select,button,textarea,[role=slider])')` live (including JS-built HSL bands, curve points, mask rows) and asserts:
1. **Nothing lost**: total control count at every level equals the baseline recorded before this work (the "keep every control" rule); a removed id fails the scan.
2. **Every control classified**: each is tagged essential, advanced, or tool-hidden; unclassified = 0.
3. **Every hidden control reachable**: each advanced/tool-hidden control is found by a palette query for its own label, and selecting it brings it into view and focusable.
4. **Numbers hit**: default-visible slider count with Exposure & Tone open <= 11 and sum of default-visible controls across all opened Standard cards <= 150; Simple <= 40.
5. **Modified dot truth**: change one control per card, expect that card and its rail group dotted, Reset clears both; reload keeps the Advanced open/closed state.

Matrix it must run across:
- Themes: dark and `body.light`.
- Widths: 320, 390, 700 (boundary), 701, 1024, 1440, 1920, plus the resizer min, default and max panel widths (`cs_panelw`).
- States: no photo (empty), JPEG loaded, RAW loaded, negative detected, multi-photo batch, mask active, Simple/Standard/Pro, Advanced open/closed, mobile sheet open/closed, palette open, first-run tour shown/dismissed, rail flat mode on/off.
- Existing gates that must stay green alongside: `npm run ui:test`, `npm run editor:gates`, `npm run editor:coverage`, `npm run tokens:gates`, `npm run unit:test`. All drive Chromium, not WKWebView, so a final manual pass in the desktop app is still required before closing.

A fresh-context gap review of this plan (a reader who has not seen this document comparing it to the scan output) is part of done.
