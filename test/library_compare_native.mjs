// Explicit opt-in native RAW validation. Uses an isolated app/catalog, never libtest IPC.
import assert from 'node:assert/strict';
import { readFile, stat, mkdir, link, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const raw = process.env.CULL_RAW_PATH;
const commit = process.env.CULL_NATIVE_COMMIT;
const build = process.env.CULL_EXPECTED_BUILD;
assert(raw && /\.(nef|cr3|arw|raf|rw2|dng)$/i.test(raw), 'Real camera RAW required');
assert(/^[a-f0-9]{40}$/.test(commit || '') && build, 'Native source commit and BUILD required');
assert(process.env.CULL_NATIVE_CATALOG_DIR && process.env.CULL_NATIVE_CACHE_DIR, 'Isolated catalog/cache launch paths required');
const hash = value => createHash('sha256').update(value).digest('hex');
const sha256 = hash(await readFile(raw));
assert.equal(sha256, process.env.CULL_RAW_SHA256, 'Fixture checksum must match');
const folder = path.join(path.dirname(raw), 'chr268-native-compare');
await mkdir(folder, { recursive: true });
const sources = ['A', 'B', 'C'].map(name => path.join(folder, name + path.extname(raw)));
for (const source of sources) {
  try { await link(raw, source); }
  catch (e) { if (e.code !== 'EEXIST') throw e; assert.equal(hash(await readFile(source)), sha256); }
}
const report = { issue: 'CHR-268', capturedAt: new Date().toISOString(), commit, build,
  fixture: { path: raw, sha256, bytes: (await stat(raw)).size, dataset: 'Three hard-linked paths of one real capture; not varied photographs' },
  isolation: { catalog: process.env.CULL_NATIVE_CATALOG_DIR, cache: process.env.CULL_NATIVE_CACHE_DIR },
  hardware: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() }, samples: [], events: [] };
const output = process.env.CULL_PERF_REPORT || 'test/output/chr268-native-compare.json';
const browser = await chromium.connectOverCDP(process.env.NATIVE_CDP || 'http://127.0.0.1:9223');
try {
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
  assert(page, 'Native WebView required');
  page.on('close', () => report.events.push({ event: 'page.close', at: new Date().toISOString() }));
  page.on('crash', () => report.events.push({ event: 'page.crash', at: new Date().toISOString() }));
  page.on('pageerror', error => report.events.push({ event: 'page.error', message: String(error), at: new Date().toISOString() }));
  browser.on('disconnected', () => report.events.push({ event: 'browser.disconnected', at: new Date().toISOString() }));
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Inspector.detached', event => report.events.push({ event: 'Inspector.detached', detail: event, at: new Date().toISOString() }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const runtime = await page.evaluate(async () => {
    if (new URL(location.href).searchParams.has('libtest') || !window.__TAURI__?.core?.invoke) throw Error('Real native app required');
    const catalog = await window.__TAURI__.core.invoke('catalog_query', { q: { offset: 0, limit: 10 } });
    return { build: BUILD, url: location.href, catalog };
  });
  assert.equal(runtime.build, build);
  const normalized = value => String(value).replaceAll('\\', '/').toLowerCase();
  const actualPaths = runtime.catalog.entries.map(entry => normalized(entry.path)).sort();
  const expectedPaths = sources.map(normalized).sort();
  assert(runtime.catalog.total === 0 || (runtime.catalog.total === 3 && JSON.stringify(actualPaths) === JSON.stringify(expectedPaths)), 'Refuse to operate on any catalog except the exact disposable fixture catalog');
  report.isolation.initialCatalogTotal = runtime.catalog.total;
  report.cache = runtime.catalog.total ? 'Retry after earlier source development; native source cache may be warm. No cold decode or latency target asserted.' : 'Fresh disposable import; disk/OS cache unspecified. No latency target asserted.';
  report.runtime = { build: runtime.build, url: runtime.url };
  await page.evaluate(async folder => {
    if (typeof csFirstEditSkip === 'function') csFirstEditSkip();
    if (!chromasmithLibraryIsOpen()) await chromasmithToggleLibrary();
    await window.__TAURI__.event.emit('tauri://drag-drop', { paths: [folder], position: { x: 0, y: 0 } });
  }, folder);
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length === 3, null, { timeout: 60000 });
  const skip = page.locator('#cs-modal-ov').getByRole('button', { name: 'Skip for now', exact: true });
  if (await skip.isVisible()) await skip.click();
  const names = await page.locator('#lib-grid .lib-card').evaluateAll(cards => cards.map(c => c.dataset.path.split(/[\\/]/).at(-1)));
  const cards = page.locator('#lib-grid .lib-card');
  await cards.nth(0).click();
  await cards.nth(1).click({ modifiers: ['Control'] });
  await cards.nth(2).click({ modifiers: ['Control'] });
  // Observe production decoding; no replacement pixels or IPC mocks.
  await page.evaluate(() => {
    const original = loadFXImages;
    const probe = window.__nativeCompareProbe = { active: 0, maxActive: 0, maxFrames: 0, calls: [], entries: [], editor: fxImages,
      lens: window.chromasmithLensApplied, persist: window.__chromasmithPersistTarget, input: document.getElementById('sel-input')?.value };
    loadFXImages = async function(files, options) {
      if (!options?.privateEntries) throw Error('Compare attempted a global Editor load');
      probe.active++; probe.maxActive = Math.max(probe.maxActive, probe.active);
      probe.calls.push([...files].map(file => file.__csSourcePath));
      try {
        const entries = await original(files, options); probe.entries.push(...entries);
        probe.maxFrames = Math.max(probe.maxFrames, probe.entries.filter(it => (it.fullImg || it.img)?.width > 0).length);
        return entries;
      } finally { probe.active--; }
    };
  });
  await page.keyboard.press('c');
  const ready = async expected => {
    await page.waitForFunction(names => ['A', 'B'].every((which, i) => {
      const pane = document.querySelector(`.lib-cmp-pane[data-pane="${which}"]`);
      return pane && document.querySelector(`.lib-cmp-name[data-pane="${which}"]`)?.textContent === names[i]
        && +pane.dataset.sourceWidth * +pane.dataset.sourceHeight >= 44e6 && pane.querySelector('canvas')?.width > 0;
    }), expected, { timeout: 240000 });
    const sample = await page.evaluate(() => ({
      panes: [...document.querySelectorAll('.lib-cmp-pane')].map(el => ({ width: +el.dataset.sourceWidth, height: +el.dataset.sourceHeight, scale: +el.dataset.detailScale, error: el.dataset.detailError || null })),
      editorUnchanged: fxImages === __nativeCompareProbe.editor,
      globalsUnchanged: window.chromasmithLensApplied === __nativeCompareProbe.lens && window.__chromasmithPersistTarget === __nativeCompareProbe.persist && document.getElementById('sel-input')?.value === __nativeCompareProbe.input,
      maxFrames: __nativeCompareProbe.maxFrames, maxActive: __nativeCompareProbe.maxActive, calls: __nativeCompareProbe.calls,
    }));
    assert(sample.editorUnchanged && sample.globalsUnchanged, 'Private Compare changed Editor globals');
    assert(sample.maxFrames <= 2 && sample.maxActive === 1, 'Private frame/load bound exceeded');
    assert(sample.panes.every(p => !p.error && p.width * p.height >= 44e6));
    report.samples.push(sample);
  };
  await ready(names.slice(0, 2));
  await page.keyboard.press('ArrowRight'); await ready([names[0], names[2]]);
  await page.keyboard.press('Enter'); await ready([names[2], names[0]]);
  await page.locator('#lib-compare [data-detail="native"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lib-cmp-pane')].every(el => +el.dataset.detailScale === 1), null, { timeout: 30000 });
  await ready([names[2], names[0]]);
  report.result = 'PASS';
  console.log('PASS: real 45MP native Compare source detail, cycle/promote, two private frames, serialized loads and Editor isolation.');
} catch (error) { report.result = 'FAIL'; report.error = String(error.stack || error); throw error; }
finally { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2)); await browser.close(); }
