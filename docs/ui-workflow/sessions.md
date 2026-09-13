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
> **2. Scope: desktop only, about 220 images in total. The user will review these by eye, so keep it small.** Every shot has a photo loaded, in both **dark and light**. No phone or tablet sizes, no hover or other states, and nothing multiplied together. Window widths are only **760** (the desktop minimum) and **1920** (the maximum).
> - **Whole-window shots (the core set).** At both window widths × both themes, capture the default layout plus, one change at a time:
>   - tool rail: narrow, full, hidden
>   - tool panel: 220, 440, closed
>   - docked filmstrip: 90, 420, closed
>
>   That's 10 layouts × 2 widths × 2 themes = 40 shots. The top bars are judged from these at their narrowest (760) and widest (1920). Do the same for the Library full view with its sidebar at 150, 420 and hidden (use its real "Show sidebar" option), plus the default: 16 shots.
> - **Editor sections:** each section open and switched on, 1920 wide, panel at 220 and at 440, both themes. That's 4 shots per section.
> - **Menus, dialogs, overlays and other surfaces:** each open once per theme, at the default layout, 1920 wide.
>
> Print the total before capturing; if it's over 300, stop and report. Clipping at in-between widths is covered by the automated layout tests (`editor_responsive_qa.mjs`), not by images.
> **3. Images.** Whole-window shots are the review images. For sections, menus and dialogs, also save a 1:1 crop of the surface with a 24px margin. Everything at full resolution. Full-size images go in the gitignored `design/asbuilt-full/<id>/`, and identical images are stored once.
> **4. No contact sheets.** At this size every image is shown individually. Commit the images, compressed, to `design/asbuilt/<id>/` with their labels in `spec.json`.
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

**S6d: Capture the 56 hidden surfaces** (Sonnet 5 + Haiku helpers; alone on the machine; if the same failure repeats twice, stop and continue in a new Opus 5 chat)
> Read docs/ui-workflow/STATE.md and follow its rules. `node test/surface_coverage_check.mjs` now fails with 56 surfaces that were counted as covered but never captured open:
> - **46 `COVERS_HIDES_SURFACE`:** an id listed in a parent's `covers` that is hidden or absent when the parent is shown. Examples: crop, mask, guides and brush overlays; the before/after split line; the multi-photo filmstrip; the video strip; the background menu; the history list; the Library sort and view menus; the empty Library; the batch bar; the review grid; the offline bar.
> - **10 `NOT_CAPTURED`:** marked unreachable with no images. These are the Library info panel, compare view, 5 Library dialogs, the import bar and `lib-grid`.
>
> `node test/capture_audit.mjs` fails on the same 10. Run `node test/surface_coverage_check.mjs --json` for the exact list; it's the only to-do list.
> Task, for each item:
> 1. **Decide how it's captured.** Either it becomes its own surface in `design/surfaces.json` (`selector` = the element itself, plus `openSteps`), or a **named state** of its parent whose `openSteps` make it visible (for example `library` with state `empty`, or `fx-deskbar` with state `history-open`). Remove it from `covers` either way. `covers` is only for parts visible whenever the parent is.
> 2. **Find the real way to open it.** grep for the function or button that shows it and read that code. Ways to try:
>    - the app's own buttons and keyboard shortcuts: click the real control (`#lib-info-btn` / I for Info, `#lib-compare-btn` / C for Compare) rather than calling closure-local functions
>    - the libtest mocks: `?libtest=1`, `window.libtestLrConnect()`
>    - fixtures in `test/fixtures/`: several photos, a video, an empty library
>    - `page.route` to simulate offline or slow network
>    - for dialogs only triggered by a backend flow, find the function that builds the dialog and call it with realistic arguments
>
>    "Ran out of time" is not a reason to mark something unreachable.
> 3. **If it truly can't be opened** after both approaches, leave `unreachable` with the exact reason, and list it in STATE.md under "Needs user approval to skip". Don't set `approvedBy` yourself; only the user approves. The gate stays red until they do.
> 4. **Capture only the new surfaces and states** with `test/surface_capture.mjs --only=<ids>`, using the S6c scope: desktop, photo loaded, both themes, 1920 wide at the default layout; add 760 wide only for bars that stretch with the window. Don't re-capture existing surfaces. A Haiku subagent runs it and reports failures only. Open 3 of the new captures yourself with Read to confirm they show the thing open.
> 5. **Update the review page** (https://claude.ai/code/artifact/65fe070e-5a71-455a-a2a5-3c24f0291e61; read it first so saved choices are kept):
>    - Add the new cards.
>    - Put a line at the top: "N of M surfaces captured", with every uncaptured one listed and its reason, so a gap is never silent again.
>    - Mind the platform's 256-file cap per artifact (see the S7c log); use the Crops artifact for crops.
>
> Done when `node test/surface_coverage_check.mjs` and `node test/capture_audit.mjs` both pass, or fail only on items listed in STATE.md as waiting for user approval. Log counts in STATE.md, then commit and push.

**S7c: Republish the review page** (Sonnet 5; after S6c)
> Read docs/ui-workflow/STATE.md and follow its rules. Republish https://claude.ai/code/artifact/65fe070e-5a71-455a-a2a5-3c24f0291e61 from the S6c captures.
> - **Read it first** (`action: "read"`) so its saved Keep/Redesign choices and notes are kept.
> - **Cards:** first a **Layouts** section with the 56 whole-window shots, grouped by layout (default, rail narrow/full/hidden, panel 220/440/closed, filmstrip 90/420/closed, Library sidebar), with the 760 and 1920 shots side by side. Then one card per surface. A page-wide Dark/Light toggle switches every image. Images are shown large enough to read, and clicking opens full size. About 220 images fits a single publish (255 files or fewer).
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

**Before S8:** S6c, S7c and **S7b** must be done. S7b records the known-failing baseline in STATE.md. Every "gates pass" below means **no failures beyond that baseline**.

**S8: Wireframe → spec → generated gate wiring** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules (the S1 (b) result and the S7b baseline).
> Facts verified 2026-09-11, so don't re-derive them:
> - The Editor wireframe (`chromasmith-design/project/Editor (Developer) View.dc.html`) has 11 `.tp-panel[data-panel]` blocks: adjust, color, crop, detail, export, film, frame, info, looks, masks, retouch.
> - 17 of its `.grp` elements carry a `data-fxsec`. Two of those, `info-meta` and `info-people`, are NOT app sections.
> - Wireframe `masks` = app `local`.
> - `PAIRS` is a hand-written object near the top of `test/editor_wireframe_diff.mjs` (grep `const PAIRS`).
> - Wireframe controls carry no ids.
>
> Task:
> (1) **Link wireframe controls to app controls exactly, never by label text.** Add a `data-app="<app css selector>"` attribute to every wireframe control that has an app counterpart. Take each selector from `test/output/panel_inventory.json` (regenerate it first with `node test/panel_extract.mjs`). A wireframe control with no app counterpart gets `data-app="none"` plus a `data-note`, and is listed in STATE.md.
> (2) Write `test/wireframe_spec_extract.mjs`. It writes `design/specs/<panel>.json` from the wireframe: element tree, computed values, each value's token (value + property role, the way `design/tokens.json` roles are matched in S3), and `data-app` links. Use the same field names as the S6c `design/asbuilt/<id>/spec.json` files; open one and copy its shape, don't invent one.
> (3) Generate `PAIRS` (S1 (b)'s rule, keeping the hand-written labels) and the per-control pairs (from `data-app`) into a generated file that `editor_wireframe_diff.mjs` imports. Do the same for the inventory expectations in `test/editor_wireframe_inventory.mjs`. Behaviour-test stubs go in a new file, not in the existing 1003-line suite.
> (4) Make `test/editor_coverage.mjs` report one row per surface in `design/surfaces.json` (has a wireframe? spec generated? pairs generated?). Surfaces without a wireframe show as "no design yet" and don't fail anything.
>
> Haiku subagents run gates and report failures only.
> Done when the generated section-level `PAIRS` for Retouch and Export are identical to the hand-written ones (print the diff: zero fields changed), per-control pairs exist for every `data-app` link, and `npm run editor:gates` has no failures beyond the baseline.

**S9: Build-time feedback loop** (Sonnet 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Facts:
> - A full `node test/editor_wireframe_diff.mjs` run takes about 21s on this Mac (measured 2026-09-11).
> - `.claude/state/` is gitignored.
> - `.claude/hooks/stop-editor-gate-check.sh` already rebuilds `desktop/dist` and runs the snap and html checks when the UI files are uncommitted.
>
> Task:
> (1) Add `--panel <id> --json` to `test/editor_wireframe_diff.mjs`. It outputs only `[{selector, prop, expected, actual, expectedToken}]` for that panel's generated pairs; `expectedToken` comes from `design/specs/<panel>.json`.
> (2) Extend the Stop hook. When `.claude/state/active-panel` exists:
>    - Run the scoped diff and exit 2 with the JSON list while there are mismatches.
>    - Skip the run only when the same panel and `chromasmith-22.html` hash previously passed. A failed hash is never cached as clean.
>    - After 3 failed rounds, retain the complete report under `.claude/state/`, say that human attention is required, and continue returning failure until the mismatch is resolved or accepted through the reviewed-baseline process.
> (3) Write `test/panel_pair_shots.mjs --panel <id>`. It writes wireframe and app side by side, in both themes, for the rest state and any other state the wireframe itself defines (read which it has; a static wireframe may only have rest).
>
> Test on the real file, then restore it with `git checkout -- chromasmith-22.html`; never commit the planted change.
> Done when:
> - a planted 4px padding mismatch in the Retouch panel blocks the turn with exactly one typed defect
> - removing it clears the block
> - planting it again three times continues to fail with the human-attention message and retained report
> - an unchanged-file turn skips the diff

**S10: Design-stage guardrails** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules. Facts:
> - Commits `247110c` ("fix substantial fabrication") and `8eed9f0` ("fix invented colours and wrong real-control values") show what invented values look like in `test/panel_proposals.mjs`; `git show` them.
> - S1 found the approved wireframe itself is mostly literal values, and about a third of them match no app token.
>
> Task:
> (1) Write `test/proposal_validate.mjs <file>`, which runs on a `.dc.html` block or a `panels/*.compare.html` PROPOSED column.
>    - **Hard fail:** a control whose label, kind or range doesn't match `test/output/panel_inventory.json`, or a colour that isn't a `design/tokens.json` value.
>    - **Report only:** spacing, size or radius values that aren't tokens. Show them, but don't fail on them.
>
>    Run it on the version of `panel_proposals.mjs` from just before each of the two commits, and confirm it flags what those commits fixed.
> (2) Read the `design` skill first, then write `docs/ui-workflow/design-stage.md`: a one-page how-to for redesigning a surface marked "Redesign". It covers starting a canvas from that surface's S6c captures and `tokens.json`, the required state artboards, running the validator, and merging into the wireframe with `data-app` links (S8). Describe only what the `design` skill actually supports; if it can't import something, say so rather than assume.
>
> Done when the validator flags the historical fabrications, and its report on the current wireframe is written to STATE.md, with any hard failures listed for the user.

**S11: Component catalogue** (Opus 5)
> Read docs/ui-workflow/STATE.md and follow its rules, including S1 (d).
> Facts: the shared component classes in the app are:
> - `.fx-ctrl` (section card)
> - `.fx-row` (slider row)
> - `.fx-toggle`
> - `.fx-sub`
> - `.btn.fx-btn-primary`, used once; the older `.bpri` is still used by 10 elements, so include both
> - `.seg`, the segmented control built by `selectToSeg(selectId, segId)`, which sets `.on` on the active option
> - `.fx-info-i`
> - `.fx-mod`, the "changed" state
>
> Task: add a `?catalog=1` mode to `chromasmith-22.html`, following the `?libtest=1` pattern. Per S1 (d), no refactor: reuse the app's own `<style>` (find it by searching for the tag) and real section markup, add `.sec-active` (cards are hidden without it under `body.fx-single`), call `initEditableVals()` and `selectToSeg()`, and stub inline handlers.
> - Show each component in these states: rest, hover, focus, disabled, modified and long label, in both themes.
> - Also support `?catalog=1&panel=<fxsec>` to show one section on its own.
>
> Write `test/catalog_visual.mjs` as a Playwright test with `toHaveScreenshot()` per component and state. Add it to `testMatch` in `playwright.config.mjs`; the config only runs files that match there. Add it to `test/editor_gates.mjs`. Baselines are per-platform (Playwright adds the OS to the file name); commit this Mac's, and note in STATE.md that CI needs its own.
> Done when the catalogue has no console errors, the baselines are committed, and a planted 1px `.fx-row` padding change fails the test (then revert it).

**S12: Step 12 documentation update**
> Use a new chat for this documentation task. Read only the requested ranges in `docs/ui-workflow/STATE.md`, `docs/ui-workflow/sessions.md`, `docs/editor-redesign-plan.md`, `.claude/skills/wireframe-transplant/SKILL.md`, `CLAUDE.md`, the component registry/contract/reference workflow READMEs, and package scripts. Update the canonical per-component/per-panel process and this S12/S13 guidance. Keep the workflow vendor-neutral, preserve Step 3b's every-width rule, change the upcoming pilot to Color, and retain Masks as historical evidence. Verify all paths and commands that the changed process names; run the focused documentation checks. Use no more than 5 percentage points of the five-hour usage allowance; check usage before work and before optional work. Stop if a documented process conflicts with an executable command; report the conflict instead of inventing a replacement.

**S13: Per-panel implementation, repeat per panel; pilot = Color**
> Use a new chat for this Color implementation. Every component-contract review, reference analysis, implementation, and independent review also gets its own new chat. Read `docs/ui-workflow/STATE.md` and follow its current process; earlier Masks work remains historical workflow evidence and does not change this pilot. Identify the Color component family and every affected declaration with `scripts/query-components.mjs`, then run `npm run components:check` before editing. Read only the relevant family contract. If a visual reference is involved, create its reference specification, resolve open questions, and obtain approval before implementation. Record the active panel in this task's prompt or notes. Read only the approved panel/reference spec and the grep-located production section. Implement with existing markup and shared components. Run the focused typed diff and panel checks, capture the panel pair, and request review in a separate fresh chat with no implementation context beyond the approved spec, affected files, and validation evidence. Rerun the registry and focused validations; record rounds, review findings, closed backlog items, and spec corrections in STATE.md. Commit implementation and validation evidence separately when appropriate. Use no more than 5 percentage points of the five-hour usage allowance; check usage before work and before optional work. Do not run unrelated gates or broaden the panel scope.

**S13-chrome: App frame fixes** (Sonnet 5; one run, after S9)
> Same loop as S13, for the items that aren't a panel: T55 (tool rail 64px; the mismatch appears in light mode only, so find out why first), T56 (tool panel 300px, probably the same cause), T58 (photo preview cut off at a 700px window), T59 (Library thumbnails cut off at 640px with a 420px sidebar) and T57 (square / original-size thumbnails; read its note first). `editor_responsive_qa.mjs` and `library_responsive_qa.mjs` must stay clean, and each item's allowlist entry is removed when it's fixed.

## Model per session
Use one new chat for each component contract, reference analysis, implementation, and independent
review. Every task prompt must state an explicit five-hour usage cap and require a usage check
before work and before optional work. Keep review independent: its only implementation context is
the approved specification, affected files, and validation evidence.

Optional model guidance is role-based: Luna for deterministic checks and small documentation
changes; Terra for bounded implementation; Astra only for difficult visual interpretation or
unresolved review. Do not require subagents or a particular vendor's helper feature.
