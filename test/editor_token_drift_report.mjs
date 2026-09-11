// T49 (editor_ux_spec.json): editor:token-check (T5/T10) runs once per invocation and reports a
// point-in-time finding count — it has no memory of the LAST count, so a slow reintroduction of
// hand-typed colours/spacing as new code lands (a few new literals per PR, each individually
// easy to justify in review) is invisible until someone happens to read the raw number and
// notices it's bigger than they remember. This turns that point-in-time gate into a trend:
// it runs editor_token_check.mjs, appends {date, colorFindings, spacingFindings, total} to a
// tracked history file, and flags an INCREASE since the last recorded run.
//
// Usage: node test/editor_token_drift_report.mjs           (record + report)
//        node test/editor_token_drift_report.mjs --check    (report only, exit 1 on increase,
//                                                             don't append — for CI/pre-push)
//
// History lives in test/token_drift_history.json (tracked in git, small — one row per run).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HISTORY_PATH = 'test/token_drift_history.json';
const CHECK_ONLY = process.argv.includes('--check');

const r = spawnSync('node', ['test/editor_token_check.mjs'], { encoding: 'utf8' });
const out = `${r.stdout || ''}${r.stderr || ''}`;

// Parse the real total off the header line rather than counting printed [kind] rows — the
// underlying check truncates its printed list at 200 findings, which would silently undercount.
const totalMatch = out.match(/\n(\d+) literal\(s\) not matching/);
const total = totalMatch ? Number(totalMatch[1]) : 0;
const colorFindings = (out.match(/\[color\]/g) || []).length;
const spacingFindings = (out.match(/\[spacing\]/g) || []).length;
const truncated = total > colorFindings + spacingFindings;

let history = [];
if (existsSync(HISTORY_PATH)) {
  try { history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8')); } catch { history = []; }
}

const last = history[history.length - 1];
const today = new Date().toISOString().slice(0, 10);
const entry = { date: today, colorFindings, spacingFindings, total, breakdownTruncated: truncated };

console.log(`editor:token-drift-report — today: ${total} total findings${truncated ? ` (breakdown below is a truncated sample: ${colorFindings} colour, ${spacingFindings} spacing)` : ` (${colorFindings} colour, ${spacingFindings} spacing)`}`);
if (last) {
  console.log(`  last recorded run: ${last.date} — ${last.total} total`);
} else {
  console.log('  no prior recorded run — this will be the first history entry.');
}

let increased = false;
if (last && total > last.total) {
  increased = true;
  console.log(`\nFAIL: token-drift count INCREASED by ${total - last.total} since ${last.date} — new hand-typed literals landed without a matching :root token. Run 'npm run editor:token-check' for the detail list.`);
} else if (last && total < last.total) {
  console.log(`\nImproved: ${last.total - total} finding(s) resolved since ${last.date}.`);
} else {
  console.log('\nNo change since last recorded run.' + (last ? '' : ''));
}

if (!CHECK_ONLY) {
  // Only append a new row if the date changed or the count changed — avoid a history file that
  // grows one identical row per CI run on an unchanged tree.
  if (!last || last.date !== today || last.total !== total) {
    history.push(entry);
    writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
    console.log(`\nRecorded to ${HISTORY_PATH}.`);
  }
}

if (increased) process.exit(1);
