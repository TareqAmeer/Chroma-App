#!/usr/bin/env node
// Guard against a bug class that already shipped once and was invisible from the browser.
//
// The Skin mask is an AI-backed mask with origin 'skin' (not 'ai'), so every check for "is this
// mask driven by segmentation" must go through mskIsAI(). When that refactor was done, a grep for
// `origin==='ai'` found and fixed five call sites — and silently missed four written as
// `origin!=='ai'`. Two of those sat on the scribble path, including the pointerdown handler, so
// scribbling did LITERALLY NOTHING on a Skin mask while the UI looked perfectly healthy.
//
// It could not be caught by test/export_harness.mjs either: the whole segmentation path is gated on
// window.__TAURI__ and the harness is a headless browser. A source-level lint is the only cheap
// check that covers it, so this runs as part of `npm test`.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'chromasmith-22.html';
const src = await readFile(path.join(ROOT, FILE), 'utf8');

// Allowed: the helper's own definition, prose in comments, and the mask-list label, which
// deliberately distinguishes a plain AI mask from a Skin AI one.
const ALLOW = [
  /function mskIsAI\(/,
  /^\s*\/\//,                        // comment lines
  /\?'AI'/,                          // the auto-label branch
];

const offenders = [];
src.split('\n').forEach((line, i) => {
  if (!/origin\s*[!=]==\s*'ai'/.test(line)) return;
  if (ALLOW.some(re => re.test(line))) return;
  offenders.push(`${FILE}:${i + 1}: ${line.trim()}`);
});

if (offenders.length) {
  console.error('✗ Raw origin comparisons against \'ai\' found — use mskIsAI(m) instead.');
  console.error('  A Skin mask has origin \'skin\' with ai:true, so these silently exclude it.');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log('✓ no raw origin===\'ai\' / origin!==\'ai\' comparisons outside mskIsAI');
