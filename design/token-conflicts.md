# Token decisions

Every app CSS variable is covered by `design/tokens.json` (as a token) or listed here. Originally
a list of open conflicts; on 2026-09-11 you asked to resolve them now (DS where DS has one,
otherwise a recommendation) so you can review the result live in the app rather than from a
table. Verified with `python3 design/verify_tokens.py`.

Matching rule used throughout (STATE.md S1(a)): value **and** property role must agree
(font-size only matches `--fs-*`/DS type-size tokens, spacing/gap only matches `--sp-*`/DS
space tokens, radius only matches `--r*`/DS radius tokens). A `_ds` var() name in the wireframe
was NOT used as a signal — fewer than 10% of declarations carry one.

## Applied — DS value adopted (visible in the app now)

| App var | Was (dark / light) | Now (dark / light) | Reasoning |
|---|---|---|---|
| `--acc2` | `#4a9ddc` / `#1f68a0` (invented off-palette blues) | `var(--acc)` in both modes | DS: "There is no second brand accent" (design.md). An invented second blue directly contradicted the DS, so it's now removed rather than reconciled. |
| `--ok` (light only) | `#257740` | `#214e1d` (DS `--green-pine`, unchanged) | 10:1+ contrast on white — same enormous margin as the DS's Blue Slate, no re-darkening needed. |
| `--err` (light only) | `#a91f1f` | `#870f13` (DS `--red-oxide`, unchanged) | 8:1+ contrast on white, same reasoning as `--ok`. |

## Applied — my recommendation (no DS value existed, visible in the app now)

| App var | Was | Now | Reasoning |
|---|---|---|---|
| `--ok` / `--err` (dark only) | `#52c97a` / `#e05454` | unchanged | DS's literal success/danger greens/reds measure ~1.3:1 against the near-black `--bg` — effectively invisible. Kept the app's brighter dark-mode values as a deliberate, documented accessibility deviation rather than importing an unreadable DS literal. |
| `--hov` | `rgba(255,255,255,.07)`, no light value at all (fell through to the dark value — invisible on a near-white row) | `rgba(255,255,255,.08)` dark, `rgba(0,0,0,.035)` light | Unified with desktop/library-ui.js's `--hover-tint`, which already had the correct light value for this exact role. One fewer inconsistent pair; fixes a real light-mode bug (invisible hover) as a side effect. |
| `--sl-thumb` / `--sl-thumb-sh` (dark) | Only a CSS `var(--sl-thumb,#e9e6df)` inline fallback — never a declared custom property | `#e9e6df` / matching inset shadow, now declared in `:root` | No visual change — makes the existing fallback an explicit, real token instead of a hidden one. |

## Kept as-is — different context, not a gap to close

These looked like mismatches but reflect genuinely different design contexts (a dense desktop
editor vs. the DS's marketing/web scale), so forcing a DS value on would trade one inconsistency
for a worse one (editor UI bloating to web-page sizing). Flagging the reasoning rather than
silently leaving them unexplained:

| App var | Value | Why it stays |
|---|---|---|
| `--bdr` / `--bdr-panel` / `--bdr-pill` (dark) | `.12` / `.1` / `.14` alpha | Deliberate wireframe-driven 3-way split (added specifically to fix a bug where one flat `--bdr` did three jobs) — DS has no equivalent multi-role border system to adopt instead. |
| `--mono` | `ui-monospace,'SF Mono',Menlo,'Courier New',monospace` | DS defines no monospace face at all; numerals/code have no DS analog. |
| `--fs-1` / `--fs-3` / `--fs-4` / `--fs-7` | `11/13/15/26px` | App's dense-editor type scale (10/11/12/13/15/20/26) is a different rhythm from the DS's spacious marketing scale (10/12/14/17/18/21/24/28/34/40/56) — CLAUDE.md itself documents the editor moving to *smaller* type as a deliberate density choice. |
| `--fs-2` | `12px` | Matches two DS tokens at once (`--type-caption-size`, `--type-nav-link-size`) — same "different scale" situation, not resolvable by picking one. |
| `--sp-4` / `--sp-5` | `16px` / `20px` | App's spacing scale is a clean 4px-step progression for dense controls; DS's (4/8/12/17/24/32/48/80) is marketing-page rhythm. Different purpose, not a gap. |
| `--r-sm` | `6px` | Added specifically because neither DS radius rung (5px/8px) fit a popover row — an intentional in-between step, not an oversight. |
| `--ease` | `cubic-bezier(.2,.8,.3,1)` | DS's `--ease-standard` curve is documented specifically for the 0.95-scale press effect, not general-purpose easing — different use, not the same knob. |
| `--dur-2` | `200ms` | DS's 300ms is a page-fade duration; the app's 200ms is a UI-transition duration in a much denser surface. |
| `--lift-1` / `--lift-2` | multi-layer panel shadows | DS reserves its one shadow for photography only — this is a concept the DS deliberately doesn't model, not a value to reconcile. |
| `--sat` / `--sab` | `env(safe-area-inset-*)` | Device geometry, not a design decision — excluded from the token source's design intent, kept only because it's a real custom property in the app. |

## Adopted 2026-09-11 — defined in tokens.json, NOT yet wired (user: "go with your recommendations")

Defined so wireframe/as-built values map to a named token (S8 specs), but deliberately not emitted
into `:root` and not used at any call site yet — zero visual change. Each carries
`status: "proposed-unwired"`. Wiring = add the var to `scripts/token-layout.json`, regenerate, then
replace literals at call sites (UI work, check visually).

| Family | Tokens | Why these values |
|---|---|---|
| Font weight | `--fw-regular` 400, `--fw-medium` 500, `--fw-semibold` 600, `--fw-bold` 700 | Matches actual app usage (5/10/28/4 uses). DS has no 500 but the dense UI uses it 10×; the one 300 use folds into 400. |
| Control height | `--h-ctrl-sm` 28px, `--h-ctrl` 32px, `--h-touch` 44px | The app's real heights by frequency; 44px = touch floor = DS. DS 52/64px are marketing scale, unused. |
| Radius | `--r-pill` 9999px, `--r-circle` 50% | Pill = DS; circle kept separate because 50% on a non-square isn't a pill. |
| On-primary text | `--on-acc` #10222a | The approved wireframe's value. DS white fails contrast on the light accent; today's #000 reads the same. |
| Danger subtle | `--err-subtle` dark rgba(224,84,84,.16) / light rgba(135,15,19,.16) | Consolidates 3 ad hoc reds onto `--err`'s own hue; light value is the wireframe's. |

Still unmapped (not in the five families; S1 saw them in the wireframe): letter-spacing .8px,
0.15s duration (app has 120/200ms), off-grid spacing 2/6/7/9/10/14px. Decide when S8 reports counts.

---

Re-run `python3 design/verify_tokens.py` after any further edit — it still asserts every declared
app var is a token or listed here.
