// E5 (editor_ux_spec.json): "flag updates in the sidebar (library) but not in the top bar, and
// the top bar flagging is stuck on the previous photo when switching photos". Fixed in an
// earlier session (setLabel/setFavorite/openInEditorInner all call window.fxUpdateFlagBtns()),
// but the spec status was never actually updated to reflect it — this test exists so "is E5
// fixed" is a machine-checkable answer instead of trusting an old commit message.
import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const test = base.extend({
  server: [async ({}, use) => {
    const server = createServer(async (req, res) => {
      try {
        const u = decodeURIComponent(req.url.split('?')[0]);
        const d = await readFile(path.join(ROOT, u.slice(1)));
        const ext = path.extname(u);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(d);
      } catch { res.writeHead(404); res.end(); }
    }).listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    await use(`http://127.0.0.1:${server.address().port}`);
    server.close();
  }, { scope: 'worker' }],

  lib: async ({ page, server }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server}/desktop/dist/index.html?libtest=1&libn=5&deskx=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await use({ page, errors });
    expect(errors, 'uncaught page errors during interaction').toEqual([]);
  },
});

test('E5: flagging a photo does not leak onto a different photo after switching', async ({ lib: { page } }) => {
  const cards = page.locator('.lib-card');
  await expect(cards.first()).toBeVisible();

  // Open photo A, flag it Pick (green) via the deskbar flag buttons.
  await cards.nth(0).dblclick();
  await page.waitForTimeout(600);
  const greenBtn = page.locator('#btn-flag-green');
  await expect(greenBtn).toBeVisible();
  await greenBtn.click();
  await page.waitForTimeout(200);
  await expect(greenBtn).toHaveClass(/\bon\b/);

  // Go back to the library and open a DIFFERENT photo (B) — its flag buttons must NOT show
  // photo A's Pick state (the "stuck on the previous photo" half of E5).
  await page.click('#lib-side-tab-library'); // expand back to the full grid (not toggleLibrary, which would close it)
  await page.waitForTimeout(400);
  await cards.nth(1).dblclick();
  await page.waitForTimeout(600);
  await expect(greenBtn).not.toHaveClass(/\bon\b/);

  // Switch back to photo A — its Pick flag must still be there (not lost, and correctly
  // re-synced — the other half of E5, "updates in library sidebar but not top bar").
  await page.click('#lib-side-tab-library'); // expand back to the full grid (not toggleLibrary, which would close it)
  await page.waitForTimeout(400);
  await cards.nth(0).dblclick();
  await page.waitForTimeout(600);
  await expect(greenBtn).toHaveClass(/\bon\b/);
});
