// CHR-267: real native cull input-to-presentation gate; no synthetic RAW or IPC mocks.
// CULL_RAW_PATH, CULL_NATIVE_COMMIT and CULL_EXPECTED_BUILD are required.
import assert from 'node:assert/strict';
import { readFile, mkdir, link, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const rawPath = process.env.CULL_RAW_PATH;
const rawPathB = process.env.CULL_RAW_PATH_B || rawPath;
const nativeCommit = process.env.CULL_NATIVE_COMMIT;
const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const nativeProfile = process.env.CULL_NATIVE_PROFILE;
const nativeCatalogDir = process.env.CULL_NATIVE_CATALOG_DIR;
const nativeCacheDir = process.env.CULL_NATIVE_CACHE_DIR;
const resumeWarmed = process.env.CULL_RESUME_WARMED === '1';
assert(rawPath && /\.(nef|cr3|arw|raf|rw2|dng)$/i.test(rawPath), 'supply a real camera RAW path');
assert(rawPathB && /\.(nef|cr3|arw|raf|rw2|dng)$/i.test(rawPathB), 'optional CULL_RAW_PATH_B must be a real camera RAW path');
assert(nativeCommit && /^[a-f0-9]{40}$/.test(nativeCommit), 'supply the verified native source commit');
assert(expectedBuild, 'supply the expected native BUILD stamp');
assert(['debug', 'release'].includes(nativeProfile), 'record the native debug/release build profile');
assert(nativeCatalogDir && nativeCacheDir, 'record the isolated native CS_CATALOG_DIR and CS_CACHE_DIR launch paths');
const bytes = await readFile(rawPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (process.env.CULL_RAW_SHA256) assert.equal(sha256, process.env.CULL_RAW_SHA256.toLowerCase());
const bytesB = rawPathB === rawPath ? bytes : await readFile(rawPathB);
const sha256B = rawPathB === rawPath ? sha256 : createHash('sha256').update(bytesB).digest('hex');
const variedCaptureMode = rawPathB !== rawPath;
if (variedCaptureMode) assert.notEqual(sha256B, sha256, 'CULL_RAW_PATH_B must be a genuinely different capture (different SHA-256)');
const expectedDimensions = (width, height, label, required) => {
  const w = width === undefined ? null : Number(width), h = height === undefined ? null : Number(height);
  if (required) assert(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0, `${label} requires explicit integer source dimensions`);
  if (w !== null || h !== null) assert(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0, `${label} width and height must both be positive integers`);
  const result = w === null ? { width: 8256, height: 5504 } : { width: w, height: h };
  assert(result.width * result.height >= 44e6, `${label} source must be at least 44 MP for the existing timing gate`);
  return result;
};
const dimsA = expectedDimensions(process.env.CULL_RAW_WIDTH, process.env.CULL_RAW_HEIGHT, 'CULL_RAW', false);
const dimsB = variedCaptureMode
  ? expectedDimensions(process.env.CULL_RAW_B_WIDTH, process.env.CULL_RAW_B_HEIGHT, 'CULL_RAW_B', true)
  : dimsA;
const sourceFixtures = [
  { label: 'A', sourcePath: rawPath, sourceSha256: sha256, sourceBytes: bytes.length,
    licence: process.env.CULL_RAW_LICENSE || 'unspecified', source: process.env.CULL_RAW_SOURCE || null, ...dimsA },
  { label: 'B', sourcePath: rawPathB, sourceSha256: sha256B, sourceBytes: bytesB.length,
    licence: process.env.CULL_RAW_B_LICENSE || process.env.CULL_RAW_LICENSE || 'unspecified',
    source: process.env.CULL_RAW_B_SOURCE || process.env.CULL_RAW_SOURCE || null, ...dimsB },
];
const folder = path.join(path.dirname(rawPath), variedCaptureMode ? 'chr267-cull-performance-varied' : 'chr267-cull-performance');
await mkdir(folder, { recursive: true });
// Distinct path/cache keys, hard-linked to canonical sources. Same-capture remains the default.
const fixturePaths = sourceFixtures.map(fixture => path.join(folder, fixture.label + path.extname(fixture.sourcePath)));
for (let i = 0; i < fixturePaths.length; i++) {
  const target = fixturePaths[i], fixture = sourceFixtures[i];
  try { await link(fixture.sourcePath, target); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const targetBytes = await readFile(target);
    assert.equal(createHash('sha256').update(targetBytes).digest('hex'), fixture.sourceSha256, `${fixture.label} fixture must match its canonical source`);
  }
}
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
assert(page, 'native WebView page is missing');
const report = {
  issue: 'CHR-267', capturedAt: new Date().toISOString(), nativeCommit, expectedBuild, nativeProfile,
  fixture: { path: rawPath, sha256, bytes: (await stat(rawPath)).size,
    dataset: variedCaptureMode ? 'A/B are hard-linked paths to two different real camera captures' : 'Two hard-linked paths of one real camera capture; not two independent photographs',
    licence: process.env.CULL_RAW_LICENSE || 'unspecified', source: process.env.CULL_RAW_SOURCE || null },
  fixtures: sourceFixtures.map((fixture, index) => ({ ...fixture, path: fixturePaths[index],
    dimensionsSource: index === 0 ? (process.env.CULL_RAW_WIDTH ? 'CULL_RAW_WIDTH/HEIGHT' : 'legacy Nikon Z 7 default') : 'CULL_RAW_B_WIDTH/HEIGHT' })),
  datasetMode: variedCaptureMode ? 'varied-capture' : 'same-capture-compatibility',
  hardware: { platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  cache: resumeWarmed
    ? 'Same-process warmed-cache resume; source-resolution cull cells were already decoded before this harness attached; initial disk/OS cache unspecified'
    : 'Source-resolution cull cells warmed explicitly in the same native process; initial disk/OS cache unspecified',
  measurementMode: resumeWarmed
    ? { mode: 'same-process-warmed-cache-resume', optIn: 'CULL_RESUME_WARMED=1', importAndWarmSkipped: true }
    : { mode: 'fresh-import-and-warm', importAndWarmSkipped: false },
  isolation: { nativeCatalogDir, nativeCacheDir },
  preparation: { mode: resumeWarmed ? 'resumed-warm-cache' : 'fresh-import-and-source-resolution-warmup', startedAt: null, elapsedMs: null },
  samples: [], failures: [], diagnostics: { stages: [], events: [], target: null },
};
const output = process.env.CULL_PERF_REPORT || 'test/output/chr267-native-perf.json';
const expectedPresentationFixtures = report.fixtures.map(({ path, sourceSha256, width, height }) => ({
  path, sha256: sourceSha256, width, height, name: path.split(/[\\/]/).at(-1).toLowerCase(),
}));
const save = async () => { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2)); };
const diagnosticStartedAt = Date.now();
const stage = name => report.diagnostics.stages.push({ at: new Date().toISOString(), elapsedMs: Date.now() - diagnosticStartedAt, name });
const event = (type, data = {}) => {
  const events = report.diagnostics.events;
  events.push({ at: new Date().toISOString(), elapsedMs: Date.now() - diagnosticStartedAt, type, ...data });
  if (events.length > 200) events.splice(0, events.length - 200);
};
const context = page.context();
let browserDisconnected = false;
page.on('close', () => event('playwright.page.close'));
page.on('crash', () => event('playwright.page.crash'));
page.on('console', message => event('playwright.console', { level: message.type(), text: message.text().slice(0, 500) }));
page.on('pageerror', error => event('playwright.pageerror', { text: String(error).slice(0, 1000) }));
page.on('framenavigated', frame => event('playwright.frameNavigated', { url: frame.url().slice(0, 1000), mainFrame: frame === page.mainFrame() }));
context.on('close', () => event('playwright.context.close'));
browser.on('disconnected', () => {
  browserDisconnected = true;
  event('playwright.browser.disconnected', { message: 'Native WebView CDP connection ended; measurements will fail unless the active operation completed before disconnect.' });
});

// Browser-level target events are diagnostic-only and do not change app state.
// Failure-time /json/list comparison helps distinguish a lost Playwright page
// from a WebView target that actually disappeared.
let browserCdp = null;
let pageCdp = null;
let targetId = null;
try {
  browserCdp = await browser.newBrowserCDPSession();
  for (const name of ['Target.targetCrashed', 'Target.targetDestroyed', 'Target.detachedFromTarget']) {
    browserCdp.on(name, payload => {
      if (name === 'Target.detachedFromTarget' || !targetId || payload.targetId === targetId
        || payload.targetInfo?.targetId === targetId) event(`cdp.${name}`, payload);
    });
  }
  await browserCdp.send('Target.setDiscoverTargets', { discover: true });
  const targets = await browserCdp.send('Target.getTargets');
  const pageInfo = targets.targetInfos.find(info => info.type === 'page' && info.url === page.url());
  targetId = pageInfo?.targetId || null;
  report.diagnostics.target = pageInfo
    ? { ...pageInfo, browserSession: 'browser-level CDP' }
    : { targetId: null, url: page.url(), browserSession: 'browser-level CDP' };
  if (pageInfo?.targetId) {
    pageCdp = await context.newCDPSession(page);
    report.diagnostics.target.pageSessionAttached = true;
    pageCdp.on('Inspector.detached', params => event('cdp.Inspector.detached', params));
  }
} catch (error) {
  event('cdp.initialization.error', { text: String(error).slice(0, 1000) });
}
const compareTargetsAfterFailure = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const url = new URL('/json/list', endpoint);
    const response = await fetch(url, { signal: controller.signal });
    const targets = await response.json();
    const matching = targets.filter(info => info.id === targetId || info.url === report.runtime?.url);
    report.diagnostics.failureTargetComparison = {
      at: new Date().toISOString(), status: response.status, targetId,
      matching: matching.map(info => ({ id: info.id, type: info.type, title: info.title, url: info.url })),
      targetCount: targets.length,
    };
  } catch (error) {
    report.diagnostics.failureTargetComparison = { at: new Date().toISOString(), targetId, error: String(error).slice(0, 500) };
  } finally { clearTimeout(timeout); }
};
try {
  stage('runtime.evaluate.start');
  const runtime = await page.evaluate(() => {
    if (new URL(location.href).searchParams.has('libtest')) throw Error('Mock Library fixture is forbidden');
    if (!window.__TAURI__?.core?.invoke) throw Error('Actual native IPC is required');
    const gl = typeof FX !== 'undefined' && FX?.gl;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { build: typeof BUILD === 'undefined' ? null : BUILD, url: location.href,
      userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null };
  });
  stage('runtime.evaluate.complete');
  Object.assign(report, { runtime });
  assert.equal(runtime.build, expectedBuild, 'native app source/build must match the recorded build');
  const initialCatalog = await page.evaluate(() => window.__TAURI__.core.invoke('catalog_query', { q: { limit: 3, offset: 0 } }));
  stage('initial.catalog.complete');
  const normalizePath = value => value.replaceAll('\\', '/').toLowerCase();
  const expectedPaths = fixturePaths.map(normalizePath).sort();
  const actualPaths = initialCatalog.entries.map(entry => normalizePath(entry.path)).sort();
  assert(initialCatalog.total === 2 && actualPaths.length === 2
    && actualPaths.every((value, index) => value === expectedPaths[index]),
    'use an isolated native catalog containing exactly the two expected RAW fixture paths, never the user catalog');
  report.isolation.initialCatalogTotal = initialCatalog.total;
  report.isolation.initialCatalogPaths = initialCatalog.entries.map(entry => entry.path);
  if (resumeWarmed) {
    stage('resume.verify-cull-view.start');
    const resumed = await page.evaluate(expected => {
      const survey = document.querySelector('#lib-survey');
      if (!survey || !survey.checkVisibility()) throw Error('resume mode requires the current Library Cull view to be visible');
      const cells = [...survey.querySelectorAll('.lib-survey-cell')];
      if (cells.length !== 2) throw Error(`resume mode requires exactly two Cull cells; found ${cells.length}`);
      const normalized = value => String(value || '').replaceAll('\\', '/').toLowerCase();
      const basename = value => normalized(value).split('/').at(-1);
      const images = typeof fxImages === 'undefined' ? [] : fxImages;
      const entries = expected.map(fixture => {
        const path = fixture.path, expectedName = basename(path);
        const cell = cells.find(el => basename(el.querySelector('.lib-survey-name')?.textContent) === expectedName);
        if (!cell) throw Error(`resume mode is missing Cull cell for ${expectedName}`);
        const iw = +cell.dataset.sourceWidth, ih = +cell.dataset.sourceHeight;
        if (iw !== fixture.width || ih !== fixture.height) throw Error(`${expectedName} Cull source dimensions are ${iw}x${ih}, expected ${fixture.width}x${fixture.height}`);
        const image = images.find(it => {
          const candidates = [it.path, it.rawFile?.path, it.file?.path, it.name, it.rawFile?.name, it.file?.name];
          return candidates.some(candidate => basename(candidate) === expectedName);
        });
        const imagePath = image?.path || image?.rawFile?.path || image?.file?.path;
        if (normalized(imagePath) !== normalized(path)) throw Error(`${expectedName} decoded image belongs to ${imagePath}, expected ${path}`);
        const source = image?.fullImg || image?.img;
        const decodedWidth = source?.naturalWidth || source?.width || 0;
        const decodedHeight = source?.naturalHeight || source?.height || 0;
        if (decodedWidth !== fixture.width || decodedHeight !== fixture.height)
          throw Error(`${expectedName} decoded source is ${decodedWidth}x${decodedHeight}, expected ${fixture.width}x${fixture.height}`);
        return { path, sha256: fixture.sha256, imagePath, cellName: cell.querySelector('.lib-survey-name')?.textContent,
          sourceWidth: iw, sourceHeight: ih, decodedWidth, decodedHeight };
      });
      if (new Set(entries.map(entry => entry.cellName)).size !== 2) throw Error('resume mode did not resolve two distinct Cull cells');
      return entries;
    }, expectedPresentationFixtures);
    report.resume = { verifiedAt: new Date().toISOString(), currentView: 'Library Cull', decodedSources: resumed };
    stage('resume.verify-cull-view.complete');
  } else {
  // A failed earlier measurement may leave this disposable app in Cull. Exit through
  // the ordinary keyboard action before requiring the folder's grid cards.
  if (await page.locator('#lib-survey').isVisible()) await page.keyboard.press('Escape');
  await page.evaluate(async folder => {
    if (typeof csFirstEditSkip === 'function') csFirstEditSkip();
    if (!chromasmithLibraryIsOpen()) await chromasmithToggleLibrary();
    // Use the native folder-drop entry point so the folder also becomes the Library
    // root. Calling the low-level browser adapter alone leaves root unset on a
    // fresh profile and subsequent Library reopen paints the first-launch empty UI.
    if (!window.__TAURI__?.event?.emit) throw Error('Native folder-drop event bridge is required');
    await window.__TAURI__.event.emit('tauri://drag-drop', { paths: [folder], position: { x: 0, y: 0 } });
  }, folder);
  stage('folder.drop.complete');
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length === 2, undefined, { timeout: 60000 });
  stage('library.cards.ready');
  const welcomeSkip = page.locator('#cs-modal-ov').getByRole('button', { name: 'Skip for now', exact: true });
  if (await welcomeSkip.isVisible()) await welcomeSkip.click();
  const cards = page.locator('#lib-grid .lib-card');
  await cards.nth(0).click();
  await cards.nth(1).click({ modifiers: ['Control'] });
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.locator('#lib-cull-time-all').click();
  await page.locator('#lib-cull-time-start').click();
  await page.locator('#fx-confirm-ok').click();
  stage('cull.entered');
  // This is deliberate warming, outside the measured navigation/zoom intervals.
  const warmupStartedAt = Date.now(); report.preparation.startedAt = new Date(warmupStartedAt).toISOString();
  await page.waitForFunction(expected => {
    const cells = [...document.querySelectorAll('#lib-survey .lib-survey-cell')];
    const normalized = value => String(value || '').toLowerCase();
    return cells.length === 2 && cells.every(el => {
      const name = normalized(el.querySelector('.lib-survey-name')?.textContent);
      const fixture = expected.find(row => row.name === name);
      return fixture && +el.dataset.sourceWidth === fixture.width && +el.dataset.sourceHeight === fixture.height
        && fixture.width * fixture.height >= 44e6;
    });
  }, expectedPresentationFixtures, { timeout: 180000 });
  report.preparation.elapsedMs = Date.now() - warmupStartedAt;
  stage('source-resolution.warmed');
  }
  await page.locator('#lib-survey [data-detail="fit"]').click();
  await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();
  // Start from an idle fitted presentation, not outstanding work from the warming controls.
  await page.waitForFunction(expected => {
    const cells = [...document.querySelectorAll('#lib-survey .lib-survey-cell')];
    const normalized = value => String(value || '').toLowerCase();
    const images = typeof fxImages === 'undefined' ? [] : fxImages;
    const ready = cells.length === 2 && document.querySelector('.lib-survey-cell.cmp-focus')?.dataset.surveyIdx === '0'
      && cells.every(el => {
        const wrap = el.querySelector('.lib-cmp-canvas-wrap'), canvas = el.querySelector('canvas');
        const iw = +el.dataset.sourceWidth, ih = +el.dataset.sourceHeight;
        const name = normalized(el.querySelector('.lib-survey-name')?.textContent), fixture = expected.find(row => row.name === name);
        if (!fixture || iw !== fixture.width || ih !== fixture.height || !wrap || !canvas || iw * ih < 44e6) return false;
        const stem = name.replace(/\.[^.]+$/, '');
        const image = images.find(it => [it.path, it.rawFile?.path, it.file?.path, it.name, it.rawFile?.name, it.file?.name]
          .some(value => normalized(String(value || '').split(/[\\/]/).at(-1)) === name || normalized(value) === stem));
        const imagePath = image?.path || image?.rawFile?.path || image?.file?.path;
        if (normalized(imagePath) !== normalized(fixture.path)) return false;
        const source = image?.fullImg || image?.img;
        if ((source?.naturalWidth || source?.width || 0) !== fixture.width || (source?.naturalHeight || source?.height || 0) !== fixture.height) return false;
        const fit = Math.min(1, wrap.clientWidth / iw, wrap.clientHeight / ih), rect = canvas.getBoundingClientRect();
        return Math.abs(rect.width - iw * fit) < 3 && Math.abs(rect.height - ih * fit) < 3
          && canvas.width >= Math.floor(rect.width) && canvas.height >= Math.floor(rect.height);
      });
    window.__chr267WarmFitFrames = ready ? (window.__chr267WarmFitFrames || 0) + 1 : 0;
    return window.__chr267WarmFitFrames >= 2;
  }, expectedPresentationFixtures, { timeout: 15000 });
  stage('idle-fit.ready');
  // Install an event-clock observer without modifying app functions or accelerating any work.
  await page.evaluate(expected => {
    const state = window.__chr267PresentationProbe = { pending: null, results: [], expectedFixtures: expected };
    const capture = event => {
      const pending = state.pending;
      if (!pending || pending.started) return;
      const isArrow = event.type === 'keydown' && event.key === pending.key;
      const isNative = event.type === 'click' && event.target.closest('#lib-survey [data-detail="native"]');
      if (!(pending.mode === 'sharp' ? isArrow : isNative)) return;
      pending.started = performance.now();
      let qualifyingFrames = 0;
      const tick = () => {
        const now = performance.now();
        const cell = document.querySelector('#lib-survey .lib-survey-cell.cmp-focus');
        const canvas = cell?.querySelector('canvas');
        const wrap = cell?.querySelector('.lib-cmp-canvas-wrap');
        const iw = +cell?.dataset.sourceWidth, ih = +cell?.dataset.sourceHeight;
        const scale = +cell?.dataset.detailScale, roiW = +cell?.dataset.detailWidth, roiH = +cell?.dataset.detailHeight;
        const fit = wrap && Math.min(1, wrap.clientWidth / iw, wrap.clientHeight / ih);
        const rect = canvas?.getBoundingClientRect();
        const name = cell?.querySelector('.lib-survey-name')?.textContent;
        const normalized = value => String(value || '').toLowerCase();
        const fixture = state.expectedFixtures.find(row => row.name === normalized(name));
        let valid = !!canvas && canvas.width > 0 && canvas.height > 0 && iw * ih >= 44e6
          && fixture && iw === fixture.width && ih === fixture.height
          && cell.dataset.surveyIdx === String(pending.index) && cell.checkVisibility();
        if (pending.mode === 'sharp') valid &&= Math.abs(rect.width - iw * fit) < 3 && Math.abs(rect.height - ih * fit) < 3
          && canvas.width >= Math.floor(rect.width) && canvas.height >= Math.floor(rect.height);
        else valid &&= scale === 1 && canvas.width >= roiW && canvas.height >= roiH
          && Math.abs(rect.width - roiW) < 2 && Math.abs(rect.height - roiH) < 2;
        // Source resolution on the DOM must also agree with the actually decoded native image.
        const images = typeof fxImages === 'undefined' ? [] : fxImages;
        const stem = name?.replace(/\.[^.]+$/, '');
        const image = images.find(it => it.name === name || it.name === stem || it.rawFile?.name === name
          || it.file?.name === name || (it.path || '').split(/[\\/]/).at(-1) === name);
        const imagePath = image?.path || image?.rawFile?.path || image?.file?.path;
        const source = image?.fullImg || image?.img;
        const decodedW = source?.naturalWidth || source?.width || 0, decodedH = source?.naturalHeight || source?.height || 0;
        valid &&= !!fixture && normalized(imagePath) === normalized(fixture.path)
          && decodedW === fixture.width && decodedH === fixture.height;
        qualifyingFrames = valid ? qualifyingFrames + 1 : 0;
        if (qualifyingFrames >= 2 || now - pending.started > 10000) {
          const result = { mode: pending.mode, key: pending.key, index: pending.index,
            ms: now - pending.started, presented: qualifyingFrames >= 2, fixturePath: fixture?.path || null,
            fixtureSha256: fixture?.sha256 || null, fixtureName: name || null, imagePath: imagePath || null,
            sourceWidth: iw, sourceHeight: ih,
            decodedWidth: decodedW, decodedHeight: decodedH, scale, roi: [roiW, roiH],
            canvas: canvas ? [canvas.width, canvas.height] : null, css: rect ? [rect.width, rect.height] : null };
          state.results.push(result); pending.resolve(result); state.pending = null;
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    // Window capture runs before the app's document-capture shortcut handler,
    // which may stopImmediatePropagation for arrow keys.
    window.addEventListener('keydown', capture, true);
    document.addEventListener('click', capture, true);
    state.cleanup = () => { window.removeEventListener('keydown', capture, true); document.removeEventListener('click', capture, true); };
  }, expectedPresentationFixtures);
  const arm = async (mode, index, key = null) => page.evaluate(({mode,index,key}) => {
    const s = window.__chr267PresentationProbe;
    if (s.pending) throw Error('An earlier presentation observation is still pending');
    s.promise = new Promise(resolve => { s.pending = {mode,index,key,resolve,started:null}; });
  }, {mode,index,key});
  const observation = async () => {
    // An input that never reaches the observer must fail rather than hang the gate.
    await page.waitForFunction(() => window.__chr267PresentationProbe.pending === null,
      undefined, { timeout: 12000 });
    return page.evaluate(() => window.__chr267PresentationProbe.promise);
  };
  const assertMeasuredFixture = (sample, index) => {
    const expected = expectedPresentationFixtures[index];
    assert(expected, `measurement index ${index} has no source fixture`);
    assert.equal(normalizePath(sample.fixturePath || ''), normalizePath(expected.path), 'presentation sample must name the focused fixture path');
    assert.equal(sample.fixtureSha256, expected.sha256, 'presentation sample must carry the focused fixture digest');
    assert.equal(normalizePath(sample.imagePath || ''), normalizePath(expected.path), 'decoded editor image must belong to the focused fixture path');
    assert.equal(sample.fixtureName?.toLowerCase(), expected.name, 'presentation sample must name the focused fixture');
  };
  navigation: for (let run = 0; run < 3; run++) {
    for (const [key, index] of [['ArrowRight', 1], ['ArrowLeft', 0]]) {
      stage(`sharp.${run}.${index}.start`);
      await arm('sharp', index, key);
      await page.keyboard.press(key);
      const sample = await observation();
      stage(`sharp.${run}.${index}.complete`);
      report.samples.push({run, ...sample, budgetMs: 100, pass: sample.presented && sample.ms < 100});
      assertMeasuredFixture(sample, index);
      if (!sample.presented) break navigation;
    }
  }
  const focusedIndex = await page.locator('.lib-survey-cell.cmp-focus').getAttribute('data-survey-idx');
  await arm('native', Number(focusedIndex));
  stage('native-detail.start');
  await page.locator('#lib-survey [data-detail="native"]').click();
  const native = await observation();
  stage('native-detail.complete');
  report.samples.push({...native, budgetMs: 500, pass: native.presented && native.ms < 500});
  assertMeasuredFixture(native, Number(focusedIndex));
  report.nativeStages = await page.evaluate(() => (window.__rawPerfLog || []).slice(-100));
  report.failures = report.samples.filter(s => !s.pass).map(s => `${s.mode} ${s.index}: ${s.presented ? s.ms.toFixed(1)+'ms' : 'no qualifying frame'} (budget ${s.budgetMs}ms)`);
  await save();
  console.log(JSON.stringify({samples:report.samples, failures:report.failures, output}));
  if (report.failures.length) process.exitCode = 1;
} catch (error) {
  stage('harness.failure');
  const failure = String(error.stack || error);
  report.failures.push(browserDisconnected
    ? `Native WebView CDP disconnected during the measurement; no reconnect was attempted because the page/session state cannot be safely resumed. Original error: ${failure}`
    : failure);
  if (browserDisconnected) report.diagnostics.disconnect = {
    at: new Date().toISOString(), recoverable: false,
    reason: 'A replacement CDP page cannot prove continuity of the warmed native process and pending presentation observer.',
  };
  await compareTargetsAfterFailure();
  await save(); throw error;
} finally {
  await page.evaluate(() => window.__chr267PresentationProbe?.cleanup?.()).catch(() => {});
  // Disconnect only. Never close the native app or reset the user's preferences/cache.
  await browser.close();
  await pageCdp?.detach().catch(() => {});
  await browserCdp?.detach().catch(() => {});
}
