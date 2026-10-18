#!/usr/bin/env node
// Pair mode: when you only have Lightroom's RENDERED result (original + "_edited" export, no slider
// values), find the Chromasmith Basic sliders that make our own renderer turn the original into the
// Lightroom-edited picture, and save them as the training labels. Uses the real app in headless Chrome,
// so the learned values mean exactly what they do in the editor.
//
//   node tools/autotrain/fit_pairs.mjs <folder> [--limit 90] [--size 192] [--out tools/autotrain/data/dataset.json]
//
// Pairs: IMG_1234.(jpg|jpeg|png) + IMG_1234_edited.(jpg|png) in the same folder. The fit residual
// (mean abs error after the best sliders, 0-255) is stored per photo so a train step can drop pictures
// our sliders simply cannot reproduce (local tone mapping etc.).
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { thumbnail, features, FEATURE_NAMES } from './lib.mjs';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const dir = argv.find((a, i) => !a.startsWith('--') && !['--limit', '--size', '--out'].includes(argv[i - 1]));
if (!dir) { console.error('usage: fit_pairs.mjs <folder> [--limit N] [--size px] [--out file]'); process.exit(2); }
const limit = parseInt(opt('--limit', '90'), 10), size = parseInt(opt('--size', '192'), 10), out = opt('--out', 'tools/autotrain/data/dataset.json');

const names = readdirSync(dir).filter(n => !n.startsWith('.')); // skip macOS ._ AppleDouble files on exFAT drives
const pairs = names.filter(n => /_edited\.(jpe?g|png)$/i.test(n)).map(e => {
  const stem = e.replace(/_edited\.[^.]+$/i, ''), o = names.find(n => n !== e && n.replace(/\.[^.]+$/, '') === stem && /\.(jpe?g|png)$/i.test(n));
  return o ? { stem, orig: path.join(dir, o), edit: path.join(dir, e) } : null;
}).filter(Boolean).slice(0, limit);
console.log(`${pairs.length} original/edited pairs`);

const SL = [['exp', 'sl-adj-exp', -60, 60], ['con', 'sl-adj-con', -60, 60], ['hi', 'sl-adj-hi', -100, 60], ['sh', 'sl-adj-sh', -60, 100],
  ['wh', 'sl-adj-wh', -60, 60], ['bl', 'sl-adj-bl', -60, 60], ['vib', 'sl-adj-vib', -60, 80], ['sat', 'sl-adj-sat', -60, 60]];
const LABELS = ['exp', 'hi', 'sh', 'con', 'wh', 'bl', 'vib']; // what the learned model predicts (sat is fitted but not learned)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = []; let t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function');
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });

  for (const [k, p] of pairs.entries()) {
    const a = thumbnail(p.orig, size), b = thumbnail(p.edit, size);
    if (a.w !== b.w || a.h !== b.h) { console.log(`skip ${p.stem}: size mismatch`); continue; }
    const fit = await page.evaluate(async ({ a, b, SL }) => {
      const toCanvas = (t) => { const c = document.createElement('canvas'); c.width = t.w; c.height = t.h; const x = c.getContext('2d'), im = x.createImageData(t.w, t.h), d = atob(t.rgb);
        for (let i = 0; i < t.w * t.h; i++) { im.data[i * 4] = d.charCodeAt(i * 3); im.data[i * 4 + 1] = d.charCodeAt(i * 3 + 1); im.data[i * 4 + 2] = d.charCodeAt(i * 3 + 2); im.data[i * 4 + 3] = 255; } x.putImageData(im, 0, 0); return c; };
      const oc = toCanvas(a), ec = toCanvas(b);
      const blob = await new Promise(r => oc.toBlob(r, 'image/png'));
      await loadFXImages([new File([blob], 'o.png', { type: 'image/png' })]);
      document.body.classList.add('fx-single');
      if (!document.getElementById('tg-adjust').classList.contains('on')) toggleFX('adjust');
      const tgt = ec.getContext('2d').getImageData(0, 0, ec.width, ec.height).data;
      const src = fxWork || fxImg, w = ec.width, h = ec.height;
      const render = async (v) => {
        for (const [key, id] of SL.map(s => [s[0], s[1]])) document.getElementById(id).value = String(Math.round(v[key]));
        fxUpdate();
        const cv = await processToCanvas(getFXParams(), src, w, h, undefined, fxPrepareExportRenderer());
        const d = cv.getContext('2d').getImageData(0, 0, w, h).data; let e = 0;
        for (let i = 0; i < w * h; i++) e += Math.abs(d[i * 4] - tgt[i * 4]) + Math.abs(d[i * 4 + 1] - tgt[i * 4 + 1]) + Math.abs(d[i * 4 + 2] - tgt[i * 4 + 2]);
        return e / (w * h * 3);
      };
      const v = Object.fromEntries(SL.map(s => [s[0], 0])); let best = await render(v); const start = best;
      for (const step of [24, 10, 4, 1.5]) {
        for (let pass = 0; pass < 2; pass++) for (const [key, , lo, hi] of SL) {
          for (const dir of [1, -1]) {
            for (;;) { const nv = Math.max(lo, Math.min(hi, v[key] + dir * step)); if (nv === v[key]) break;
              const old = v[key]; v[key] = nv; const e = await render(v); if (e < best - 1e-3) best = e; else { v[key] = old; break; } }
          }
        }
      }
      return { v, start, best };
    }, { a: { ...a, rgb: Buffer.from(a.rgb).toString('base64') }, b: { ...b, rgb: Buffer.from(b.rgb).toString('base64') }, SL });
    rows.push({ file: p.stem, x: features(a), y: LABELS.map(l => fit.v[l]), w: a.w, h: a.h, fitStart: fit.start, fitEnd: fit.best, sat: fit.v.sat, rgb: Buffer.from(a.rgb).toString('base64') });
    console.log(`${String(k + 1).padStart(3)}/${pairs.length} ${p.stem}  err ${fit.start.toFixed(1)} -> ${fit.best.toFixed(1)}  ${JSON.stringify(Object.fromEntries(Object.entries(fit.v).map(([k2, x]) => [k2, Math.round(x)])))}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} finally { await browser.close(); }
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ featureNames: FEATURE_NAMES, labels: LABELS, source: 'pair-fit', rows }));
console.log(`wrote ${rows.length} rows -> ${out}`);
