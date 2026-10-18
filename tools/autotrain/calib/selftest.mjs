#!/usr/bin/env node
// Self-test for analyze.mjs: fabricates "Lightroom exports" with OUR renderer using a known ratio
// (ours = 0.5 x LR for highlights, 1.0 for the rest), embeds fake crs settings, runs the analyzer,
// and checks it recovers those ratios. Proves the measuring chain; says nothing about real Lightroom.
//
//   node tools/autotrain/calib/selftest.mjs
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { deflateSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const chartDir = path.join(ROOT, 'tools/autotrain/data/calibration');
const work = mkdtempSync(path.join(tmpdir(), 'calib-self-'));
const CASES = [ // [crs key, our slider id, LR value, ourValue-to-render]
  ['Highlights2012', 'sl-adj-hi', -80, -40], ['Shadows2012', 'sl-adj-sh', 50, 50], ['Contrast2012', 'sl-adj-con', 50, 50], ['Exposure2012', 'sl-adj-exp', 1, 20], ['Vibrance', 'sl-adj-vib', 50, 50],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function');
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });
  const chart = readFileSync(path.join(chartDir, 'chart.png')).toString('base64');
  await page.evaluate(async chart => {
    await loadFXImages([new File([Uint8Array.from(atob(chart), c => c.charCodeAt(0))], 'chart.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single'); if (!document.getElementById('tg-adjust').classList.contains('on')) toggleFX('adjust');
  }, chart);
  const render = (id, v) => page.evaluate(async ([id, v]) => {
    for (const s of document.querySelectorAll('[id^="sl-adj-"]')) if (s.type === 'range') s.value = '0';
    if (id) document.getElementById(id).value = String(v); fxUpdate();
    const src = fxWork || fxImg, cv = await processToCanvas(getFXParams(), src, src.naturalWidth || src.width, src.naturalHeight || src.height, undefined, fxPrepareExportRenderer());
    return cv.toDataURL('image/png').split(',')[1];
  }, [id, v]);
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, 'latin1'), d])) >>> 0, 8 + d.length); return b; };
  const withXmp = (png, xmp) => { const iend = png.length - 12, itxt = Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), Buffer.from(xmp, 'utf8')]); return Buffer.concat([png.subarray(0, iend), chunk('iTXt', itxt), png.subarray(iend)]); };
  const xmpFor = (k, v) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"${k ? ` crs:${k}="${v}"` : ''}/></rdf:RDF></x:xmpmeta>`;
  writeFileSync(path.join(work, 'base.png'), withXmp(Buffer.from(await render(null, 0), 'base64'), xmpFor(null)));
  for (const [k, id, lr, ours] of CASES) writeFileSync(path.join(work, `${k}.png`), withXmp(Buffer.from(await render(id, ours), 'base64'), xmpFor(k, lr)));
} finally { await browser.close(); }

const outJson = path.join(work, 'map.json');
const r = execFileSync('node', [path.join(ROOT, 'tools/autotrain/calib/analyze.mjs'), work, '--out', outJson], { encoding: 'utf8', env: process.env });
console.log(r);
const map = JSON.parse(readFileSync(outJson, 'utf8')).map;
const expect = { hi: 0.5, sh: 1, con: 1, exp: 1, vib: 1 };
let bad = 0;
for (const [n, k] of Object.entries(expect)) { const got = map[n]?.k; const ok = got != null && Math.abs(got - k) < 0.12; if (!ok) bad++; console.log(`${n}: expected k=${k} got ${got?.toFixed(2)} ${ok ? 'OK' : 'FAIL'}`); }
rmSync(work, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
