// INTERACTION coverage for the Library UI — the thing test/wireframe_inventory.mjs structurally
// cannot do.
//
// Why this file exists: the inventory tool compares a static snapshot (element counts, text,
// position, font-size) of three zones. It has no concept of "click this and something should
// happen", so every behavioural defect in the Library shipped invisibly under a green PASS. The
// user found them by hand, repeatedly. This closes that loop.
//
// ⚠️ THIS SUITE IS EXPECTED TO START RED. Per an explicit decision, tests here assert the
// CORRECT behaviour, not the current one — so a genuine defect shows up as a failing test rather
// than being baked in as "expected". Every failure should map to a numbered defect in
// HANDOVER.md. A failure that ISN'T in that list is a real regression and must be investigated,
// not added to the list.
//
// SAFETY: every run is `?libtest=1`, where library-ui.js swaps the Tauri `invoke` layer for
// `libtestInvoke` (library-ui.js:16) — every backend command is mocked and no real file, library
// root or app setting is reachable. Playwright uses a throwaway browser profile, so the app's
// real localStorage/WebKit store is untouched. Nothing here can delete or modify user data.
//
// Assertions are on OBSERVABLE state only — DOM classes, text, localStorage, inline custom
// properties, and the two debug hooks the app already exposes (`window.__libtestCallCounts()`,
// library-ui.js:44). The `state` object is module-local and deliberately not reachable; per
// Playwright's own guidance that is the correct thing to assert against anyway ("avoid relying
// on implementation details such as things which users will not typically use, see, or know").
// Defects that are only visible in `state` and produce no observable symptom are recorded in
// HANDOVER.md as code-review findings instead of being forced into an unobservable test.
import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
// Worker-scoped static server: one per worker, serving the built desktop/dist/. Must be the
// BUILT copy — desktop/dist/ is a staged copy and editing desktop/library-ui.js does nothing
// until `bash build-desktop.sh` runs (CLAUDE.md documents this having silently wasted two
// earlier fix attempts).
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

  // A Library page in full-window mode with the catalog mocks on, welcome modal dismissed, and
  // the grid actually painted. `libcat=1` matters: without it catalog_counts returns zeros
  // (library-ui.js:234-240), so Needs Review / Not-Face-Scanned / the date tree don't render at
  // all and half this suite would be testing an empty sidebar.
  lib: async ({ page, server }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server}/desktop/dist/index.html?libtest=1&libcat=1&libn=60`, { waitUntil: 'domcontentloaded' });
    // Readiness = the grid has painted real cards. An auto-retrying assertion, not a sleep:
    // fixed sleeps are the documented main source of flake and this repo already has two
    // harnesses suffering from exactly that.
    await expect(page.locator('#lib-grid .lib-card').first()).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
      document.getElementById('lib-overlay')?.classList.add('full');
    });
    await settleForCapture(page);
    await use({ page, errors });
    // A pageerror during an interaction test is a failure even if the assertions passed —
    // it means something threw where the user would have seen a broken control.
    expect(errors, 'uncaught page errors during interaction').toEqual([]);
  },
});

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
const ls = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const counts = (page) => page.evaluate(() => window.__libtestCallCounts());
const cssVar = (page, sel, prop) => page.evaluate(
  ([s, p]) => getComputedStyle(document.querySelector(s)).getPropertyValue(p).trim(), [sel, prop]);

// ════════════════════════════════════════════════════════════════════════════════════════════
// TOP BAR
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('topbar', () => {
  test('search input filters the grid after its debounce', async ({ lib: { page } }) => {
    const before = await page.locator('#lib-grid .lib-card').count();
    await page.fill('#lib-search', 'IMG_1001');
    // 150ms debounce (library-ui.js:5804-5807) then renderGrid; the assertion retries so the
    // debounce is waited out by observation, not by a magic number.
    await expect(page.locator('#lib-grid .lib-card')).not.toHaveCount(before);
  });

  test('search clears back to the full set', async ({ lib: { page } }) => {
    const before = await page.locator('#lib-grid .lib-card').count();
    await page.fill('#lib-search', 'IMG_1001');
    await expect(page.locator('#lib-grid .lib-card')).not.toHaveCount(before);
    await page.fill('#lib-search', '');
    await expect(page.locator('#lib-grid .lib-card')).toHaveCount(before);
  });

  test('Enter on an empty search box does nothing', async ({ lib: { page } }) => {
    const before = await page.locator('#lib-grid .lib-card').count();
    const c0 = await counts(page);
    await page.click('#lib-search');
    await page.keyboard.press('Enter');
    // Guard at library-ui.js:5813 — `value.trim()` falsy means no call at all.
    expect((await counts(page)).catalogQuery).toBe(c0.catalogQuery);
    await expect(page.locator('#lib-grid .lib-card')).toHaveCount(before);
  });

  test('Enter with text runs a semantic search and re-renders', async ({ lib: { page } }) => {
    await page.fill('#lib-search', 'a dog on a beach');
    await page.keyboard.press('Enter');
    // The libcat mock returns 5 synthetic ids seeded from the query (library-ui.js:424-425).
    await expect(page.locator('#lib-grid .lib-card')).toHaveCount(5);
  });

  test('view toggle switches to list and persists', async ({ lib: { page } }) => {
    await page.click('#lib-viewmode-seg button[data-v="list"]');
    await expect(page.locator('#lib-grid')).toHaveClass(/list-view/);
    await expect(page.locator('#lib-viewmode-seg button[data-v="list"]')).toHaveClass(/\bon\b/);
    expect(await ls(page, 'chromasmith_lib_view')).toBe('list');
  });

  test('view toggle switches back to grid', async ({ lib: { page } }) => {
    await page.click('#lib-viewmode-seg button[data-v="list"]');
    await expect(page.locator('#lib-grid')).toHaveClass(/list-view/);
    await page.click('#lib-viewmode-seg button[data-v="grid"]');
    await expect(page.locator('#lib-grid')).not.toHaveClass(/list-view/);
    expect(await ls(page, 'chromasmith_lib_view')).toBe('grid');
  });

  test('view mode survives a reload', async ({ lib: { page } }) => {
    await page.click('#lib-viewmode-seg button[data-v="list"]');
    expect(await ls(page, 'chromasmith_lib_view')).toBe('list');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#lib-grid .lib-card').first()).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => document.getElementById('lib-overlay')?.classList.add('full'));
    await expect(page.locator('#lib-viewmode-seg button[data-v="list"]')).toHaveClass(/\bon\b/);
  });

  test('thumbnail slider resizes the grid and persists', async ({ lib: { page } }) => {
    await page.locator('#lib-thumbsize').fill('220');
    await expect(page.locator('#lib-grid')).toHaveAttribute('style', /--lib-thumb:\s*220px/);
    expect(await ls(page, 'chromasmith_lib_thumbsize')).toBe('220');
  });

  test('flag buttons are inert with no photo open', async ({ lib: { page } }) => {
    // chromasmithToggleFlag/Favorite both early-return on a falsy state.openedPath
    // (library-ui.js:3734-3755). Nothing is open in a fresh harness, so the row must not light.
    await page.click('#lib-flag-pick');
    await page.click('#lib-flag-fav');
    await expect(page.locator('#lib-flag-pick')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#lib-flag-fav')).not.toHaveClass(/\bon\b/);
  });

  test('sort menu opens and closes on outside click', async ({ lib: { page } }) => {
    await page.click('#lib-sort-btn');
    await expect(page.locator('#lib-sort-menu')).toHaveClass(/\bopen\b/);
    await page.click('#lib-grid', { position: { x: 5, y: 5 } });
    await expect(page.locator('#lib-sort-menu')).not.toHaveClass(/\bopen\b/);
  });

  test('choosing a sort option updates the pill label and persists', async ({ lib: { page } }) => {
    await page.click('#lib-sort-btn');
    await page.click('#lib-sort-menu .opt[data-sortval="name"]');
    await expect(page.locator('#lib-sort-label')).toHaveText('Name');
    expect(await ls(page, 'chromasmith_lib_sort')).toBe('name');
    await expect(page.locator('#lib-sort-menu')).not.toHaveClass(/\bopen\b/);
  });

  test('sort direction flips, persists, and keeps the menu open', async ({ lib: { page } }) => {
    await page.click('#lib-sort-btn');
    const before = await ls(page, 'chromasmith_lib_sortdir');
    await page.click('#lib-sort-dir');
    const after = await ls(page, 'chromasmith_lib_sortdir');
    expect(after).not.toBe(before);
    await expect(page.locator('#lib-sort-dir')).toHaveAttribute('data-dir', after);
    // Deliberate: direction is a refinement of the current sort, so the menu stays up.
    await expect(page.locator('#lib-sort-menu')).toHaveClass(/\bopen\b/);
  });

  test('filters panel opens, closes by its X, and closes on outside click', async ({ lib: { page } }) => {
    await page.click('#lib-filters-btn');
    await expect(page.locator('#lib-filters-panel')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#lib-filters-btn')).toHaveClass(/\bactive\b/);
    await page.click('#lib-filters-panel-close');
    await expect(page.locator('#lib-filters-panel')).not.toHaveClass(/\bopen\b/);
    await page.click('#lib-filters-btn');
    await expect(page.locator('#lib-filters-panel')).toHaveClass(/\bopen\b/);
    await page.click('#lib-grid', { position: { x: 5, y: 5 } });
    await expect(page.locator('#lib-filters-panel')).not.toHaveClass(/\bopen\b/);
  });

  test('a type filter narrows the grid and lights the badge', async ({ lib: { page } }) => {
    await page.click('#lib-filters-btn');
    const before = await page.locator('#lib-grid .lib-card').count();
    await page.selectOption('#lib-type-filter', 'raw');
    await expect(page.locator('#lib-grid .lib-card')).not.toHaveCount(before);
    await expect(page.locator('#lib-filters-badge')).toHaveClass(/\bon\b/);
  });

  test('Clear all resets every filter select and the search box', async ({ lib: { page } }) => {
    await page.click('#lib-filters-btn');
    await page.selectOption('#lib-type-filter', 'raw');
    await page.fill('#lib-search', 'IMG_10');
    await page.click('#lib-filters-clear');
    await expect(page.locator('#lib-type-filter')).toHaveValue('all');
    await expect(page.locator('#lib-search')).toHaveValue('');
    await expect(page.locator('#lib-filters-badge')).not.toHaveClass(/\bon\b/);
  });

  test('All FX reports that it is not implemented yet', async ({ lib: { page } }) => {
    // library-ui.js:5945-5946 is a toast-only stub. Asserting the stub keeps it honest: if
    // someone wires it for real, this test fails and forces the coverage to be written.
    await page.click('#lib-allfx-btn');
    await expect(page.getByText(/coming soon/i)).toBeVisible();
  });

  test('Export with nothing selected is a silent no-op', async ({ lib: { page } }) => {
    // libExportPaths early-returns on an empty target list (library-ui.js:4200). It must not
    // throw, toast an error, or start the editor pipeline. The fixture's pageerror check is
    // what actually enforces "did not throw".
    await page.click('#lib-export-btn');
    await expect(page.locator('#lib-grid .lib-card').first()).toBeVisible();
  });

  test('gear menu opens, and an .opt-action item closes it', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await expect(page.locator('#lib-view-menu')).toHaveClass(/\bopen\b/);
    await page.click('#lib-expand');
    await expect(page.locator('#lib-view-menu')).not.toHaveClass(/\bopen\b/);
  });

  test('gear menu checkbox items keep the menu open', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-hideicons');
    // Not an .opt-action, so the auto-close listener (library-ui.js:5939) does not apply —
    // deliberate, so several view options can be toggled in one visit.
    await expect(page.locator('#lib-view-menu')).toHaveClass(/\bopen\b/);
  });

  test('Hide flag & type icons toggles and persists', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-hideicons');
    await expect(page.locator('#lib-overlay')).toHaveClass(/lib-hide-icons/);
    expect(await ls(page, 'chromasmith_lib_hideicons')).toBe('1');
  });

  test('No spacing between photos toggles and persists', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-zerogap');
    await expect(page.locator('#lib-grid')).toHaveClass(/lib-zero-gap/);
    expect(await ls(page, 'chromasmith_lib_zerogap')).toBe('1');
  });

  test('Show title toggles and persists', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-showtitle');
    expect(await ls(page, 'chromasmith_lib_showtitle')).toBe('1');
    // The filename node is .lib-name (library-ui.js:4739), rendered only when showTitle is on.
    await expect(page.locator('#lib-grid .lib-name').first()).toBeVisible();
  });

  test('metadata overlay options move the checkmark and persist', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-view-menu .opt[data-metaval="always"]');
    expect(await ls(page, 'chromasmith_lib_metadisp')).toBe('always');
    await expect(page.locator('#lib-view-menu .opt[data-metaval="always"]')).toHaveClass(/\bsel\b/);
    await expect(page.locator('#lib-view-menu .opt[data-metaval="off"]')).not.toHaveClass(/\bsel\b/);
  });

  test('theme switch flips the Library palette and persists', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-view-menu .opt[data-theme="light"]');
    await expect(page.locator('#lib-overlay')).toHaveClass(/lib-light/);
    expect(await ls(page, 'csTheme')).toBe('light');
    // No second #lib-view-menu-btn click here: [data-theme] rows are not .opt-action, so the
    // menu is still open and clicking the button again would CLOSE it (library-ui.js:5939).
    await page.click('#lib-view-menu .opt[data-theme="dark"]');
    await expect(page.locator('#lib-overlay')).not.toHaveClass(/lib-light/);
  });

  test('Show sidebar hides and restores the sidebar, and persists', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-tree-toggle');
    await expect(page.locator('#lib-side')).toBeHidden();
    expect(await ls(page, 'chromasmith_lib_sidebar')).toBe('collapsed');
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-tree-toggle');
    await expect(page.locator('#lib-side')).toBeVisible();
    expect(await ls(page, 'chromasmith_lib_sidebar')).toBe('open');
  });

  test('Get Info toggles the info panel closed again', async ({ lib: { page } }) => {
    // KNOWN DEFECT (HANDOVER #3): #lib-info-btn always sets showInfo = true
    // (library-ui.js:5430) instead of toggling, so a second click cannot close the panel.
    // Only the `I` key toggles. Asserting the correct behaviour so the defect stays visible.
    // A photo must be focused first — renderInfoPanel needs _kbCursor/openedPath/selection
    // (library-ui.js:4814-4815) and toasts instead of opening when there is none.
    await page.locator('#lib-grid .lib-card').first().click();
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-info-btn');
    await expect(page.locator('#lib-info')).toBeVisible();
    await page.click('#lib-view-menu-btn');
    await page.click('#lib-info-btn');
    await expect(page.locator('#lib-info')).toBeHidden();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('sidebar', () => {
  test('the Library tab is the active tab and stays active', async ({ lib: { page } }) => {
    await expect(page.locator('#lib-side-tab-library')).toHaveClass(/\bon\b/);
    await page.click('#lib-side-tab-library');
    await expect(page.locator('#lib-side-tab-library')).toHaveClass(/\bon\b/);
  });

  test('the Develop tab matches its own tooltip', async ({ lib: { page } }) => {
    // KNOWN DEFECT (HANDOVER #5): the button's title says "Develop — not yet available" but it
    // is wired to close the Library entirely (library-ui.js:5991). Either the title or the
    // wiring is wrong. Asserting that a control advertised as unavailable does not silently
    // perform a major navigation.
    const title = await page.locator('#lib-side-tab-develop').getAttribute('title');
    await page.click('#lib-side-tab-develop');
    if (/not yet available/i.test(title || '')) {
      await expect(page.locator('#lib-overlay'), 'a control labelled "not yet available" closed the Library').toBeVisible();
    }
  });

  test('resizer drag widens the sidebar and persists on release', async ({ lib: { page } }) => {
    const box = await page.locator('#lib-side-resizer').boundingBox();
    // ⚠️ Grab the LEFT edge, not the centre. The resizer's box is 6px (right:-3px, width:6px)
    // but hit-testing shows only its leftmost ~2px actually receive the pointer — #lib-side
    // wins at box.x+3 and #lib-main from box.x+4 onward. See HANDOVER "resizer hit target".
    await page.mouse.move(box.x + 1, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(360, box.y + 200, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => cssVar(page, '#lib-overlay', '--lib-side-w')).toBe('360px');
    expect(await ls(page, 'chromasmith_lib_side_w')).toBe('360');
  });

  test('resizer clamps at its 150px floor and does NOT collapse', async ({ lib: { page } }) => {
    // Documents the confirmed gap: Library View.html collapses the sidebar when dragged narrow;
    // the app clamps at Math.max(150, …) (library-ui.js:5966-5989) and has no collapse path at
    // all. This test pins the CURRENT behaviour so that implementing collapse is a deliberate,
    // visible change rather than something that silently alters an untested control.
    const box = await page.locator('#lib-side-resizer').boundingBox();
    // ⚠️ Grab the LEFT edge, not the centre. The resizer's box is 6px (right:-3px, width:6px)
    // but hit-testing shows only its leftmost ~2px actually receive the pointer — #lib-side
    // wins at box.x+3 and #lib-main from box.x+4 onward. See HANDOVER "resizer hit target".
    await page.mouse.move(box.x + 1, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(20, box.y + 200, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => cssVar(page, '#lib-overlay', '--lib-side-w')).toBe('150px');
    await expect(page.locator('#lib-side')).toBeVisible();
  });

  test('sidebar width survives a reload', async ({ lib: { page } }) => {
    const box = await page.locator('#lib-side-resizer').boundingBox();
    // ⚠️ Grab the LEFT edge, not the centre. The resizer's box is 6px (right:-3px, width:6px)
    // but hit-testing shows only its leftmost ~2px actually receive the pointer — #lib-side
    // wins at box.x+3 and #lib-main from box.x+4 onward. See HANDOVER "resizer hit target".
    await page.mouse.move(box.x + 1, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(300, box.y + 200, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => ls(page, 'chromasmith_lib_side_w')).toBe('300');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#lib-grid .lib-card').first()).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => document.getElementById('lib-overlay')?.classList.add('full'));
    await expect.poll(() => cssVar(page, '#lib-overlay', '--lib-side-w')).toBe('300px');
  });

  test('All Photos row becomes the active view', async ({ lib: { page } }) => {
    // Asserted on the row's own selected state, not on an invoke counter: catalog_query is
    // served from a cached page for an unchanged scope, so the counter legitimately does not
    // move here. The user-visible outcome is the row lighting up.
    await page.click('.lib-coll-row[data-catalog="all"]');
    await expect(page.locator('.lib-coll-row[data-catalog="all"]')).toHaveClass(/\bon\b/);
  });

  test('By date root toggle collapses and re-expands the tree', async ({ lib: { page } }) => {
    const root = page.locator('[data-date-tree-toggle]');
    await root.click();                                    // collapse (seeded open)
    await expect(page.locator('.lib-tree-row[data-date-scope]')).toHaveCount(0);
    await root.click();                                    // re-expand
    await expect(page.locator('.lib-tree-row[data-date-scope]').first()).toBeVisible();
  });

  test('a year chevron expands children WITHOUT navigating', async ({ lib: { page } }) => {
    // The load-bearing split (library-ui.js:6475-6494, 8676-8699): the chevron stops
    // propagation and only mutates dateExpanded. This regressed once already and made merely
    // browsing the tree load an entire year of photos. Asserted via the selected state rather
    // than an invoke counter — expanding must not change WHICH view is active.
    const rows0 = await page.locator('.lib-tree-row[data-date-scope]').count();
    await page.locator('.lib-tree-row[data-date-scope] [data-chev-toggle]').first().click();
    await expect(page.locator('.lib-tree-row[data-date-scope]')).not.toHaveCount(rows0); // children appeared
    await expect(page.locator('.lib-tree-row[data-date-scope].on'), 'a chevron click navigated').toHaveCount(0);
  });

  test('a date row body navigates WITHOUT expanding', async ({ lib: { page } }) => {
    const rows0 = await page.locator('.lib-tree-row[data-date-scope]').count();
    await page.locator('.lib-tree-row[data-date-scope]').first().click({ position: { x: 60, y: 8 } });
    await expect(page.locator('.lib-tree-row[data-date-scope]').first()).toHaveClass(/\bon\b/);
    await expect(page.locator('.lib-tree-row[data-date-scope]'), 'a row click expanded the tree').toHaveCount(rows0);
  });

  // Each section header toggles independently against one shared Set + key
  // (chromasmith_lib_sec_open_v1, library-ui.js:6162-6180). Keywords is deliberately absent —
  // it is a [data-kw-tree-toggle] tree row with a session-only Set, not a section.
  for (const sec of ['collections', 'people', 'albums', 'drives', 'devices', 'folders', 'cloud']) {
    test(`section "${sec}" toggles independently and persists`, async ({ lib: { page } }) => {
      const head = page.locator(`[data-sec-toggle="${sec}"]`);
      if (await head.count() === 0) test.skip(true, `section ${sec} not rendered in this mock state`);
      // Read the open state from the DOM, not localStorage: the key is only WRITTEN on the
      // first toggle, so at defaults it is null and every section would read as closed
      // (library-ui.js:6162-6168 seeds collections/folders/drives open in memory).
      const isOpen = () => head.locator('.lib-tree-chev.open').count().then((n) => n > 0);
      const openBefore = await isOpen();
      await head.click();
      await expect.poll(isOpen, { message: `section ${sec} did not toggle` }).toBe(!openBefore);
      // Once written, the key must reflect what the DOM shows.
      await expect.poll(async () => (JSON.parse(await ls(page, 'chromasmith_lib_sec_open_v1') || '[]')).includes(sec))
        .toBe(!openBefore);
      // The others must be untouched by this click.
      const others = ['collections', 'people', 'albums', 'drives', 'devices', 'folders', 'cloud'].filter((s) => s !== sec);
      const after = JSON.parse(await ls(page, 'chromasmith_lib_sec_open_v1') || '[]');
      const defaults = new Set(['collections', 'folders', 'drives']);
      for (const o of others) {
        if (await page.locator(`[data-sec-toggle="${o}"]`).count() === 0) continue;
        expect(after.includes(o), `toggling ${sec} also changed ${o}`).toBe(defaults.has(o));
      }
    });
  }

  for (const coll of ['recents', 'favorites', 'edited', 'exported', 'flagged', 'rejected', 'duplicates', 'gphotos']) {
    test(`collection "${coll}" becomes the active source when clicked`, async ({ lib: { page } }) => {
      const row = page.locator(`.lib-coll-row[data-coll="${coll}"]`);
      await row.click();
      await expect(row).toHaveClass(/\bon\b/);
    });
  }

  test('Raw shortcut sets the shared type filter', async ({ lib: { page } }) => {
    await page.click('.lib-coll-row[data-type-shortcut="raw"]');
    await expect(page.locator('#lib-type-filter')).toHaveValue('raw');
    await expect(page.locator('.lib-coll-row[data-type-shortcut="raw"]')).toHaveClass(/\bon\b/);
  });

  test('Videos shortcut sets the shared type filter', async ({ lib: { page } }) => {
    await page.click('.lib-coll-row[data-type-shortcut="video"]');
    await expect(page.locator('#lib-type-filter')).toHaveValue('video');
  });

  test('Needs Review row scopes the catalog to flagged-blurry', async ({ lib: { page } }) => {
    const row = page.locator('.lib-coll-row[data-catalog="blurry"]');
    await row.click();
    await expect(row).toHaveClass(/\bon\b/);
  });

  test('Not Face-Scanned row sets the faces filter', async ({ lib: { page } }) => {
    const row = page.locator('.lib-coll-row[data-faces-pending]');
    await row.click();
    await expect(row).toHaveClass(/\bon\b/);
    await expect(page.locator('#lib-faces-filter')).toHaveValue('pending');
  });

  test('the Albums + button opens the name prompt without collapsing the section', async ({ lib: { page } }) => {
    // The stopPropagation at library-ui.js:8437 is load-bearing: without it the click bubbles
    // to [data-sec-toggle="albums"] and collapses the section under the modal.
    const openBefore = (JSON.parse(await ls(page, 'chromasmith_lib_sec_open_v1') || '[]')).includes('albums');
    if (!openBefore) await page.click('[data-sec-toggle="albums"]');
    await page.click('#lib-album-new');
    const after = (JSON.parse(await ls(page, 'chromasmith_lib_sec_open_v1') || '[]')).includes('albums');
    expect(after, 'the + button collapsed the Albums section').toBe(true);
  });

  test('folder tree: a chevron expands WITHOUT loading the folder', async ({ lib: { page } }) => {
    // HANDOVER §3.2, now fixed (buildTreeNode, library-ui.js): the chevron previously shared
    // ONE row.onclick with the row body that toggled expansion AND called openFolder() AND
    // re-rendered — peeking at a folder's children triggered a full load, same bug the date
    // tree already fixed. Asserted on catalogQuery, NOT listDir: expanding a never-before-seen
    // node legitimately costs exactly one list_dir call either way (that's how its children get
    // discovered at all, see listDirCached) — that call happens whether or not the fix is
    // applied, so it can't distinguish the bug. openFolder() is what's heavy (catalog_add_root +
    // catalog_scan + catalog_query) and what must NOT fire from a chevron click.
    const chev = page.locator('#lib-tree .lib-tree-chev').first();
    if (await chev.count() === 0) test.skip(true, 'no folder tree rendered (no root set in this mock state)');
    const c0 = await counts(page);
    await chev.click();
    expect((await counts(page)).catalogQuery, 'a folder chevron click must not load the folder').toBe(c0.catalogQuery);
  });

  test('keyword tree: a chevron expands WITHOUT navigating', async ({ lib: { page } }) => {
    // Companion to the folder-tree test above — HANDOVER §3.2 covers all three trees. Before
    // the fix, keywordsSectionHtml's row.onclick (library-ui.js:8707-8716) toggled kwExpanded
    // AND called openCatalogView() in one handler; expanding "Travel" to see "Iceland" would
    // also navigate the catalog scope to Travel. The ?libcat=1 mock (library-ui.js:313-318)
    // seeds a two-level tree (Travel > Iceland) specifically so this nesting is testable.
    const kwRoot = page.locator('[data-kw-tree-toggle]');
    if (await kwRoot.count() === 0) test.skip(true, 'no keyword tree rendered in this mock state');
    await kwRoot.click(); // expand the "Keywords" root section itself first
    const travelChev = page.locator('.lib-tree-row[data-kw-scope] [data-chev-toggle]').first();
    if (await travelChev.count() === 0) test.skip(true, 'no expandable keyword node in this mock state');
    const rows0 = await page.locator('.lib-tree-row[data-kw-scope]').count();
    await travelChev.click();
    await expect(page.locator('.lib-tree-row[data-kw-scope]')).not.toHaveCount(rows0); // Iceland appeared
    await expect(page.locator('.lib-tree-row[data-kw-scope].on'), 'a chevron click navigated').toHaveCount(0);
  });

  test('drive volume rows are display-only', async ({ lib: { page } }) => {
    const vol = page.locator('.lib-coll-row.offline').first();
    if (await vol.count() === 0) test.skip(true, 'no offline volume in this mock state');
    const c0 = await counts(page);
    await vol.click();
    expect((await counts(page)).catalogQuery).toBe(c0.catalogQuery);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// UI QUALITY — rules adapted from Vercel's published web-interface-guidelines. These are NOT
// wireframe-fidelity checks; they are the general interface-quality rules that apply to any
// app, reported separately so they can be triaged on their own.
// ════════════════════════════════════════════════════════════════════════════════════════════
test.describe('quality', () => {
  test('every icon-only control has an accessible name', async ({ lib: { page } }) => {
    // "Icon-only buttons need aria-label" — this UI is almost entirely icon-only buttons.
    // `title` is accepted: it is what the app uses today and it does surface an accessible
    // name, even though aria-label is the stronger form.
    const unnamed = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('#lib-top button, #lib-side button')) {
        if (!b.offsetParent) continue;
        const text = (b.textContent || '').trim();
        const name = b.getAttribute('aria-label') || b.getAttribute('title') || text;
        if (!name) out.push(b.id || b.className || b.outerHTML.slice(0, 80));
      }
      return out;
    });
    expect(unnamed, 'icon-only controls with no accessible name').toEqual([]);
  });

  test('Escape closes the sort menu', async ({ lib: { page } }) => {
    await page.click('#lib-sort-btn');
    await expect(page.locator('#lib-sort-menu')).toHaveClass(/\bopen\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#lib-sort-menu')).not.toHaveClass(/\bopen\b/);
  });

  test('Escape closes the gear menu', async ({ lib: { page } }) => {
    await page.click('#lib-view-menu-btn');
    await expect(page.locator('#lib-view-menu')).toHaveClass(/\bopen\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#lib-view-menu')).not.toHaveClass(/\bopen\b/);
  });

  test('Escape closes the filters panel', async ({ lib: { page } }) => {
    await page.click('#lib-filters-btn');
    await expect(page.locator('#lib-filters-panel')).toHaveClass(/\bopen\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#lib-filters-panel')).not.toHaveClass(/\bopen\b/);
  });

  test('interactive controls are keyboard reachable', async ({ lib: { page } }) => {
    // "Interactive elements need keyboard handlers" / focus must be able to land on them.
    const unreachable = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#lib-top button, #lib-top input, #lib-side button')) {
        if (!el.offsetParent) continue;
        if (el.tabIndex < 0) out.push(el.id || el.className);
      }
      return out;
    });
    expect(unreachable, 'controls removed from the tab order').toEqual([]);
  });

  test('focused controls show a visible focus indicator', async ({ lib: { page } }) => {
    // "Never outline-none without focus replacement" — check the real focus-visible paint,
    // not just the stylesheet, by focusing the element and reading its computed style.
    const bare = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#lib-top button')) {
        if (!el.offsetParent) continue;
        el.focus();
        const cs = getComputedStyle(el);
        const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        const hasRing = cs.boxShadow !== 'none';
        if (!hasOutline && !hasRing) out.push(el.id || el.className);
      }
      return out;
    });
    expect(bare, 'controls with no visible focus indicator').toEqual([]);
  });

  test('the sidebar rows a user can click are real buttons or have a role', async ({ lib: { page } }) => {
    // "<button> for actions … not <div onClick>". The sidebar is built from clickable divs;
    // without a role they are invisible to assistive tech and unreachable by keyboard.
    const divRows = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#lib-side [data-coll], #lib-side [data-catalog], #lib-side [data-sec-toggle]')) {
        if (!el.offsetParent) continue;
        if (el.tagName !== 'BUTTON' && !el.getAttribute('role')) out.push(el.className);
      }
      return [...new Set(out)];
    });
    expect(divRows, 'clickable sidebar rows with no button semantics or role').toEqual([]);
  });

  test('destructive drive actions open a menu rather than acting immediately', async ({ lib: { page } }) => {
    // "Destructive actions need confirmation modal or undo window—never immediate."
    // "Free up space…" deletes cached data. It correctly opens a chooser first (and each item
    // then goes through window.confirmModal, library-ui.js:8549) — assert the chooser appears.
    const free = page.locator('[data-cache-free]');
    if (await free.count() === 0) test.skip(true, 'cache usage row not rendered in this mock state');
    await free.click();
    // showCacheMenu (library-ui.js:8569-8582) appends a bare inline-styled div to <body> with
    // no class, id or role — hence this selector. That it CANNOT be addressed any other way is
    // itself the finding asserted below.
    // Match on the bare number: the browser re-serialises cssText, so `z-index:9999` in the
    // source becomes `z-index: 9999` in the style attribute.
    const popover = page.locator('body > div[style*="9999"]');
    await expect(popover.first()).toBeVisible();
    // Same popover, accessibility side: a menu with no role is invisible to assistive tech and
    // unreachable by keyboard.
    await expect(popover.first(), 'destructive-action menu has no role="menu"').toHaveAttribute('role', 'menu');
  });

  test('the app honours prefers-reduced-motion', async ({ lib: { page } }) => {
    // The fixture already runs with reducedMotion:'reduce'. Any element still carrying a
    // non-zero transition duration is ignoring the preference.
    const animated = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#lib-top *, #lib-side *')) {
        const d = getComputedStyle(el).transitionDuration;
        if (d && d !== '0s' && !d.startsWith('0s,')) out.push((el.className || el.tagName) + ' ' + d);
      }
      return [...new Set(out)].slice(0, 10);
    });
    expect(animated, 'transitions still running under prefers-reduced-motion').toEqual([]);
  });
});
