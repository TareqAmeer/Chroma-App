# UI workflow rebuild — session prompts

Paste ONE prompt into a NEW chat. Set the model in the app BEFORE the first message (switching mid-chat re-reads everything uncached). Run in order (S6 → S6b → S7 → S7b → S8 …); S13 repeats per panel. S6 groups: A editor-sections, B editor-overlays, C other-pages (+splash via its wireframe), D mobile, E library. S1 may revise prompts below — always copy from this file, not an older copy.

## Prompts
**S1: Spike** (Opus 5, high effort)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: a throwaway feasibility spike, with scripts in the scratchpad only and no app edits. Test 4 assumptions and record the numbers:
> (a) Can the computed styles of the Retouch and Export panels in `chromasmith-design/project/Editor (Developer) View.dc.html` be mapped onto the app's `:root` tokens (`chromasmith-22.html` lines 50–98)? Report counts of exact matches, ambiguous matches and no match. Note that the wireframe uses `_ds` token names (`_ds/.../_ds_manifest.json`).
> (b) Can the `PAIRS` entries in `test/editor_wireframe_diff.mjs` for Retouch be generated from the wireframe DOM? Diff the generated entries against the hand-written ones.
> (c) How long does a token-only lint (raw hex, px and ms values not in a `var()`) take on just the changed lines of `chromasmith-22.html`'s `<style>`?
> (d) Do `.fx-row`, `.fx-ctrl`, `.fx-toggle` and the segmented control (`selectToSeg`) render correctly in a bare page, or does isolating them need a refactor?
> Use Haiku subagents (`model: "haiku"`) to run the spike scripts and report numbers only; you interpret them.
> Done when STATE.md has a verdict for each (works / works with caveat / fails), plus any edits needed to the later prompts in docs/ui-workflow/sessions.md. Make those edits.

**S2: Cleanup** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task:
> (1) In `test/editor_ux_spec.json`, mark T43–T53 as deferred ("superseded by the component catalogue and per-panel spec work"). Don't delete them.
> (2) Fix stale guidance. CLAUDE.md §3b names the fonts as Inter/Instrument Serif, but `:root` uses SF Pro, so check it and correct it. `.claude/skills/wireframe-transplant/SKILL.md` still says to install to `/Applications`; remove that and add the Editor tools (`editor_wireframe_diff`, `editor_wireframe_inventory`, `editor:coverage`). Spec item D1 says 9 placeholders, but all 11 panels now have content.
> (3) Shrink CLAUDE.md towards 200 lines. Move §3b and §4 into `docs/design-tokens.md` and `docs/app-tabs.md`, and leave a one-line pointer for each.
> (4) Commit the currently uncommitted gate files (`editor_axe_check`, `editor_icon_check`, `editor_token_drift_report`, `token_drift_history.json`, and the `editor_gates.mjs` and `package.json` changes) as their own commit. Run `npm run editor:gates` first.
> Run `npm run editor:gates` via a Haiku subagent that reports failures only.
> Done when gates pass and CLAUDE.md is at or under about 250 lines.

**S3: Token mapping** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules, including the S1 result (a). Task: create `design/tokens.json` in W3C DTCG format as the single token source.
> Seed values from `chromasmith-design/project/_ds/.../_ds_manifest.json`. Give every token a `$extensions.chromasmith.appVar` (the app's CSS variable, e.g. `--acc`) and a `role` (e.g. `action.primary`, `surface.panel`, `text.muted`).
> Cover every variable in the app's `:root` (lines 50–98), the `body.light` override (about line 1263), and the token block in `desktop/library-ui.js` (about lines 695–745).
> Where the design system and the app disagree, don't decide; list each conflict in `design/token-conflicts.md` for the user.
> Per S1 (a): match by computed value AND property role (font-size→`--fs-*`, padding/gap→`--sp-*`, radius→`--r*`) — value-only matching is ambiguous (8px = `--r`/`--sp-2`, 12px = `--fs-2`/`--sp-3`). Don't infer roles from `_ds` var names (under 10% of wireframe decls use them). Families the app has no tokens for — control heights, font weights, pill radius, on-primary text, danger-subtle, 0.15s — go in the conflicts file as "proposed new token" entries.
> Done when every app variable maps to exactly one token or is listed as a conflict, and a script check proves it.

**S4: Token generator + lint hook** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. `design/tokens.json` exists (from S3). Task:
> (1) `scripts/build-tokens.mjs` generates the `:root` / `body.light` block in `chromasmith-22.html` and the token block in `desktop/library-ui.js` between marker comments. Reuse the marker-injection pattern in `site/build-page.mjs`.
> (2) Extend `test/editor_token_check.mjs` to flag a token used in the wrong role (for example a legacy `.bpri` colour on a primary button).
> (3) Add a PostToolUse hook, `.claude/hooks/token-lint-on-edit.sh`, registered in `.claude/settings.json`. It lints only the literals the Edit ADDS (new_string minus old_string — `<style>` already has 940 raw literals, so whole-line linting reports old debt), skips `--x:` token definitions and comments, allows `1px`, confirms the edit is inside `<style>` with a string search (not a git diff; S1 (c): 0.12–0.26s vs 0.3–0.4s), and prints only violations.
> Run the gates and export harness via a Haiku subagent that reports failures only.
> Done when the first generator run is byte-identical to today's `:root` (the diff must be empty), and `npm run editor:gates` and `node test/export_harness.mjs` pass.

**S5: Surface inventory** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: `test/surface_inventory.mjs`, extending the DOM walk in `test/panel_extract.mjs`. It lists every UI surface and its reachable states and writes `design/surfaces.json`. The list covers:
> - the pages `#panel-fx`, `#panel-match`, `#panel-copy`, `#panel-collage` and `#panel-guide`
> - every `data-fxsec` section
> - the menus, popovers and overlays (`fx-view-menu`, `fx-tools-menu`, `fx-settings-menu`, `fx-overflow-menu`, `fx-split-popover`, `fx-timeline-popover`, `cs-modal`, and any others found)
> - the mobile (≤700px) sheet layout
> - Library, via `?libtest=1`
>
> For each entry record: the id, how to open it (the click steps), its states (rest, hover, disabled, empty, loaded, long text), and whether a wireframe exists.
> Done when `surfaces.json` exists and a Haiku subagent can confirm every "how to open" step actually opens its surface.

**S6: As-built capture, repeat per group** (Sonnet 5 + Haiku helpers). Run A→E, one per session.
>
> | Group | Surfaces |
> |---|---|
> | A: editor-sections | the `#panel-fx` page plus all 23 `fxsec` sections |
> | B: editor-overlays | the 6 menus, the 2 modal/confirm dialogs, the toast |
> | C: other-pages | `#panel-match`, `#panel-copy`, `#panel-collage`, `#panel-guide`, and splash — splash can't be opened in the running app (no live DOM route); use `chromasmith-design/project/Splash Screen.html` as its wireframe/as-built stand-in instead of capturing it |
> | D: mobile | the mobile sheet, in all its states |
> | E: library | Library, via `?libtest=1` |
>
> Read docs/ui-workflow/STATE.md and follow its rules. Task: capture the as-built wireframes for group **{GROUP}** (A–E per the table above) from `design/surfaces.json` (each entry now carries a `group` field, assigned by `test/surface_inventory.mjs`'s `GROUPS` map — flag any entry with `group: null` instead of guessing where it belongs).
> Write (or reuse, if it already exists) `test/surface_capture.mjs`. For each surface and state it saves `design/asbuilt/<id>/<state>.webp`, and a `spec.json` holding the element tree and computed values mapped to `design/tokens.json` names (value + property role, as in S3). Also generate a `.dc.html`-format block, the same structure as the `.tp-panel` blocks in `Editor (Developer) View.dc.html`.
> Nothing is drawn by hand. Anything that doesn't map to a token goes in `spec.json` as `unmapped`.
> You write/fix the script; a Haiku subagent runs it and reports only counts per surface, missing states and errors — never read the captures or spec files yourself beyond spot checks.
> Done when every surface in the group has captures for all its states. Add a group row to STATE.md.

**S6b: Full scenario capture** (Sonnet 5 + Haiku helpers; long; run before your triage and before S8, alone on the machine)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: extend `test/surface_capture.mjs` to capture **every combination** for every surface in `design/surfaces.json`:
> - **State:** every state the surface supports (per `surfaces.json`).
> - **Theme:** dark and light — use the app's real theme switch; read how `body.light` is set, don't guess.
> - **Width:** the viewport list in `test/editor_responsive_qa.mjs`, plus 390 (phone) and 768 (tablet) if missing. Don't invent other sizes.
> - **Sidebars:** every collapsible Editor panel/sidebar expanded and collapsed, and every Library dock state in `test/library_dock_states.mjs`. Read the real toggle functions first.
>
> **Scenario states** (extra, both themes at 1400×900 only, on the surfaces they affect): keyboard focus, pressed, modified (`.fx-mod`); portrait / landscape / panorama photos (fixtures in `test/fixtures/`, generate if missing); multi-photo batch (filmstrip + export-scope toggle); RAW loaded if a fixture exists (T11 says none — list as skipped); video loaded; masks none / one selected / several; export progress overlay, loading, error, empty; split view, 1:1 loupe, crop mode; Library empty / large / Lightroom-connected (`window.libtestLrConnect()`) / grid and list / multi-select; mobile sheet open and closed, landscape phone; browser zoom 125% and 200%, forced-colors, reduced motion; Editor rest in Playwright WebKit (see `test/editor_webkit_smoke.mjs`). Reach each state through real functions and fixtures.
>
> **Chrome surfaces first:** `node test/surface_coverage_check.mjs` lists every layout region — visible at load AND hidden-until-opened (overlays, dialogs, menus, progress bars, empty states, found from the source) — with no `design/surfaces.json` entry of its own (~80 on 2026-09-11) (Editor top bar, tool rail, docked filmstrip, Library top bar / sidebar / filters panel / status bar, phone action bar and section nav, and anything else it finds). Add each real surface as its own entry (its `selector` must be the region itself, not a page that contains it) with the steps to open it, then capture it like any other. A sub-part of a surface (e.g. `#fx-deskbar-left` inside the top bar) goes in that surface's `covers` list instead. Done only when that check passes; then remove `editor:surface-coverage` from ADVISORY_GATES in `test/editor_gates.mjs`.
> **Resizer positions are widths too:** for every surface, include the layout axes `test/editor_responsive_qa.mjs`'s LAYOUT_AXES uses (rail labels/icons; panel 220/320/440/closed; docked filmstrip 90/120/420) and the Library sidebar 150/230/420, crossed with every viewport.
>
> Rules:
> 1. Skip impossible combinations; list each with its reason in `spec.json`.
> 2. Deduplicate: hash each screenshot, store identical images once, and have `spec.json` map each combination to its image.
> 3. Full-size images go to `design/asbuilt-full/<id>/` (gitignored). Commit only `design/asbuilt/<id>/contact-<theme>.webp` (labelled grids; split if too big to read) plus the `spec.json` index.
> 4. Resumable: skip combinations that already have an image.
> 5. One run per group (A–E, the `group` field). A Haiku subagent runs each and reports only counts (captured / duplicate / skipped / failed) plus failures. After 2 failed attempts on the same failure, record it in STATE.md and move on.
> 6. Update S7's review page to show both themes' sheets per surface, including the new chrome surfaces, with the total under 255 files.
>
> Done when every surface has every possible combination captured or listed with a reason. Log totals per group in STATE.md, then commit and push.

**S6c: Re-capture, done right** (Sonnet 5 + Haiku helpers; alone on the machine; if the same failure repeats twice, stop and continue in a new Opus 5 chat)
> Read docs/ui-workflow/STATE.md and follow its rules. The as-built captures are wrong and must be redone. Verified 2026-09-11 by viewing `design/asbuilt/fxsec-grain/contact-{dark,light}.webp`: (a) Editor sections are captured closed, with only the title bar and no controls; (b) no layout variation was applied, and every cell says "expanded"; (c) cells are tiny crops with no context, on a dark sheet even for light mode; (d) 8 surfaces in `design/surfaces.json` have no captures at all. Fix `test/surface_capture.mjs`, which already has `--group`, `--id`, `--only` and `--smoke`. Reuse it; don't rewrite it.
> **0. Setup.**
> - Regenerate `test/output/panel_inventory.json` with `node test/panel_extract.mjs`. It's gitignored and may be stale.
> - Move `LAYOUT_AXES` out of `test/editor_responsive_qa.mjs` into a shared `test/layout_axes.mjs`, and import it in both scripts so they can never drift apart. Add the Library sidebar axis (150/230/420).
> - Delete the old images in `design/asbuilt/*/` except `spec.json`/`block.dc.html`; they're still in git history.
> **1. Assert before every screenshot.** Any failed assert fails the capture; never save a closed, empty or wrong-theme shot.
> - *Open:* Editor sections have a photo loaded and are expanded and switched on ("off" is its own state), and the number of visible controls equals that section's count in panel_inventory.json. Menus and dialogs: the element is visible and taller than when closed.
> - *Theme:* switch with `fxSetTheme('light'|'dark')`, then assert `body.light` matches and the page background brightness matches the theme.
> - *Layout:* after applying each axis value, assert the element's computed width equals it, and label the image with the real values (for example "1024×768 · rail=icons · panel=220").
> **2. A sensible matrix, not every combination multiplied together.** Multiplying every axis gives about 90k images, which isn't feasible. Per surface, in both themes:
> - (i) every state at 1440×900 with the default layout
> - (ii) the rest state at every viewport in the axes file, default layout
> - (iii) the rest state at 1440 and at 760 wide, for each value of each axis that changes that surface's size. The rail axis applies to the rail; the panel axis to sections and the panel; the dock axis to the filmstrip; the sidebar axis to Library surfaces. Change one axis at a time; don't combine them.
>
> Print the total image count before capturing, and if it's over 6,000, stop and report.
> **3. Two images per combination, both at full resolution.** The whole app window, for context, and a 1:1 crop of the surface with a 24px margin. Full-size images go in the gitignored `design/asbuilt-full/<id>/`, and identical images are stored once.
> **4. Readable sheets.** At most 8 cells per sheet, each at least 480px wide, with a sheet background matching the theme. Split into as many sheets as needed and commit them to `design/asbuilt/<id>/`.
> **5. Smoke test before the full run.** Capture 3 surfaces only (`fxsec-grain`, `fx-toolrail`, one Library dialog), then open their sheets yourself with Read. Fix anything wrong before capturing the rest; this is the step that saves the hour.
> **6. Full run in Haiku subagents.** One group (A–E) per subagent, one at a time, since parallel browser runs overload this Intel Mac. Each reports only counts (captured, duplicate, skipped-with-reason, failed-assert) plus the failures. Also capture anything `node test/surface_coverage_check.mjs` reports.
> **7. Audit.** Write `test/capture_audit.mjs`. Per surface it checks:
> - the image count equals the matrix minus the listed skips
> - no image is blank or near-uniform
> - each image's brightness matches its theme
> - Editor section crops are well taller than the title bar
> - labels name real layout values
>
> It prints pass/fail per surface.
> **8. Visual review in parallel Haiku subagents.** Split all committed sheets into batches of about 10, one Haiku subagent per batch (these may run in parallel since they only look at images). Each opens its sheets with Read and returns only the ones that look wrong: closed or empty, wrong theme, cut off, blank, or a mislabelled layout. You re-check each flagged sheet yourself, fix, re-capture just that surface with `--id`, and re-review it.
>
> Done when `capture_audit.mjs` passes for every surface and the visual review has no open flags. Log counts and what the review caught in STATE.md, then commit and push.

**S7c: Republish the review page** (Sonnet 5; after S6c)
> Read docs/ui-workflow/STATE.md and follow its rules. Republish https://claude.ai/code/artifact/65fe070e-5a71-455a-a2a5-3c24f0291e61 from the S6c captures.
> - **Read it first** (`action: "read"`) so its saved Keep/Redesign choices and notes are kept.
> - **Cards:** each card's main image is the full-window capture at 1440×900, with a Dark/Light toggle for the whole page, large enough to read. Clicking a card opens a gallery of all its sheets, filterable by theme, width and layout.
> - **Every surface appears**, including the 8 new ones.
> - **Publishing images:** use the publish call's `files` map, not `upload_asset`, which would mean one tool call per image. Each publish takes up to 255 files, and files left out of a later publish are kept, so publish in batches of 255 or fewer until every image is up, keeping each version under 64MB. Load the `artifact-design` skill before editing the page.
>
> Done when a single look at the published page shows light and dark full-window images for every surface. Log it in STATE.md.

**S7: Triage page** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: build one review page that shows every captured surface in `design/asbuilt/` with a Keep / Redesign / Unsure choice and a notes field. Publish it as an Artifact that saves the choices, so they persist. Then write the choices back to `design/surfaces.json` (`triage` field).
> Done when the user has made their choices and `surfaces.json` reflects them.

**S7b: Baseline + token gates** (Sonnet 5; after S6b, before S8, on a quiet machine)
> Read docs/ui-workflow/STATE.md and follow its rules. Task:
> (1) Add `node scripts/build-tokens.mjs --check` and `python3 design/verify_tokens.py` to `test/editor_gates.mjs` as blocking gates, and to `githooks/pre-commit`.
> (2) Apply `docs/ui-workflow/allowlist-audit.md`: do §1 (delete; re-record the Library icon-shape baseline first), then §2 one entry at a time (remove, re-run its gate, restore it only if it still fires). Leave §3 in place but make sure each is a backlog item in `test/editor_ux_spec.json`. Don't touch §4. Record the before/after counts in STATE.md. §5's checker fixes are out of scope here.
> (3) Run `npm run editor:gates` and `npm run ui:test` via a Haiku subagent. Record every still-failing gate or check as the known baseline in STATE.md (name and a one-line reason). From then on, "gates pass" means "no failures beyond this baseline".
> Log it in STATE.md, then commit and push.

**S8: Spec extract + generated PAIRS** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: make `design/asbuilt/<id>/spec.json` plus the wireframe the source for the Editor gates:
> (1) `test/wireframe_spec_extract.mjs` writes `design/specs/<panel>.json` from `Editor (Developer) View.dc.html` (the target design), in the same shape as the as-built specs.
> (2) Generate the `PAIRS` entries for `test/editor_wireframe_diff.mjs` (S1 (b) rule: one entry per `.grp[data-fxsec]`, else whole panel→`.fx-ctrl[data-fxsec=<key>]`, alias masks→local; keep hand-written labels; Info's info-meta/info-people groups need an explicit override). Per-control pairs need a link the wireframe doesn't have — add `data-app="#sl-heal-size"`-style attributes to wireframe controls (preferred) or match by label text; ask the user which before building. Also generate the inventory expectations for `editor_wireframe_inventory.mjs`, and behaviour-test stubs from those specs.
> (3) Point `editor:coverage` at `design/surfaces.json` instead of the 11 panels.
> Run gates via a Haiku subagent that reports failures only.
> Done when the generated `PAIRS` for the already-built panels (Retouch, Export) produce zero new mismatches compared with the hand-written ones, and `npm run editor:gates` passes.

**S9: Build-time feedback loop** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task:
> (1) Add `--panel <id> --json` to `test/editor_wireframe_diff.mjs`, outputting only `[{selector, prop, expected, actual, expectedToken}]`.
> (2) Change `.claude/hooks/stop-editor-gate-check.sh` so that, when `.claude/state/active-panel` exists, it runs that scoped diff and blocks the turn from ending while mismatches remain. Cap it at 3 blocks per panel (a counter in the state file), then let the turn end with a "stopped after 3 rounds" message.
> (3) `test/panel_pair_shots.mjs` writes one side-by-side wireframe-vs-app image per panel and state.
> Run test scripts via a Haiku subagent that reports failures only.
> Done when a deliberate 4px padding mismatch on a scratch branch triggers the block with one typed defect, clears once fixed, and gives up after 3 rounds.

**S10: Design-stage tooling** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: stop hand-written design proposals from inventing values.
> (1) `test/proposal_validate.mjs` rejects any control or value in a proposal (a `.dc.html` block or a `panels/*.compare.html` PROPOSED column) that isn't in `test/output/panel_inventory.json` or `design/tokens.json`. Run it against the old `test/panel_proposals.mjs` and confirm it catches the invented values fixed in commits `247110c`/`8eed9f0`.
> (2) Write `docs/ui-workflow/design-stage.md`, a one-page how-to for redesigning a surface marked "Redesign". It covers how to start a Claude Design canvas (the `design` skill) from the surface's as-built capture and `tokens.json`, the required state artboards, running the validator, and merging into the wireframe.
> Run the validator via a Haiku subagent that returns only the flagged items.
> Done when the validator flags the historical fabrications and passes on the current wireframe.

**S11: Component catalogue** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules, including the S1 result (d). Task: add a `?catalog=1` mode to `chromasmith-22.html`, following the `?libtest=1` pattern. It renders each shared component (`.fx-ctrl`, `.fx-row`, `.fx-toggle`, `.fx-sub`, `.fx-btn-primary`, the segmented control, `.fx-info-i`) in the states rest, hover, focus, disabled, modified (`.fx-mod`) and long label, in both themes. It can also render any single Editor panel on its own.
> Add Playwright `toHaveScreenshot()` baselines per component and state (`test/catalog_visual.mjs`), wired into `npm run editor:gates`.
> Run gates and screenshot checks via a Haiku subagent that reports failures only.
> Per S1 (d) no refactor is needed: inject the app `<style>` + real section markup, add `.sec-active` (cards are hidden without it under `body.fx-single`), call `initEditableVals()` and `selectToSeg()`, and stub inline handlers. Locate `<style>` by searching for the tag, not by line numbers.
> Done when the catalogue renders without console errors, the baselines are committed, and a 1px change to `.fx-row` padding fails the check.

**S12: Update the process docs** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Task: rewrite §1 of `docs/editor-redesign-plan.md` and `.claude/skills/wireframe-transplant/SKILL.md` for the new per-panel loop:
> 1. Set `.claude/state/active-panel`.
> 2. Read `design/specs/<panel>.json` only.
> 3. Implement.
> 4. The Stop hook's typed diff blocks the turn from ending until mismatches are fixed.
> 5. Run `panel_pair_shots`.
> 6. A fresh-context reviewer subagent checks against the spec.
> 7. Commit the design, implementation and tests separately.
>
> Add the per-panel prompt template (S13) to `docs/ui-workflow/sessions.md`.
> Done when both files describe only tools that exist. Verify each named script runs (one Haiku subagent runs them all and reports which fail).

**S13: Per-panel build, repeat per panel; pilot = Masks** (Sonnet 5, high effort; switch to Opus 5 in a new chat after 2 failed rounds)
> Read docs/ui-workflow/STATE.md and follow its rules. Build the **{PANEL}** panel.
> (1) `echo {PANEL} > .claude/state/active-panel`.
> (2) Read only `design/specs/{PANEL}.json` and the matching `chromasmith-22.html` section (use grep to find it; never read the whole file).
> (3) Implement by moving the existing markup, not rewriting it.
> (4) Let the Stop hook's diff drive the fixes. Full `npm run editor:gates` runs go to a Haiku subagent that reports failures only.
> (5) Run `node test/panel_pair_shots.mjs --panel {PANEL}`, and have a fresh-context Opus reviewer subagent compare the images with the spec.
> (6) Commit the implementation and tests separately, then delete `active-panel`.
>
> Record in STATE.md: rounds used, reviewer findings, and anything the spec got wrong.

## Model per session
Relative cost per token: Haiku 4.5 = 1×, Sonnet 5 = 2×, Opus 5 = 5×, Fable 5.1 = 10×.
Pick the model when a session starts. Switching mid-session makes the whole conversation be re-read at full price, because the saved (cached) context only works for the model that built it.

| Phase | Main session | Helpers (subagents) | Session |
|---|---|---|---|
| Spike | Opus 5, high effort | Haiku to run scripts and summarise output | New; its findings go into STATE.md |
| Step 1: pause gates, fix stale docs | Sonnet 5 | none | New, short |
| Step 2: token bridge | Opus 5 for the role mapping, then Sonnet 5 for the generator script | none | New |
| Phase 0: inventory and capture | Sonnet 5 writes the scripts | Haiku runs the captures and reports counts | New; one session per surface group |
| Step 3: spec extract and generated `PAIRS` | Opus 5 | Haiku for gate runs | New |
| Step 4: typed diff and Stop hook | Sonnet 5 | none | New |
| Step 5: design stage | Opus 5; Fable 5.1 only for a whole-surface redesign where Opus has already fallen short | none | New, per surface |
| Step 6: catalogue page | Opus 5 (large-file surgery) | Haiku for gate runs | New |
| Per-panel build (after Step 4) | Sonnet 5, high effort; switch to Opus in a new session after 2 failed rounds | Opus fresh-context reviewer; Haiku for gates and screenshots | One panel per session |

