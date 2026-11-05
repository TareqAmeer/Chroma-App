#!/usr/bin/env node
// CHR-297 real-photo mask-quality gate: 40 public labelled photos (portrait matting, salient objects,
// fine-edge objects, sky, face parsing) scored against their datasets' ground truth.
//   node test/mask_quality_real.mjs            # fetch if missing, run models, score, compare to baseline
//   node test/mask_quality_real.mjs --update   # rewrite test/mask_quality_real_baseline.json
//   node test/mask_quality_real.mjs --no-run   # score existing pred-*.png only
// Photos are NOT in git: tools/scripts/mask_realset_fetch.py downloads them (list in
// test/fixtures/mask-quality/realset.json) into test/output/mask-realset/. The models run natively
// in the desktop app, not in Chromium, so tools/scripts/mask_realset_run.py mirrors the Rust ORT
// pre/post-processing (see that file). If the photos or models are unavailable the gate prints SKIP
// and exits 0 (pass --strict to fail instead).
// Metrics per fixture/task: IoU at alpha 0.5, boundary F-score (DAVIS-style, tolerance 0.75% of the
// diagonal), alpha MAE. Regression = a row's mean IoU or boundary F drops by more than TOL.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

const TOL = 0.02;
const args = new Set(process.argv.slice(2));
const setDir = path.resolve('test/output/mask-realset');
const models = path.resolve('desktop/src-tauri/vendor');
const list = JSON.parse(fs.readFileSync('test/fixtures/mask-quality/realset.json', 'utf8'));
const basePath = 'test/mask_quality_real_baseline.json';
const skip = (why) => { console.log(`SKIP mask_quality_real: ${why}`); process.exit(args.has('--strict') ? 1 : 0); };
const py = (script, ...a) => spawnSync('python3', ['-I', script, ...a], { stdio: 'inherit' }).status;

if (!list.fixtures.every((f) => fs.existsSync(path.join(setDir, f.id, 'photo.png'))))
  if (py('tools/scripts/mask_realset_fetch.py', setDir) !== 0) skip('could not fetch the public photo set (network or pyarrow missing)');
if (!args.has('--no-run')) {
  for (const m of ['sam/edge_sam_encoder.onnx', 'matte/modnet.onnx', 'landscape/model_quantized.onnx', 'faceparse/model_quantized.onnx'])
    if (!fs.existsSync(path.join(models, m)) || fs.statSync(path.join(models, m)).size < 1e6) skip(`model ${m} missing (git-lfs pointer?)`);
  if (py('tools/scripts/mask_realset_run.py', setDir, models) !== 0) { console.error('FAIL: model runner errored'); process.exit(1); }
}

const grey = (p) => { const g = PNG.sync.read(fs.readFileSync(p)); const a = new Float32Array(g.width * g.height); for (let i = 0; i < a.length; i++) a[i] = g.data[i * 4] / 255; return { w: g.width, h: g.height, a }; };
function edges(b, w, h) { const e = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, v = b[i]; if ((x + 1 < w && b[i + 1] !== v) || (y + 1 < h && b[i + w] !== v)) e[i] = 1; } return e; }
function dilate(e, w, h, r) { // square (Chebyshev) dilation, separable
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (e[y * w + x]) last = x; if (x - last <= r) t[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (e[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; } }
  return o;
}
export function score(gt, pr, w, h) {
  const n = w * h, g = new Uint8Array(n), p = new Uint8Array(n); let inter = 0, uni = 0, mae = 0;
  for (let i = 0; i < n; i++) { g[i] = gt[i] >= .5; p[i] = pr[i] >= .5; inter += g[i] & p[i]; uni += g[i] | p[i]; mae += Math.abs(gt[i] - pr[i]); }
  const r = Math.max(1, Math.round(0.0075 * Math.hypot(w, h))), eg = edges(g, w, h), ep = edges(p, w, h), dg = dilate(eg, w, h, r), dp = dilate(ep, w, h, r);
  let ng = 0, np_ = 0, hitP = 0, hitG = 0; for (let i = 0; i < n; i++) { if (ep[i]) { np_++; hitP += dg[i]; } if (eg[i]) { ng++; hitG += dp[i]; } }
  const P = np_ ? hitP / np_ : (ng ? 0 : 1), R = ng ? hitG / ng : (np_ ? 0 : 1);
  return { iou: uni ? inter / uni : 1, bf: P + R ? 2 * P * R / (P + R) : 0, mae: mae / n };
}

const TASKS = { subject: ['MODNet Auto Subject', 'gt.png'], click: ['EdgeSAM 1 click', 'gt.png'], sky: ['UperNet sky', 'gt.png'], 'face-skin': ['SegFormer skin', 'gt-skin.png'], 'face-hair': ['SegFormer hair', 'gt-hair.png'] };
const per = [], rows = {};
for (const f of list.fixtures) for (const t of f.tasks) {
  const d = path.join(setDir, f.id), pp = path.join(d, `pred-${t}.png`);
  if (!fs.existsSync(pp)) { console.error(`FAIL: missing ${pp}`); process.exit(1); }
  const g = grey(path.join(d, TASKS[t][1])), p = grey(pp);
  if (g.w !== p.w || g.h !== p.h) { console.error(`FAIL: ${f.id} ${t} size mismatch`); process.exit(1); }
  const s = score(g.a, p.a, g.w, g.h); per.push({ id: f.id, task: t, ...s });
  const k = `${f.category}/${t}`; (rows[k] ||= { category: f.category, task: t, model: TASKS[t][0], n: 0, iou: 0, bf: 0, mae: 0 });
  rows[k].n++; rows[k].iou += s.iou; rows[k].bf += s.bf; rows[k].mae += s.mae;
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const table = Object.values(rows).map((r) => ({ ...r, iou: r4(r.iou / r.n), bf: r4(r.bf / r.n), mae: r4(r.mae / r.n) }));
console.log('category/task              model                 n   IoU     BF      αMAE');
for (const r of table) console.log(`${(r.category + '/' + r.task).padEnd(26)} ${r.model.padEnd(20)} ${String(r.n).padStart(2)}  ${r.iou.toFixed(3)}  ${r.bf.toFixed(3)}  ${r.mae.toFixed(3)}`);
const timings = fs.existsSync(path.join(setDir, 'timings.json')) ? JSON.parse(fs.readFileSync(path.join(setDir, 'timings.json'), 'utf8')) : null;
if (timings) console.log('median s/call (this machine):', JSON.stringify(timings.median_s));

if (args.has('--update') || !fs.existsSync(basePath)) {
  fs.writeFileSync(basePath, JSON.stringify({ note: 'CHR-297 real-photo baseline (public datasets, see test/fixtures/mask-quality/realset.json). Regenerate: node test/mask_quality_real.mjs --update', tolerance: TOL, rows: table, fixtures: per.map((p) => ({ ...p, iou: r4(p.iou), bf: r4(p.bf), mae: r4(p.mae) })), timingsThisMachine: timings && { cpu: timings.cpu, onnxruntime: timings.onnxruntime, median_s: timings.median_s } }, null, 1) + '\n');
  console.log(`wrote ${basePath}`); process.exit(0);
}
const base = JSON.parse(fs.readFileSync(basePath, 'utf8')); const fails = [];
for (const b of base.rows) { const r = table.find((x) => x.category === b.category && x.task === b.task); if (!r) { fails.push(`${b.category}/${b.task} missing`); continue; } for (const k of ['iou', 'bf']) if (r[k] < b[k] - TOL) fails.push(`${b.category}/${b.task} ${k} ${r[k]} < baseline ${b[k]} - ${TOL}`); }
if (fails.length) { console.error('FAIL mask_quality_real:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`PASS mask_quality_real: ${table.length} rows within ${TOL} of baseline`);
