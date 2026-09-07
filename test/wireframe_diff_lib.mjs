// Shared infrastructure for wireframe_diff.mjs / editor_wireframe_diff.mjs.
// Added after a review of the diff tooling itself found three real gaps:
//   1. No repair loop — detection existed, nothing let a fix be checked against the PREVIOUS
//      run (resolved / persisting / new mismatches), so "did the fix work" still had to be
//      eyeballed from two raw text dumps.
//   2. No determinism pinning beyond the swiftshader GPU flag — font loading, animation/
//      transition timing, device pixel ratio, locale/timezone were all left to chance, so a
//      flaky run could report a "mismatch" that was really just timing noise.
//   3. No change-budget/scope control — nothing recorded which files a fix touched vs. which
//      files it was expected to touch, so a repair pass could silently drift outside its scope.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

// ── 1. Determinism ──────────────────────────────────────────────────────────────────────────
// Launch args: swiftshader (already in use) + a pinned colour profile so a monitor's ICC
// profile can't shift rendered colours between machines/runs.
export const DETERMINISTIC_LAUNCH_ARGS = [
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
];

// Per-context options: fixed locale/timezone (date/number formatting can otherwise vary by CI
// vs local machine) and reduced motion (see settleAnimations below for the belt-and-suspenders
// CSS override — emulateMedia alone doesn't stop every hand-rolled JS transition).
export const DETERMINISTIC_CONTEXT_OPTIONS = {
  locale: 'en-US',
  timezoneId: 'UTC',
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
};

// Call after navigation, before any screenshot/extract: waits for webfonts to actually finish
// loading (a screenshot taken mid-swap between a fallback and the real face is a false
// mismatch, not a real one) and freezes CSS animations/transitions so a screenshot can't land
// mid-frame of something moving.
export async function settleForCapture(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }`,
  });
}

// ── 2. Repair loop: structured report + recheck against the previous run ───────────────────
// Every mismatch as a record, not just a formatted string, so a future run can diff against it
// by identity (theme+label+prop) rather than by re-parsing text.
export function toRecords(mismatches, missing) {
  const parseMismatch = (line) => {
    const m = /^\[(\w+)\] ([^:]+): (\S+) — (.+)$/.exec(line);
    return m ? { theme: m[1], label: m[2], prop: m[3], detail: m[4], raw: line } : { raw: line };
  };
  return {
    mismatches: mismatches.map(parseMismatch),
    missing: missing.map((line) => ({ raw: line })),
  };
}

function recordKey(r) { return r.theme ? `${r.theme}|${r.label}|${r.prop}` : r.raw; }

export async function writeReport(reportPath, records) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...records }, null, 2));
}

// Compares this run's records against the JSON report from the LAST run (if any) and returns
// { resolved, persisting, new } record lists — the actual detect→diagnose→fix→RECHECK loop:
// after applying a fix, re-run the same script and this tells you exactly what changed, instead
// of diffing two raw console dumps by eye.
export async function recheck(reportPath, currentRecords) {
  let prev;
  try { prev = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch { return null; } // no previous run to compare against — not an error, just first run
  const prevKeys = new Set([...prev.mismatches, ...prev.missing].map(recordKey));
  const curKeys = new Set([...currentRecords.mismatches, ...currentRecords.missing].map(recordKey));
  const resolved = [...prevKeys].filter((k) => !curKeys.has(k));
  const persisting = [...curKeys].filter((k) => prevKeys.has(k));
  const fresh = [...curKeys].filter((k) => !prevKeys.has(k));
  return { resolved, persisting, new: fresh, prevGeneratedAt: prev.generatedAt };
}

export function printRecheck(rc) {
  if (!rc) { console.log('(no previous report to recheck against — this is the first run)'); return; }
  console.log(`\nRecheck vs previous run (${rc.prevGeneratedAt}):`);
  console.log(`  resolved:   ${rc.resolved.length}`);
  console.log(`  persisting: ${rc.persisting.length}`);
  console.log(`  new:        ${rc.new.length}`);
  if (rc.new.length) { console.log('  New:'); rc.new.forEach((k) => console.log('    ' + k)); }
}

// ── 3. Change-budget / scope control ────────────────────────────────────────────────────────
// Call after a repair pass with the file(s) the fix was SUPPOSED to touch. Reports any changed
// file outside that set — cheap, and it's exactly the check that would have caught a repair
// pass drifting into files nobody asked it to touch.
export function reportChangeScope(expectedFiles) {
  const changed = execSync('git diff --name-only && git diff --cached --name-only', { cwd: process.cwd() })
    .toString().split('\n').map((l) => l.trim()).filter(Boolean);
  const changedSet = [...new Set(changed)];
  const expected = new Set(expectedFiles);
  const inScope = changedSet.filter((f) => expected.has(f));
  const outOfScope = changedSet.filter((f) => !expected.has(f));
  const untouchedExpected = expectedFiles.filter((f) => !changedSet.includes(f));
  return { inScope, outOfScope, untouchedExpected };
}

export function printChangeScope(scope) {
  console.log('\nChange-scope report:');
  console.log(`  in-scope changes:     ${scope.inScope.join(', ') || '(none)'}`);
  console.log(`  OUT-OF-SCOPE changes: ${scope.outOfScope.join(', ') || '(none)'}`);
  console.log(`  expected but untouched: ${scope.untouchedExpected.join(', ') || '(none)'}`);
  if (scope.outOfScope.length) {
    console.log('  ⚠ files changed outside what this fix was scoped to — review before committing.');
  }
}
