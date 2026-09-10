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

  // A REAL opened folder (?libtest=1&libn=N's list_dir mock), not a bare loadFXImages() call —
  // the `docked` fixture above loads a photo directly, bypassing state.entries/renderTree()
  // entirely, so it could never have exercised "does the folder survive a Library<->Develop
  // round trip" (exactly the bug this fixture exists to catch: the Develop tab's handler called
  // toggleLibrary(), which closes state.open and discards the open folder, instead of
  // toggleExpandedView(false), which only narrows the view). Starts in the FULL grid, same as a
  // real user opening the app and browsing before picking a photo.
  libraryFolder: async ({ page, server }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length > 0, { timeout: 15000 });
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

// Behaviour test, not structure — CLICKS the Library/Develop tabs themselves and asserts what's
// actually on screen after each click, rather than snapshotting fixed-width DOM shape. Exists
// because that structural gap let a REAL regression through: the Develop tab's handler called
// toggleLibrary() (closes the whole dock, folder included) instead of toggleExpandedView(false)
// (just narrows the view) — a wrong CLICK HANDLER, which no amount of measuring #lib-side at
// fixed widths could ever have caught, since nothing here ever pressed a tab. See the commit
// that added this test for the full live repro this reproduces.
test('Library <-> Develop round trip keeps the filmstrip and the open folder alive', async ({ libraryFolder: { page } }) => {
  // #lib-grid is the SAME element in both modes (full grid vs. docked filmstrip — see
  // renderGrid()'s own `docked` detection), so a plain count works for both; mode itself is
  // asserted separately via #lib-overlay's own `full` class below.
  const gridCards = () => page.locator('#lib-grid .lib-card').count();

  // Start in the full grid with a real folder open (the libraryFolder fixture's own setup).
  await expect.poll(gridCards).toBeGreaterThan(0);

  // Open a photo into the editor — this is the app's own real path from full grid to docked
  // filmstrip (openInEditorInner's toggleExpandedView(false) call), not a simulated click.
  await page.locator('#lib-grid .lib-card').first().dblclick();
  await page.waitForFunction(() => !document.getElementById('lib-overlay').classList.contains('full'), { timeout: 10000 });

  // Symptom 1: "filmstrip disappears when switching to Develop" — click Develop from docked
  // (a no-op per the handler's own `if (state.expanded_view)` guard, but must not close it).
  await page.locator('#lib-side-tab-develop').click();
  await expect(page.locator('#lib-overlay')).toHaveClass(/\bon\b/); // state.open must survive — this is the exact class toggleLibrary() used to clear
  await expect(page.locator('#lib-overlay')).toBeVisible();
  await expect(page.locator('#lib-overlay')).not.toHaveClass(/full/);

  // Round-trip through full view and back — Library tab, then Develop tab.
  await page.locator('#lib-side-tab-library').click();
  await page.waitForFunction(() => document.getElementById('lib-overlay').classList.contains('full'), { timeout: 5000 });
  // Symptom 3: "switching back to Library shows the folder as empty".
  await expect.poll(gridCards, { timeout: 5000 }).toBeGreaterThan(0);

  await page.locator('#lib-side-tab-develop').click();
  await page.waitForFunction(() => !document.getElementById('lib-overlay').classList.contains('full'), { timeout: 5000 });
  await expect(page.locator('#lib-overlay')).toBeVisible();
  // Symptom 2: "filmstrip doesn't show the actual thumbnails in the selected folder".
  await expect.poll(gridCards, { timeout: 5000 }).toBeGreaterThan(0);
});
