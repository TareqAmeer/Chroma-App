// CHR-178: the reference window's "Match to this" button moves the CURRENT photo toward the
// reference. Measured as mean-colour distance between the rendered preview and the reference.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = req.url.split('?')[0];
    const d = await readFile(path.join(ROOT, decodeURIComponent(u).slice(1)));
    res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : u.endsWith('.png') ? 'image/png' : u.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: process.argv.includes('mobile') ? 390 : 1400, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await p.waitForFunction(() => typeof loadFXImages === 'function' && typeof fxRefShow === 'function');
const b64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
const out = await p.evaluate(async b64 => {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  await loadFXImages([new File([bin], 'p.png', { type: 'image/png' })]);
  await new Promise(r => setTimeout(r, 800));
  const mean = el => { const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height, k = Math.min(1, 120 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d'); x.drawImage(el, 0, 0, c.width, c.height); const d = x.getImageData(0, 0, c.width, c.height).data; const m = [0, 0, 0]; let n = 0;
    for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; n++; } return m.map(v => v / n); };
  // reference: the same scene a stop brighter and warmer
  renderPreview(); await new Promise(r => setTimeout(r, 700)); renderPreview(); await new Promise(r => setTimeout(r, 300)); const g0 = FX.getPixels(), src = document.createElement("canvas"); src.width = g0.w; src.height = g0.h; src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(g0.px.buffer), g0.w, g0.h), 0, 0);
  const rc = document.createElement('canvas'); rc.width = src.width; rc.height = src.height; const rx = rc.getContext('2d'); rx.drawImage(src, 0, 0);
  const id = rx.getImageData(0, 0, rc.width, rc.height); for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.min(255, id.data[i] * 1.7 * 1.15); id.data[i + 1] = Math.min(255, id.data[i + 1] * 1.7); id.data[i + 2] = Math.min(255, id.data[i + 2] * 1.7 * 0.8); }
  rx.putImageData(id, 0, 0);
  const blob = await new Promise(r => rc.toBlob(r, 'image/png'));
  fxRefShow(URL.createObjectURL(blob), 'ref');
  const ref = document.querySelector('#fx-ref-win img'); await new Promise(r => { if (ref.complete) r(); else ref.onload = r; });
  const dist = async () => { renderPreview(); await new Promise(r => setTimeout(r, 500)); renderPreview(); await new Promise(r => setTimeout(r, 200)); const g = FX.getPixels(), cc = document.createElement("canvas"); cc.width = g.w; cc.height = g.h; cc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(g.px.buffer), g.w, g.h), 0, 0); const a = mean(cc), t = mean(ref); return Math.hypot(a[0] - t[0], a[1] - t[1], a[2] - t[2]); };
  const r = { before: await dist() };
  const btn = document.querySelector('#fx-ref-win .ref-match'); r.hasButton = !!btn;
  btn.click(); await new Promise(r => setTimeout(r, 300));
  r.after1 = await dist(); r.override1 = { exp: curItem().adjustOverride.exp, temp: curItem().adjustOverride.temp };
  btn.click(); await new Promise(r => setTimeout(r, 300));
  r.after2 = await dist(); r.sliderExp = document.getElementById('sl-adj-exp').value;
  return r;
}, b64);
console.log(JSON.stringify(out));
assert.ok(out.hasButton, 'Match to this button is in the reference window');
assert.ok(out.after1 < out.before * 0.7, `one click closes the gap (${out.before.toFixed(1)} -> ${out.after1.toFixed(1)})`);
assert.ok(out.after2 <= out.after1 + 1, 'a second click does not make it worse');
assert.ok(out.override1.exp > 0, 'exposure was raised toward the brighter reference');
assert.deepEqual(errors, []);
console.log('PASS reference "Match to this"');
await b.close(); server.close();
