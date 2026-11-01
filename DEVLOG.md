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

- CHR-152: Rebuilt the home page as eight scrolling, benefit-led chapters with a changing CHRO-MA rail, numbered navigation, a comparison control, and reduced-motion behavior.
- Updated `index.html`, `site/build-page.mjs`, site assets and documentation; recorded 28 animation and product-page research takeaways in `site/animation-research.md`.
- Verified desktop and phone layouts, chapter navigation, images, comparison keyboard input, and accessibility with `test/homepage_smoke.mjs`; the original photographs and founder portrait/copy remain explicit placeholders.

- CHR-113, CHR-115, CHR-116, CHR-117: Corrected mobile preview fit within canvas padding, removed phone value underlines, enabled vertical sheet scrolling over sliders, and refreshed slider visuals after section resets; also fixed an editor script syntax error that prevented the page from starting.
- CHR-114: Confirmed the current phone tool sheet sits directly beneath the preview controls, replacing the spaced layout shown in the ticket.
- Updated `chromasmith-22.html` and `test/editor_wireframe_behaviour.mjs`; all five focused phone checks and HTML validity passed. The broader UI audit and editor gates still report separate existing findings.

- Promo v12 director's cut: reviewed the supplied v11 script/film and created a separate 72-second 1080p/30 fps film with all nine requested corrections and 20 additional improvements; source, photo bakes, original hopeful score and verification reports are in `.claude/worktrees/quizzical-brattain-587cce/promo/video/motion-cut-v12/`, with the script at `promo/script-v12-directors-cut.md` in that worktree.
- Verification: 2160 frames decode successfully; browser rendering reported no errors; cursor/slider alignment, enabled toggles, 65mm and final tagline checks pass; encoded audio measures -14.25 LUFS / -0.97 dBTP. Linear issue ID unresolved: searches found no unique matching promo issue. Publication stopped because the production worktree is on `promo-v11` (current chat checkout `codex/browser`), not `main`; no commit, push or unrelated issue update performed.


### 2026-10-05 — Chromasmith promo V13
- Rebuilt the promo as a new 60-second “Keep the moment” script and Canvas motion film, with new score, photographic transitions, native control mechanics and a 100-point critique; files: promo/script-v13-keep-the-moment.md and promo/video/keep-the-moment-v13/ in the production checkout.
- Verified the 1080p30 master decodes all 1800 frames; renderer reports no errors; encoded audio measures −13.85 LUFS and −0.99 dBTP.
- Linear issue: no unique matching issue found. Publication blocked by non-main branches (codex/browser and promo-v11); no commit, push or unrelated issue update performed.


### 2026-10-05 — Chromasmith promo V14 photographic treatment
- Added three authorized temporary online photographic references, a new emotional opening with aperture reveals, a wider closing gallery and timed audio accents; files: promo/script-v14-keep-the-feeling.md and promo/video/keep-the-feeling-v14/ in the production checkout. Source URLs, photographers and original replacement briefs are recorded in image-sources.json.
- Verified the 60-second 1080p30 master decodes all 1800 frames without renderer errors; encoded audio measures −13.75 LUFS / −0.99 dBTP. Reviewed sampled opening transitions, gallery and master contact frames.
- Linear issue: no unique matching promo issue found after search. Required publication remains blocked by non-main branches codex/browser and promo-v11; no commit, push or unrelated issue update performed.


### 2026-10-05 — Chromasmith promo V15 photographic zine
- Reworked every promo composition to a denser photographic publication direction: printed contact sheets, ink/newsprint/orange graphics, quick cuts, receipt-like export and a full-photograph ending. Files: promo/script-v15-photo-zine.md and promo/video/photo-zine-v15/ in the production checkout; retained genuine effect renders, source credits and native control mechanics.
- Verified the final 1080p30 master decodes all 1800 frames without renderer errors; sampled control checks retain enabled toggles, 65mm and exact final tagline. Audio measures −13.75 LUFS / −0.99 dBTP. Reviewed master contact frames and corrected a workflow caption collision.
- Linear issue: search found no unique matching promo issue. Required publication remains blocked by non-main branches codex/browser and promo-v11; no staging, commit, push or unrelated issue update performed.

### 2026-10-05 — CHR-274 AI mask refinement controls
- Added non-destructive Feather and Edge settings for raster AI subject/skin/coat masks, derived from the preserved authored selection and shared by preview and tiled export; reset returns to the exact source mask.
- Kept the guided-filter action for AI masks, invalidated derived controls when SAM produces a new selection, and added `test/mask_refinement_math.mjs` for growth, contraction, feathering and exact reset.
- Verified refinement math (5 checks), editor HTML validity and `git diff --check`. The Playwright raster round-trip suite could not launch because Chromium is not installed in this checkout; labelled hair/foliage fixtures and halo thresholds are still needed for the issue's quality claim.

### 2026-10-08 — CHR-201/202 native destination validation (local, unpublished)
- Built current `origin/main` in a clean Codex integration checkout and exercised the actual Tauri/WebView2 flow with 20 fixture photos and three recipes. All 60 non-empty files were written to their configured recipe folders, and the original export destination was restored. Browser collision/retry and 60-output test passes are from earlier current-main runs, not rerun in this checkout.
- Still open: mixed-format native Match Source, offline-source behavior, and native failed-write retry/no-duplicate recovery. The note is local only: ACL denied writes/commit in the integration checkout, and `git ls-remote` failed with `getaddrinfo() thread failed to start`; nothing from this validation has been published. CHR-201 and CHR-202 remain In Progress.
- Files: this working copy's `DEVLOG.md` only; no product source changed.