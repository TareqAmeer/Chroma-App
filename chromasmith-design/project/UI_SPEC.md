# UI_SPEC.md — Chromasmith Library View + Editor (Develop) View
Source of truth for implementation. Tokens live in `_ds/chromasmith-design-system-.../tokens/*.css`. Covers `Library View.html` and `Editor (Developer) View.dc.html` as currently built. Every mapping below is literal law — do not substitute, approximate, or "improve."

## 1. Token & Component Mapping

### Zone: App shell (`.app`)
- Background (dark): `var(--surface-tile-3)`; text: `var(--ink-on-dark)`; font: `var(--font-text)`
- Light mode: background `var(--canvas)`; text `var(--ink)`

### Zone: Topbar — both views (`.topbar`)
- Height: fixed 52px (Library) / 48px (Editor) — literal chrome height, not tokenized
- Bottom border: `1px solid` white-alpha hairline on dark chrome (dark surfaces do not use `--hairline`, which is a light-surface token)
- Background: `var(--surface-tile-1)`
- Padding: `var(--space-sm)`–`var(--space-md)`; gaps: `var(--space-xs)`–`var(--space-sm)`

### Zone: Logo (both views)
- `assets/chromasmith-logo.png`, fixed height, flush to left edge via negative margin canceling topbar padding

### Zone: Search bar (Library)
- Radius: `var(--radius-pill)`; background `var(--surface-tile-2)` (dark) / `var(--surface-alt)` (light)
- Icon/placeholder color: `var(--ink-on-dark-muted)` (dark) / `var(--ink-muted-48)` (light); no border

### Zone: Pill buttons / sort control (`.pillbtn`, both views)
- Radius `var(--radius-pill)`; border `1px solid` hairline-alpha; font `var(--type-button-utility-*)`; icon stroke `var(--ink-on-dark-muted)`

### Zone: Icon buttons (`.ibtn`, flag/reject/heart, rail icons — both views)
- Hit target ≥`var(--hit-min)` (44px); visible size 28–30px
- Idle stroke `var(--ink-on-dark-muted)`; active/selected stroke `var(--primary-on-dark)`, selection shown as a ring (never icon fill)
- Fixed glyphs: reject = X, pick/flag = flag, favorite = heart — no substitutions

### Zone: Filter row / type chips (`.chip`, Library)
- Radius `var(--radius-pill)`; selected: `var(--primary-on-dark)` fill + `var(--on-primary)` content; unselected: `var(--surface-tile-2)` fill + `var(--ink-on-dark-muted)` content

### Zone: Sidebar (`#sidebar`, Library)
- Background `var(--surface-tile-1)`; eyebrow labels `var(--type-micro-legal-*)` uppercase, `var(--ink-on-dark-muted)`
- Row label: `var(--type-caption-size)`, `var(--weight-regular)` — bold (`--weight-semibold`) only for the selected row and the permanent "All Photos" exception
- Indentation: Year (0) → Month (`var(--space-sm)`) → Day (`var(--space-lg)`, aligned under Month's first character)
- Expand/collapse chevron: left-aligned, Year/Month rows only, never Day

### Zone: Photo grid cards (`.card`, Library)
- Radius `var(--radius-none)` — sharp corners always
- Selected ring: `inset 0 0 0 2px var(--primary-on-dark)`
- RAW badge ("R" only, no JPG badge): `var(--surface-chip-alpha)` fill, `var(--on-dark)` text, `var(--radius-xs)`
- Rejected state: opacity/dim overlay in `var(--surface-black)`, not a filter/hue shift
- Caption metadata: `var(--type-caption-size)`, `var(--ink-on-dark-muted)`

### Zone: Status bar (`.statusbar`, Library)
- Text `var(--type-fine-print-size)`, `var(--ink-on-dark-muted)`; counts ≥1000 render as `#.#k`

### Zone: Menus/dropdowns (`.menu`, both views)
- Background `var(--surface-tile-2)` (dark) / `var(--canvas)` (light); border `var(--hairline-alpha)`/`var(--hairline)`; radius `var(--radius-sm)`
- Hover fill: white-alpha overlay (dark) / `var(--surface-alt)` (light); checkmark `var(--primary-on-dark)`/`var(--primary)`

### Zone: Editor topbar extras
- Left cluster: logo → back → undo/redo (`.undogrp`, `flex:none`) → hold-to-open history/export dropdown (`.history-menu`, scrollable, styled as `.menu`)
- Right cluster: zoom (`.zoomctl`, shrinks first) → show-original → full-res → Tools menu (docked right, fixed position) → All FX (sparkle icon) → Export (`var(--primary-on-dark)` fill, near-black text) → view menu (theme toggle)
- Center: filename/EXIF, truncates with ellipsis, never overlaps side clusters

### Zone: Filmstrip (`#filmstrip`, Editor)
- Background `var(--surface-tile-1)`; border `var(--hairline-alpha)`
- Library/Develop tab pair (`.fs-tab`) styled like Library sidebar tabs
- Resizable, collapses to 0 below ~60px with a `.showpanel` restore button (28×28px, `var(--radius-sm)`, `var(--surface-tile-2)`)
- Thumbnails: `var(--radius-none)`, same as Library cards

### Zone: Tool panel (`#toolpanel`, Editor)
- Background `var(--surface-tile-1)`; same resize/collapse/`.showpanel` pattern as filmstrip
- Field labels (`var(--type-micro-legal-*)`, uppercase, `var(--ink-on-dark-muted)`) always sit outside their control's box — Presets label included; only the collapse chevron sits inside the box border
- Select dropdowns truncate with ellipsis, never overlap the chevron
- Sliders: ≥`var(--space-xxs)` gap between value label and thumb
- Preset tiles: `var(--radius-xs)`, selected ring `inset 0 0 0 2px var(--primary-on-dark)`

### Zone: Tool rail (`.rail`, Editor — Looks/Adjust/Color/Detail/Retouch/Masks/Film/Frame/Export/Info)
- Fixed-width vertical rail, `var(--surface-tile-1)` background, `var(--hairline-alpha)` border-left
- Must fit all items in viewport height with no scroll — reduce spacing first, drop to icons-only as last resort
- Active `var(--primary-on-dark)`; inactive `var(--ink-on-dark-muted)`

### Zone: Canvas + context menu (Editor)
- Canvas background `var(--surface-black)` (true black) — never `--surface-tile-*`
- Context menu: same token mapping as other `.menu` instances; submenus indent via padding-left only

## 2. Multi-Page & State Coverage

### 2.1 Library View — Grid (default/index state)
Topbar (logo, search, sort dropdown, view-menu, flag/reject/heart rate row), filter row (type chips, flags & tags chips), sidebar (Years/Months/Days tree), photo grid (default thumbnail state), status bar.

### 2.2 Library View — Card hover state
Uncolored flag/reject/heart icons reveal on hover; unaffected when a rating is already set (see 2.4).

### 2.3 Library View — Card selected / multi-select state
Selection ring; supports multi-select (shift/cmd-click implied by "multiple photos" requirement).

### 2.4 Library View — Card rating-set state
When one rating icon (flag/reject/heart) is active, the other two icons hide until deselected; reject additionally dims the thumbnail.

### 2.5 Library View — Sort dropdown (open state)
Dropdown menu replacing the old inline sort pill; standard `.menu` styling.

### 2.6 Library View — Type filter dropdown (open state)
Full list of photo types, cmd-click multi-select; selected types render back as chips in the filter row until deselected.

### 2.7 Library View — View menu (open state)
Contains thumbnail layout options (square crop/original dimensions/spacing toggle — toggle must support re-deselecting) and the dark/light mode switch.

### 2.8 Library View — Dark mode / Light mode (global toggle state)
Full palette swap per Section 1; icons and selected-state text must retain contrast in both modes.

### 2.9 Editor View — Default develop state
Topbar, filmstrip (Library/Develop tabs, thumbnail rail), canvas (photo at current zoom), tool panel (Looks tab active by default), tool rail.

### 2.10 Editor View — Filmstrip / tool panel collapsed state
Either side panel dragged below ~60px hides fully; corresponding `.showpanel` restore button appears.

### 2.11 Editor View — Tool rail icons-only state
Rail auto-drops text labels when full labeled rail would require scrolling at the current viewport height.

### 2.12 Editor View — Undo hold / history dropdown (open state)
Holding the undo button opens a scrollable dropdown listing edit history and export history entries.

### 2.13 Editor View — Right-click context menu (open state)
Rate / Rotate & flip / Add to album / Export, each with a nested submenu (open/closed sub-state).

### 2.14 Editor View — Tools menu (open state, docked top-right)
Rotate/flip/gamut-warning toggle/copy-paste settings/reset — fixed to the right, must not relocate.

### 2.15 Editor View — View/theme menu (open state)
Gamut warning toggle + light/dark toggle, mirrors Library's theme switch.

### 2.16 Editor View — Presets box collapsed/expanded state
Collapsible box (chevron rotates); strength slider disabled until a preset tile is selected.

## 3. Gap Analysis & Ambiguity Resolution (STRICT RULE)

**Binding rule for the downstream agent:** If a feature exists in the current app codebase but is absent from these wireframes, OR the wireframes show a feature the app's backend does not currently support, DO NOT GUESS OR INVENT A SOLUTION. Pause execution and explicitly ask the user what to do before writing any code for that feature.

Open questions / gaps observed in this spec right now:
- Is multi-select drag-select (marquee) required in the Library grid, or is click+modifier (shift/cmd) sufficient? The wireframes imply "select multiple" but don't show a marquee interaction.
- What is the actual full list of photo types for the Types dropdown beyond All/RAW/JPEG/Video shown in the collapsed chip row?
- Is there a real backend/API for edit history and export history, or should the history dropdown remain presentational-only (static list) until a data source is confirmed?
- Does "Full resolution" and "Show original" in the Editor topbar map to real image-loading behavior, or are they visual-only toggles for this pass?
- Should dark/light mode be a persisted user preference (localStorage/account setting) or a session-only visual toggle?
- Is there a real LUT file system (upload/save/download `.cube`) behind the LUT row controls, or are those presentational placeholders pending backend support?
- What does "Merge (beta)" and "Scan photos" in the canvas context menu actually do — are these real, backend-supported actions or UI-only stubs?

## 4. State & Data Binding Contracts

Every interactive element below is presentational only. Components must accept props/callbacks — they must NOT fetch, mock, or manage their own data.

- **Photo grid card**: props `{ id, thumbnailUrl, isRaw, rating: 'none'|'flagged'|'rejected'|'favorite', isSelected, onSelect(id, modifierKeys), onSetRating(id, rating) }`
- **Sidebar tree row**: props `{ level: 'year'|'month'|'day', label, count, isExpanded, isSelected, onToggleExpand(id), onSelect(id) }`
- **Sort dropdown**: props `{ options: string[], selected: string, onChange(value) }`
- **Type filter dropdown**: props `{ options: string[], selectedValues: string[], onChange(values[]) }` (multi-select)
- **Flag/tag chips row**: props `{ chips: {id, icon, label, active}[], onToggle(id) }`
- **View/theme menu**: props `{ theme: 'dark'|'light', onThemeChange(theme), spacingOption, onSpacingChange(value|null) }` — spacing toggle must support a null/deselected value
- **Zoom control**: props `{ value: number, min, max, onChange(value) }`
- **Undo/redo + history dropdown**: props `{ canUndo, canRedo, onUndo(), onRedo(), historyEntries: {id,label}[], exportEntries: {id,label}[] }`
- **Tool rail**: props `{ tabs: {id, icon, label}[], activeTab, onTabChange(id) }`
- **Preset tile grid**: props `{ presets: {id, name, thumbnailUrl}[], selectedId, strength, onSelect(id), onStrengthChange(value) }`
- **Filmstrip/tool panel resize+collapse**: props `{ width, isCollapsed, onResize(width), onCollapse(), onRestore() }`

STRICT RULE: no mock API endpoints, no dummy data fetchers, no new state management library. All state above is passed in via props/callbacks from a parent the downstream agent does not need to author.

## 5. "Black Box" Component Boundaries

The following are specialized viewports. The downstream agent must generate only the surrounding container `div` with correct layout (dimensions, background, border, position in the grid) and is strictly forbidden from writing the internal rendering logic:

- **Photo grid thumbnail image renderer** (`.card .ph` / `.fs-thumb` image content) — container only; actual thumbnail decode/render/virtualization is out of scope.
- **Editor canvas photo viewport** (`.canvas-photo` / `.canvas-wrap` image render, pan/zoom compositing) — container only (fixed aspect box, `var(--surface-black)` background); actual raw-decode/render/zoom compositing logic is out of scope.
- **LUT chart / color grid preview** (behind the "LUT chart" icon button) — container only if this surface is built at all.
- **Preset/LUT thumbnail previews** — container only; the rendered preview image content itself is out of scope.

## 6. Negative Constraints & Validation Checklist

### Negative Constraints
1. NEVER use raw hex codes or RGB/RGBA literals — every color resolves through `var(--token-name)` (white/black alpha overlays for dark-surface hairlines/hover are the only sanctioned exception, at the exact alphas already specified).
2. DO NOT invent new CSS classes, layout primitives, or component variants not already named in this spec.
3. DO NOT add features, buttons, menu items, or copy not explicitly named in this spec or the wireframes.
4. DO NOT deviate from the fixed icon glyph assignments (X = reject, flag = pick, heart = favorite, sparkle = All FX). Icons stay single-color line icons, never filled/duotone.
5. DO NOT use border-radius values outside `{0, 5, 8, 11, 18, pill}`.
6. DO NOT apply drop shadows to chrome, cards, buttons, menus, or text — the one sanctioned shadow token is for photography resting on a surface only.
7. DO NOT use font-weight 500 — the ladder is 300/400/600/700 only.
8. DO NOT let any two interactive elements overlap or compress into each other at any viewport width — shrink or collapse secondary controls first.
9. DO NOT introduce a second accent color beyond `var(--primary-on-dark)`/`var(--primary)`.
10. DO NOT reintroduce bold/semibold weight on non-selected sidebar rows (year, month, counts) — only the selected row and "All Photos" are exceptions.
11. DO NOT invent mock APIs, data fetchers, or state libraries per Section 4.
12. DO NOT write internal rendering logic for any zone named in Section 5.

### Validation Checklist (self-run before finalizing)
- [ ] **Contrast:** every icon/text on a selected or highlighted background resolves to ≥4.5:1 contrast — no icon/count uses the same or near-same color as its background wash.
- [ ] **Responsive collapse:** at the narrowest supported viewport, sort control/search bar/zoom bar visibly shrink or go icon-only BEFORE any two topbar elements overlap.
- [ ] **Sidebar hierarchy:** Year (0 indent, regular weight) → Month (indented, regular weight, ≤ Year size) → Day (indented further, aligned under Month's first character, smallest size, no chevron) — verified in code, not by eye.
- [ ] **Icon consistency:** reject/pick/favorite use the exact same glyph everywhere (sidebar, filter row, grid cards, editor context menu) — no mixed iconography for the same action.
- [ ] **Editor panel resilience:** dragging filmstrip/tool-panel below the collapse threshold hides it fully (width 0, no crushed partial state) and shows its `.showpanel` restore button, while the tool rail still shows all items with zero scrollbar at any panel width.

## 7. Context & Token Efficiency Rules

- NEVER use `cat` or read whole files just to find a component. Use the Read tool with explicit line `limit` and `offset` arguments.
- When using `grep` or `bash` to search the codebase, always pipe output to `head -n 50` to avoid context window pollution.
- Do not output verbose explanations or chatty summaries — write the code and move on.
- Prompt the user to run `/compact` after completing each page or major UI zone to compress session history.
