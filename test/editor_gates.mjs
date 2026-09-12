// Runs every Editor-side design gate in one call, with a compact PASS/FAIL table.
//
// WHY THIS EXISTS
// The Editor gates were all reachable (`npm run editor:wireframe-test`, `editor:inventory`,
// `editor:responsive-test`) but NONE of them was in `npm test` — the only thing that ran them
// was the pre-commit hook, and only for a commit that happened to stage chromasmith-22.html.
// So the ordinary "did I break anything" command reported green while every Editor design check
// sat unrun. That is the same shape as the failure this repo has already paid for: a gate that
// exists, is believed to be enforcing, and isn't (CLAUDE.md's wireframe-fidelity note,
// HANDOVER_EDITOR.md §0 on the regressions-only diff that always exited 0 on a clean checkout).
//
// ⚠️ E7 (editor_ux_spec.json) — [light/photo] colour reads on #fx-deskbar descendants
// intermittently returning the DARK theme's colour — ROOT-CAUSED AND FIXED 2026-09-10, by live
// instrumentation of a real failing run rather than more theorizing: two prior "fixes" (a boot-
// watchdog grace widen, then removing the watchdog race entirely for `?libtest=1`) both turned
// out to target the wrong mechanism — `document.body.classList.contains('lib-full')` was
// confirmed FALSE in every reproduced failure, ruling out the Library-takeover theory those
// fixes were built on. The actual cause: test/wireframe_diff_lib.mjs's settleForCapture()
// injects `transition-duration:0s` to stop future transitions, but per the CSS Transitions spec
// that does not retroactively cancel one already running — toggling body.light starts a real
// ~120ms CSSTransition on #fx-deskbar's inherited `color` (confirmed live via
// `document.getAnimations()` showing one `running`, present in every reproduced failure, absent
// in every pass), and reading computed style while it's still interpolating can return any
// intermediate value. Fixed by having settleForCapture() call `.finish()` on every in-flight
// Animation, not just block new ones — see that function's own comment for the full repro
// method. Verified: 17 consecutive real runs (not the retry loop below — a fresh, separate
// `node test/editor_wireframe_diff.mjs` invocation each time) after the fix, 0 recurrences,
// versus a same-length pre-fix sample where it reproduced on roughly a third of runs.
// FLAKE_RETRIES is kept, deliberately smaller than before: a residual safety margin for timing
// noise this specific tool hasn't been proven immune to over a much larger sample, not a
// workaround for a known-unsolved bug any more. If this ever fails even once now, that is a
// real signal worth reading, not something to retry away.
//
// ⚠️ STALE-BUILD GUARD (added 2026-09-10, found while auditing the test tooling itself): every
// gate below loads desktop/dist/index.html, a STAGED COPY that build-desktop.sh generates from
// chromasmith-22.html + desktop/library-ui.js. This script used to run every gate straight
// against whatever was already in desktop/dist/ — so `npm test` (which calls this) could report
// PASS or FAIL against code from a previous session's build, silently ignoring every edit made
// since. test/verify.py already rebuilds before its gates; this was the one entry point that
// didn't, and it's the one wired into `npm test` and the pre-commit hook. Now this always runs
// build-desktop.sh first and fails loudly (before any gate) if the build itself is broken,
// rather than letting every gate below quietly grade stale HTML.
import { spawnSync } from 'node:child_process';

const build = spawnSync('bash', ['build-desktop.sh'], { encoding: 'utf8' });
if (build.status !== 0) {
  console.log('BLOCKED: build-desktop.sh failed — cannot verify against stale desktop/dist/.');
  console.log((build.stdout || '') + (build.stderr || ''));
  process.exit(1);
}

const FLAKE_RETRIES = 2; // reduced from 6 now that E7's real cause is fixed — see the comment above
// T21 (editor_ux_spec.json): retries are a targeted workaround for E7's specific, documented
// timing flake in editor:wireframe-diff — NOT a default reliability blanket. Every other gate
// below runs with implicit `retries: 1` (no retry) on purpose, including editor:snap-check/
// editor:html-check/editor:self-reschedule-check/editor:native-gate-check, which are pure
// static/DOM-structure scans with no known timing flake. Adding `retries` to a new gate should
// require its OWN documented, understood flake (like E7's), not be a reflexive copy-paste.
// T13 (editor_ux_spec.json): theme (light/dark) is exercised only by editor:wireframe-diff's own
// loop. editor:inventory/snap-check/html-check never vary by theme, which is fine today — theme
// is style-only and doesn't change DOM structure — but would stop being fine if a future change
// made something theme-conditional in the DOM itself (not just CSS), so this is a known,
// accepted gap rather than a silent assumption.

// ⚠️ ADVISORY MODE (added 2026-09-10): editor:inventory/responsive/coverage stayed unenforced by
// any pre-commit hook for so long (see WHY THIS EXISTS above) that a large, pre-existing backlog
// accumulated invisibly — 253 unallowlisted structural findings on a clean tree the moment this
// script started actually running them, none introduced by the change that happened to trip over
// it. Making pre-commit block on that immediately turns "did I break the Editor" into "please
// first triage 253 old findings", which is real work but not this commit's — and would have
// blocked commits to chromasmith-22.html outright until someone did it. Per explicit user
// decision (not a default this script picked): pass `--advisory` (githooks/pre-commit does) to
// print these three gates' output without making a FAIL here count toward the exit code — a
// human still sees the noise every commit, just isn't blocked writing code by SOMEONE ELSE's
// unfinished redesign work. `npm test`/CI never pass this flag, so they stay fully strict —
// advisory mode is a LOCAL commit-friction reduction, not a coverage reduction anywhere it
// actually gets read. editor:snap-check/editor:html-check/editor:wireframe-diff are NOT
// advisory-eligible: they're low-noise, each has caught a real, previously-invisible bug the
// same day it was built (T2/T4/E7), and a clean tree is expected to pass all three right now.
const ADVISORY_MODE = process.argv.includes('--advisory');
// editor:token-check (T5/T10) joins the advisory set: 225 pre-existing findings on a clean tree
// the moment it started running (same shape as inventory/responsive/coverage's own 253) — a
// human sees the noise every commit without being blocked by someone else's unrelated backlog.
// editor:canvas-resize-leak (T33) also joins advisory: a heap-growth trend measurement is
// inherently noisier than a structural/DOM check (allocator timing, SwiftShader software-GL
// variance) — a human should see a FAIL and look, but a transient false alarm shouldn't block a
// commit the way a real structural regression should.
// editor:icon-check (T53) joins advisory: --strict fails on stroke-width drift, and a pre-
// existing backlog of icon() calls at sizes outside the documented 16/20/22 set (14/12/18/34,
// found the day this gate was built) is a real doc-vs-code gap worth surfacing every commit, not
// a regression this commit introduced — same reasoning as token-check/canvas-resize-leak above.
// editor:motion-token-check (T52's cheap first step) joins advisory too: a pre-existing backlog
// of hand-typed transition/animation durations+easings found the day this gate was built, same
// reasoning as token-check.
// editor:axe-check (T41) joins advisory: a real axe-core sweep of the Editor's panels. Building
// it also fixed every CRITICAL label/select-name and SERIOUS aria-toggle-field-name violation
// (a11yEnhanceFormLabels(), chromasmith-22.html) — the remaining findings are all color-contrast
// on DIMMED off-section labels (.fx-fields.ff-off, CLAUDE.md §3b's intentional dim-not-hidden
// pattern), a real but pre-existing design-token decision, not a regression this pass introduced.
// T43/T44/T46/T47/T48/T50 (editor_ux_spec.json) all join advisory: each is a NEW state-matrix/
// simulation-shaped check built the same day, several with a documented, known scope limit
// (an element not visible in this harness's default panel state isn't a confirmed pass OR fail —
// see each script's own header comment) rather than a clean green/red structural check.
// editor:responsive LEFT the advisory set 2026-09-11: its topbar-overlap backlog had cleared (0 of
// the 5 allowlisted overlaps still fired), and it now carries the CLIP + layout-matrix checks that
// would have blocked the clipped narrow tool rail — a check that can't block can't prevent anything.
const ADVISORY_GATES = new Set(['editor:inventory', 'editor:coverage', 'editor:token-check', 'editor:canvas-resize-leak', 'editor:icon-check', 'editor:motion-token-check', 'editor:axe-check', 'editor:hover-focus-matrix', 'editor:empty-error-states', 'editor:zoom-check', 'editor:long-string-check', 'editor:hidpi-check', 'editor:cvd-check']);
// editor:surface-coverage REMOVED from advisory 2026-09-11 — every region it found (82 hidden-
// at-load ones, plus the original 11 live-layout gaps) now has a design/surfaces.json entry
// (real surface or `covers` listing), verified 0 missing. Now blocking: a new uninventoried
// region should fail the gate immediately, not join a backlog.

const GATES = [
  { name: 'editor:inventory', cmd: ['node', 'test/editor_wireframe_inventory.mjs'] },
  { name: 'editor:responsive', cmd: ['node', 'test/editor_responsive_qa.mjs'] },
  { name: 'editor:coverage', cmd: ['node', 'test/editor_coverage.mjs'] },
  { name: 'editor:wireframe-diff', cmd: ['node', 'test/editor_wireframe_diff.mjs'], retries: FLAKE_RETRIES },
  // T2/T4 (editor_ux_spec.json, 2026-09-10): neither existed before this session. T2 catches a
  // slider/colour/toggle that's live in the DOM but missing from _FX_SNAP_SLIDERS/_FX_SNAP_COLORS/
  // _FX_SNAP_TOGGLES (silently breaking undo/session-persistence/reset-visibility — how
  // deconv-amt/deconv-rad and adj-dehaze sat broken for a long time with zero test failure
  // anywhere). T4 catches a <button> nested inside another <button> (invalid HTML the browser
  // silently mis-parses) in both the shipped app and the review-only panel_proposals.mjs.
  { name: 'editor:snap-check', cmd: ['node', 'test/editor_snap_lists_check.mjs'] },
  { name: 'editor:html-check', cmd: ['node', 'test/editor_html_validity_check.mjs'] },
  // T30/T31 (editor_ux_spec.json, 2026-09-10): built after diagnosing the mskRebuild()/
  // fxEnsureDepthMap() infinite-render-loop hang. Both are pure text-scans of chromasmith-22.html
  // (no Playwright/browser needed, no known flake — same zero-retries convention as snap-check/
  // html-check per T21) and both are fail-tested against the actual pre-fix source from git
  // history: self-reschedule-check flags mskRebuild()'s unguarded `.then(()=>mskRebuild())`,
  // native-gate-check flags fxEnsureDepthMap()'s capNative()-instead-of-__TAURI__ mismatch.
  { name: 'editor:self-reschedule-check', cmd: ['node', 'test/editor_self_reschedule_check.mjs'] },
  { name: 'editor:native-gate-check', cmd: ['node', 'test/editor_native_gate_check.mjs'] },
  // T14 (editor_ux_spec.json): asserts every onclick-bearing element inside a .fx-ctrl[data-fxsec]
  // card is either a real interactive tag or has been made operable via a11yEnhanceToggles()'s
  // role+tabindex+keydown pattern — catches a future `<div onclick>` control that would otherwise
  // sail through every other check while being unusable by keyboard. Passes clean today.
  { name: 'editor:keyboard-check', cmd: ['node', 'test/editor_keyboard_check.mjs'] },
  { name: 'editor:token-check', cmd: ['node', 'test/editor_token_check.mjs', '--strict'] },
  // T34 (editor_ux_spec.json): every gate above drives Chromium; this is the one gate that drives
  // WebKit (the real engine family behind the shipping desktop/iOS app). Skips (exit 0) rather
  // than fails when WebKit isn't installed locally (`npx playwright install webkit`) — an
  // environment gap, not an app regression, and CI should install it rather than this gate faking
  // a pass/fail either way.
  { name: 'editor:webkit-smoke', cmd: ['node', 'test/editor_webkit_smoke.mjs'] },
  // T36 (editor_ux_spec.json): hammers undo/redo (30 edits, past the 20-entry cap) and verifies
  // the cap actually holds plus an exact round-trip, not just a single-click smoke test.
  { name: 'editor:undo-stress', cmd: ['node', 'test/editor_undo_stress.mjs'] },
  // T37 (editor_ux_spec.json): saves a session with several feature families touched, does a
  // REAL page reload (not a same-context snapshot re-apply), and diffs restored state.
  { name: 'editor:session-roundtrip', cmd: ['node', 'test/editor_session_roundtrip.mjs'] },
  // T38 (editor_ux_spec.json): feeds malformed .cube/image fixtures through the real load paths,
  // asserting a bounded settle time and no uncaught error — the before-ship half of what
  // editor_hang_diagnose.mjs (T28) exists to clean up after a hang is already reported live.
  { name: 'editor:fuzz-input', cmd: ['node', 'test/editor_fuzz_input.mjs'] },
  // T33 (editor_ux_spec.json): repeatedly resizes the preview canvas and watches JS heap trend —
  // advisory (heap-growth measurement is noisier than a structural check, see ADVISORY_GATES).
  { name: 'editor:canvas-resize-leak', cmd: ['node', 'test/editor_canvas_resize_leak.mjs'] },
  // T35 (editor_ux_spec.json): verifies coi-serviceworker's register/reload cycle and the REAL
  // offline claim (warmed LUT presets resolve from IndexedDB with zero network) — not a full
  // page reload while offline, which this test found genuinely doesn't work today (no Cache
  // Storage layer in coi-serviceworker.min.js) and logs as a note rather than failing on it.
  { name: 'editor:offline-check', cmd: ['node', 'test/editor_offline_check.mjs'] },
  // T40 (editor_ux_spec.json): two tabs against the same IndexedDB — a real user mistake — write/
  // read/race-checked for corruption, not just "does it throw".
  { name: 'editor:crosstab-check', cmd: ['node', 'test/editor_crosstab_check.mjs'] },
  // T41 (editor_ux_spec.json): real axe-core WCAG 2.0/2.1 A+AA sweep across 11 panels — broader
  // than editor:keyboard-check's (T14) tag/role/tabindex heuristic, which says nothing about
  // whether a control announces sensibly to a screen reader.
  { name: 'editor:axe-check', cmd: ['node', 'test/editor_axe_check.mjs'] },
  // T53 (editor_ux_spec.json): icon() call sites resolve to a real ICONS entry at an approved
  // size, and every ICONS entry itself has a non-empty drawable body. --strict here also checks
  // stroke-width drift, which is advisory (see ADVISORY_GATES).
  { name: 'editor:icon-check', cmd: ['node', 'test/editor_icon_check.mjs', '--strict'] },
  // T52 (editor_ux_spec.json) cheap first step: transition/animation duration+easing drift
  // against --dur-1/--dur-2/--ease. Does not measure actual jank/frame-timing (larger lift, not
  // attempted here).
  { name: 'editor:motion-token-check', cmd: ['node', 'test/editor_motion_token_check.mjs', '--strict'] },
  // T45 (editor_ux_spec.json): forced-colors (Windows High Contrast) mode — a control with no
  // border/outline/content that relies purely on background-colour can vanish entirely once the
  // browser strips custom backgrounds. Found and fixed one real instance (.fx-toggle) building
  // this; passes clean now (border:1px solid transparent, switched to CanvasText under
  // forced-colors — the property forced-colors mode does NOT strip).
  { name: 'editor:forced-colors-check', cmd: ['node', 'test/editor_forced_colors_check.mjs'] },
  // T43 (editor_ux_spec.json): resting/hover/focus computed-style snapshot diff across component
  // classes. Found .fx-select shows no visible hover or focus change.
  { name: 'editor:hover-focus-matrix', cmd: ['node', 'test/editor_hover_focus_matrix.mjs', '--strict'] },
  // T44 (editor_ux_spec.json): empty/loading/error state legibility (visibility + WCAG contrast).
  { name: 'editor:empty-error-states', cmd: ['node', 'test/editor_empty_error_states.mjs', '--strict'] },
  // T46 (editor_ux_spec.json): real browser-chrome zoom (CDP DeviceMetricsOverride) at 150%/200%
  // — overlap + unmarked-clipping check against the deskbar/toolrail.
  { name: 'editor:zoom-check', cmd: ['node', 'test/editor_zoom_check.mjs', '--strict'] },
  // T47 (editor_ux_spec.json): oversized filename/preset-name injection — clipping/overlap check.
  { name: 'editor:long-string-check', cmd: ['node', 'test/editor_long_string_check.mjs', '--strict'] },
  // T48 (editor_ux_spec.json): canvas backing-store resolution vs emulated deviceScaleFactor.
  { name: 'editor:hidpi-check', cmd: ['node', 'test/editor_hidpi_check.mjs', '--strict'] },
  // T50 (editor_ux_spec.json): CVD simulation matrices against paired design tokens (ok/err,
  // acc/mut) + a markup check that colour-coded controls also carry a non-colour signal.
  // T60 (editor_ux_spec.json, 2026-09-11): every layout region (top bars, tool rail, docked
  // filmstrip, Library sidebar/status bar, phone action bar...) must have its OWN entry in
  // design/surfaces.json — the S5 inventory omitted all app chrome, so the review page and the
  // capture pipeline never saw the clipped tool rail. Advisory only until S6b adds those
  // entries; then remove it from ADVISORY_GATES so a new region can never go uninventoried.
  { name: 'editor:surface-coverage', cmd: ['node', 'test/surface_coverage_check.mjs'] },
  { name: 'editor:cvd-check', cmd: ['node', 'test/editor_cvd_check.mjs', '--strict'] },
  // Token generator drift gate (S3/S4/"Token generator gates" session): design/tokens.json is
  // the source of truth for chromasmith-22.html's :root/body.light and library-ui.js's DS block;
  // --check fails if regenerating from tokens.json would change either file (hand-edit or
  // tokens.json/token-layout.json drift). Blocking — a drifted token silently reverts on the
  // next build-tokens run otherwise.
  { name: 'editor:tokens-check', cmd: ['node', 'scripts/build-tokens.mjs', '--check'] },
  // Generated app-wide map from component families and semantic icons to their production
  // declarations. Keeps requests such as "change every toggle" from relying on a hand list.
  { name: 'editor:components-check', cmd: ['node', 'scripts/build-component-registry.mjs', '--check'] },
  // verify_tokens.py re-parses all three source blocks and asserts every declared CSS var is
  // either in design/tokens.json or documented in design/token-conflicts.md. Blocking.
  { name: 'editor:tokens-verify', cmd: ['bash', '-c', 'if [ -x .calibvenv/bin/python3 ]; then .calibvenv/bin/python3 design/verify_tokens.py; else python3 design/verify_tokens.py; fi'] },
  // ?catalog=1 component catalogue (docs/ui-workflow/STATE.md S1(d)): one toHaveScreenshot() per
  // shared component class x state (test/catalog_visual.mjs). Blocking — baselines are committed
  // and a pixel-level regression in any shared component should fail the same way any other
  // wireframe-diff gate here does.
  { name: 'editor:catalog-visual', cmd: ['npx', 'playwright', 'test', 'test/catalog_visual.mjs', '--config=playwright.config.mjs'] },
];

const verbose = process.argv.includes('--verbose');
const results = [];

for (const gate of GATES) {
  const attempts = gate.retries || 1;
  let out = '', code = 1, used = 0;
  for (let i = 1; i <= attempts; i++) {
    used = i;
    const r = spawnSync(gate.cmd[0], gate.cmd.slice(1), { encoding: 'utf8' });
    out = `${r.stdout || ''}${r.stderr || ''}`;
    code = r.status ?? 1;
    if (code === 0) break;
    if (i < attempts) console.log(`  ${gate.name}: attempt ${i} failed — retrying (see E7 in editor_ux_spec.json)`);
  }
  results.push({ name: gate.name, ok: code === 0, attempts: used, out });
  // Only a FAILING gate dumps its output. A passing gate's full log is noise that pushes the
  // one thing you need to read off the top of the terminal — same reasoning as test/verify.py.
  if (code !== 0 || verbose) {
    console.log(`\n──── ${gate.name} ${code === 0 ? '(verbose)' : 'FAILED'} ────`);
    console.log(out.trimEnd());
  }
}

console.log('\nEDITOR GATES');
console.log('─'.repeat(52));
for (const r of results) {
  const advisory = ADVISORY_MODE && !r.ok && ADVISORY_GATES.has(r.name);
  const label = advisory ? 'WARN' : (r.ok ? 'PASS' : 'FAIL');
  const note = advisory ? '  (advisory — not blocking; see --advisory comment above)' : '';
  console.log(`  ${label}  ${r.name}${r.attempts > 1 ? `  (${r.attempts} attempts)` : ''}${note}`);
}
console.log('─'.repeat(52));

const blocking = results.filter((r) => !r.ok && !(ADVISORY_MODE && ADVISORY_GATES.has(r.name)));
if (blocking.length) {
  console.log(`RESULT: FAIL — ${blocking.map((r) => r.name).join(', ')}\n`);
  process.exit(1);
}
const warned = results.filter((r) => !r.ok);
if (warned.length) {
  console.log(`RESULT: PASS (with ${warned.length} advisory warning(s): ${warned.map((r) => r.name).join(', ')})\n`);
} else {
  console.log('RESULT: PASS\n');
}
