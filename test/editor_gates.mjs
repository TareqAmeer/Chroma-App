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
// ⚠️ editor_wireframe_diff carries a documented, unsolved flake (E7 in editor_ux_spec.json):
// [light/photo] colour reads on #fx-deskbar descendants intermittently return the DARK theme's
// computed colour. A forced-reflow mitigation was tried and confirmed NOT to fix it. The
// pre-commit hook works around it by retrying up to 6x; this mirrors that number deliberately
// rather than picking a new one — two different retry budgets for the same flake would drift.
// A REAL regression fails all 6 attempts. Do not "fix" a red gate by raising this.
import { spawnSync } from 'node:child_process';

const FLAKE_RETRIES = 6; // keep in sync with githooks/pre-commit's loop — same documented flake

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
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.attempts > 1 ? `  (${r.attempts} attempts)` : ''}`);
}
console.log('─'.repeat(52));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`RESULT: FAIL — ${failed.map((r) => r.name).join(', ')}\n`);
  process.exit(1);
}
console.log('RESULT: PASS\n');
