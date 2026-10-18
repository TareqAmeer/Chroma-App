#!/usr/bin/env node
// Reads the Lightroom exports of the calibration chart (one slider moved per file), and for each finds
// the Chromasmith slider value whose render of the SAME chart matches Lightroom's pixels best.
// Result: how strong each of our sliders is relative to Lightroom's, written to calib_map.json.
//
//   node tools/autotrain/calib/analyze.mjs <exportFolder> [--chart tools/autotrain/data/calibration] [--out calib_map.json]
//
// Files are identified by the Lightroom settings embedded in each export (crs:*), not by filename, so
// naming does not matter. An export with no tone settings is treated as the unedited baseline.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBmp } from '../lib.mjs';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const dir = argv.find((a, i) => !a.startsWith('--') && !['--chart', '--out'].includes(argv[i - 1]));
if (!dir) { console.error('usage: analyze.mjs <exportFolder> [--chart dir] [--out file]'); process.exit(2); }
const chartDir = opt('--chart', path.join(ROOT, 'tools/autotrain/data/calibration')), outFile = opt('--out', path.join(chartDir, 'calib_map.json'));
const layout = JSON.parse(readFileSync(path.join(chartDir, 'chart_layout.json'), 'utf8'));

// our slider for each Lightroom setting; LR exposure is in stops, ours is stops*20
const MAP = { Exposure2012: ['exp', 'sl-adj-exp', 20], Contrast2012: ['con', 'sl-adj-con', 1], Highlights2012: ['hi', 'sl-adj-hi', 1], Shadows2012: ['sh', 'sl-adj-sh', 1],
  Whites2012: ['wh', 'sl-adj-wh', 1], Blacks2012: ['bl', 'sl-adj-bl', 1], Vibrance: ['vib', 'sl-adj-vib', 1], Saturation: ['sat', 'sl-adj-sat', 1] };

function lrSettings(file) {
  const s = readFileSync(file).toString('latin1'), i = s.indexOf('<x:xmpmeta'); if (i < 0) return {};
  const x = s.slice(i, s.indexOf('</x:xmpmeta>') + 12), out = {};
  for (const k of Object.keys(MAP)) { const m = x.match(new RegExp(`crs:${k}="([-+0-9.]+)"`)); if (m && parseFloat(m[1]) !== 0) out[k] = parseFloat(m[1]); }
  return out;
}
function decode(file) {
  const d = mkdtempSync(path.join(tmpdir(), 'calib-'));
  try { execFileSync('sips', ['-s', 'format', 'bmp', file, '--out', path.join(d, 'x.bmp')], { stdio: 'ignore' }); return readBmp(readFileSync(path.join(d, 'x.bmp'))); }
  finally { rmSync(d, { recursive: true, force: true }); }
}
// sample every patch centre (40% of the patch) + 16 ramp points; returns flat [r,g,b,...]
function sampleImg({ w, h, rgb }, layout) {
  const out = [], P = layout.patch, fx = w / layout.width, fy = h / layout.height;
  const mean = (cx, cy, hw, hh) => { let r = 0, g = 0, b = 0, n = 0; for (let y = Math.floor((cy - hh) * fy); y < Math.ceil((cy + hh) * fy); y++) for (let x = Math.floor((cx - hw) * fx); x < Math.ceil((cx + hw) * fx); x++) { const o = (y * w + x) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; n++; } return [r / n, g / n, b / n]; };
  for (let i = 0; i < layout.patches.length; i++) { if (layout.patches[i].name === 'pad') continue; out.push(...mean((i % layout.cols + .5) * P, (Math.floor(i / layout.cols) + .5) * P, P * .2, P * .2)); }
  for (let k = 0; k < 16; k++) out.push(...mean(((k + .5) / 16) * layout.width, (layout.rampRow + .5) * P, 12, P * .2));
  return out;
}
const sample = img => sampleImg(img, layout);
const mad = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) e += Math.abs(a[i] - b[i]); return e / a.length; };

const files = readdirSync(dir).filter(n => !n.startsWith('.') && /\.(jpe?g|png)$/i.test(n));
const exports = [];
for (const f of files) {
  const lr = lrSettings(path.join(dir, f)), keys = Object.keys(lr);
  if (keys.length > 1) { console.log(`skip ${f}: more than one slider moved (${keys.join(', ')})`); continue; }
  exports.push({ file: f, key: keys[0] || null, value: keys[0] ? lr[keys[0]] : 0, px: sample(decode(path.join(dir, f))) });
}
console.log(`${exports.length} exports (${exports.filter(e => !e.key).length} baseline)`);
if (!exports.some(e => e.key)) { console.error('no export carries a Lightroom slider value — export as JPG with edits, from the presets in presets/'); process.exit(1); }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function');
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });
  const chart = readFileSync(path.join(chartDir, 'chart.png')).toString('base64');
  await page.evaluate(async ({ chart, samplerSrc, layout }) => {
    const sampleImg = eval('(' + samplerSrc + ')');
    const bytes = Uint8Array.from(atob(chart), c => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'chart.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single');
    if (!document.getElementById('tg-adjust').classList.contains('on')) toggleFX('adjust');
    window.__render = async (id, val) => {
      for (const s of document.querySelectorAll('[id^="sl-adj-"]')) if (s.type === 'range' && ['exp','con','hi','sh','wh','bl','vib','sat'].includes(s.id.slice(7))) s.value = '0';
      if (id) document.getElementById(id).value = String(val);
      fxUpdate();
      const src = fxWork || fxImg, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      const cv = await processToCanvas(getFXParams(), src, w, h, undefined, fxPrepareExportRenderer());
      const d = cv.getContext('2d').getImageData(0, 0, w, h).data, o = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { o[i * 3] = d[i * 4]; o[i * 3 + 1] = d[i * 4 + 1]; o[i * 3 + 2] = d[i * 4 + 2]; }
      return sampleImg({ w, h, rgb: o }, layout); // only the small sample vector crosses back to Node
    };
  }, { chart, samplerSrc: sampleImg.toString(), layout });
  const ours = (id, v) => page.evaluate(([i, x]) => window.__render(i, x), [id, v]);

  const base = exports.find(e => !e.key);
  if (base) { const z = await ours(null, 0); console.log(`baseline check: our untouched render vs Lightroom's untouched export differ by ${mad(z, base.px).toFixed(2)} / 255 (should be ~1)`); }
  for (const e of exports.filter(x => x.key)) {
    const [name, id, unit] = MAP[e.key], lrUnits = e.value * unit;
    const f = async v => mad(await ours(id, v), e.px);
    let best = { v: 0, e: await f(0) }; const zero = best.e;
    for (const step of [20, 8, 3, 1]) { // coarse-to-fine line search around the current best
      for (let v = Math.max(-100, best.v - step * 4); v <= Math.min(100, best.v + step * 4); v += step) { const err = await f(v); if (err < best.e) best = { v, e: err }; }
    }
    results.push({ slider: name, lr: e.value, lrUnits, ours: best.v, err: best.e, errAtZero: zero, ratio: lrUnits !== 0 ? best.v / lrUnits : null });
    console.log(`${name.padEnd(4)} LR ${String(e.value).padStart(6)}  ->  ours ${String(best.v).padStart(6)}   (ratio ${(best.v / lrUnits).toFixed(2)}; mismatch ${best.e.toFixed(2)} vs ${zero.toFixed(2)} untouched)`);
  }
} finally { await browser.close(); }

const map = {};
for (const name of new Set(results.map(r => r.slider))) {
  const pts = results.filter(r => r.slider === name), num = pts.reduce((s, r) => s + r.ours * r.lrUnits, 0), den = pts.reduce((s, r) => s + r.lrUnits ** 2, 0);
  map[name] = { k: den ? num / den : null, points: pts, goodFit: pts.every(r => r.err < r.errAtZero * 0.6) };
}
writeFileSync(outFile, JSON.stringify({ made: new Date().toISOString(), note: 'ours = k * LR (LR exposure in stops*20). goodFit=false means our slider cannot reproduce Lightroom for that setting.', map }, null, 1));
console.log('\nour slider = k x Lightroom value:');
for (const [n, m] of Object.entries(map)) console.log(`  ${n.padEnd(4)} k = ${m.k == null ? 'n/a' : m.k.toFixed(2)}${m.goodFit ? '' : '   (weak match: sliders behave differently)'}`);
console.log(`wrote ${outFile}`);
