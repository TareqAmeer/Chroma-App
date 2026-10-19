#!/usr/bin/env node
// Procedural labelled mask-quality fixtures (CHR-297). Ground truth is exact by construction, so no
// third-party photos or licences are involved. Writes to test/output/mask-quality/ (gitignored) plus a
// manifest, then runs test/mask_refinement_quality.mjs and writes a baseline table.
//   node test/mask_quality_synth.mjs                 # generate + evaluate simulated candidates
//   node test/mask_quality_synth.mjs --candidates D  # use D/<id>.png app exports as refinedMask
// Candidates are SIMULATED unless --candidates is given: sourceMask mimics a low-res SAM decoder
// output (1/8 res, hard threshold, nearest upsample); refinedMask mimics Feather (box blur).
// This is a harness baseline, not a measurement of the shipped models. Thresholds live in
// test/mask_quality_thresholds.json and are fixed before any candidate is evaluated.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

const W = 192, H = 192, PER = 4;
const out = path.resolve('test/output/mask-quality');
const candDir = process.argv[2] === '--candidates' ? path.resolve(process.argv[3]) : null;
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const newField = () => new Float32Array(W * H);
function disc(a, cx, cy, r, v = 1, soft = 1.2) {
  for (let y = Math.max(0, cy - r - 2 | 0); y < Math.min(H, cy + r + 3); y++) for (let x = Math.max(0, cx - r - 2 | 0); x < Math.min(W, cx + r + 3); x++) {
    const d = Math.hypot(x + .5 - cx, y + .5 - cy), c = Math.max(0, Math.min(1, (r - d) / soft + .5)) * v;
    if (c > a[y * W + x]) a[y * W + x] = c;
  }
}
function stroke(a, pts, r, v = 1) { for (let i = 0; i < pts.length - 1; i++) { const n = 12; for (let k = 0; k <= n; k++) disc(a, pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n, r, v, 1); } }
function curve(a, x0, y0, len, ang, r, bend) { const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([x0 + Math.cos(ang + bend * t) * len * t, y0 + Math.sin(ang + bend * t) * len * t]); } stroke(a, pts, r); }
const ring = (a, cx, cy, r, th) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.abs(Math.hypot(x + .5 - cx, y + .5 - cy) - r); const c = Math.max(0, Math.min(1, (th - d) + .5)); if (c > a[y * W + x]) a[y * W + x] = c; } };

const makers = {
  hair: (a) => { disc(a, 96, 110, 48); for (let i = 0; i < 70; i++) curve(a, 96 + (rnd() - .5) * 80, 70 + rnd() * 20, 30 + rnd() * 40, -Math.PI / 2 + (rnd() - .5) * 2.2, .55 + rnd() * .5, (rnd() - .5) * 2); },
  foliage: (a) => { stroke(a, [[96, 190], [96, 90]], 3); for (let i = 0; i < 90; i++) { const x = 96 + (rnd() - .5) * 120, y = 40 + rnd() * 110; if (Math.hypot(x - 96, y - 90) < 62) disc(a, x, y, 3 + rnd() * 5, 1, 1); } },
  glasses: (a) => { ring(a, 60, 96, 26, 1.6); ring(a, 132, 96, 26, 1.6); stroke(a, [[86, 92], [106, 92]], 1.2); stroke(a, [[34, 90], [8, 84]], 1.2); stroke(a, [[158, 90], [184, 84]], 1.2); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const l = Math.hypot(x - 60, y - 96) < 25 || Math.hypot(x - 132, y - 96) < 25; if (l && a[y * W + x] < .3) a[y * W + x] = .3; } },
  backlit: (a) => { disc(a, 96, 100, 55, 1, 5); for (let i = 0; i < 25; i++) curve(a, 96 + (rnd() - .5) * 90, 60, 25 + rnd() * 25, -Math.PI / 2 + (rnd() - .5) * 2, .6 + rnd() * .4, (rnd() - .5)); },
  'multi-person': (a) => { for (const [cx, cy, r] of [[55, 100, 36], [100, 90, 40], [145, 105, 34]]) { disc(a, cx, cy, r); stroke(a, [[cx, cy + r - 6], [cx, 188]], r * .7); } },
  occluded: (a) => { disc(a, 96, 100, 60); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - 110) < 7) a[y * W + x] = 0; },
  'complex-sky': (a) => { stroke(a, [[0, 190], [40, 140], [70, 80], [96, 20]], 2.2); for (let i = 0; i < 60; i++) { const t = rnd(), bx = 20 + t * 70, by = 150 - t * 120; curve(a, bx, by, 15 + rnd() * 25, -Math.PI / 2 + (rnd() - .3) * 2.5, .6 + rnd() * .6, (rnd() - .5) * 1.5); } },
  'fine-edge': (a) => { for (let i = 0; i < 12; i++) stroke(a, [[0, 20 + i * 14], [W, 30 + i * 14 + (rnd() - .5) * 10]], .5 + rnd() * .5); for (let i = 0; i < 4; i++) stroke(a, [[30 + i * 45, 0], [30 + i * 45 + 8, H]], .8); },
};
const bright = new Set(['backlit', 'complex-sky']);

function savePng(file, w, h, fn) { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { const [r, g, b] = fn(i); p.data.set([r, g, b, 255], i * 4); } fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, PNG.sync.write(p)); }
const gray = (a) => (i) => { const v = Math.round(Math.max(0, Math.min(1, a[i])) * 255); return [v, v, v]; };
function lowResThreshold(a) { const s = 8, o = newField(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) m += a[(Math.min(H - 1, (y / s | 0) * s + dy)) * W + Math.min(W - 1, (x / s | 0) * s + dx)]; o[y * W + x] = m / (s * s) >= .5 ? 1 : 0; } return o; }
function boxBlur(a, r) { const o = newField(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; s += a[yy * W + xx]; n++; } o[y * W + x] = s / n; } return o; }

const fixtures = [];
for (const [cat, make] of Object.entries(makers)) for (let k = 1; k <= PER; k++) {
  const id = `${cat}-${String(k).padStart(3, '0')}`, a = newField(); make(a);
  const bgv = bright.has(cat) ? 235 : 70, fgv = bright.has(cat) ? 40 : 190;
  const src = lowResThreshold(a);
  const cand = candDir ? null : boxBlur(src, 2);
  savePng(path.join(out, id, 'alpha.png'), W, H, gray(a));
  savePng(path.join(out, id, 'photo.png'), W, H, (i) => { const v = Math.round(bgv * (1 - a[i]) + fgv * a[i]); return [v, v, Math.min(255, v + 10)]; });
  savePng(path.join(out, id, 'ai-mask.png'), W, H, gray(src));
  const refined = candDir ? path.join(candDir, `${id}.png`) : path.join(out, id, 'refined-mask.png');
  if (!candDir) savePng(refined, W, H, gray(cand));
  fixtures.push({ id, categories: cat === 'fine-edge' || cat === 'complex-sky' || cat === 'hair' || cat === 'foliage' ? [cat, ...(cat === 'complex-sky' ? ['fine-edge'] : [])] : [cat], photo: `${id}/photo.png`, groundTruth: `${id}/alpha.png`, sourceMask: `${id}/ai-mask.png`, refinedMask: candDir ? refined : `${id}/refined-mask.png` });
}
const thresholds = JSON.parse(fs.readFileSync('test/mask_quality_thresholds.json', 'utf8')).thresholds;
const manifest = { version: 1, provenance: { source: 'test/mask_quality_synth.mjs (procedural, exact ground truth)', license: 'Generated in-repo; no third-party data' }, thresholds, fixtures };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
const r = spawnSync('node', ['test/mask_refinement_quality.mjs', '--manifest', path.join(out, 'manifest.json')], { encoding: 'utf8', maxBuffer: 1 << 26 });
const rep = JSON.parse(r.stdout);
const byCat = {};
for (const f of rep.fixtures) { const c = f.id.replace(/-\d+$/, ''); (byCat[c] ||= []).push(f); }
const avg = (l, k, s) => l.reduce((t, f) => t + f[s][k], 0) / l.length;
const rows = Object.entries(byCat).map(([c, l]) => ({ category: c, n: l.length, source: { alphaMae: avg(l, 'alphaMae', 'sourceMetrics'), boundaryMae: avg(l, 'boundaryMae', 'sourceMetrics'), fp: avg(l, 'falsePositivePercent', 'sourceMetrics') }, refined: { alphaMae: avg(l, 'alphaMae', 'refinedMetrics'), boundaryMae: avg(l, 'boundaryMae', 'refinedMetrics'), fp: avg(l, 'falsePositivePercent', 'refinedMetrics') }, failing: l.filter(f => f.failures.length).length }));
console.log('category        n  src αMAE  src bndMAE  ref αMAE  ref bndMAE  ref FP%  fail');
for (const r2 of rows) console.log(`${r2.category.padEnd(14)} ${r2.n}  ${r2.source.alphaMae.toFixed(4)}    ${r2.source.boundaryMae.toFixed(4)}      ${r2.refined.alphaMae.toFixed(4)}   ${r2.refined.boundaryMae.toFixed(4)}      ${r2.refined.fp.toFixed(2)}    ${r2.failing}/${r2.n}`);
if (!candDir) fs.writeFileSync('test/mask_quality_baseline.json', JSON.stringify({ note: 'SIMULATED candidates (low-res threshold + box blur); harness baseline, not shipped-model measurements. Regenerate with node test/mask_quality_synth.mjs.', fixtures: rep.fixtures.length, rows }, null, 1) + '\n');
