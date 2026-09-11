// Shared boot helper for T43-51's state-matrix gates (editor_ux_spec.json). Every one of those
// gates needs the same three things — a static file server, a Chromium page loaded against
// desktop/dist/index.html with a real photo in it, and a clean shutdown — so this factors that
// out instead of copy-pasting editor_responsive_qa.mjs's boot sequence eight more times.
//
// Deliberately NOT a generic "run any Editor test" framework: it exposes exactly the pieces the
// T43-51 gates need (launch, loadPage, withPhoto, close) and nothing else. Gates that need
// something more specific (viewport sweep, wireframe diff) still own their own boot code.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();

export async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const d = await readFile(path.join(ROOT, u.slice(1)));
      const ext = path.extname(u);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  return { server, port: server.address().port };
}

// Launches Chromium + loads the Editor, optionally with a photo already in it.
// `query` lets a gate add its own URL params (e.g. forced-colors doesn't need any).
export async function bootEditor({ withPhoto = true, query = 'libtest=1&deskx=1', viewport = null, contextOptions = {} } = {}) {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
  const page = await browser.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS, ...(viewport ? { viewport } : {}), ...contextOptions });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    if (typeof applyFxLayout === 'function') applyFxLayout();
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (withPhoto) {
    const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'portrait.png', { type: 'image/png' });
      if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
    }, fixtureB64);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
  }
  await settleForCapture(page);
  return {
    browser, page, server, pageErrors,
    async close() { await browser.close().catch(() => {}); server.close(); },
  };
}
