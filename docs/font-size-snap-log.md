# Font-size snap-to-scale log (2026-09-13)

Context: `design/tokens.json`'s typography scale changed (10/11→12, 13→14, 15→17,
20→21, 26→24; see git history around this date). That change only affected
`--fs-N` variable *values* — it did nothing to the ~54 hardcoded font-size/
font-weight literals across `chromasmith-22.html` that happened to numerically
match the *old* scale by coincidence but never actually referenced `var(--fs-N)`.

Per explicit request, every one of those literals was snapped to the *nearest*
value in the new scale (12 / 14 / 17 / 21 / 24px) and rewritten to use the
matching CSS variable, even where the original number was arguably an
intentional one-off (icon sizes, tiny badge labels) rather than a body-text
size. This is a deliberately aggressive pass — **if it visibly worsens the UI
(icons/labels reading too large or too small in context), revert this batch**
rather than hand-tuning individual rules, since the snapping logic was uniform
and undoing it is the same in one step.

## How to revert

```bash
git log --oneline -- chromasmith-22.html | grep -i "font-size snap"
git revert <that commit sha>
```

or simply restore each selector's original literal value from the table below.

## Scale reference

| Var | Value |
|---|---|
| `--fs-0` / `--fs-1` / `--fs-2` | 12px |
| `--fs-3` | 14px |
| `--fs-4` | 17px |
| `--fs-6` | 21px |
| `--fs-7` | 24px |

All snaps below route through `--fs-2` for anything landing in the 12px
cluster (arbitrary single choice for consistency — `--fs-0`/`--fs-1` alias the
same 12px value).

## Changes (selector → old literal → new var)

| Selector | Old | New |
|---|---|---|
| `body` | `font-size:16px` | `var(--fs-4)` (17px) |
| `.bstamp` | `10px` | `var(--fs-2)` (12px) |
| `.badge` | `10px` | `var(--fs-2)` |
| `.cver` | `11px` | `var(--fs-2)` |
| `.dz-ic` | `18px` | `var(--fs-4)` (17px) |
| `.dz-sb` | `11px` | `var(--fs-2)` |
| `.dz-fn` | `10px` | `var(--fs-2)` |
| `.vinput` | `11px` | `var(--fs-2)` |
| `.step-badge` | `10px` | `var(--fs-2)` |
| `.hsl-t` | `11px` | `var(--fs-2)` |
| `.hsl-t th` (font-weight) | `normal` | `var(--fw-regular)` (400) |
| `#panel-fx .dz-ic` | `16px` | `var(--fs-4)` |
| `.fx-hint` | `11px` | `var(--fs-2)` |
| `.fx-info-i` | `9px` | `var(--fs-2)` |
| `.fx-hint-x>summary` | `11px` | `var(--fs-2)` |
| `.fx-hint-x p` | `11px` | `var(--fs-2)` |
| `.msk-mst .msk-swatch>span` | `9px` | `var(--fs-2)` |
| `.fx-split-knob` | `11px` | `var(--fs-2)` |
| `.fx-zoom-ctrl #fx-zoom-pct` | `10px` | `var(--fs-2)` |
| `.ni-build` | `10px` | `var(--fs-2)` |
| `.fs-idx` | `9px` | `var(--fs-2)` |
| `.look-cell-err::after` | `9px` | `var(--fs-2)` |
| `.look-cell .look-nm` | `8px` | `var(--fs-2)` |
| `.guide` | `14px` | `var(--fs-3)` (14px, exact) |
| `.guide h1` | `26px` | `var(--fs-7)` (24px) |
| `.guide h3` | `15px` | `var(--fs-3)` (14px) |
| `.guide .gnote` | `13px` | `var(--fs-2)` |
| `.guide .toc a` | `11px` | `var(--fs-2)` |
| `.ll` | `11px` | `var(--fs-2)` |
| `.fx-exif-chip` | `11px` | `var(--fs-2)` |
| `.fx-people-chip` | `11px` | `var(--fs-2)` |
| `body.mobile-fx.sheet-open .fx-act-ic` | `19px` | `var(--fs-4)` (17px) |
| `#fx-sl-bubble` | `11px` | `var(--fs-2)` |
| `#fx-add-btn` | `36px` | `var(--fs-7)` (24px) |
| `#fx-exp-ov .eo-txt` | `11px` | `var(--fs-2)` |
| `.fx-mini` | `9px!important` | `var(--fs-2)!important` |
| `.fx-act-ic` | `25px` | `var(--fs-7)` (24px) |
| `body.mobile-fx #fx-fab-export .fx-act-ic` | `22px` | `var(--fs-6)` (21px) |
| `.fx-ovf-grp-label` | `10px` | `var(--fs-2)` |
| `.cl-empty` | `13px` | `var(--fs-2)` |
| `.cl-cell-empty` | `22px` | `var(--fs-6)` (21px) |
| `.cl-thumb .cl-thumb-x` (font-size) | `11px` | `var(--fs-2)` |
| `.cl-count button` | `11px` | `var(--fs-2)` |
| `.cl-sec-btn .cl-sec-lb` | `8px` | `var(--fs-2)` |
| `.fx-val` (mobile override, `@media` block) | `11px` | `var(--fs-2)` |

## Not touched: line-heights

10 line-height literals (`.fx-hint`, `.msk-hint`, `.msk-warn`, `.guide`,
`#fx-toast`, `.fs-idx`, `body.deskx .fx-rail-btn .fx-rail-lb`,
`.cl-thumb .cl-thumb-x`, plus `body`'s base `1.5`) still show as violations.
No line-height token scale exists in `design/tokens.json` — snapping implies
snapping *to* something, and there's nothing to snap to yet. Building a
line-height scale (à la the scrim/tint scales) would be a reasonable follow-up
if this keeps coming up, but is a separate decision from this pass.

## Biggest blast-radius items to eyeball first

- `body`'s base font-size (16→17px) — affects any `em`/`rem`-relative sizing
  app-wide, though this codebase is almost entirely raw-px, so the practical
  effect should be small.
- `#fx-add-btn` (36→24px) and `.fx-act-ic` (25→24px) — these are large icon
  glyphs (the floating add/export button, toolbar action icons); a 12px drop
  on `#fx-add-btn` is the most visually significant single change in this
  batch and is worth a screenshot check.
