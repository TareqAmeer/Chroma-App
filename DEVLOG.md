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
