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
const ADVISORY_GATES = new Set(['editor:inventory', 'editor:responsive', 'editor:coverage', 'editor:token-check']);

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
