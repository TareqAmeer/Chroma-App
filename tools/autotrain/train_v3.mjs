#!/usr/bin/env node
// Auto-enhance v3 trainer. Features come from the APP's own autoEnhanceFeatures() (extracted from
// chromasmith-22.html, so training and runtime can never drift apart); labels are Lightroom's Auto
// settings converted into OUR slider units with the calibration map (calib_map.json).
//
//   node tools/autotrain/train_v3.mjs <dataset.json> [--calib calib_map.json] [--out model_v3.json] [--embed chromasmith-22.html]
//
// Reports slider error vs Lightroom's choices on a held-out 20% for: always-the-average, the app's
// rule engine, and the learned hybrid. --embed writes the model into the HTML's AUTO_MODEL slot.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitRidge, predictRidge } from './lib.mjs';
import { load } from '../../test/unit/extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const dsFile = argv.find((a, i) => !a.startsWith('--') && !['--calib', '--out', '--embed'].includes(argv[i - 1]));
if (!dsFile) { console.error('usage: train_v3.mjs <dataset.json> [--calib f] [--out f] [--embed html]'); process.exit(2); }
const calibFile = opt('--calib', path.join(ROOT, 'tools/autotrain/data/calibration/calib_map.json')), outFile = opt('--out', path.join(ROOT, 'tools/autotrain/data/model_v3.json')), embed = opt('--embed', null);
const K = JSON.parse(readFileSync(calibFile, 'utf8')).map, ds = JSON.parse(readFileSync(dsFile, 'utf8'));
const LABELS = ['exp', 'hi', 'sh', 'con', 'wh', 'bl', 'vib'], CLAMP = { exp: [-60, 60], hi: [-100, 40], sh: [-40, 100], con: [-30, 40], wh: [-50, 50], bl: [-50, 30], vib: [-10, 50] };
const toOurs = (l, v) => Math.max(-100, Math.min(100, v * (K[l]?.k ?? 1)));
const ae = load(['autoEnhanceRules', 'autoEnhanceFeatures', 'AUTO_FEATURE_NAMES', 'AUTO_MODEL', 'autoEnhanceParams']);

const rows = ds.rows.map(r => {
  const d = Buffer.from(r.rgb, 'base64'), rgba = new Uint8ClampedArray(r.w * r.h * 4);
  for (let i = 0; i < r.w * r.h; i++) rgba.set([d[i * 3], d[i * 3 + 1], d[i * 3 + 2], 255], i * 4);
  const lr = Object.fromEntries(ds.labels.map((l, o) => [l, r.y[o]]));
  const rules = ae.autoEnhanceRules(rgba);
  return { file: r.file, x: ae.autoEnhanceFeatures(rgba), y: LABELS.map(l => toOurs(l, lr[l])), rules: LABELS.map(l => rules[l]) };
});
const test = rows.filter((_, i) => i % 5 === 0), train = rows.filter((_, i) => i % 5 !== 0);
const mae = (pred, rs) => LABELS.map((_, o) => rs.reduce((s, r, i) => s + Math.abs(pred[i][o] - r.y[o]), 0) / rs.length);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

let best = { lambda: 1, err: Infinity };
for (const lambda of [0.3, 1, 3, 10, 30, 100, 300]) {
  let tot = 0;
  for (let f = 0; f < 5; f++) { const tr = train.filter((_, i) => i % 5 !== f), va = train.filter((_, i) => i % 5 === f); const m = fitRidge(tr.map(r => r.x), tr.map(r => r.y), lambda); tot += avg(mae(va.map(r => predictRidge(m, r.x)), va)); }
  if (tot < best.err) best = { lambda, err: tot };
}
const model = fitRidge(train.map(r => r.x), train.map(r => r.y), best.lambda);
const meanY = LABELS.map((_, o) => avg(train.map(r => r.y[o])));
const mMean = mae(test.map(() => meanY), test), mRules = mae(test.map(r => r.rules), test), mLearn = mae(test.map(r => predictRidge(model, r.x).map((v, o) => Math.max(CLAMP[LABELS[o]][0], Math.min(CLAMP[LABELS[o]][1], v)))), test);
console.log(`photos ${rows.length} (train ${train.length}, held-out ${test.length}), lambda ${best.lambda}`);
console.log('error vs Lightroom Auto, in OUR slider units (lower is better)');
console.log('label  always-average  rule-engine  learned-hybrid');
LABELS.forEach((l, o) => console.log(`${l.padEnd(5)}  ${mMean[o].toFixed(2).padStart(13)}  ${mRules[o].toFixed(2).padStart(11)}  ${mLearn[o].toFixed(2).padStart(14)}`));
console.log(`MEAN   ${avg(mMean).toFixed(2).padStart(13)}  ${avg(mRules).toFixed(2).padStart(11)}  ${avg(mLearn).toFixed(2).padStart(14)}`);

// refit on everything for the shipped model
const full = fitRidge(rows.map(r => r.x), rows.map(r => r.y), best.lambda), r4 = v => Math.round(v * 1e4) / 1e4;
const shipped = { version: 3, labels: LABELS, clamp: CLAMP, mu: full.mu.map(r4), sd: full.sd.map(r4), W: full.W.map(row => row.map(r4)), featureNames: ae.AUTO_FEATURE_NAMES, trainedOn: rows.length, heldOutMae: { average: avg(mMean), rules: avg(mRules), learned: avg(mLearn) } };
writeFileSync(outFile, JSON.stringify(shipped));
console.log(`wrote ${outFile}`);
if (embed) {
  let html = readFileSync(embed, 'utf8'); const re = /let AUTO_MODEL=[^;\n]*;/;
  if (!re.test(html)) throw new Error('AUTO_MODEL slot not found');
  const { featureNames, heldOutMae, ...slim } = shipped;
  html = html.replace(re, () => `let AUTO_MODEL=${JSON.stringify(slim)};`); writeFileSync(embed, html); console.log(`embedded into ${embed}`);
}
