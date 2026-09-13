# Color pilot readiness audit

Audit date: 2026-09-13. Scope: evidence gathering only; no production UI, tokens, contracts, specifications, or screenshots changed. Starting tree was clean at `2be1e4f7ced7fb1b50e87b1e71b69d1cf8a10472`, which includes required commit `2be1e4f`.

## Current Color composition

The Color rail group contains four existing sections, in source order: Tone Curves (`curves`), Color Mixer (`hsl`), Colour Wheels (`wheels`), and Point Color (`pointcolor`). The app group currently registers all four under `FX_GROUPS.color`.

| Family | Color source registrations | Whole-repo source registrations |
| --- | ---: | ---: |
| section-card | 4 | 29 |
| control-row | 11 | 145 |
| toggle | 4 | 23 |
| slider | 14 | 91 |
| button | 16 | 271 |
| info-button | 1 | 14 |

Counts come from `scripts/query-components.mjs --family <family>` filtered to the four Color source sections (lines 1949–2053). Family memberships overlap: sliders are also in control rows, and the info button is also a button. The proposed slider contract records 10 Color registrations for Mixer, Wheels, and Point Color; four additional native range inputs belong to Tone Curves' conditional Parametric mode. Buttons generated into HSL/Point Color chip containers are runtime-created and have no static Color registrations.

Controls include native sliders, buttons/chips, section toggles, the HSL histogram and band chips, Point Color's sampled-color list, a canvas-based Tone Curves editor, and three canvas-based colour wheels. Point Color's eyedropper samples by clicking the photo canvas; its four adjustment sliders appear only after selecting a point. The registries provide 983 runtime appearances across 18 states overall, but the `page:fx` Color query finds the Color navigation button and general zoom control only, not Color section controls. Runtime evidence for those sections is therefore absent from the component appearance registry.

## Existing design evidence

The current-app capture set is present under `design/asbuilt/fxsec-{curves,hsl,wheels,pointcolor}/`: each section has full panel captures at 220px and 440px in dark and light themes, plus corresponding crops. `design/surfaces.json` records all four as opened, with `rest` and `hover` true and `disabled` false; it records `wireframe: false` and no wireframe file for each. The image set names distinguish width and theme, not interaction state, so the inventory's hover flag does not establish a separately reviewable hover capture.

The wireframe-side artifact `chromasmith-design/project/panels/color.compare.html` exists, but its own header calls it an auto-generated draft and says its “proposed” column is a mechanical 1:1 translation into wireframe component vocabulary, not a design. There are no paired Color wireframe captures registered in `design/surfaces.json`. `test/baselines/visual/color.png` is also present, without a paired-state set recorded here. `design/specs/color.json` is generated wireframe extraction (group `wireframe`, generated 2026-09-12); its targeted tree branches map the four sections and selected controls to app IDs, while marking unmatched controls. It is generated structural/style evidence, not an authored or approved design.

Captured widths are panel surfaces of 220px and 440px, not phone layouts. Captures cover resting/default visuals in both themes. They do not show changed values, active dragging, keyboard focus/operation, error or disabled states, or Point Color after a sample is selected. There is no Color mobile capture, accessibility-tree or assistive-technology evidence, or forced-colors/reduced-motion evidence. No Color proposal capture demonstrates its appearance at any width or theme.

## Existing implementation status

Backlog item CO1 is marked fixed and records the earlier Color implementation work: the Color rail group was wired to include Wheels (which had working canvas UI but was unreachable from that group), and the Point Color help tooltip became a sibling info button rather than invalid nested button markup. Tone Curves and Wheels canvas interactions were left as existing widgets. The current source wires section toggles, curve mode/channel and parametric handlers, HSL sliders, wheel drag/luminance handlers, and Point Color sampling/adjustment handlers. This confirms implemented source paths; this audit did not execute a focused interaction test and the runtime registry does not capture these Color states.

R8 is fixed for the nested Point Color button issue. CO1's wording says “reviewed Color panel proposal,” but it contains no approval record. The current comparison file labels itself a draft, and the reference-to-spec workflow requires explicit approval evidence. Do not infer user approval from the earlier implementation or “reviewed” wording.

## Open Color backlog

These are the non-closed items whose panel or source explicitly identifies Color:

| ID | Status | Current item |
| --- | --- | --- |
| R9 | backlog | Tone Curves, Color Mixer, Point Color, and Colour Wheels keep their reset actions at the bottom of each section instead of moving them into the header. The note says dual reset actions need per-section override logic; bottom reset actions work meanwhile. |
| R10 | backlog | Cross-panel inventory findings are reported across six panels, including Color; the current Color inventory findings have not been triaged/allowlisted. This is cross-panel work and is not recorded as a direct blocker to the pilot. |

Closed Color references (including CO1, R8, and T22) are excluded from the open list.

## Contract readiness

The slider contract is `proposed`, not approved. Its recorded decisions are: Slate Blue changed fill on light and Mist Blue on dark; preserve functional HSL gradients; use a 44px minimum interaction target unless validation finds a concrete issue; associate visible labels and expose native values. Its further proposed mapping includes 12px/400 SF Pro Text labels and tabular values, 4px label/control separation, the documented focus ring, and restrained motion. The contract itself records no approval; these are recorded decisions for the proposal and do not authorize production changes.

Other Color-used families whose contracts remain `draft` are `section-card`, `control-row`, `button`, and `info-button`. The `toggle` contract is `proposed`. The custom curve/wheel canvases and runtime-created chips are not represented by the static Color registrations above. Slider evidence does not cover the four conditional Tone Curves sliders.

Evidence gaps include mobile/touch hit-target validation; changed/default and focus/drag behavior; contrast and focus visibility in both themes; and keyboard, screen-reader, and value announcement behavior. There is conflicting accessibility evidence: Color's static markup uses adjacent `.fx-label` divs rather than associated `<label>` elements and has no explicit per-input `aria-label`, while the app-wide `a11yEnhanceFormLabels()` runtime enhancement derives names and the 2026-09-11 app-wide axe audit reports those naming violations fixed. No Color-specific accessibility-tree or interaction record resolves that at the Color controls, so verify it there rather than reporting either an established failure or a Color-specific pass.

## Decision gate

One user choice is needed before proceeding: which starting path is intended?

1. Explicitly accept the proposed side of `color.compare.html` as the basis for a Color pilot review (it remains a generated draft, not an approved design).
2. Supply a new visual reference, including its provenance and the views/states it is intended to govern.
3. Request a targeted redesign and name the component/control to target.

No visual direction is selected by this audit. Any path still needs its evidence gaps handled and explicit specification approval before production implementation.

## Recommended next task

Get the user's explicit choice at the decision gate and record the selected starting scope. This is the prerequisite that the verified evidence supports; do not begin redesign work before it is answered.

## Evidence paths and commands checked

Read: `docs/ui-workflow/STATE.md` (Component registry onward); `docs/editor-redesign-plan.md` §1; `docs/ui-workflow/reference-to-spec/README.md` and `template.json`; slider contract; targeted metadata/tree branches of `design/specs/color.json`; Color panel/source backlog entries in `test/editor_ux_spec.json`; Color family and runtime results from `scripts/query-components.mjs`; `design/surfaces.json`; and the four `design/asbuilt/fxsec-*` surface records, specs, and captures.

Commands: `npm run components:check`, `npm run components:contracts:check`, and `npm run reference:spec:validate:all` passed at start and are required again after this documentation edit. No browser capture or unrelated panel check was run. `node scripts/query-components.mjs --family <family>` was used for family registration evidence; `node scripts/query-components.mjs --runtime --state page:fx --text color` was used for the Color runtime query.
