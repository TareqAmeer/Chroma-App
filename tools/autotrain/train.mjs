#!/usr/bin/env node
// Train a small ridge regressor that predicts Lightroom-Auto-style slider values from a photo's
// tone/colour statistics, and decide honestly whether it beats what the app already does.
//
//   node tools/autotrain/train.mjs [dataset.json] [--out tools/autotrain/data/auto_model.json]
//
// It compares on a held-out 20% against (a) always predicting the training mean and (b) the app's
// current deterministic autoEnhanceParams, and only reports PROMOTE when the model beats both by a
// margin. No network, no GPU, no installs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fitRidge, predictRidge } from './lib.mjs';
import { load } from '../../test/unit/extract.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : 'tools/autotrain/data/auto_model.json';
const dataFile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') || 'tools/autotrain/data/dataset.json';
const ds = JSON.parse(readFileSync(dataFile, 'utf8'));
const rows = ds.rows;
if (rows.length < 20) { console.error(`only ${rows.length} photos — need at least 20 (hundreds+ for a trustworthy result)`); process.exit(1); }

// deterministic split: every 5th photo is held out, so reruns are comparable
const test = rows.filter((_, i) => i % 5 === 0), train = rows.filter((_, i) => i % 5 !== 0);
const X = r => r.x, Y = r => r.y, k = ds.labels.length;
const mae = (pred, rs) => ds.labels.map((_, o) => rs.reduce((s, r, i) => s + Math.abs(pred[i][o] - r.y[o]), 0) / rs.length);

// choose lambda by 5-fold CV on the training part
let best = { lambda: 1, err: Infinity };
for (const lambda of [0.1, 1, 10, 100, 1000]) {
  let tot = 0;
  for (let f = 0; f < 5; f++) {
    const tr = train.filter((_, i) => i % 5 !== f), va = train.filter((_, i) => i % 5 === f);
    const m = fitRidge(tr.map(X), tr.map(Y), lambda);
    tot += mae(va.map(r => predictRidge(m, X(r))), va).reduce((a, b) => a + b, 0) / k;
  }
  if (tot < best.err) best = { lambda, err: tot };
}
const model = fitRidge(train.map(X), train.map(Y), best.lambda);

// baselines
const mean = Array.from({ length: k }, (_, o) => train.reduce((s, r) => s + r.y[o], 0) / train.length);
const { autoEnhanceParams } = load(['autoEnhanceParams']);
const det = r => { const d = Buffer.from(r.rgb, 'base64'), rgba = new Uint8ClampedArray(r.w * r.h * 4); for (let i = 0; i < r.w * r.h; i++) rgba.set([d[i * 3], d[i * 3 + 1], d[i * 3 + 2], 255], i * 4); const p = autoEnhanceParams(rgba); return ds.labels.map(l => p[l]); };
const mMean = mae(test.map(() => mean), test), mDet = mae(test.map(det), test), mModel = mae(test.map(r => predictRidge(model, X(r))), test);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`photos: ${rows.length} (train ${train.length}, held-out ${test.length}), ridge lambda ${best.lambda}`);
console.log('label   mean-baseline  current-auto   learned');
ds.labels.forEach((l, o) => console.log(`${l.padEnd(6)}  ${mMean[o].toFixed(2).padStart(12)}  ${mDet[o].toFixed(2).padStart(12)}  ${mModel[o].toFixed(2).padStart(8)}`));
console.log(`MEAN    ${avg(mMean).toFixed(2).padStart(12)}  ${avg(mDet).toFixed(2).padStart(12)}  ${avg(mModel).toFixed(2).padStart(8)}`);
const promote = avg(mModel) < avg(mDet) * 0.9 && avg(mModel) < avg(mMean) * 0.9;
console.log(promote ? 'VERDICT: PROMOTE — learned model clearly beats both baselines on held-out photos'
  : 'VERDICT: KEEP CURRENT — learned model does not beat both baselines by at least 10%');

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ version: 1, featureNames: ds.featureNames, labels: ds.labels, lambda: best.lambda, trainedOn: train.length, heldOutMae: { mean: avg(mMean), current: avg(mDet), learned: avg(mModel) }, promote, model }, null, 1));
console.log(`wrote ${outFile}`);
process.exit(0);
