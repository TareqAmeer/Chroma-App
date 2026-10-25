// Shared bootstrap for mask probes: serves the repo, launches Chromium (swiftshader), loads a fixture photo.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
export async function openMaskPage({ width = 1400, height = 1000 } = {}) {
  const server = createServer(async (req, res) => {
    try { const fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      const data = await readFile(process.env.CHROMASMITH_HTML && fp === path.join(ROOT, 'chromasmith-22.html') ? process.env.CHROMASMITH_HTML : fp);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(data);
    } catch { res.writeHead(404); res.end('nf'); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.getUISnapshot === 'function', null, { timeout: 30000 }).catch(e => { console.error(errors); throw e; });
  await page.waitForTimeout(3000); // let boot finish (module-level lets initialise late)
  const b64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
  await page.evaluate(async b => { const bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    await window.loadFXImages([new File([a], 'portrait.png', { type: 'image/png' })]); }, b64);
  await page.waitForFunction(() => typeof fxWork !== 'undefined' && !!fxWork && !!curItem()?.img, null, { timeout: 20000 });
  await page.evaluate(() => { document.querySelector('[data-tour-action="close"]')?.click(); document.getElementById('cs-modal-ov')?.remove(); });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { page, errors, close: async () => { await browser.close(); server.close(); } };
}
