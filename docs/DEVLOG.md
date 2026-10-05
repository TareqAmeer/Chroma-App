# 📖 DEVLOG
Agent-generated changelog of completed features and architectural decisions.

- CHR-7: Centered shared ask/confirm dialogs used by delete photos, create album, and related pop-ups.
- Updated `chromasmith-22.html`; focused editor HTML validation passed.
- Full UI audit remains blocked by missing `test/fixtures/portrait.png` in the existing worktree.

- CHR-142: Removed the above-100% pan clamp so an enlarged photo can be moved freely in every direction.
- Added `test/editor_pan_check.mjs` and the `editor:pan-check` script; it verifies unconstrained high-zoom pan and preserved sub-100% centering.
- Updated `chromasmith-22.html` and `package.json`; `npm run editor:pan-check` and `npm run editor:fast-check` pass.

- CHR-140: Added persistent labels above every Library filter dropdown so filter purpose is visible before opening controls.
- Updated `desktop/library-ui.js`; syntax and library-content lint pass. Full browser gates remain environment-blocked by desktop staging and Playwright launch permissions.

- CHR-145: Styled the Library thumbnail zoom slider with a square thumb and consistent track across Chromium and Firefox.
- CHR-146: Kept the Library zoom slider visible when the desktop toolbar enters its first overflow state, shrinking the track and removing only its step buttons and flags.
- Updated `desktop/library-ui.js`; the cause was responsive overflow CSS hiding the whole zoom row. No automated tests were run.

- CHR-122: Refined the desktop splash composition with the approved desaturated photo, vertical app/version labels, and live loading percentage within the orange card.
- Updated `chromasmith-22.html`, the splash reference spec/wireframe, and packaged photo assets; `npm run build` succeeded and the app was installed. Visual rendering was not independently screenshot-verified.
- Added the mandatory completion workflow in `AGENTS.md`: scoped commit/push to `main` and a Linear update that leaves tickets In Review.

- Added the `Redesign Ideas/` reference folder with two design specs, two HTML concepts, and two screenshots for future redesign work.
- No implementation or verification changes were made; this commit only adds design reference files.

- CHR-139: Moved the open Library filters row beneath the top bar so it stays visible while photos scroll, and centered it over the photo area.
- Updated `desktop/library-ui.js` and `test/wireframe_behaviour.mjs`; focused browser checks passed at 1440px and 820px, and Library content lint passed. The full responsive and editor gate runs stalled and were stopped.

- CHR-151: Reshaped the mobile editor around the photo with Snapseed-style top actions, quick tools, and Looks / Tools / Export navigation.
- Updated `chromasmith-22.html` with a categorized mobile tool grid and kept its selections connected to the existing editing sheets.
- Verified phone photo loading, category filtering, tool selection, navigation bounds, HTML validity, and section registry; broad editor/UI gates still report unrelated baseline findings.

- CHR-138: Bounded web libraw worker decoding at 45 seconds per attempt and terminate stalled workers so 48MP ProRAW imports report a clear error instead of hanging indefinitely.
- Updated `chromasmith-22.html` and `docs/raw-dcp.md`; added `test/raw_decode_timeout.mjs` for the stalled-worker and successful-decode paths.
- Verified the timeout test in cross-origin-isolated Chromium, format/origin lint, and `git diff --check`; the reported 48MP DNG was unavailable for a real-file decode check.

- CHR-152: Rebuilt the home page as eight viewport-sized, benefit-led chapters with eased one-chapter wheel paging, touch snapping, a changing CHRO-MA rail, numbered navigation, and a comparison control.
- Updated `index.html`, `site/build-page.mjs`, site assets and documentation; recorded 28 animation and product-page research takeaways in `site/animation-research.md`.
- Verified desktop, laptop, tablet and phone layouts, chapter paging, images, comparison keyboard input, and accessibility with `test/homepage_smoke.mjs`; the original photographs and founder portrait/copy remain explicit placeholders.

- CHR-152: Increased home page letter spacing by 0.02em across body copy, headings, the CHRO-MA rail, and small labels in `index.html`.
- Verified the updated typography visually on desktop and phone and reran `test/homepage_smoke.mjs` across six viewport sizes.

- CHR-152: Removed number-and-subheading labels from all chapters, limited the right index to neighboring pages with a top arrow, widened the left wordmark, and applied bundled Gramatika to every text element in `index.html`.
- Added beta chapters for video editing, astro stacking and two-photo panorama, plus 100 expandable feature descriptions; recorded 20 proposals in `site/less-powerpoint-ideas.md` and updated `site/README.md`.
- Verified ten chapters across six viewports, the feature directory's independent scroll and disclosures, navigation, font loading, images and accessibility with `test/homepage_smoke.mjs`.

- CHR-152: Carried one temporary repository photograph through Gallery, Studio, Click and Film with distinct layouts, chapter-specific motion and a shared-image transition; the before/after slider now compares the original with a real Chromasmith export.
- Updated `index.html`, `site/assets/manifest.json`, `site/assets/story/`, `site/render-story-photo.mjs`, `site/build-page.mjs`, `site/README.md`, `site/awwwards-motion-research.md` and `test/homepage_smoke.mjs`.
- Verified the app render, six viewport layouts, image continuity, mid-transition layer, real comparison, keyboard input and accessibility with `node test/homepage_smoke.mjs --shots --layout`; inspected desktop and mobile screenshots.

- CHR-152: Replaced abrupt wheel paging with gesture-following scroll and an interruptible spring settle; replaced the photo handoff with a five-strip shutter and added reversible scroll motion to Gallery, Studio, Click, Film, Anywhere, Guy and beta cards.
- Reworked `index.html` into a contact sheet, open editor, full-bleed comparison and print-like Film sequence; expanded `site/awwwards-motion-research.md`, updated `site/README.md`, and added `test/homepage_motion_probe.mjs`.
- Verified six viewport layouts, navigation, images, comparison, feature disclosures and accessibility with `test/homepage_smoke.mjs`; the motion probe recorded 43 moving frames, a 120px maximum step and a 17ms 95th-percentile frame gap.

- CHR-169: Implemented all 20 approved mobile improvements: responsive/accessibility controls, tool/look discovery, compare/precision/masking, per-photo queue and atomic autosaves, named versions, collections, persistent Trash, explicit export destinations/receipts/retry and portable project backup/restore/desktop handoff.
- Updated `chromasmith-22.html`, `mobile/*`, native Android/iOS configuration, dependencies, desktop asset staging, `test/mobile_ux.mjs` and the mobile CI workflow; mobile version 1.2.0/build 3. Chromium and WebKit acceptance flows, shared UI audit and 18/18 export goldens pass.
- Full Editor gates were run; existing snapshot-list, wireframe/inventory and related baseline failures remain (snapshot/surface findings also reproduced on unmodified main). Release and device-test checklist: `docs/mobile-release-1.2.md`; issue remains In Review for user testing.

- CHR-169: Validation follow-up for mobile 1.2.1/build 4: preserve outgoing edits and undo history after failed decode, retain a usable failed-save Retry, prevent same-name Files exports from overwriting, preserve Blob bytes and report actual single-file native results.
- Updated mobile library/export/dialog/project modules, mobile CSS, shared native save helper, native versions, release notes and mobile/desktop release workflows; added `test/mobile_edge_cases.mjs` for recovery, selective sync, legacy recipes, partial exports, real brush/erase, deletion and keyboard focus.
- Verified 64 mobile acceptance/edge-case groups in Chromium and WebKit, zero uncaught runtime errors, shared UI audit with zero findings, HTML validity, JS syntax and diff checks. Full Editor gates completed with 11 existing/design-baseline failures; native-device permissions, signing/install and VoiceOver/TalkBack remain for user testing. Issue stays In Review.

- CHR-169: Verified the downloaded v1.2.1 APK/IPA contain the exact released HTML/mobile modules/fflate, BUILD 1.1002V and native version 1.2.1/build 4; packaged recovery/export checks pass in Chromium and WebKit. Mobile CI passes all 64 groups and export regression CI passes.
- Fixed `test/mobile_edge_cases.mjs` to read requested files before sending response headers, so a missing optional asset returns 404 instead of terminating package validation. Production release assets are unchanged; issue remains In Review for real-device testing.

- CHR-273: Added durable per-photo batch paste/selective paste/All FX jobs with progress/results, cancellation, restart recovery, failed-photo selection/retry, and whole-batch undo that preserves later edits and virtual copies. Selective paste now merges against each destination and its previously broken picker decoder is fixed.
- Updated `desktop/library-ui.js`, `chromasmith-22.html`, `desktop/src-tauri/src/{recipe_batch,library,main}.rs`, `package.json`, and batch tests; atomic sidecar/registry writes, compact history summaries, and one registry update per job avoid partial writes and quadratic batch overhead. Amended `AGENTS.md` to carry user authorization across the open-ticket queue without repeated approvals.
- Verification: seven helper regressions pass; a real 5,000-photo disk test verified every persisted recipe, and native sidecar/virtual-copy suites pass. Full Editor gates still fail on existing design/token/accessibility checks; snapshot-list baseline comparison produces the same two findings on unchanged origin/main and this change.
