#!/usr/bin/env node
// ── VISUAL REGRESSION SCORECARD ──────────────────────────────────────────────────────────────
// Diffs test/output/visual/*.png (from `node test/visual_baseline.mjs`) against
// test/baselines/visual/*.png using pixelmatch — the SAME diff algorithm Playwright's own
// `toHaveScreenshot()` uses internally (verified before building this: it's the field-standard
// approach precisely because naive per-pixel diffing false-positives on anti-aliasing noise
// between identical-looking renders). Diffing lives in JS, not calib/export_scorecard.py's
// Python+numpy pattern, because pixelmatch's anti-aliasing detection has no equivalent-quality
// Python counterpart worth reimplementing — the render/diff split elsewhere in this repo is a
// convention, not a rule that outranks using the right tool for this specific job.
//
//   node test/visual_scorecard.mjs                  # PASS/FAIL table, exit 1 on regression
//   node test/visual_scorecard.mjs --threshold 0.05  # override the default pixelmatch threshold
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output', 'visual');
const BASELINE_DIR = path.join(__dirname, 'baselines', 'visual');
const DIFF_DIR = path.join(__dirname, 'output', 'visual_diffs');

// pixelmatch's own per-pixel colour-distance sensitivity (0=strict, 1=lenient). 0.1 is
// pixelmatch's documented default and matches Playwright's toHaveScreenshot() default.
const PIXEL_THRESHOLD = 0.1;
// Fraction of pixels allowed to differ before a scenario FAILs. Verified empirically, not
// guessed: two captures of genuinely identical state (SwiftShader headless render, same fixed
// grain seed) come back at EXACTLY 0.000% — this harness has no inherent font-rendering/
// anti-alias noise floor to budget for the way a real-display screenshot tool would. A
// deliberate 100x100px mutation on a 1440x820 capture (0.847%) was the case that caught this:
// the original 1% default would have silently passed a change that size. 0.1% still comfortably
// clears the observed zero-noise floor while catching much smaller real regressions.
const MAX_DIFF_RATIO = 0.001;

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const maxDiffRatio = argValue('--threshold', MAX_DIFF_RATIO);

async function loadPng(filePath) {
  const data = await readFile(filePath);
  return PNG.sync.read(data);
}

async function main() {
  let baselineFiles;
  try {
    baselineFiles = (await readdir(BASELINE_DIR)).filter((f) => f.endsWith('.png'));
  } catch {
    console.error(`No baselines at ${path.relative(ROOT, BASELINE_DIR)}/ — run `
      + '`node test/visual_baseline.mjs --baseline` first.');
    process.exit(1);
  }
  if (baselineFiles.length === 0) {
    console.error('Baseline directory is empty.');
    process.exit(1);
  }

  // Cleared, not just created — a diff image from a scenario that FAILed on a previous run and
  // now PASSes would otherwise linger and misreport as a current failure to anyone browsing the
  // directory. Caught live: the first tightened-threshold run left five stale diffs from an
  // earlier (since-fixed) run sitting next to the one genuine new failure.
  await rm(DIFF_DIR, { recursive: true, force: true });
  await mkdir(DIFF_DIR, { recursive: true });

  const rows = [];
  let anyFail = false;

  for (const file of baselineFiles.sort()) {
    const name = file.replace(/\.png$/, '');
    const outPath = path.join(OUT_DIR, file);
    let outPng;
    try {
      outPng = await loadPng(outPath);
    } catch {
      rows.push({ name, status: 'MISSING', pct: '-' });
      anyFail = true;
      continue;
    }
    const basePng = await loadPng(path.join(BASELINE_DIR, file));

    if (outPng.width !== basePng.width || outPng.height !== basePng.height) {
      rows.push({ name, status: 'SIZE MISMATCH', pct: '-' });
      anyFail = true;
      continue;
    }

    const { width, height } = outPng;
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(
      basePng.data, outPng.data, diff.data, width, height,
      { threshold: PIXEL_THRESHOLD },
    );
    const pct = diffPixels / (width * height);
    const pass = pct <= maxDiffRatio;
    if (!pass) {
      anyFail = true;
      await writeFile(path.join(DIFF_DIR, file), PNG.sync.write(diff));
    }
    rows.push({ name, status: pass ? 'PASS' : 'FAIL', pct: (pct * 100).toFixed(3) + '%' });
  }

  const nameW = Math.max(...rows.map((r) => r.name.length), 8);
  console.log(`${'scenario'.padEnd(nameW)}  status          diff%`);
  console.log('-'.repeat(nameW + 26));
  for (const r of rows) {
    console.log(`${r.name.padEnd(nameW)}  ${r.status.padEnd(14)}  ${r.pct}`);
  }
  console.log();
  if (anyFail) {
    console.log(`FAIL — diff images for failing scenarios written to ${path.relative(ROOT, DIFF_DIR)}/`);
    process.exit(1);
  }
  console.log('PASS — all scenarios within threshold.');
}

main().catch((e) => { console.error(e); process.exit(1); });
