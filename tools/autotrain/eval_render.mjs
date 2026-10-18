#!/usr/bin/env node
// Decisive check: on held-out RAW photos that have a baked Lightroom JPG, render the plain photo with
//   (a) no edit, (b) the app's current Auto-enhance, (c) the learned model's sliders converted with
//   calib_map.json, (d) Lightroom's own slider values converted the same way (the best any slider
//   conversion could do), and measure each against Lightroom's actual pixels.
//
//   node tools/autotrain/eval_render.mjs <exportFolder> <dataset.json> <model.json> [calib_map.json] [--limit 20]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { thumbnail, predictRidge } from './lib.mjs';
import { load } from '../../test/unit/extract.mjs';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit');
const [dir, dsFile, modelFile] = pos, calibFile = pos[3] || path.join(ROOT, 'tools/autotrain/data/calibration/calib_map.json');
const limit = parseInt((argv.includes('--limit') ? argv[argv.indexOf('--limit') + 1] : '20'), 10), SIZE = 192;
const ds = JSON.parse(readFileSync(dsFile, 'utf8')), model = JSON.parse(readFileSync(modelFile, 'utf8')).model, K = JSON.parse(readFileSync(calibFile, 'utf8')).map;
const IDS = { exp: 'sl-adj-exp', hi: 'sl-adj-hi', sh: 'sl-adj-sh', con: 'sl-adj-con', wh: 'sl-adj-wh', bl: 'sl-adj-bl', vib: 'sl-adj-vib' };
const clamp = v => Math.max(-100, Math.min(100, Math.round(v)));
const conv = vals => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, clamp(v * (K[k]?.k ?? 1))]));
const { autoEnhanceParams } = load(['autoEnhanceParams']);

// held-out = every 5th row (same split as train.mjs); keep RAW rows that have a same-stem baked JPG
const names = readdirSync(dir).filter(n => !n.startsWith('.'));
const rows = ds.rows.map((r, i) => ({ ...r, i })).filter(r => r.i % 5 === 0 && /\.rw2$/i.test(r.file))
  .map(r => { const stem = r.file.replace(/\.[^.]+$/, ''), j = names.find(n => n.replace(/\.[^.]+$/, '') === stem && /\.jpe?g$/i.test(n)); return j ? { ...r, jpg: path.join(dir, j), raw: path.join(dir, r.file) } : null; })
  .filter(Boolean).slice(0, limit);
console.log(`${rows.length} held-out RAW photos with a baked Lightroom JPG`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tot = { none: 0, current: 0, learned: 0, oracle: 0 }, per = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function');
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });
  for (const r of rows) {
    const a = thumbnail(r.raw, SIZE), t = thumbnail(r.jpg, SIZE); if (a.w !== t.w || a.h !== t.h) continue;
    const rgba = new Uint8ClampedArray(a.w * a.h * 4); for (let i = 0; i < a.w * a.h; i++) rgba.set([a.rgb[i * 3], a.rgb[i * 3 + 1], a.rgb[i * 3 + 2], 255], i * 4);
    const cur = conv0(autoEnhanceParams(rgba)), pred = predictRidge(model, r.x), learned = conv(Object.fromEntries(ds.labels.map((l, o) => [l, pred[o]])));
    const lrTrue = readFileSync(r.raw.replace(/\.[^.]+$/, '.xmp'), 'utf8'), oracle = conv(parseLr(lrTrue));
    const variants = { none: {}, current: cur, learned, oracle };
    const errs = await page.evaluate(async ({ a, t, variants, IDS }) => {
      const cv = x => { const c = document.createElement('canvas'); c.width = x.w; c.height = x.h; const g = c.getContext('2d'), im = g.createImageData(x.w, x.h), d = atob(x.rgb); for (let i = 0; i < x.w * x.h; i++) { im.data[i*4] = d.charCodeAt(i*3); im.data[i*4+1] = d.charCodeAt(i*3+1); im.data[i*4+2] = d.charCodeAt(i*3+2); im.data[i*4+3] = 255; } g.putImageData(im, 0, 0); return c; };
      const oc = cv(a), tc = cv(t), blob = await new Promise(r => oc.toBlob(r, 'image/png'));
      await loadFXImages([new File([blob], 'o.png', { type: 'image/png' })]);
      document.body.classList.add('fx-single'); if (!document.getElementById('tg-adjust').classList.contains('on')) toggleFX('adjust');
      const tgt = tc.getContext('2d').getImageData(0, 0, tc.width, tc.height).data, src = fxWork || fxImg, w = tc.width, h = tc.height, out = {};
      for (const [name, v] of Object.entries(variants)) {
        for (const id of Object.values(IDS)) document.getElementById(id).value = '0';
        for (const [k, x] of Object.entries(v)) document.getElementById(IDS[k]).value = String(x);
        fxUpdate();
        const c = await processToCanvas(getFXParams(), src, w, h, undefined, fxPrepareExportRenderer()), d = c.getContext('2d').getImageData(0, 0, w, h).data; let e = 0;
        for (let i = 0; i < w * h; i++) e += Math.abs(d[i*4] - tgt[i*4]) + Math.abs(d[i*4+1] - tgt[i*4+1]) + Math.abs(d[i*4+2] - tgt[i*4+2]);
        out[name] = e / (w * h * 3);
      }
      return out;
    }, { a: { ...a, rgb: Buffer.from(a.rgb).toString('base64') }, t: { ...t, rgb: Buffer.from(t.rgb).toString('base64') }, variants, IDS });
    for (const k of Object.keys(tot)) tot[k] += errs[k];
    per.push(errs);
    console.log(`${r.file.padEnd(14)} none ${errs.none.toFixed(1)}  current ${errs.current.toFixed(1)}  learned ${errs.learned.toFixed(1)}  oracle ${errs.oracle.toFixed(1)}`);
  }
} finally { await browser.close(); }
const n = per.length, wins = per.filter(e => e.learned < e.current).length;
console.log(`\nmean error vs Lightroom's pixels (0-255, lower is better), ${n} photos:`);
for (const k of Object.keys(tot)) console.log(`  ${k.padEnd(8)} ${(tot[k] / n).toFixed(2)}`);
console.log(`learned beat the current Auto-enhance on ${wins}/${n} photos`);

function conv0(p) { return Object.fromEntries(Object.entries(p).filter(([k]) => IDS[k]).map(([k, v]) => [k, clamp(v)])); } // current auto already outputs OUR slider units
function parseLr(x) { const g = k => { const m = x.match(new RegExp(`crs:${k}="([-+0-9.]+)"`)); return m ? parseFloat(m[1]) : 0; };
  return { exp: g('Exposure2012') * 20, hi: g('Highlights2012'), sh: g('Shadows2012'), con: g('Contrast2012'), wh: g('Whites2012'), bl: g('Blacks2012'), vib: g('Vibrance') }; }
