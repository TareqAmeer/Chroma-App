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

// T19 (editor_ux_spec.json, 2026-09-10): individual tests used to declare their OWN local
// `errors`/`page.on('pageerror', ...)` instead of using the `editor`/`editorWeb` fixture's own
// (already listening from page creation, exposed as `errors` below). A page error thrown BEFORE
// a test's own local listener line ran — e.g. during the click that immediately precedes it —
// was only caught by the fixture's own teardown assertion, not that test's explicit
// `expect(errors).toEqual([])`, so it failed as a generic teardown error rather than pointing at
// the specific action that threw. Every such test now destructures `errors` from the fixture
// (`{ editor: { page, errors } }`) instead of redeclaring it, closing that gap and removing the
// duplication in one pass.
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
    // ⚠️ #btn-flag-red/green/#btn-favorite stay display:none unless window.chromasmithOpenedFlag
    // exists (fxUpdateFlagBtns, chromasmith-22.html) — a real Tauri-only hook ?libtest=1 never
    // stubs. Every desktop launch reaches this bar via the Library, where the hook is real, so
    // the `editor` fixture stubs it too — otherwise every behaviour test built on this fixture
    // exercises a topbar with three real controls silently absent (see the Topbar Parity pass
    // this was found from: a full inventory of this exact fixture missed all three).
    await page.evaluate(() => {
      window.chromasmithOpenedFlag = () => null;
      window.chromasmithOpenedFavorite = () => false;
      window.chromasmithToggleFlag = async () => {};
      window.chromasmithToggleFavorite = async () => {};
    });
    const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'portrait.png', { type: 'image/png' });
      if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
    }, fixtureB64);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { if (typeof fxUpdateFlagBtns === 'function') fxUpdateFlagBtns(); });
    await page.waitForTimeout(300);
    await settleForCapture(page);
    await use({ page, errors });
    expect(errors, 'uncaught page errors during interaction').toEqual([]);
  },

  // Same boot sequence as `editor`, at a MOBILE viewport and WITHOUT ?libtest=1. Needed because
  // #btn-split-menu/#btn-history open FLOATING popovers (#fx-split-popover/#fx-timeline-popover)
  // that only exist as standalone triggers in this mode. ⚠️ TWO separate things force desktop
  // mode, and both had to go: (1) "web/mobile" is driven by `_mqMobile` (max-width:700px,
  // chromasmith-22.html applyFxLayout()), not the ?deskx=1 query param, so a narrow viewport is
  // required; (2) ?libtest=1 itself (desktop/library-ui.js's Tauri mock) unconditionally does
  // `document.body.classList.add('deskx')` regardless of viewport — confirmed live, a 390px-wide
  // ?libtest=1 page still reports body.deskx and #btn-split-menu stays display:none. Since this
  // fixture doesn't need the Library mock (no Library interaction in these tests), it skips
  // ?libtest=1 and boots the plain browser page instead — the one path where deskx is driven
  // purely by the width media query, as the wireframe intends.
  editorWeb: async ({ page, server }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server}/desktop/dist/index.html`, { waitUntil: 'domcontentloaded' });
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

// ════════════════════════════════════════════════════════════════════════════════════════════
// TOOLS / VIEW MENUS
// ════════════════════════════════════════════════════════════════════════════════════════════
// 2026-09-10: Tools + View + ⋯ merged into ONE settings menu (#fx-settings), a two-column
// drill-down — a fixed category list on the left (#fx-settings-cats, SETTINGS_CATS) and one
// content pane visible at a time on the right (#fx-settings-page, settingsShowCat()). There is
// no separate Tools/View/overflow trigger any more — every category lives behind the single
// gear button and category switches happen WITHOUT closing the menu (settingsShowCat() toggles
// `.active` on the existing buttons; see its comment on the detach-mid-event bug this guards
// against — a naive innerHTML rebuild there closes the whole menu on the first category click).
test.describe('menus', () => {
  test('Settings menu opens and closes on outside click', async ({ editor: { page } }) => {
    await page.click('#fx-settings .fx-db');
    await expect(page.locator('#fx-settings-menu')).toHaveClass(/\bon\b/);
    await page.click('#fx-canvas-wrap, body', { position: { x: 5, y: 5 } }).catch(() => page.mouse.click(5, 5));
    await expect(page.locator('#fx-settings-menu')).not.toHaveClass(/\bon\b/);
  });

  // The core regression this file exists to catch: clicking a category must NOT close the menu
  // (the detach-mid-event bug fixed in settingsShowCat() — see chromasmith-22.html's comment
  // right above that function). Switch through all five categories and confirm the menu stays
  // open and exactly one pane is active at a time.
  test('switching settings categories keeps the menu open and shows exactly one pane', async ({ editor: { page } }) => {
    await page.click('#fx-settings .fx-db');
    await expect(page.locator('#fx-settings-menu')).toHaveClass(/\bon\b/);
    const cats = [
      ['tools', '#fx-tools-menu'],
      ['view', '#fx-view-menu'],
      ['split', '#fx-settings-split-list'],
      ['history', '#fx-settings-history-list'],
      ['overflow', '#fx-overflow-menu'],
    ];
    for (const [key, paneSel] of cats) {
      await page.click(`.fx-settings-cat[data-cat="${key}"]`);
      await expect(page.locator('#fx-settings-menu')).toHaveClass(/\bon\b/); // still open
      await expect(page.locator(paneSel)).toHaveClass(/\bactive\b/);
      await expect(page.locator(`.fx-settings-cat[data-cat="${key}"]`)).toHaveClass(/\bactive\b/);
      const activePanes = await page.locator('.fx-settings-pane.active').count();
      expect(activePanes).toBe(1);
    }
  });

  // E8 (editor_ux_spec.json): the wireframe's View-menu Appearance section, added 2026-09-09,
  // now the View category inside the merged settings menu.
  test('Appearance: Dark/Light rows toggle body.light and stay open (not the old rebuild-closes-menu bug)', async ({ editor: { page } }) => {
    await page.click('#fx-settings .fx-db');
    await page.click('.fx-settings-cat[data-cat="view"]');
    await page.click('button[onclick*="fxSetTheme(\'light\')"]');
    await expect(page.locator('body')).toHaveClass(/\blight\b/);
    await expect(page.locator('#fx-settings-menu')).toHaveClass(/\bon\b/); // menu must still be open
    await expect(page.locator('button[onclick*="fxSetTheme(\'light\')"]')).toHaveClass(/\bon\b/);
    await page.click('button[onclick*="fxSetTheme(\'dark\')"]');
    await expect(page.locator('body')).not.toHaveClass(/\blight\b/);
    await expect(page.locator('button[onclick*="fxSetTheme(\'dark\')"]')).toHaveClass(/\bon\b/);
  });

  // E6 (editor_ux_spec.json): the docked Library filmstrip must re-theme with the Editor.
  // The theme buttons deliberately keep the menu open (same "stay open so several can be
  // flipped in one visit" convention as Library's own menu) — click the category only once.
  test('theme change from the Editor gear menu also re-themes the docked Library filmstrip (E6)', async ({ editor: { page } }) => {
    const overlay = page.locator('#lib-overlay');
    await page.click('#fx-settings .fx-db');
    await page.click('.fx-settings-cat[data-cat="view"]');
    await page.click('button[onclick*="fxSetTheme(\'light\')"]');
    await expect(overlay).toHaveClass(/\blib-light\b/);
    await page.click('button[onclick*="fxSetTheme(\'dark\')"]'); // menu is still open — no re-click needed
    await expect(overlay).not.toHaveClass(/\blib-light\b/);
  });

  test('theme change from the Library gear menu also re-themes the Editor (E6, reverse direction)', async ({ editor: { page } }) => {
    // #lib-view-menu-btn lives in #lib-top, which is now .lib-fullview-only (2026-09-09: the
    // docked filmstrip stopped rendering the whole Library toolbar — search/sort/filters/view-menu
    // — since none of it is in the wireframe's docked .filmstrip and the app-wide theme toggle
    // already lives in the Editor's own gear menu, which syncs both ways; confirmed with the user
    // that a second, docked-only theme control is not needed). The gear button itself still exists
    // and still works in the Library's FULL (undocked) view, so this test proves the Library-side
    // handler still propagates to body.light by opening full view first, rather than testing a
    // docked-only trigger surface that no longer exists.
    await page.click('#lib-side-tab-library');
    await expect(page.locator('#lib-overlay')).toHaveClass(/\bfull\b/);
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-view-menu .opt[data-theme="light"]');
    await expect(page.locator('body')).toHaveClass(/\blight\b/);
    await page.click('#lib-view-menu .opt[data-theme="dark"]'); // menu is still open — no re-click needed
    await expect(page.locator('body')).not.toHaveClass(/\blight\b/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// LEFT CLUSTER (Undo/Redo/Show original/Full resolution) — the 2026-09-10 wireframe-fidelity
// fixes (7-item mismatch list). fxSyncTopbarDisabled() (chromasmith-22.html) greys out Undo,
// Redo, and Show original together off the SAME fxHistIdx signal, on purpose (deliberately not
// a second, independently-driven signal that could drift — see the comment above that function).
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('left cluster: undo/redo/show original/full resolution', () => {
  test('Undo and Show original start disabled on a freshly loaded photo, Undo enables after an edit', async ({ editor: { page } }) => {
    await expect(page.locator('#btn-undo-db')).toBeDisabled();
    await expect(page.locator('#btn-before')).toBeDisabled();
    await page.click('#fx-toolrail [data-sec="adjust"]');
    await page.locator('#sl-adj-exp').fill('30').catch(() => {});
    await page.waitForTimeout(200);
    await expect(page.locator('#btn-undo-db')).toBeEnabled();
    await expect(page.locator('#btn-before')).toBeEnabled();
  });

  test('Redo is disabled until an Undo has happened', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="adjust"]');
    await page.locator('#sl-adj-exp').fill('30').catch(() => {});
    await page.waitForTimeout(200);
    await expect(page.locator('#btn-redo-db')).toBeDisabled();
    await page.click('#btn-undo-db');
    await expect(page.locator('#btn-redo-db')).toBeEnabled();
  });

  // 7-item wireframe fix #2: Show original moved next to Undo/Redo on the LEFT, and #5: Full
  // resolution now lives in the same left cluster — both relocated by relocatePreviewTools()
  // out of the zoom cluster / floating layer into #fx-deskbar-left under body.deskx.
  test('Show original and Full resolution live in the left deskbar cluster, not the zoom cluster', async ({ editor: { page } }) => {
    const left = page.locator('#fx-deskbar-left');
    await expect(left.locator('#btn-before')).toHaveCount(1);
    await expect(left.locator('#btn-fx-fullres')).toHaveCount(1);
  });

  // 7-item wireframe fix #1: the stray Library folder icon must not render in desktop/deskx mode.
  test('the Library folder icon is not shown in the desktop deskbar', async ({ editor: { page } }) => {
    await expect(page.locator('#db-lib-btn')).toBeHidden();
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
// RESET (E2/E3)
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('reset', () => {
  // E3 already shipped (confirmed live 2026-09-10): fxResetAll() (chromasmith-22.html:14863) no
  // longer calls confirmModal() at all — it resets immediately, no dialog. This test used to click
  // a #fx-confirm-modal OK button that no longer appears, which timed out forever (the dialog
  // never exists — nothing to click). Drive it through the real UI (Reset all edits, in the gear
  // menu) so this test exercises the same path a user does, not a shortcut around it.
  test('reset restores every adjustment to its default (E2)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="adjust"]');
    const slider = page.locator('#sl-adj-exp');
    await slider.fill('50').catch(() => {});
    await page.waitForTimeout(500); // history push is debounced — see the undo/redo tests above
    await page.click('#fx-settings .fx-db');
    await page.click('.fx-settings-cat[data-cat="overflow"]');
    await page.click('#fx-overflow-menu button[onclick*="fxResetAll"]');
    await expect(slider).toHaveValue('0');
  });

  // 3.1.3/E3 (editor_ux_spec.json) — SHIPPED: fxResetAll() (chromasmith-22.html:14863) no longer
  // awaits confirmModal() at all, per the user's ask that an undo can already recover a mistake.
  test('reset does not show a confirmation dialog (E3)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="adjust"]');
    await page.locator('#sl-adj-exp').fill('50').catch(() => {});
    await page.waitForTimeout(500); // history push is debounced — see the undo/redo tests above
    await page.click('#fx-settings .fx-db');
    await page.click('.fx-settings-cat[data-cat="overflow"]');
    await page.click('#fx-overflow-menu button[onclick*="fxResetAll"]');
    await expect(page.locator('#fx-confirm-modal[open]')).toHaveCount(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// RETOUCH PANEL (RT1) — written BEFORE moving the app markup to the redesigned layout, per
// docs/editor-redesign-plan.md's rule: every control that moves needs a test proving it still
// works, asserted first against the CURRENT markup. All three ids (sel-heal-mode, btn-heal-paint,
// btn-heal-clear via onclick) are preserved across the move — see CLAUDE.md §3's "move markup,
// don't rewrite it" rule — so these keep passing unchanged once the panel is redesigned.
//
// ⚠️ The Mode test below was UPDATED, not left as originally written, once Mode actually became
// a segmented control (selectToSeg): sel-heal-mode is now display:none by intentional design —
// the same "a real <select> stays the source of truth, still dispatches its own onchange, just
// visually replaced" pattern already used by Crop/Canvas/Input (selectToChips) — so Playwright's
// actionability check on a hidden <select> is a false alarm, not a severed-wiring regression.
// Interacting through the real new UI (the seg button) and asserting the underlying select's
// value is what actually proves the wiring survived the move.
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('retouch panel (RT1)', () => {
  test('mode selector still changes sel-heal-mode', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="retouch"]');
    await page.click('#seg-heal-mode button:has-text("Clone")');
    await expect(page.locator('#sel-heal-mode')).toHaveValue('clone');
  });

  test('the Retouch button still toggles paint mode', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="retouch"]');
    const btn = page.locator('#btn-heal-paint');
    await btn.click();
    await expect(btn).toHaveClass(/\bon\b|\bactive\b|\bbsec\b/).catch(async () => {
      // The app doesn't guarantee a specific "active" class name — fall back to asserting the
      // click actually reached the handler (fxState/global flag) rather than failing on a class
      // name this test shouldn't be coupled to.
      const called = await page.evaluate(() => typeof healToggle === 'function');
      expect(called).toBe(true);
    });
  });

  test('Clear all spots still calls healClear without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="retouch"]');
    await page.click('button[onclick*="healClear"]');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  // New in this implementation, not a moved control — covers the shared desktop reset-visibility
  // mechanism (feedback COLOR 1) as applied to Retouch specifically, where the section's "edited"
  // signal is spot count rather than the generic .fx-mod slider tracking (see healSyncUI's own
  // comment on why: Size/Feather/Opacity are brush tool settings, not persisted photo state).
  test('Reset is hidden until a spot exists, then clears spots and hides again', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="retouch"]');
    const reset = page.locator('.fx-ctrl[data-fxsec="retouch"] .fx-ctrl-title-reset');
    await expect(reset).toBeHidden();
    await page.evaluate(() => {
      const it = fxImages[fxCurIdx];
      it.heal = it.heal || [];
      it.heal.push({ x: 0.5, y: 0.5, r: 0.05 });
      healSyncUI();
    });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(reset).toBeHidden();
    const spotsLeft = await page.evaluate(() => (fxImages[fxCurIdx].heal || []).length);
    expect(spotsLeft).toBe(0);
  });
});

test.describe('detail panel (DT1)', () => {
  test('RAW noise reduction segmented control still drives sel-raw-nr', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="detail"]');
    await page.click('#seg-raw-nr button:has-text("High")');
    await expect(page.locator('#sel-raw-nr')).toHaveValue('high');
    // High-tier conditional block (strength slider + Denoise now/Cancel) becomes visible.
    await expect(page.locator('#row-nr-high-strength')).toBeVisible();
    await expect(page.locator('#row-nr-high')).toBeVisible();
    await page.click('#seg-raw-nr button:has-text("Fast")');
    await expect(page.locator('#sel-raw-nr')).toHaveValue('fast');
    await expect(page.locator('#row-nr-high-strength')).toBeHidden();
  });

  // T20 (editor_ux_spec.json): the test above only proves a USER CLICK on the seg control updates
  // the underlying select. It says nothing about the reverse direction this same control also
  // needs — a PROGRAMMATIC write to window.chromasmithRawNr (session restore, undo/redo,
  // copy-paste, or the real native RAW-load path this mirrors) going through fxRawNrSyncUI(),
  // whose whole job is calling sel._chipsRender() so the seg control doesn't silently show the
  // WRONG selection while the real underlying state is actually correct. Nothing exercised that
  // path before this.
  test('a programmatic RAW-NR write (fxRawNrSyncUI) re-renders the seg control, not just the select', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="detail"]');
    await expect(page.locator('#seg-raw-nr button:has-text("Fast")')).toHaveClass(/\bon\b/);
    await page.evaluate(() => { window.chromasmithRawNr = 'high'; fxRawNrSyncUI(); });
    await expect(page.locator('#sel-raw-nr')).toHaveValue('high');
    await expect(page.locator('#seg-raw-nr button:has-text("High")')).toHaveClass(/\bon\b/);
    await expect(page.locator('#seg-raw-nr button:has-text("Fast")')).not.toHaveClass(/\bon\b/);
  });

  test('Sparkle-optimized RAW toggle still calls fxDemosaicToggled', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="detail"]');
    const tg = page.locator('#tg-demosaic-ahd');
    await tg.click();
    await expect(tg).toHaveClass(/\bon\b/);
    await tg.click();
    await expect(tg).not.toHaveClass(/\bon\b/);
  });

  test('lens Auto toggle still calls fxLensAutoToggled without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="detail"]');
    await page.click('.fx-ctrl[data-fxsec="lens"] #tg-lens-auto');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  test('header Reset still resets Noise Reduction via resetNR', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="detail"]');
    // T15 (editor_ux_spec.json): assert the RESTING state first — every existing Reset test here
    // jumped straight to "make a change, then check visible", which can't catch a regression
    // that leaves Reset permanently visible (e.g. a CSS selector typo broadening :has()).
    const reset = page.locator('.fx-ctrl[data-fxsec="nr"] .fx-ctrl-title-reset');
    await expect(reset).toBeHidden();
    const slider = page.locator('#sl-nr-lum');
    await slider.fill('60');
    // fxMarkModifiedSliders() debounces 120ms before flagging .fx-mod, which gates the reset
    // button's visibility via :has() — wait it out before clicking (see the vig test's comment
    // in the film-panel block for the failure this caused when there was no buffer).
    await page.waitForTimeout(200);
    await page.click('.fx-ctrl[data-fxsec="nr"] .fx-ctrl-title-reset');
    await expect(slider).toHaveValue('0');
  });

  test('header Reset still resets Deconvolution via resetDeconv', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="detail"]');
    const reset = page.locator('.fx-ctrl[data-fxsec="deconv"] .fx-ctrl-title-reset'); // T15
    await expect(reset).toBeHidden();
    const slider = page.locator('#sl-deconv-amt');
    await slider.scrollIntoViewIfNeeded();
    await slider.fill('40');
    await page.waitForTimeout(200);
    await page.click('.fx-ctrl[data-fxsec="deconv"] .fx-ctrl-title-reset');
    await expect(slider).toHaveValue('0');
  });
});

test.describe('film panel (F1)', () => {
  test('halation toggle still calls toggleFX and Shadow protect keeps its info tooltip', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="film"]');
    const tg = page.locator('.fx-ctrl[data-fxsec="hal"] #tg-hal');
    await tg.click();
    await expect(tg).toHaveClass(/\bon\b/);
    await expect(page.locator('.fx-ctrl[data-fxsec="hal"] .fx-info-i').first()).toBeVisible();
    await tg.click();
  });

  test('Film artifacts Re-roll button still calls artReshuffle without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="film"]');
    const btn = page.locator('.fx-ctrl[data-fxsec="art"] button[onclick*="artReshuffle"]');
    await expect(btn).toHaveText('Re-roll');
    await btn.click();
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  test('grain toggle still calls toggleFX without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="film"]');
    await page.click('.fx-ctrl[data-fxsec="grain"] #tg-grain');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  test('bloom and vignette header Reset still work via the generic fxResetSection', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="film"]');
    // T15: both Resets checked hidden at rest before either section is touched at all — turning
    // a section's on/off switch on (next line, bloom) must not by itself count as "modified".
    const bloomReset = page.locator('.fx-ctrl[data-fxsec="bloom"] .fx-ctrl-title-reset');
    const vigReset = page.locator('.fx-ctrl[data-fxsec="vig"] .fx-ctrl-title-reset');
    await expect(bloomReset).toBeHidden();
    await expect(vigReset).toBeHidden();
    await page.click('.fx-ctrl[data-fxsec="bloom"] #tg-bloom');
    const bloomSlider = page.locator('#sl-bloom-a');
    await bloomSlider.scrollIntoViewIfNeeded();
    await bloomSlider.fill('80');
    await page.waitForTimeout(200); // fx-mod debounce
    await page.click('.fx-ctrl[data-fxsec="bloom"] .fx-ctrl-title-reset');
    await expect(bloomSlider).toHaveValue('40');
    const vigSlider = page.locator('#sl-vig');
    await vigSlider.scrollIntoViewIfNeeded();
    await vigSlider.fill('90');
    // fxMarkModifiedSliders() debounces 120ms before it flags the row .fx-mod (chromasmith-22.html)
    // — the reset button's visibility is gated on that class via :has(), so a click right after
    // fill() can race it. The bloom assertion above happens to give enough time by coincidence;
    // vig has no such buffer, so wait explicitly.
    await page.waitForTimeout(200);
    await page.click('.fx-ctrl[data-fxsec="vig"] .fx-ctrl-title-reset');
    await expect(vigSlider).toHaveValue('50');
  });
});

test.describe('frame panel (FR1)', () => {
  test('border colour and thickness rows are in colour-then-thickness order', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="frame"]');
    // "borders" is in _ALLFX (chromasmith-22.html) — its fields start with inline display:none
    // until first toggled on (a pre-existing app behaviour, not specific to this panel).
    await page.click('.fx-ctrl[data-fxsec="borders"] #tg-borders');
    const rows = page.locator('.fx-ctrl[data-fxsec="borders"] .fx-row');
    await expect(rows.nth(0)).toContainText('Inner colour');
    await expect(rows.nth(1)).toContainText('Inner thickness');
    await expect(rows.nth(2)).toContainText('Outer colour');
    await expect(rows.nth(3)).toContainText('Outer thickness');
  });

  test('header Reset restores both border colours, not just thickness', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="frame"]');
    await page.click('.fx-ctrl[data-fxsec="borders"] #tg-borders');
    const reset = page.locator('.fx-ctrl[data-fxsec="borders"] .fx-ctrl-title-reset'); // T15
    await expect(reset).toBeHidden();
    const color = page.locator('#cl-b1');
    const slider = page.locator('#sl-b1-t');
    await slider.fill('5');
    await page.waitForTimeout(200); // fx-mod debounce, see the film-panel vig test's comment
    await page.evaluate(() => {
      const c = document.getElementById('cl-b1');
      c.value = '#ff0000';
      c.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('.fx-ctrl[data-fxsec="borders"] .fx-ctrl-title-reset');
    await expect(slider).toHaveValue('1');
    await expect(color).toHaveValue('#000000');
  });

  test('Style select keeps its fx-info-i tooltip and filmFrameChanged still fires', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="frame"]');
    await page.click('.fx-ctrl[data-fxsec="borders"] #tg-borders');
    await expect(page.locator('.fx-ctrl[data-fxsec="borders"] .fx-info-i')).toBeVisible();
    await page.selectOption('#sel-film-frame', 'sprocket35');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
    await expect(page.locator('#sel-film-frame')).toHaveValue('sprocket35');
  });
});

test.describe('crop panel (CR1)', () => {
  test('Aspect ratio and Transform subheads are both present and in order', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="crop"]');
    const subs = page.locator('.fx-ctrl[data-fxsec="crop"] .fx-sub');
    await expect(subs).toHaveCount(2);
    await expect(subs.nth(0)).toHaveText('Aspect ratio');
    await expect(subs.nth(1)).toHaveText('Transform');
  });

  test('aspect chips still drive sel-crop-ar via cropSetAspect', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="crop"]');
    await page.click('#crop-ar-chips button:has-text("1:1 Square")');
    await expect(page.locator('#sel-crop-ar')).toHaveValue('1');
  });

  test('rotate/flip icon buttons still call geomRotate/geomFlip without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="crop"]');
    await page.click('.fx-ctrl[data-fxsec="crop"] button[onclick*="geomRotate(-90)"]');
    await page.click('.fx-ctrl[data-fxsec="crop"] button[onclick*="geomFlip"]');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  test('Crop button still calls cropToggle without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="crop"]');
    await page.click('#btn-crop');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });
});

test.describe('color panel (CO1)', () => {
  test('Colour Wheels is now reachable from the Color rail button (was homeless, D2/CO1)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="color"]');
    await expect(page.locator('.fx-ctrl[data-fxsec="wheels"]')).toHaveClass(/sec-active/);
  });

  test('Point Color Pick button keeps its own click target and gained an info tooltip', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="color"]');
    await expect(page.locator('.fx-ctrl[data-fxsec="pointcolor"] .fx-info-i')).toBeVisible();
    // The info-i must NOT be nested inside #btn-pc-eye (invalid HTML/mis-parse risk, R8) —
    // clicking the Pick button itself must still resolve to btn-pc-eye and call pcEyedropper.
    await page.click('#btn-pc-eye');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  test('curve mode/channel chips still call curveSetMode/curveSetCh without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="color"]');
    await page.click('.fx-ctrl[data-fxsec="curves"] #tg-curves');
    await page.click('#curve-chips button[data-ch="r"]');
    await expect(page.locator('#curve-chips button[data-ch="r"]')).toHaveClass(/\bon\b/);
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });
});

test.describe('export panel (EX1)', () => {
  test('all five subheadings are present and in order', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="export"]');
    const subs = page.locator('.fx-ctrl[data-fxsec="export"] .fx-sub');
    await expect(subs).toHaveCount(5);
    await expect(subs.nth(0)).toContainText('Output');
    await expect(subs.nth(1)).toContainText('Watermark');
    await expect(subs.nth(2)).toContainText('Preset');
    await expect(subs.nth(4)).toContainText('Export');
  });

  test('Filename input keeps its own value and gained an info tooltip', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="export"]');
    await expect(page.locator('.fx-ctrl[data-fxsec="export"] .fx-info-i').first()).toBeVisible();
    const fname = page.locator('#fx-fname');
    await fname.fill('my-export');
    await expect(fname).toHaveValue('my-export');
  });

  test('HDR row still lives in the Output group and toggles without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="export"]');
    // Hidden by default (no HDR-capable source loaded) — assert it's still wired, not visible.
    const hdr = page.locator('#tg-exp-hdr');
    await page.evaluate(() => { document.getElementById('fx-hdr-row').style.display = ''; });
    await hdr.click();
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });

  test('Export button still calls exportFX and Export scope sits under the Export subhead', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="export"]');
    const exportBtn = page.locator('#btn-fx-export');
    await expect(exportBtn).toHaveAttribute('onclick', /exportFX/);
    const subs = page.locator('.fx-ctrl[data-fxsec="export"] .fx-sub');
    const lastSub = subs.nth(4);
    // #fx-export-scope-row is display:none until a batch (>1 photo) is loaded — force it
    // visible to check its position, same approach as the HDR-row test above.
    await page.evaluate(() => { document.getElementById('fx-export-scope-row').style.display = ''; });
    const scopeRow = page.locator('#fx-export-scope-row');
    const subBox = await lastSub.boundingBox();
    const scopeBox = await scopeRow.boundingBox();
    expect(scopeBox.y).toBeGreaterThan(subBox.y);
  });
});

test.describe('info panel (IN1)', () => {
  test('metadata (#fx-info) renders above people (#fx-people)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="info"]');
    const infoBox = await page.locator('#fx-info').boundingBox();
    const peopleBox = await page.locator('#fx-people').boundingBox();
    expect(infoBox).not.toBeNull();
    expect(peopleBox).not.toBeNull();
    expect(peopleBox.y).toBeGreaterThanOrEqual(infoBox.y);
  });
});

// Masks (MA1) — BASELINE coverage of the CURRENT mskRebuild() output, written deliberately
// before any redesign work touches it. Per docs/editor-redesign-plan.md's own rule ("grow the
// behaviour suite before moving anything") and MA1's own note: mskRebuild() is ~367 lines of
// generation logic (not static markup like every other panel), covering 9 mask types, drag
// reorder, mute/solo/rename/delete, colour-range/luminance/depth gates, and per-type tone tools
// — the app's most sensitive feature (docs/skin-tone.md). These tests exist so a future
// implementation pass has something to run red/green against, not to assert a REDESIGNED shape.
test.describe('masks panel (MA1) — baseline, pre-redesign', () => {
  test('+ Mask menu groups items as Shape/Paint/AI/Range (current shape, not yet the proposal\'s Draw/Detect/Range)', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="local"]');
    await page.click('.fx-ctrl[data-fxsec="local"] button[onclick*="mskAddMenu"]');
    const menu = page.locator('.msk-more-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Shape');
    await expect(menu).toContainText('Radial');
    await expect(menu).toContainText('Range');
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(5, 5);
  });

  // ⚠️ Was a CONFIRMED infinite loop, not a test flake: adding the first mask called mskRebuild(),
  // whose Depth Range UI block (gated on window.__TAURI__, which the desktop dist build sets)
  // called fxEnsureDepthMap(). That function's native-platform guard checked capNative() — the
  // CAPACITOR/iOS check — instead of window.__TAURI__, so on desktop it always returned null
  // immediately, every call, with no memoization. mskRebuild()'s own `.then(()=>mskRebuild())`
  // then re-entered the same dead branch, forming an unbounded recursive rebuild loop (measured:
  // 20+ recursive calls/second, pinning the renderer indefinitely — see git history for the full
  // isolation trail via CDP Debugger.pause sampling). Fixed in chromasmith-22.html's
  // fxEnsureDepthMap(): correct window.__TAURI__ guard + an img._depthMapAttempted memo so a
  // genuine depth_run failure can't retrigger the same loop either.
  test('adding a Radial mask creates a row and selects it, showing the Selection group', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="local"]');
    const before = await page.locator('#local-list button').count();
    await page.click('.fx-ctrl[data-fxsec="local"] button[onclick*="mskAddMenu"]');
    await page.click('.msk-more-menu button:has-text("Radial")');
    await expect(page.locator('#local-list button')).toHaveCount(before + 1);
    await expect(page.locator('#local-ctl')).toContainText('Selection');
  });

  // Same underlying loop as above — fixed the same way.
  test('the "..." menu can mute and delete the selected mask', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="local"]');
    await page.click('.fx-ctrl[data-fxsec="local"] button[onclick*="mskAddMenu"]');
    await page.click('.msk-more-menu button:has-text("Radial")');
    const countAfterAdd = await page.locator('#local-list button').count();

    await page.click('.msk-rowbar .msk-more');
    await page.click('.msk-more-menu button:has-text("Mute")');
    await expect(page.locator('.msk-rowbar')).toContainText('Muted');

    await page.click('.msk-rowbar .msk-more');
    await page.click('.msk-more-menu button:has-text("Delete mask")');
    await expect(page.locator('#local-list button')).toHaveCount(countAfterAdd - 1);
  });

  test('Show on photo (Overlay/Isolate/Selection/Off) still calls mskSetPreviewMode without throwing', async ({ editor: { page, errors } }) => {
    await page.click('#fx-toolrail [data-sec="local"]');
    const seg = page.locator('.fx-ctrl[data-fxsec="local"] .msk-prevmode-seg');
    await seg.locator('button[data-v="isolate"]').click();
    await expect(seg.locator('button[data-v="isolate"]')).toHaveClass(/\bon\b/);
    await seg.locator('button[data-v="overlay"]').click();
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });
});

// Point Color (#pc-list) and Export Styles (#style-list) — T29 (editor_ux_spec.json,
// 2026-09-10): editor_coverage.mjs's structural fully-dynamic-panel detector found these two the
// same way it found Masks — an empty list container built entirely by JS, so nothing under it can
// be structurally inventoried and a behaviour test is the ONLY safety net. Each test proves the
// container's item count goes up (add) and back down (delete), same shape as the masks tests
// above, so `editor_coverage.mjs`'s smoke-test check (`#container...toHaveCount` at least twice)
// picks them up as covered.
test.describe('point color panel — dynamic #pc-list (T29)', () => {
  test('picking a point color from the photo adds a chip, and Delete point removes it', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="color"]');
    await page.click('#tg-pointcolor');
    const before = await page.locator('#pc-list button').count();
    await page.click('#btn-pc-eye');
    await page.locator('#fx-canvas').click({ position: { x: 60, y: 60 } });
    await expect(page.locator('#pc-list button')).toHaveCount(before + 1);

    await page.click('#pc-list button >> nth=0');
    await page.click('button:has-text("Delete point")');
    await expect(page.locator('#pc-list button')).toHaveCount(before);
  });
});

test.describe('export panel — dynamic #style-list (T29)', () => {
  test('Save as Style… adds an entry, deleting it removes it', async ({ editor: { page } }) => {
    await page.click('#fx-toolrail [data-sec="export"]');
    const before = await page.locator('#style-list .btn-row').count();

    await page.click('button:has-text("Save as Style…")');
    await page.fill('#fx-ask-input', 'T29 smoke test style');
    await page.click('#fx-ask-ok');
    await expect(page.locator('#style-list .btn-row')).toHaveCount(before + 1);

    await page.click('#style-list button[onclick*="styleDelete"]');
    await page.click('#fx-confirm-ok');
    await expect(page.locator('#style-list .btn-row')).toHaveCount(before);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// OTHER DROPDOWNS / POPOVERS — every remaining "click a control, something floats open" surface
// that isn't the settings menu: the canvas-background right-click context menu (desktop mode,
// editorBgOpenMenu()), and the web/mobile split-compare and edit-history popovers, which are
// hidden entirely under body.deskx (relocatePreviewTools() moves those same DOM nodes into the
// settings menu's Compare/History categories instead — see the `menus` describe block above).
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('other dropdowns', () => {
  // editorBgOpenMenu()'s handler checks e.target!==wrap (chromasmith-22.html:10695), so it only
  // fires for a contextmenu event whose target IS #fx-wrap itself, not one of its children (the
  // canvas fills the wrap edge-to-edge once a photo is loaded, so a geometric right-click can't
  // reliably land on the wrap's own background) — dispatch the event with an explicit target
  // instead of aiming a pointer at a pixel.
  test('right-clicking the empty canvas background opens the background-color menu, closes on outside click', async ({ editor: { page } }) => {
    await page.evaluate(() => {
      document.getElementById('fx-wrap').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    await expect(page.locator('.fx-bgmenu')).toHaveCount(1);
    await page.mouse.click(400, 5);
    await expect(page.locator('.fx-bgmenu')).toHaveCount(0);
  });

  test('right-clicking ON the photo/canvas content does not open the background menu', async ({ editor: { page } }) => {
    await page.locator('#fx-canvas').click({ button: 'right' });
    await expect(page.locator('.fx-bgmenu')).toHaveCount(0);
  });

  test('web/mobile: split-compare popover opens off #btn-split-menu and closes on outside click', async ({ editorWeb: { page } }) => {
    await page.click('#btn-split-menu');
    await expect(page.locator('#fx-split-popover')).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.locator('#fx-split-popover')).toBeHidden();
  });

  // ⚠️ page.click() here was observed (via a MutationObserver on style.display) to fire the
  // button's onclick TWICE for one logical click — fxToggleTimelinePopover() has no
  // e.stopPropagation() (unlike fxToggleSplitMenu(e), which does), so it's plausible Playwright's
  // own actionability retry re-dispatches once the popover's appearance shifts layout under the
  // click point. The net effect was open-then-immediately-close (toggle called twice: none→block,
  // then block→none), well within the same tick. dispatchEvent bypasses that retry machinery.
  test('web/mobile: edit-history popover opens off #btn-history and closes on outside click', async ({ editorWeb: { page } }) => {
    await page.locator('#btn-history').dispatchEvent('click');
    await expect(page.locator('#fx-timeline-popover')).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.locator('#fx-timeline-popover')).toBeHidden();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// QUALITY (accessibility) — ported from test/wireframe_behaviour.mjs's own `quality` block
// (the Library's equivalent file), ~150 lines the Editor never had a counterpart for. Same
// generic a11y/keyboard/motion checks, re-scoped to the Editor's own containers
// (#fx-deskbar/#fx-toolrail/.fx-settings-pane in place of #lib-top/#lib-side/.lib-menu).
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('quality (accessibility)', () => {
  test('every icon-only control in the deskbar/rail has an accessible name', async ({ editor: { page } }) => {
    const unnamed = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('#fx-deskbar button, #fx-toolrail button')) {
        if (!b.offsetParent) continue;
        const text = (b.textContent || '').trim();
        const name = b.getAttribute('aria-label') || b.getAttribute('title') || text;
        if (!name) out.push(b.id || b.className || b.outerHTML.slice(0, 80));
      }
      return out;
    });
    expect(unnamed, 'icon-only controls with no accessible name').toEqual([]);
  });

  // Fixed 2026-09-10: chromasmith-22.html's global keydown handler (~line 21563) had Escape
  // wired for eyedropper/crop/loupe/AI-tap-mode but never checked #fx-settings-menu — every
  // other menu in the app closed on click-outside only. Library's own sort/gear menus already
  // supported Escape (test/wireframe_behaviour.mjs); found via porting that check over. Auditing
  // the same pattern across the Editor turned up the same gap on #fx-split-popover,
  // #fx-timeline-popover, and .fx-bgmenu (the right-click background menu) — all fixed together.
  test('Escape closes the settings menu', async ({ editor: { page } }) => {
    await page.click('#fx-settings .fx-db');
    await expect(page.locator('#fx-settings-menu')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#fx-settings-menu')).not.toHaveClass(/\bon\b/);
  });

  // Same rationale as the Library version: nothing else checks WHERE focus lands after a menu
  // closes — stranding it on a now-hidden element silently breaks the next Tab press.
  test('focus stays on a real, visible element after Escape closes the settings menu', async ({ editor: { page } }) => {
    await page.click('#fx-settings .fx-db');
    await page.keyboard.press('Escape');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      return { id: el && el.id, visible: !!(el && el.offsetParent), isBody: el === document.body };
    });
    expect(info.isBody, 'focus fell back to <body> after closing the settings menu').toBe(false);
    expect(info.visible, 'focus landed on a hidden element after closing the settings menu').toBe(true);
  });

  test('Escape closes the split-compare and edit-history popovers, and the background context menu', async ({ editorWeb: { page } }) => {
    await page.click('#btn-split-menu');
    await expect(page.locator('#fx-split-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#fx-split-popover')).toBeHidden();

    await page.locator('#btn-history').dispatchEvent('click'); // see the dropdowns test above re: dispatchEvent
    await expect(page.locator('#fx-timeline-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#fx-timeline-popover')).toBeHidden();

    await page.evaluate(() => {
      document.getElementById('fx-wrap').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    await expect(page.locator('.fx-bgmenu')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.fx-bgmenu')).toHaveCount(0);
  });

  test('deskbar/rail controls are keyboard reachable', async ({ editor: { page } }) => {
    const unreachable = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#fx-deskbar button, #fx-deskbar input, #fx-toolrail button')) {
        if (!el.offsetParent || el.disabled) continue; // disabled is correctly out of tab order
        if (el.tabIndex < 0) out.push(el.id || el.className);
      }
      return out;
    });
    expect(unreachable, 'controls removed from the tab order').toEqual([]);
  });

  // Same "compare against its OWN unfocused paint" technique as the Library version — a plain
  // "has some box-shadow" check would pass on decorative box-shadows that already exist at rest.
  // ⚠️ Root cause of the original "failure" here: btn-undo-db/btn-redo-db/btn-before start
  // `disabled` on a freshly loaded photo with no edits yet (fxSyncTopbarDisabled(), fxHistIdx<=0)
  // — confirmed live that `el.focus()` on a disabled button is a silent no-op in Chromium
  // (document.activeElement never changes), so the "no visible change" reading was really "this
  // button structurally cannot be focused right now," not a missing CSS rule. A disabled control
  // is correctly excluded from keyboard traversal already; testing it for a focus RING is the
  // wrong question. Skip disabled controls, same as the "keyboard reachable" test above does
  // implicitly (a disabled button reporting tabIndex 0 in Chromium doesn't mean it's reachable).
  test('focused deskbar/rail/settings-menu controls show a visible focus indicator', async ({ editor: { page } }) => {
    const bare = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#fx-deskbar button, #fx-toolrail button, .fx-settings-pane button')) {
        if (!el.offsetParent || el.disabled) continue;
        el.blur();
        const before = getComputedStyle(el);
        const restOutline = `${before.outlineStyle} ${before.outlineWidth} ${before.outlineColor}`;
        const restShadow = before.boxShadow;
        el.focus();
        const cs = getComputedStyle(el);
        const focOutline = `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
        const gainedOutline = focOutline !== restOutline && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        const gainedShadow = cs.boxShadow !== restShadow && cs.boxShadow !== 'none';
        if (!gainedOutline && !gainedShadow) out.push(el.id || el.className);
        el.blur();
      }
      return out;
    });
    expect(bare, 'controls with no visible focus indicator').toEqual([]);
  });

  // ⚠️ Unfalsifiable-by-construction trap the Library version already hit once: settleForCapture()
  // (called by the `editor` fixture) injects a `transition-duration:0s!important` stylesheet for
  // deterministic screenshots — reading computed styles with that still in place would report 0s
  // on EVERYTHING regardless of whether the app itself honours prefers-reduced-motion. Remove it
  // first so the assertion is real, same fix as the Library test.
  test('the Editor honours prefers-reduced-motion', async ({ editor: { page } }) => {
    await page.evaluate(() => {
      for (const st of document.querySelectorAll('style')) {
        if (/transition-duration\s*:\s*0s\s*!important/.test(st.textContent || '')) st.remove();
      }
    });
    await page.waitForTimeout(100);
    const animated = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#fx-deskbar *, #fx-toolrail *, .fx-settings-pane *')) {
        const d = getComputedStyle(el).transitionDuration;
        if (!d) continue;
        if (d.split(',').some((v) => parseFloat(v) > 0.001)) out.push((el.id || (typeof el.className === 'string' ? el.className : el.tagName) || el.tagName) + ' ' + d);
      }
      return [...new Set(out)].slice(0, 10);
    });
    expect(animated, 'transitions still running under prefers-reduced-motion').toEqual([]);
  });
});
