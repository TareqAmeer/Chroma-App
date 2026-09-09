// State-matrix structural test for the docked Library filmstrip (#lib-overlay:not(.full) under
// deskx). Exists because a hand-picked assertion list missed a real regression: widening the
// dock revealed the Library/Develop tab pair as intended, but ALSO the full Collections/By-Date
// navigation tree, because both live inside the same #lib-side wrapper and only the tabs were
// checked for. See CLAUDE.md #6.15/#6.16.
//
// Per spec (chromasmith-design/project/Editor (Developer) View.dc.html's .filmstrip, lines
// 230-247): #filmstrip holds fs-tabs (Library/Develop, ALWAYS visible) + fs-head (a "Photos"
// label + import button) + fs-list (thumbnails) — nothing else, at ANY width from 90 to 280px.
// Resizing changes thumbnail size, never what chrome is shown. The app's own DOM splits this
// differently (#lib-side = the tab pair only; #lib-top/#lib-main cover fs-head/fs-list), so this
// test scopes to #lib-side specifically — the actual container that leaked, per the review
// feedback that drove this file: snapshotting only .lib-side-tabs (a leaf) would not have seen
// the leaked siblings; the PARENT container is the one that must be asserted.
//
// The expected snapshot is hand-authored from the spec above, NOT auto-generated from the
// current implementation — auto-generating from a possibly-broken DOM would just codify
// whatever bug is already there instead of catching it.
import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();

const test = base.extend({
  server: [async ({}, use) => {
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
    await use(`http://127.0.0.1:${server.address().port}`);
    server.close();
  }, { scope: 'worker' }],

  // Docked (not full-window) Library filmstrip, next to an open photo — same fixture pattern as
  // editor_wireframe_behaviour.mjs's `editor` fixture (boot-watchdog Escape included).
  docked: async ({ page, server }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'portrait.png', { type: 'image/png' });
      if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
    }, fixtureB64);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    await settleForCapture(page);
    await use({ page, errors });
    expect(errors, 'uncaught page errors during interaction').toEqual([]);
  },
});

// Sets --dock-w-user on .fx-layout directly (the real track authority — see library-ui.js's own
// comment on why the resizer writes there, not #lib-overlay's own width) rather than simulating
// a mouse drag: deterministic, and this test is about STRUCTURE at a given width, not about the
// drag gesture itself (library_responsive_qa.mjs / the manual Browser-pane pass already covers
// that interaction).
async function setDockWidth(page, px) {
  await page.evaluate((w) => {
    const fx = document.querySelector('.fx-layout');
    if (fx) fx.style.setProperty('--dock-w-user', w + 'px');
  }, px);
  await page.waitForTimeout(100); // let the ResizeObserver-driven class sync settle
}

const EXPECTED = `
- button "Library"
- button "Develop"
`;

for (const width of [90, 150, 280]) {
  test(`docked filmstrip at ${width}px shows only Library/Develop — no navigation tree`, async ({ docked: { page } }) => {
    await setDockWidth(page, width);
    await expect(page.locator('#lib-side')).toMatchAriaSnapshot(EXPECTED);
  });
}
