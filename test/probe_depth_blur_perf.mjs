// ROADMAP R7 — measures the real cost of the depth-blur/tilt-shift compositor (3 extra blur
// pairs + 1 composite pass) vs the existing identity path, using the SAME Playwright/SwiftShader
// rig export_harness.mjs uses. Tilt-shift mode needs no depth model (a plain vertical band), so
// it is the one path fully testable in this browser-only harness — Depth Blur mode shares the
// exact same compositor and blur-pass cost, just a different per-pixel weight source, so this
// number stands in for both.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('[console.error]', msg.text()); });
    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.processToCanvas === 'function' && typeof window.getFXParams === 'function');

    const fixtureBytes = await readFile(path.join(__dirname, 'fixtures', 'portrait.png'));
    const fixtureB64 = fixtureBytes.toString('base64');
    await page.evaluate(async ({ b64 }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bytes], 'portrait.png', { type: 'image/png' });
      await window.loadFXImages([file]);
    }, { b64: fixtureB64 });
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

    const result = await page.evaluate(async () => {
      const P = window.getFXParams();
      const img = fxImages[0].img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const N = 5;
      // Baseline: identity path (no depth blur / tilt-shift key at all).
      let t0 = performance.now();
      for (let i = 0; i < N; i++) await window.processToCanvas(P, img, iw, ih);
      const offMs = (performance.now() - t0) / N;
      // Tilt-shift ON: same P, plus the effect — needs no model (vertical band), so testable here.
      const P2 = Object.assign({}, P, { tiltShift: { enabled: true, amount: 60, focus: 50, band: 12, falloff: 35 } });
      t0 = performance.now();
      for (let i = 0; i < N; i++) await window.processToCanvas(P2, img, iw, ih);
      const onMs = (performance.now() - t0) / N;
      return { iw, ih, offMs, onMs };
    });

    console.log(`portrait.png ${result.iw}x${result.ih}, ${5} renders averaged:`);
    console.log(`  tiltShift OFF: ${result.offMs.toFixed(1)}ms/render`);
    console.log(`  tiltShift ON:  ${result.onMs.toFixed(1)}ms/render`);
    console.log(`  extra cost:    ${(result.onMs - result.offMs).toFixed(1)}ms/render (+${((result.onMs / result.offMs - 1) * 100).toFixed(0)}%)`);
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
