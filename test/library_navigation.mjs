// CHR-192 — Gallery/Studio navigation state and visible job recovery actions.
// Browser-only layout/transport harness; the native companion runs against the actual Tauri app.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const librarySourceOverride = process.env.CULL_NAV_LIBRARY_SOURCE;
const server = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const builtLibrary = relative === 'desktop/dist/library-ui.js';
    const file = builtLibrary && librarySourceOverride ? librarySourceOverride : path.join(root, builtLibrary ? 'desktop/library-ui.js' : relative);
    let body = await readFile(file);
    const ext = path.extname(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm' };
    response.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const sourceRoot = '/test/Photos';
const sessionPath = `${sourceRoot}/Session`;
const assetNames = Array.from({ length: 72 }, (_, i) => `chart-${String(i + 1).padStart(3, '0')}.png`);
const fixtureBytes = {
  chart: (await readFile('test/fixtures/chart.png')).toString('base64'),
  portrait: (await readFile('test/fixtures/portrait.png')).toString('base64'),
};
const jobId = 19277;
const historyRow = {
  id: `raw-review-job-${jobId}`, jobId: `raw-review-job-${jobId}`, rawReviewJobId: jobId,
  label: 'Interrupted RAW preparation', status: 'Interrupted', outcome: 'interrupted',
  done: 0, total: 1, failedCount: 0, failedItems: [], finishedAt: Date.now(),
  detail: 'Resume checks sources, settings and prepared previews before continuing',
};

function assertHeaderGeometry(header, label, titleText) {
  const requiredTitleWidth = Math.min(100, header.title.scrollWidth || 0);
  assert(titleText?.trim() && header.title.visible && header.title.height > 0 && header.title.width + 1 >= requiredTitleWidth,
    `${label}: photo filename must be fully visible up to 100px: ${JSON.stringify({ titleText, requiredTitleWidth, title: header.title })}`);
  assert(header.zoom.visible && header.zoom.width >= 48 && /zoom/i.test(header.zoom.aria || ''),
    `${label}: zoom control must remain visible and accessible: ${JSON.stringify(header.zoom)}`);
  const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
  for (const [name, other] of [['scope', header.scope], ['zoom', header.zoom], ['Jobs', header.jobs]]) {
    assert(!overlaps(header.title, other), `${label}: filename overlaps ${name}: ${JSON.stringify({ title: header.title, other })}`);
  }
  assert(!overlaps(header.scope, header.zoom) && !overlaps(header.scope, header.jobs),
    `${label}: photo scope overlaps zoom or Jobs: ${JSON.stringify(header)}`);
}

async function runTheme(theme, { normalMotion = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: normalMotion ? 'no-preference' : 'reduce' });
  const nativeProbe = await context.newPage();
  await nativeProbe.setContent('<button id="native-space">Space activation</button>');
  await nativeProbe.evaluate(() => { document.getElementById('native-space').onclick = () => { window.spaceActivated = true; }; });
  await nativeProbe.locator('#native-space').focus(); await nativeProbe.locator('#native-space').press('Space');
  assert.equal(await nativeProbe.evaluate(() => window.spaceActivated === true), true, 'isolated native buttons activate with Space in this browser');
  await nativeProbe.close();
  await context.addInitScript(({ theme, fixtureBytes, historyRow, jobId, sourceRoot, sessionPath, assetNames }) => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    localStorage.setItem('csTheme', theme);
    localStorage.setItem('csThemeGallery', theme);
    localStorage.setItem('csThemeEditor', theme);
    localStorage.setItem('chromasmith-job-history-v1', JSON.stringify([historyRow]));
    window.__chr192Calls = [];
    window.__libtestCatalogInvoke = (command, args = {}) => {
      const handled = result => ({ __libtestHandled: true, result });
      if (command === 'list_dir') {
        if (args.path === sourceRoot) return handled([
          { path: sessionPath, name: 'Session', is_dir: true, is_image: false, kind: '', ext: '', mtime: 1, size: 0 },
        ]);
        if (args.path === sessionPath) return handled(assetNames.map((name, i) => ({
          path: `${sessionPath}/${name}`, name, is_dir: false, is_image: true, is_video: false,
          kind: 'image', ext: 'png', mtime: 1000 + i, size: 1000,
        })));
        return handled([]);
      }
      if (command === 'catalog_query' && args.q?.folder) {
        return handled({ total: assetNames.length, capped: false, entries: assetNames.map((name, i) => ({
          id: i + 1, path: `${sessionPath}/${name}`, name, is_dir: false, is_image: true, is_video: false,
          kind: 'image', ext: 'png', mtime: 1000 + i, size: 1000, missing: false, edited_ts: 0,
          offline: false, volume: 'Test', sharpness: null, blurry: false, stack_n: 0, thumb_path: null,
        })) });
      }
      if (['get_thumbnail', 'get_thumbnail_or_offline', 'read_file_bytes'].includes(command)) {
        const bytes = Uint8Array.from(atob(args.path?.includes('portrait') ? fixtureBytes.portrait : fixtureBytes.chart), c => c.charCodeAt(0));
        return handled(bytes);
      }
      if (command === 'raw_review_jobs_get') {
        window.__chr192Calls.push({ command, args });
        return handled({ id: jobId, label: 'Interrupted RAW preparation', status: 'interrupted', items: [
          { index: 0, path: `${sessionPath}/IMG_19277.NEF`, recipeKey: 'prior-key', settingsJson: '{}', status: 'pending', error: null },
        ] });
      }
      if (command === 'raw_review_jobs_resume') {
        window.__chr192Calls.push({ command, args });
        const key = args.expectedRecipeKeys?.find(item => item.index === 0)?.recipeKey;
        return handled({ id: jobId, label: 'Interrupted RAW preparation', status: 'running', items: [
          { index: 0, path: `${sessionPath}/IMG_19277.NEF`, recipeKey: key, settingsJson: '{}', status: 'completed', error: null },
        ] });
      }
      if (command === 'raw_review_jobs_finish') {
        window.__chr192Calls.push({ command, args });
        return handled({ id: jobId, status: 'completed' });
      }
      return null;
    };
  }, { theme, fixtureBytes, historyRow, jobId, sourceRoot, sessionPath, assetNames });

  const page = await context.newPage();
  const errors = [];
  let workspaceDiscoverability = null;
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=72&deskx=1`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.locator('#cs-tog-lib').click();
    await page.waitForSelector('#lib-side .lib-tree-row', { timeout: 10000 }).catch(async error => {
      const state = await page.evaluate(() => ({ url: location.href, bodyClass: document.body.className,
        overlay: !!document.getElementById('lib-overlay'), rows: document.querySelectorAll('#lib-side .lib-tree-row').length,
        libHooks: { openFolder: typeof window.chromasmOpenFolder, toggle: typeof window.chromasmToggleLibrary, state: typeof window.__libState },
        scripts: [...document.scripts].map(script => script.src).filter(Boolean),
        resources: performance.getEntriesByType('resource').map(resource => resource.name).filter(name => /library-ui|desktop-native/.test(name)),
        text: document.body.innerText.slice(0, 300) }));
      throw new Error(`${error.message}; page=${JSON.stringify(state)}; pageErrors=${errors.join(' | ')}`);
    });
    const rootRow = page.locator('#lib-side .lib-tree-row').first();
    const rootPath = await rootRow.evaluate(el => el.textContent.trim());
    await rootRow.locator('[data-chev-toggle]').click();
    const folderRow = page.locator('#lib-side .lib-tree-row').filter({ hasText: 'Session' }).first();
    await folderRow.waitFor({ state: 'visible' });
    await folderRow.click();
    await page.waitForSelector('#lib-grid .lib-card[data-path]', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card[data-path]').length >= 4);

    const grid = page.locator('#lib-main');
    if (normalMotion) {
      const targetCard = page.locator('#lib-grid .lib-card[data-path]').nth(49);
      assert.match(await targetCard.getAttribute('data-path'), /chart-050\.png$/, 'normal-motion scenario scrolls the exact PNG target into view');
      await targetCard.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } else {
      await grid.evaluate(el => { el.scrollTop = 2800; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    // A partially clipped target makes Playwright scroll during dblclick, before application
    // handlers run. Center the actual target first, then use that settled position as the
    // navigation baseline, matching a user click on a fully visible card.
    const targetCard = page.locator('#lib-grid .lib-card[data-path]').nth(49);
    await targetCard.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const targetGeometry = await targetCard.evaluate(el => ({ top: el.getBoundingClientRect().top,
      bottom: el.getBoundingClientRect().bottom, path: el.dataset.path,
      viewportTop: document.getElementById('lib-main').getBoundingClientRect().top,
      viewportBottom: document.getElementById('lib-main').getBoundingClientRect().bottom }));
    assert(targetGeometry.top >= targetGeometry.viewportTop && targetGeometry.bottom <= targetGeometry.viewportBottom,
      `target must be fully visible before capturing scroll baseline: ${JSON.stringify(targetGeometry)}`);
    const anchorBefore = await page.evaluate(() => {
      const root = document.getElementById('lib-main');
      const bounds = root.getBoundingClientRect();
      const card = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].find(el => {
        const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      return { path: card?.dataset.path || '', offset: card ? card.getBoundingClientRect().top - bounds.top : null,
        folder: document.querySelector('#lib-side .lib-tree-row.on')?.textContent.trim() || '',
        index: card ? [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].indexOf(card) : -1,
        scrollTop: root.scrollTop, mainWidth: bounds.width, mainHeight: bounds.height,
        gridWidth: document.getElementById('lib-grid')?.getBoundingClientRect().width,
        columns: document.getElementById('lib-grid') ? getComputedStyle(document.getElementById('lib-grid')).gridTemplateColumns : '' };
    });
    assert(anchorBefore.path, 'scrolled Gallery should have a visible photo anchor');
    assert.match(anchorBefore.folder, /Session/, `selected folder should be Session; root was ${rootPath}`);

    await page.evaluate(() => {
      window.__chr192PointerDown = [];
      document.getElementById('lib-main').addEventListener('pointerdown', event => {
        const card = event.target.closest?.('.lib-card[data-path]');
        if (card) window.__chr192PointerDown.push({ path: card.dataset.path, scrollTop: event.currentTarget.scrollTop,
          rectTop: card.getBoundingClientRect().top, rectBottom: card.getBoundingClientRect().bottom,
          detail: event.detail || 0 });
      }, true);
    });
    await targetCard.dblclick();
    const pointerOpen = await page.evaluate(() => window.__chr192PointerDown?.at(-1) || null);
    assert(pointerOpen && Math.abs(pointerOpen.scrollTop - anchorBefore.scrollTop) <= 1,
      `captured Gallery baseline must match the actual photo pointerdown: ${JSON.stringify({ anchorBefore, pointerOpen })}`);
    await page.waitForFunction(() => window.chromasmithHasOpenedPhoto?.() && window.chromasmithSourcePath, null, { timeout: 15000 });
    const source = await page.evaluate(() => window.chromasmithSourcePath);
    assert.equal(source, targetGeometry.path, 'Gallery double-click should open the exact fully visible ordinary PNG');
    await page.locator('#fx-zoom-slider').evaluate(el => {
      el.value = '225'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const studioBefore = await page.evaluate(() => ({
      source: window.chromasmithSourcePath,
      zoom: document.getElementById('fx-zoom-slider')?.value,
      title: document.getElementById('db-title-name')?.textContent.trim(),
      header: (() => { const rect = el => { const r = el?.getBoundingClientRect(), s = el && getComputedStyle(el); return r && {
        x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:el.scrollWidth,
        visible:!!el.getClientRects().length && s.display!=='none' && s.visibility==='visible' && Number(s.opacity)>0,
        aria:el.getAttribute('aria-label') }; };
        return { title:rect(document.getElementById('db-title-name')), zoom:rect(document.getElementById('fx-zoom-slider')),
          scope:rect(document.getElementById('fx-batch-scope')), jobs:rect(document.getElementById('sk2-act-jobs')) }; })(),
      titleNodes: document.querySelectorAll('#db-title-name').length,
      zoomNodes: document.querySelectorAll('#fx-zoom-slider').length,
      capClones: document.querySelectorAll('#sk2-cap-copy').length,
      jobs: (() => { const button = document.getElementById('sk2-act-jobs'); return {
        visible: !!button && button.getClientRects().length > 0,
        studioHost: !!button?.closest('#fx-deskbar-tools'),
        buttonCount: document.querySelectorAll('#sk2-act-jobs').length,
        popoverCount: document.querySelectorAll('#sk2-act-pop').length,
        activityCount: document.querySelectorAll('#lib-activity').length,
        activityInSharedHost: !!document.getElementById('lib-activity')?.closest('#sk2-act'),
        legacyFooterActivity: !!document.querySelector('#lib-statusbar #lib-activity, #lib-footer #lib-activity'),
      }; })(),
      rail: [...document.querySelectorAll('#fx-toolrail .fx-rail-btn')].map(button => ({
        text: button.querySelector('.fx-rail-lb')?.textContent.trim(),
        aria: button.getAttribute('aria-label'), title: button.getAttribute('title'),
      })),
    }));
    assert.equal(studioBefore.source, source);
    assert.equal(studioBefore.zoom, '225');
    assert.equal(studioBefore.title, source.split('/').pop().replace(/\.[^.]+$/, ''));
    assertHeaderGeometry(studioBefore.header, `Studio header (${theme})`, studioBefore.title);
    assert.equal(studioBefore.titleNodes, 1, 'the canonical photo title must not be duplicated');
    assert.equal(studioBefore.zoomNodes, 1, 'the canonical zoom slider must not be duplicated');
    assert.equal(studioBefore.capClones, 0, 'Gallery must not mount cloned Studio header controls');
    assert(studioBefore.rail.length > 0 && studioBefore.rail.every(item => item.text && item.aria), 'tool rail controls keep visible names and accessible names');
    assert.deepEqual(studioBefore.jobs, { visible: true, studioHost: true, buttonCount: 1, popoverCount: 1,
      activityCount: 1, activityInSharedHost: true, legacyFooterActivity: false }, 'Studio exposes one shared Jobs host with no legacy footer activity');

    if (normalMotion) {
      const resizers = await page.locator('#fx-panel-resizer, #fx-rail-resizer, #lib-unified-resizer').evaluateAll(elements =>
        elements.map(el => ({ id: el.id, role: el.getAttribute('role') || el.tagName.toLowerCase(), label: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '', visible: el.getClientRects().length > 0 })));
      const visibleResizers = resizers.filter(item => item.visible);
      assert(visibleResizers.length > 0 && visibleResizers.every(item => item.label),
        `Every visible Studio resizer has an accessible name: ${JSON.stringify(resizers)}`);
      assert(visibleResizers.some(item => item.id === 'fx-rail-resizer' && item.label === 'Resize tool bar'),
        `Studio exposes its visible tool-bar resizer: ${JSON.stringify(resizers)}`);
      assert(resizers.some(item => item.id === 'fx-panel-resizer' && item.label === 'Resize tool panel'),
        `The native tool-panel resizer keeps its accessible name when this pane is hidden: ${JSON.stringify(resizers)}`);
      const settings = page.locator('button[aria-label="Settings — transform, edit settings, view, appearance"]');
      const settingsLabel = await settings.getAttribute('aria-label');
      assert.match(settingsLabel || '', /view/i, 'Settings entry advertises the View controls');
      await settings.click();
      const appearanceCategory = page.locator('#fx-settings-cats .fx-settings-cat[data-cat="appearance"]');
      await appearanceCategory.waitFor({ state: 'visible' });
      assert.equal((await appearanceCategory.textContent()).trim(), 'Appearance');
      await appearanceCategory.click();
      // The existing layout reset is grouped with Appearance; do not invoke it during discovery.
      const resetLayout = page.locator('#fx-appearance-menu button.fx-ovf-item').filter({ hasText: /^Reset layout$/ });
      await resetLayout.waitFor({ state: 'visible' });
      workspaceDiscoverability = { resizers, category: (await appearanceCategory.textContent()).trim(), resetLayout: (await resetLayout.textContent()).trim() };
      await settings.click();
      await page.waitForFunction(() => !document.getElementById('fx-settings-menu')?.classList.contains('on'));
    }

    // The same Jobs control must be keyboard-operable in Studio; Escape closes it, returns focus,
    // and does not switch the workspace. Clicking elsewhere closes it too.
    const studioModeBeforeJobs = await page.evaluate(() => document.body.classList.contains('lib-full'));
    const jobs = page.locator('#sk2-act-jobs');
    await jobs.focus(); await jobs.press('Enter');
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'true', null, { timeout: 7000 }).catch(async error => {
      throw new Error(`${error.message}; keyboard=${JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.id, expanded: document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded'), host: document.getElementById('sk2-act-jobs')?.parentElement?.id, popHidden: document.getElementById('sk2-act-pop')?.hidden })))}`);
    });
    assert.equal(await page.locator('#sk2-act-pop').evaluate(el => el.hidden), false);
    assert.equal(await page.locator('#sk2-act-pop .lib-act-history').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'sk2-act-jobs', 'Escape restores Jobs focus');
    assert.equal(await page.evaluate(() => document.body.classList.contains('lib-full')), studioModeBeforeJobs, 'Escape must not switch workspace');
    await jobs.click();
    await page.locator('#cs-brand-name').click();
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.body.classList.contains('lib-full')), studioModeBeforeJobs, 'click-away must not switch workspace');

    await page.locator('#cs-tog-lib').click();
    await page.waitForFunction(() => document.body.classList.contains('lib-full'), null, { timeout: 10000 });
    // The async Gallery-anchor restore can start after the layout first looks stable.
    // Require the expected card and viewport offset to remain correct while geometry settles.
    await page.waitForFunction(({ path, offset }) => {
      const root = document.getElementById('lib-main'), grid = document.getElementById('lib-grid');
      if (!root || !grid) return false;
      const bounds = root.getBoundingClientRect();
      const card = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].find(el => {
        const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      if (!card || card.dataset.path !== path || Math.abs(card.getBoundingClientRect().top - bounds.top - offset) > 2) {
        window.__chr192LayoutStableFrames = 0;
        return false;
      }
      const now = [root.clientWidth, root.clientHeight, grid.clientWidth, getComputedStyle(grid).gridTemplateColumns,
        root.scrollTop.toFixed(2)].join('|');
      if (window.__chr192LayoutSample === now) window.__chr192LayoutStableFrames = (window.__chr192LayoutStableFrames || 0) + 1;
      else { window.__chr192LayoutSample = now; window.__chr192LayoutStableFrames = 0; }
      return window.__chr192LayoutStableFrames >= 3;
    }, { path: anchorBefore.path, offset: anchorBefore.offset }, { timeout: 5000 });
    const roundTrip = await page.evaluate(() => {
      const root = document.getElementById('lib-main'), bounds = root.getBoundingClientRect();
      const card = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].find(el => {
        const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      const grid = document.getElementById('lib-grid');
      return { folder: document.querySelector('#lib-side .lib-tree-row.on')?.textContent.trim() || '',
        anchor: card?.dataset.path || '', offset: card ? card.getBoundingClientRect().top - bounds.top : null,
        scrollTop: root.scrollTop, mainWidth: bounds.width, mainHeight: bounds.height,
        gridWidth: grid?.getBoundingClientRect().width, columns: grid ? getComputedStyle(grid).gridTemplateColumns : '' };
    });
    assert.match(roundTrip.folder, /Session/);
    assert.equal(roundTrip.anchor, anchorBefore.path, `Gallery anchor identity changed (${theme}, ${normalMotion ? 'no-preference' : 'reduced'}): ${JSON.stringify({ anchorBefore, roundTrip })}`);
    assert(Math.abs(roundTrip.offset - anchorBefore.offset) <= 2, `Gallery scroll anchor moved (${theme}, ${normalMotion ? 'no-preference' : 'reduced'}): ${JSON.stringify({ anchorBefore, roundTrip })}`);
    const galleryJobs = await page.evaluate(() => ({
      visible: document.getElementById('sk2-act-jobs')?.getClientRects().length > 0,
      galleryHost: !!document.getElementById('sk2-act-jobs')?.closest('#lib-top-right'),
      buttonCount: document.querySelectorAll('#sk2-act-jobs').length,
      popoverCount: document.querySelectorAll('#sk2-act-pop').length,
      activityCount: document.querySelectorAll('#lib-activity').length,
      activityInSharedHost: !!document.getElementById('lib-activity')?.closest('#sk2-act'),
      legacyFooterActivity: !!document.querySelector('#lib-statusbar #lib-activity, #lib-footer #lib-activity'),
    }));
    assert.deepEqual(galleryJobs, { visible: true, galleryHost: true, buttonCount: 1, popoverCount: 1,
      activityCount: 1, activityInSharedHost: true, legacyFooterActivity: false }, 'Gallery uses the same single Jobs host without a footer duplicate');
    const galleryModeBeforeJobs = await page.evaluate(() => document.body.classList.contains('lib-full'));
    await page.evaluate(() => {
      window.__chr192Keys = [];
      const button = document.getElementById('sk2-act-jobs');
      const record = (type, phase, e) => window.__chr192Keys.push({ type, phase, key: e.key || '', prevented: e.defaultPrevented, active: document.activeElement?.id });
      for (const type of ['keydown', 'keyup']) {
        document.addEventListener(type, e => record(type, 'document-capture', e), true);
        document.addEventListener(type, e => record(type, 'document-bubble', e));
        window.addEventListener(type, e => record(type, 'window-bubble', e));
      }
      for (const type of ['keydown', 'keyup', 'click', 'focusout']) button.addEventListener(type, e => record(type, 'button', e));
    });
    await page.locator('#sk2-act-jobs').focus(); await page.locator('#sk2-act-jobs').press('Space');
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'true', null, { timeout: 7000 }).catch(async error => {
      throw new Error(`${error.message}; gallery-key=${JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.id, expanded: document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded'), events: window.__chr192Keys })))}`);
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'sk2-act-jobs');
    assert.equal(await page.evaluate(() => document.body.classList.contains('lib-full')), galleryModeBeforeJobs);
    await page.locator('#sk2-act-jobs').click();
    await page.locator('#lib-grid-title').click();
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.body.classList.contains('lib-full')), galleryModeBeforeJobs);
    await page.locator('#cs-tog-studio').click();
    await page.waitForFunction(() => !document.body.classList.contains('lib-full'), null, { timeout: 10000 });
    const studioAfter = await page.evaluate(() => ({
      source: window.chromasmithSourcePath, zoom: document.getElementById('fx-zoom-slider')?.value,
      title: document.getElementById('db-title-name')?.textContent.trim(),
      header: (() => { const rect = el => { const r = el?.getBoundingClientRect(), s = el && getComputedStyle(el); return r && {
        x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:el.scrollWidth,
        visible:!!el.getClientRects().length && s.display!=='none' && s.visibility==='visible' && Number(s.opacity)>0,
        aria:el.getAttribute('aria-label') }; };
        return { title:rect(document.getElementById('db-title-name')), zoom:rect(document.getElementById('fx-zoom-slider')),
          scope:rect(document.getElementById('fx-batch-scope')), jobs:rect(document.getElementById('sk2-act-jobs')) }; })(),
      titleNodes: document.querySelectorAll('#db-title-name').length,
      zoomNodes: document.querySelectorAll('#fx-zoom-slider').length,
      capClones: document.querySelectorAll('#sk2-cap-copy').length,
      railAccessible: [...document.querySelectorAll('#fx-toolrail .fx-rail-btn')].every(button =>
        !!button.querySelector('.fx-rail-lb')?.textContent.trim() && !!button.getAttribute('aria-label')),
    }));
    assertHeaderGeometry(studioAfter.header, `Studio header after Gallery return (${theme})`, studioAfter.title);
    const { header: _headerGeometry, ...studioAfterCore } = studioAfter;
    assert.deepEqual(studioAfterCore, {
      source, zoom: '225', title: source.split('/').pop().replace(/\.[^.]+$/, ''), titleNodes: 1, zoomNodes: 1,
      capClones: 0, railAccessible: true,
    }, 'Studio identity, zoom, header uniqueness, and named rail should survive round trip');
    assert.equal(await page.evaluate(() => document.body.classList.contains('light')), theme === 'light');

    // This uses the actual Jobs disclosure and history-row resume button. The mock responds to
    // the same native journal commands, returning an already-completed matching item so no RAW
    // decode is dispatched by the UI test.
    await page.locator('#cs-tog-lib').click();
    await page.locator('#sk2-act-jobs').click();
    await page.locator(`[data-job-history-id="raw-review-job-${jobId}"] [data-job-raw-resume-id]`).click();
    await page.waitForFunction(id => (window.__chr192Calls || []).some(call => call.command === 'raw_review_jobs_finish' && call.args.id === id), jobId, { timeout: 10000 });
    const jobCalls = await page.evaluate(() => window.__chr192Calls);
    assert.deepEqual(jobCalls.map(call => call.command), ['raw_review_jobs_get', 'raw_review_jobs_resume', 'raw_review_jobs_finish']);
    assert.equal(jobCalls[0].args.id, jobId);
    assert.equal(jobCalls[1].args.id, jobId);
    assert.equal(jobCalls[1].args.expectedRecipeKeys.length, 1);
    assert.equal(jobCalls[1].args.expectedRecipeKeys[0].index, 0);
    assert(jobCalls[1].args.expectedRecipeKeys[0].recipeKey, 'resume dispatch carries the freshly resolved per-photo recipe key');
    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    return { theme, motion: normalMotion ? 'no-preference' : 'reduced', source, rootPath: rootPath,
      folder: roundTrip.folder, anchorBefore: anchorBefore.path, anchor: roundTrip.anchor,
      zoom: studioAfter.zoom, jobs: jobCalls.map(call => call.command), railItems: studioBefore.rail.length,
      ...(workspaceDiscoverability ? { workspaceDiscoverability } : {}) };
  } finally { await context.close(); }
}

try {
  if (process.env.CULL_NAV_CASE === 'normal') {
    const normalMotion = await runTheme('dark', { normalMotion: true });
    console.log(JSON.stringify({ result: 'PASS', viewport: '1366x768', browser: true, nativeDecode: false, normalMotion }));
  } else {
    const dark = await runTheme('dark');
    const light = await runTheme('light');
    const normalMotion = await runTheme('dark', { normalMotion: true });
    console.log(JSON.stringify({ result: 'PASS', viewport: '1366x768', browser: true, nativeDecode: false, dark, light, normalMotion }));
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
