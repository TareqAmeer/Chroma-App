#!/usr/bin/env node
// Focused, browser-free contract checks for CHR-173's sampled export preview.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(ROOT, 'chromasmith-22.html'), 'utf8');

const estimateSource = html.match(/function fxSoftProofEstimate\([\s\S]*?\n\}/)?.[0];
assert.ok(estimateSource, 'the sampled-size estimator exists');
const estimate = vm.runInNewContext(`(${estimateSource})`);
const previewFunctions = html.match(/let FXSoftProof=null,[\s\S]*?function sk2ExportBuild\(\)/)?.[0]
  .replace(/function sk2ExportBuild\(\)$/, '');
assert.ok(previewFunctions, 'soft-proof implementation block exists');
assert.doesNotThrow(() => new vm.Script(previewFunctions), 'soft-proof code parses as JavaScript');
const resampleSource = html.match(/async function exportResample\(cv,settings\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(resampleSource, 'export resampling accepts preview settings');
assert.doesNotThrow(() => new vm.Script(resampleSource), 'shared export resampling code parses as JavaScript');

assert.equal(estimate(0, 100, 100, 200, 200), 0, 'invalid sample sizes are rejected');
assert.equal(estimate(1000, 100, 50, 100, 50), 1000, 'same-size estimate preserves sample bytes');
assert.equal(estimate(1000, 100, 50, 200, 100), 4000, 'doubling both edges estimates four times the bytes');
assert.equal(estimate(500, 100, 100, 50, 50), 125, 'halving both edges estimates one quarter of the bytes');
assert.equal(estimate(1800, 100, 100, 200, 200), estimate(7200, 100, 100, 200, 200) / 4,
  'estimated size tracks sampled content/quality encode size proportionally');

assert.match(html, /FXSoftProof\.resetTextureSnapshotFrom\(FX\)/,
  'the preview uses an independent renderer with a captured texture snapshot');
assert.match(html, /structuredClone\(live\)|JSON\.parse\(JSON\.stringify\(live\)\)/,
  'the edited recipe is copied before rendering');
assert.match(html, /processToCanvas\(P,proofSource,pw,ph,\(\)=>\{\},FXSoftProof\)/,
  'preview pixels use the normal export renderer path');
assert.match(html, /exportResample\(proofOut,\{size,sharp\}\)/,
  'selected resize and sharpening are applied to the preview');
assert.match(html, /toBlob\(resolve,mime,mime==='image\/png'\?undefined:quality\)/,
  'sample encoding uses the selected output format and quality');
assert.match(html, /fxSoftProofSchedule\(\);[\s\S]{0,220}Video export keeps/,
  'photo and recipe renders debounce a refresh and invalidate stale previews');
assert.match(previewFunctions, /if\(!canvas\|\|revision!==_fxSoftProofRevision\)return;[\s\S]*?it\.kind==='video'/,
  'stale, missing-photo, and video previews are excluded');
assert.match(html, /fxSoftProofInvalidate\(\);if\(sh\)/,
  'closing the export sheet invalidates pending preview work');
assert.match(html, /Show original/,
  'the export sheet offers an original/edited toggle');

console.log('PASS CHR-173 sampled estimate math and export-preview contracts');
