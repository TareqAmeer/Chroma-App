// CHR-249 Super Resolution front-end contract with a mocked Tauri bridge: the Export option appears
// only when the native model reports available, fxSuperResCanvas frames the request correctly and
// rebuilds the enlarged canvas, progress events are forwarded, and failures surface as errors.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    window.__calls = []; window.__avail = true; window.__fail = false;
    let listener = null;
    window.__TAURI__ = { core: { invoke: async (cmd, arg) => {
      window.__calls.push(cmd);
      if (cmd === 'superres_available') return window.__avail;
      if (cmd === 'superres_run') {
        const dv = new DataView(arg.buffer, arg.byteOffset), hl = dv.getUint32(0, true);
        const req = JSON.parse(new TextDecoder().decode(arg.subarray(4, 4 + hl)));
        window.__req = req; window.__payloadLen = arg.length - 4 - hl;
        if (window.__fail) throw 'model not found';
        if (listener) listener({ payload: { done: 1, total: 2 } });
        const ow = req.width * req.scale, oh = req.height * req.scale;
        const head = new TextEncoder().encode(JSON.stringify({ width: ow, height: oh }));
        const out = new Uint8Array(4 + head.length + ow * oh * 3);
        new DataView(out.buffer).setUint32(0, head.length, true); out.set(head, 4);
        for (let i = 0; i < ow * oh; i++) out.set([200, 100, 50], 4 + head.length + i * 3);
        return out.buffer;
      }
      return null;
    } }, event: { listen: async (name, cb) => { if (name === 'superres-progress') listener = cb; return () => { listener = null; }; } } };
  });
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.fxSuperResCanvas === 'function');
  await page.waitForFunction(() => document.getElementById('exp-sr-row')?.style.display === '', null, { timeout: 10000 });
  assert.ok(await page.evaluate(() => window.__calls.includes('superres_available')), 'asks the native side whether the model is present');

  const r = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 3;
    const x = cv.getContext('2d'); x.fillStyle = 'rgb(10,20,30)'; x.fillRect(0, 0, 4, 3);
    const seen = [];
    const up = await fxSuperResCanvas(cv, 2, (d, t) => seen.push([d, t]));
    const px = up.getContext('2d').getImageData(0, 0, 1, 1).data;
    return { w: up.width, h: up.height, px: [...px], req: window.__req, payload: window.__payloadLen, seen };
  });
  assert.deepEqual([r.w, r.h], [8, 6], '2x canvas dimensions');
  assert.deepEqual(r.px, [200, 100, 50, 255], 'pixels decoded from the native RGB response');
  assert.deepEqual(r.req, { width: 4, height: 3, scale: 2 }, 'request header');
  assert.equal(r.payload, 4 * 3 * 3, 'payload is packed RGB8 of the source');
  assert.deepEqual(r.seen, [[1, 2]], 'progress events are forwarded');

  const failed = await page.evaluate(async () => {
    window.__fail = true;
    const cv = document.createElement('canvas'); cv.width = 2; cv.height = 2;
    try { await fxSuperResCanvas(cv, 4); return 'no error'; } catch (e) { return String(e); }
  });
  assert.match(failed, /model not found/, 'native failure propagates so export can fall back loudly');
  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('CHR-249 super resolution UI contract: PASS (option gated on availability, framing, 2x rebuild, progress, error path)');
} finally { await browser.close(); }
