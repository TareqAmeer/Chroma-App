# Token conflicts — needs a decision

Every app CSS variable is covered by `design/tokens.json` (as a token) or listed here. These
are cases where the app value and the design system disagree, or where the app needs a family
the design system doesn't define. Verified with `python3 design/verify_tokens.py`.

Matching rule used throughout (STATE.md S1(a)): value **and** property role must agree
(font-size only matches `--fs-*`/DS type-size tokens, spacing/gap only matches `--sp-*`/DS
space tokens, radius only matches `--r*`/DS radius tokens). A `_ds` var() name in the wireframe
was NOT used as a signal — fewer than 10% of declarations carry one.

## Color

| App var | App value (dark / light) | Nearest DS token | Gap |
|---|---|---|---|
| `--bdr` | `rgba(255,255,255,.12)` / `#e0e0e0` | `--hairline-alpha` (`rgba(0,0,0,.08)`) / `--hairline` (`#e0e0e0`) | Dark value has no DS analog — DS never defines a white-alpha border, only `--hairline-alpha` at `.08` on black. Light side matches `--hairline` exactly. |
| `--bdr-panel` | `rgba(255,255,255,.1)` / `#e0e0e0` | none (dark) / `--hairline` (light) | Same gap as `--bdr`, dark side. |
| `--bdr-pill` | `rgba(255,255,255,.14)` / `#e0e0e0` | none (dark) / `--hairline` (light) | Same gap, third alpha step (.14). |
| `--acc2` | `#4a9ddc` / `#1f68a0` | `--blue-slate-focus` `#2a5468` | Neither mode matches any DS blue variant exactly. |
| `--ok` | `#52c97a` / `#257740` | `--green-pine` `#214e1d` / `--state-success` | App lightens the DS success green for dark-surface contrast; light mode is also off (`#257740` vs `#214e1d`). Neither is a DS literal. |
| `--err` | `#e05454` / `#a91f1f` | `--red-oxide` `#870f13` / `--state-danger` | Same pattern as `--ok` — app's dark-mode error is much lighter than DS oxide; light mode also doesn't match exactly. |
| `--hov` | `rgba(255,255,255,.07)` | none | DS has no generic hover-overlay token (frosted/press tokens exist, not a row-hover wash). |
| `--hover-tint` (desktop/library-ui.js) | `rgba(255,255,255,.08)` dark / `rgba(0,0,0,.035)` light | none | Same family as `--hov` above but a distinct value/var — the two should probably be unified, but that's a product decision, not ours to make here. |
| `--sl-thumb` / `--sl-thumb-sh` | `#3a3a35` (light only; dark relies on inline CSS `var(--sl-thumb,#e9e6df)` fallback, never assigned as a real custom property) | none | Slider-thumb fill/shadow have no DS component spec at all (DS ships no slider). Proposed new component tokens: `component.slider-thumb.fill` / `.shadow`, needs an explicit dark value (currently only a CSS fallback literal, not a declared token). |

## Typography

| App var | App value | Nearest DS token | Gap |
|---|---|---|---|
| `--mono` | `ui-monospace,'SF Mono',Menlo,'Courier New',monospace` | none | DS defines only Display/Text families; no monospace face anywhere in the system. Proposed new token: `typography.face.mono`. |
| `--fs-1` | `11px` | none | Off the DS type scale entirely (DS sizes: 10/12/14/17/18/21/24/28/34/40/56). |
| `--fs-2` | `12px` | **two** DS tokens tie: `--type-caption-size` and `--type-nav-link-size` (both `12px`) | Value+role match is ambiguous — role alone (generic UI label vs nav link) doesn't disambiguate which DS type style the app's `--fs-2` should inherit weight/line-height/tracking from. |
| `--fs-3` | `13px` | none | Off-grid. |
| `--fs-4` | `15px` | none | Off-grid. |
| `--fs-6` | `20px` | `--type-tagline-size` `21px` | Close (1px) but not exact — flagged rather than silently rounded. |
| `--fs-7` | `26px` | none | Off-grid. |
| Font weights | App has no weight variable at all (`--sans`/`--display` are family-only; weight is set ad hoc per rule) | `--weight-light/regular/semibold/bold` (300/400/600/700) | The app has no `--fw-*` family to receive these. Proposed new tokens: `typography.weight.{light,regular,semibold,bold}`, currently unbacked by any app var. |

## Spacing & sizing

| App var | App value | Nearest DS token | Gap |
|---|---|---|---|
| `--sp-4` | `16px` | `--space-md` `17px` | Off by 1px — not an exact match, not aliased. |
| `--sp-5` | `20px` | `--gutter-grid` `20px` (exact value, wrong role — that token is a page-gutter, not a spacing-scale step) | Value matches but role doesn't: DS's spacing scale itself has no `20px` step (`4/8/12/17/24/32/48/80`). Using `--gutter-grid` here would be borrowing a layout token for a spacing role. |
| `--r-sm` | `6px` | `--radius-xs` `5px` | Close (1px) but not exact. |
| Control heights | App has no height-scale variable at all — heights are hardcoded per rule | `--height-global-nav 44px`, `--height-sub-nav 52px`, `--height-sticky-bar 64px`, `--height-input 44px`, `--hit-min 44px` | Whole family is missing from the app. Proposed new tokens: `layout.height.{control,nav,input}` — needs the user to confirm which app controls should adopt which DS height before wiring this up. |
| Pill radius | App's pill/rounded-full shapes use hardcoded `50%`/`9999px` literals, not `--r` or `--r-sm` | `--radius-pill` / `--radius-full` (`9999px`) | Proposed new token `radius.pill` — app currently has no named token for this, just literals at each call site. |

## Motion

| App var | App value | Nearest DS token | Gap |
|---|---|---|---|
| `--ease` | `cubic-bezier(.2,.8,.3,1)` | `--ease-standard` `cubic-bezier(.4,0,.6,1)` | Different curve, not aliasable. |
| `--dur-2` | `200ms` | `--duration-fade` `300ms` | App's only "slow" duration is 200ms; DS's only non-press duration is 300ms. No exact match. |
| (no app var) | App's own `0.15s`/150ms literals appear directly in some rules (per STATE.md's S1(a) finding) rather than through `--dur-1`/`--dur-2` | none | Neither DS nor the app's own token pair covers 150ms. Proposed: either retire the 150ms literals in favor of `--dur-1` (120ms) or `--dur-2` (200ms), or add a third duration step — product decision. |

## Elevation

| App var | App value | Nearest DS token | Gap |
|---|---|---|---|
| `--lift-1` / `--lift-2` | Multi-layer shadow recipes (inset highlight + drop shadow(s)), different per theme | `--shadow-product` `rgba(0,0,0,.22) 3px 5px 30px 0` | DS's guideline (`guidelines/brand-elevation.card.html`) is explicit that shadow is reserved "for imagery only" — every other surface uses hairlines. The app's panel-lift shadows are a different concept the DS doesn't model at all. Not a value mismatch so much as a scope mismatch; flagging rather than forcing a mapping. |

## Not design tokens (proposed exclusion)

| App var | Why it's listed instead of mapped |
|---|---|
| `--sat` / `--sab` | `env(safe-area-inset-top/bottom)` — device geometry passed through as an overridable custom property (for desktop-Chrome iPhone-inset testing per chromasmith-22.html's own comment), not a design decision. Recommend excluding from the token source entirely rather than forcing a DS role onto it. |

---

**Needs your call:** anywhere in the tables above marked "Gap" — the DS side and the app side
are both real, considered values; picking one over the other (or adding a third, DS-blessed
value) isn't something to guess at silently.
