// Regression probe for: "Reset edit" (context-menu / ⌘⇧R) on an already-open/cached photo
// greys out the menu item (sidecar correctly flips to not-edited) but the on-screen render
// stays at the stale edited look. Root cause: desktop/library-ui.js's openInEditorInner()
// takes the FAST `cached` branch (installFXImages() directly) when reopening a photo that's
// already in imgCache — which is always true for the currently-open photo — skipping
// loadFXImages()'s `_fxPristineDefault` reset. Combined with `if (sc.recipe)` doing nothing
// when the recipe is now empty (post-reset), the live fxState/UI never reverts to defaults.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = await new Promise(r => {
  const s = createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const d = await readFile(path.join(ROOT, u.slice(1)));
      const ext = path.extname(u);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));

await pg.goto(`${base}/desktop/dist/index.html?libtest=1&libn=3&deskx=1`, { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1500);
await pg.evaluate(() => { document.querySelectorAll('button').forEach(b => { if (b.textContent.trim() === 'Got it') b.click(); }); });
await pg.keyboard.press('Escape');
await pg.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length > 0, null, { timeout: 15000 });

// Open the first photo, grade it hard (exposure slider), confirm the edit landed.
await pg.locator('#lib-grid .lib-card').first().dblclick();
await pg.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, null, { timeout: 15000 });
await pg.waitForTimeout(300);
await pg.evaluate(() => { const tg = document.getElementById('tg-adjust'); if (tg && !tg.classList.contains('on')) toggleFX('adjust'); });
const afterEdit = await pg.evaluate(async () => {
  const sl = document.getElementById('sl-adj-exp');
  sl.value = '90'; sl.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  return sl.value;
});
// The Library's autosave into the sidecar recipe is debounced 2s (library-ui.js's
// `chromasmithOnEdit` -> `saveTimer = setTimeout(flushPendingSave, 2000)`) — reset must be
// triggered AFTER that lands, or the sidecar's pre-reset recipe is still the untouched default
// and the bug this probe targets can't be observed (a fast reset "accidentally" looks fine).
await pg.waitForTimeout(2300);

// Reset via the exact real-world path: ⌘⇧R (libResetEdit -> reset_edit -> openInEditor reopen).
await pg.keyboard.down('Meta'); await pg.keyboard.down('Shift'); await pg.keyboard.press('R');
await pg.keyboard.up('Shift'); await pg.keyboard.up('Meta');
await pg.waitForTimeout(600);

const afterReset = await pg.evaluate(() => {
  const sl = document.getElementById('sl-adj-exp');
  return { sliderValue: sl ? sl.value : null };
});

console.log(JSON.stringify({ afterEdit, afterReset, pageErrors: errors }, null, 1));
await br.close(); server.close();

if (afterReset.sliderValue !== '0') {
  console.error(`FAIL: expected exposure slider back to '0' (default) after Reset edit, got '${afterReset.sliderValue}' — the live editor state did not revert even though the sidecar/menu believes it did.`);
  process.exit(1);
}
console.log('PASS: exposure slider reverted to default after Reset edit on the already-open photo.');
