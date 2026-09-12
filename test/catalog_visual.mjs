// Visual regression test for chromasmith-22.html's `?catalog=1` component catalogue
// (docs/ui-workflow/STATE.md S1(d)). One toHaveScreenshot() per shared component x state, so a
// pixel-level layout regression in any of the app's shared component classes (.fx-ctrl, .fx-row,
// .fx-toggle, .fx-sub, .btn.fx-btn-primary, .bpri, .seg, .fx-info-i) is caught without hand-
// picking which real section to screenshot. States: rest/disabled/modified/longlabel are baked
// into the catalogue's own markup (see buildCatalogPage() in chromasmith-22.html); hover/focus
// are driven live here against each component's "rest" instance, same as every other real
// interaction test in this repo (no separate hover/focus markup needed).
//
// Baselines are per-platform (Playwright appends the OS to the snapshot filename) — this repo's
// dev machine is Intel macOS (CLAUDE.md's user_hardware note), so only the darwin baseline is
// committed here. CI runs on macos-latest (.github/workflows/editor-gates.yml) so today that's
// the same platform; docs/ui-workflow/STATE.md notes CI should still get its own explicit run
// once rather than silently trusting a baseline generated on someone's dev machine.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };

test.use({ viewport: { width: 960, height: 900 } });

const server = test.extend({
  base: [async ({}, use) => {
    const s = createServer(async (req, res) => {
      try {
        const u = decodeURIComponent(req.url.split('?')[0]);
        const d = await readFile(path.join(ROOT, u.slice(1)));
        res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' });
        res.end(d);
      } catch { res.writeHead(404); res.end(); }
    }).listen(0, '127.0.0.1');
    await new Promise((r) => s.on('listening', r));
    await use(`http://127.0.0.1:${s.address().port}`);
    s.close();
  }, { scope: 'worker' }],
});

// Mirrors the COMPONENTS list in chromasmith-22.html's buildCatalogPage().
const COMPONENTS = [
  'fx-ctrl', 'fx-row', 'fx-toggle', 'fx-sub', 'fx-btn-primary', 'bpri', 'seg', 'fx-info-i',
];
const MARKUP_STATES = ['rest', 'disabled', 'modified', 'longlabel'];

for (const theme of ['dark', 'light']) {
  server(`catalog: no console errors (${theme})`, async ({ page, base }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/chromasmith-22.html?catalog=1`, { waitUntil: 'load' });
    await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
    await page.waitForTimeout(200);
    // Pre-existing, unrelated to catalog mode (confirmed live: identical on a plain page load
    // with no ?catalog=1) — the COI service worker refusing to register over plain http.
    const real = errors.filter((e) => !/ServiceWorker|COOP\/COEP|fetching the script/i.test(e));
    expect(real, real.join('\n')).toEqual([]);
  });

  for (const key of COMPONENTS) {
    for (const state of MARKUP_STATES) {
      server(`catalog: ${key} — ${state} (${theme})`, async ({ page, base }) => {
        await page.goto(`${base}/chromasmith-22.html?catalog=1`, { waitUntil: 'load' });
        await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
        const el = page.locator(`[data-cat="${key}-${state}"]`);
        await expect(el).toHaveCount(1);
        await el.scrollIntoViewIfNeeded();
        await expect(el).toHaveScreenshot(`${key}-${state}-${theme}.png`);
      });
    }

    server(`catalog: ${key} — hover (${theme})`, async ({ page, base }) => {
      await page.goto(`${base}/chromasmith-22.html?catalog=1`, { waitUntil: 'load' });
      await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
      const el = page.locator(`[data-cat="${key}-rest"]`);
      await el.scrollIntoViewIfNeeded();
      await el.hover();
      await expect(el).toHaveScreenshot(`${key}-hover-${theme}.png`);
    });

    server(`catalog: ${key} — focus (${theme})`, async ({ page, base }) => {
      await page.goto(`${base}/chromasmith-22.html?catalog=1`, { waitUntil: 'load' });
      await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
      const el = page.locator(`[data-cat="${key}-rest"]`);
      await el.scrollIntoViewIfNeeded();
      // Force-focusable so :focus-visible (chromasmith-22.html's `:where(...,[tabindex]):focus-visible`
      // rule) applies even to non-natively-focusable components like .fx-sub/.fx-ctrl.
      await el.evaluate((n) => { if (!n.hasAttribute('tabindex')) n.setAttribute('tabindex', '-1'); n.focus(); });
      await expect(el).toHaveScreenshot(`${key}-focus-${theme}.png`);
    });
  }

  server(`catalog: panel=retouch renders one section (${theme})`, async ({ page, base }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/chromasmith-22.html?catalog=1&panel=retouch`, { waitUntil: 'load' });
    await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
    await expect(page.locator('[data-cat="panel-retouch"]')).toHaveCount(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
