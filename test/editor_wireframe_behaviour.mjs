// INTERACTION coverage for the Editor — same gap test/wireframe_behaviour.mjs closes for the
// Library. The wireframe_inventory/diff tools compare a static snapshot; neither can see "click
// this and something should happen". This closes that loop for the Editor.
//
// ⚠️ Cases for functionality not yet built (resizers, history hold, Tools-button consolidation —
// plan Phases E-H) are EXPECTED TO START RED, same convention as wireframe_behaviour.mjs: they
// assert the CORRECT behaviour per editor_ux_spec.json, not the current one. A failure that maps
// to a tracked spec item is a known gap, not a regression — check editor_ux_spec.json before
// investigating. ⚠️ This file only runs if playwright.config.mjs's testMatch includes it — that
// was widened 2026-09-08 specifically so a new *_behaviour.mjs file couldn't ship silently unrun
// (see the comment there).
//
// SAFETY: every run is ?libtest=1 (mocked Tauri invoke, throwaway browser profile) — no real
// file, library root, or app setting is reachable.
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

  // Desktop editor shell, docked (not full-window Library), with a photo loaded — see
  // editor_wireframe_diff.mjs's own comment on why ?libtest=1 forces full-window Library as a
  // boot-watchdog fallback (a genuine timing race) and why Escape reliably exits it regardless
  // of which side of that race fired.
  editor: async ({ page, server }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
      if (typeof applyFxLayout === 'function') applyFxLayout();
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

// ════════════════════════════════════════════════════════════════════════════════════════════
// TOOLS / VIEW MENUS
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('menus', () => {
  test('Tools menu opens and closes on outside click', async ({ editor: { page } }) => {
    await page.click('#fx-tools .fx-db');
    await expect(page.locator('#fx-tools-menu')).toHaveClass(/\bon\b/);
    await page.click('#fx-canvas-wrap, body', { position: { x: 5, y: 5 } }).catch(() => page.mouse.click(5, 5));
    await expect(page.locator('#fx-tools-menu')).not.toHaveClass(/\bon\b/);
  });

  test('opening the Tools menu closes the View/overflow menu and vice versa', async ({ editor: { page } }) => {
    await page.click('#fx-overflow .fx-db');
    await expect(page.locator('#fx-overflow-menu')).toHaveClass(/\bon\b/);
    await page.click('#fx-tools .fx-db');
    await expect(page.locator('#fx-tools-menu')).toHaveClass(/\bon\b/);
    await expect(page.locator('#fx-overflow-menu')).not.toHaveClass(/\bon\b/);
  });

  // E8 (editor_ux_spec.json): the wireframe's View-menu Appearance section, added 2026-09-09.
  // 2026-09-09: Appearance moved out of the overflow (⋯) menu into the new #fx-view menu
  // (viewMenuBuild()) when Tools/View/⋯ were split — this test's trigger selector was never
  // updated at the time, so it silently timed out instead of catching the real behavior.
  test('Appearance: Dark/Light rows toggle body.light and stay open (not the old rebuild-closes-menu bug)', async ({ editor: { page } }) => {
    await page.click('#fx-view .fx-db');
    await page.click('button[onclick*="fxSetTheme(\'light\')"]');
    await expect(page.locator('body')).toHaveClass(/\blight\b/);
    await expect(page.locator('#fx-view-menu')).toHaveClass(/\bon\b/); // menu must still be open
    await expect(page.locator('button[onclick*="fxSetTheme(\'light\')"]')).toHaveClass(/\bon\b/);
    await page.click('button[onclick*="fxSetTheme(\'dark\')"]');
    await expect(page.locator('body')).not.toHaveClass(/\blight\b/);
    await expect(page.locator('button[onclick*="fxSetTheme(\'dark\')"]')).toHaveClass(/\bon\b/);
  });

  // E6 (editor_ux_spec.json): the docked Library filmstrip must re-theme with the Editor.
  // Both trigger buttons are TOGGLES and the theme opts deliberately keep the menu open (same
  // "stay open so several can be flipped in one visit" convention as Library's own menu) — click
  // the trigger only once, or a second click closes an already-open menu instead of reopening it.
  test('theme change from the Editor gear menu also re-themes the docked Library filmstrip (E6)', async ({ editor: { page } }) => {
    const overlay = page.locator('#lib-overlay');
    await page.click('#fx-view .fx-db');
    await page.click('button[onclick*="fxSetTheme(\'light\')"]');
    await expect(overlay).toHaveClass(/\blib-light\b/);
    await page.click('button[onclick*="fxSetTheme(\'dark\')"]'); // menu is still open — no re-click needed
    await expect(overlay).not.toHaveClass(/\blib-light\b/);
  });

  test('theme change from the Library gear menu also re-themes the Editor (E6, reverse direction)', async ({ editor: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-view-menu .opt[data-theme="light"]');
    await expect(page.locator('body')).toHaveClass(/\blight\b/);
    await page.click('#lib-view-menu .opt[data-theme="dark"]'); // menu is still open — no re-click needed
    await expect(page.locator('body')).not.toHaveClass(/\blight\b/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// TOOL RAIL
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('rail', () => {
  test('clicking a rail item opens its panel section', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="adjust"]');
    await expect(page.locator('[data-fxsec="adjust"]')).toHaveClass(/sec-active|active/).catch(async () => {
      // Fallback: some builds gate visibility via the parent .fx-panel's active section rather
      // than a class on the section itself — assert the section is at least visible.
      await expect(page.locator('[data-fxsec="adjust"]')).toBeVisible();
    });
  });

  // Plan decision (2026-09-08): the tool panel gets NO restore button — clicking the ACTIVE
  // rail item toggles body.panel-closed, and clicking ANY rail item (active or not) must reopen
  // it. This is the one behaviour a computed-style diff structurally cannot see.
  test('clicking the active rail item closes the panel; clicking any rail item reopens it', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="looks"]');
    await expect(page.locator('body')).not.toHaveClass(/panel-closed/);
    await page.click('#fx-toolrail [data-sec="looks"]'); // active item again -> closes
    await expect(page.locator('body')).toHaveClass(/panel-closed/);
    await page.click('#fx-toolrail [data-sec="adjust"]'); // any item -> reopens
    await expect(page.locator('body')).not.toHaveClass(/panel-closed/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// ZOOM
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('zoom', () => {
  // 3.1.7 (editor_ux_spec.json) — EXPECTED RED, not yet built. Confirmed by reading the code
  // (chromasmith-22.html:15021): double-click today is wired on #fx-wrap (the CANVAS), not the
  // zoom bar/slider, and toggles Fit<->2.5x zoom — a different gesture from the wireframe's
  // "double-click the zoom BAR resets to 100%, keep the % hidden until hover/drag" (3.1.7).
  // This test asserts the SPEC'd behaviour on the SPEC'd target (the slider), so it fails until
  // 3.1.7 actually moves the gesture there — don't "fix" it by retargeting the assertion at
  // #fx-wrap, that would just re-document the current gap as correct.
  test('double-click on the zoom bar resets to 100% (3.1.7, not yet built)', async ({ editor: { page } }) => {
    await page.fill('#fx-zoom-slider', '250');
    await page.locator('#fx-zoom-slider').dispatchEvent('input');
    await expect(page.locator('#fx-zoom-pct')).toHaveText(/250%/);
    await page.dblclick('#fx-zoom-slider');
    await expect(page.locator('#fx-zoom-pct')).toHaveText(/100%/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// RESET (E2/E3) — EXPECTED RED until Phase C ships
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('reset', () => {
  // ⚠️ fxResetAll() (chromasmith-22.html:14529) awaits confirmModal() — a real in-page <dialog>
  // (#fx-confirm-modal), not window.confirm() — so calling it via page.evaluate() without also
  // clicking that dialog's OK button leaves the returned promise unresolved forever and the
  // reset silently never happens. Drive it through the real UI (Reset all edits, in the gear
  // menu) so this test exercises the same path a user does, not a shortcut around it.
  test('reset restores every adjustment to its default (E2)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="adjust"]');
    const slider = page.locator('#sl-adj-exp');
    await slider.fill('50').catch(() => {});
    await page.click('#fx-overflow .fx-db');
    await page.click('button[onclick*="fxResetAll"]');
    await page.click('#fx-confirm-modal #fx-confirm-ok');
    await expect(slider).toHaveValue('0');
  });

  // 3.1.3/E3 (editor_ux_spec.json) — EXPECTED RED, not yet built: fxResetAll() (chromasmith-22.html
  // :14531) awaits confirmModal(), a real in-page <dialog>, before doing anything. The user asked
  // for this confirmation to be REMOVED (an undo can already recover from a mistaken reset).
  test('reset does not show a confirmation dialog (E3, not yet built)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="adjust"]');
    await page.locator('#sl-adj-exp').fill('50').catch(() => {});
    await page.click('#fx-overflow .fx-db');
    await page.click('button[onclick*="fxResetAll"]');
    await expect(page.locator('#fx-confirm-modal[open]')).toHaveCount(0);
  });
});
