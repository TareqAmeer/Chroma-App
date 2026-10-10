// CHR-267: real native cull input-to-presentation gate; no synthetic RAW or IPC mocks.
// CULL_RAW_PATH, CULL_NATIVE_COMMIT and CULL_EXPECTED_BUILD are required.
import assert from 'node:assert/strict';
import { readFile, mkdir, link, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const rawPath = process.env.CULL_RAW_PATH;
const nativeCommit = process.env.CULL_NATIVE_COMMIT;
const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const nativeProfile = process.env.CULL_NATIVE_PROFILE;
assert(rawPath && /\.(nef|cr3|arw|raf|rw2|dng)$/i.test(rawPath), 'supply a real camera RAW path');
assert(nativeCommit && /^[a-f0-9]{40}$/.test(nativeCommit), 'supply the verified native source commit');
assert(expectedBuild, 'supply the expected native BUILD stamp');
assert(['debug', 'release'].includes(nativeProfile), 'record the native debug/release build profile');
const bytes = await readFile(rawPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (process.env.CULL_RAW_SHA256) assert.equal(sha256, process.env.CULL_RAW_SHA256.toLowerCase());
const folder = path.join(path.dirname(rawPath), 'chr267-cull-performance');
await mkdir(folder, { recursive: true });
// Distinct path/cache keys, one shared real capture. No extra 50MB fixture copies.
const fixturePaths = ['A', 'B'].map(name => path.join(folder, name + path.extname(rawPath)));
for (const target of fixturePaths) {
  try { await link(rawPath, target); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const targetBytes = await readFile(target);
    assert.equal(createHash('sha256').update(targetBytes).digest('hex'), sha256, 'existing fixture must match');
  }
}
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
assert(page, 'native WebView page is missing');
const report = {
  issue: 'CHR-267', capturedAt: new Date().toISOString(), nativeCommit, expectedBuild, nativeProfile,
  fixture: { path: rawPath, sha256, bytes: (await stat(rawPath)).size,
    dataset: 'Two hard-linked paths of one real camera capture; not two independent photographs',
    licence: process.env.CULL_RAW_LICENSE || 'unspecified', source: process.env.CULL_RAW_SOURCE || null },
  hardware: { platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  cache: 'Source-resolution cull cells warmed explicitly in the same native process; initial disk/OS cache unspecified',
  samples: [], failures: [],
};
const output = process.env.CULL_PERF_REPORT || 'test/output/chr267-native-perf.json';
const save = async () => { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2)); };
try {
  const runtime = await page.evaluate(() => {
    if (new URL(location.href).searchParams.has('libtest')) throw Error('Mock Library fixture is forbidden');
    if (!window.__TAURI__?.core?.invoke) throw Error('Actual native IPC is required');
    const gl = typeof FX !== 'undefined' && FX?.gl;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { build: typeof BUILD === 'undefined' ? null : BUILD, url: location.href,
      userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null };
  });
  Object.assign(report, { runtime });
  assert.equal(runtime.build, expectedBuild, 'native app source/build must match the recorded build');
  await page.evaluate(async folder => {
    if (typeof csFirstEditSkip === 'function') csFirstEditSkip();
    if (!chromasmithLibraryIsOpen()) await chromasmithToggleLibrary();
    await chromasmithOpenFolder(folder);
  }, folder);
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length === 2, undefined, { timeout: 60000 });
  const cards = page.locator('#lib-grid .lib-card');
  await cards.nth(0).click();
  await cards.nth(1).click({ modifiers: ['Control'] });
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.locator('#lib-cull-time-all').click();
  await page.locator('#lib-cull-time-start').click();
  await page.locator('#fx-confirm-ok').click();
  // This is deliberate warming, outside the measured navigation/zoom intervals.
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('#lib-survey .lib-survey-cell')];
    return cells.length === 2 && cells.every(el => +el.dataset.sourceWidth * +el.dataset.sourceHeight >= 44e6);
  }, undefined, { timeout: 180000 });
  await page.locator('#lib-survey [data-detail="fit"]').click();
  await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();
  // Start from an idle fitted presentation, not outstanding work from the warming controls.
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('#lib-survey .lib-survey-cell')];
    const ready = cells.length === 2 && document.querySelector('.lib-survey-cell.cmp-focus')?.dataset.surveyIdx === '0'
      && cells.every(el => {
        const wrap = el.querySelector('.lib-cmp-canvas-wrap'), canvas = el.querySelector('canvas');
        const iw = +el.dataset.sourceWidth, ih = +el.dataset.sourceHeight;
        if (!wrap || !canvas || iw * ih < 44e6) return false;
        const fit = Math.min(1, wrap.clientWidth / iw, wrap.clientHeight / ih), rect = canvas.getBoundingClientRect();
        return Math.abs(rect.width - iw * fit) < 3 && Math.abs(rect.height - ih * fit) < 3
          && canvas.width >= Math.floor(rect.width) && canvas.height >= Math.floor(rect.height);
      });
    window.__chr267WarmFitFrames = ready ? (window.__chr267WarmFitFrames || 0) + 1 : 0;
    return window.__chr267WarmFitFrames >= 2;
  }, undefined, { timeout: 15000 });
  // Install an event-clock observer without modifying app functions or accelerating any work.
  await page.evaluate(() => {
    const state = window.__chr267PresentationProbe = { pending: null, results: [] };
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
        let valid = !!canvas && canvas.width > 0 && canvas.height > 0 && iw * ih >= 44e6
          && cell.dataset.surveyIdx === String(pending.index) && cell.checkVisibility();
        if (pending.mode === 'sharp') valid &&= Math.abs(rect.width - iw * fit) < 3 && Math.abs(rect.height - ih * fit) < 3
          && canvas.width >= Math.floor(rect.width) && canvas.height >= Math.floor(rect.height);
        else valid &&= scale === 1 && canvas.width >= roiW && canvas.height >= roiH
          && Math.abs(rect.width - roiW) < 2 && Math.abs(rect.height - roiH) < 2;
        // Source resolution on the DOM must also agree with the actually decoded native image.
        const images = typeof fxImages === 'undefined' ? [] : fxImages;
        const name = cell?.querySelector('.lib-survey-name')?.textContent;
        const stem = name?.replace(/\.[^.]+$/, '');
        const image = images.find(it => it.name === name || it.name === stem || it.rawFile?.name === name
          || it.file?.name === name || (it.path || '').split(/[\\/]/).at(-1) === name);
        const source = image?.fullImg || image?.img;
        const decodedW = source?.naturalWidth || source?.width || 0, decodedH = source?.naturalHeight || source?.height || 0;
        valid &&= decodedW >= iw && decodedH >= ih;
        qualifyingFrames = valid ? qualifyingFrames + 1 : 0;
        if (qualifyingFrames >= 2 || now - pending.started > 10000) {
          const result = { mode: pending.mode, key: pending.key, index: pending.index,
            ms: now - pending.started, presented: qualifyingFrames >= 2, sourceWidth: iw, sourceHeight: ih,
            decodedWidth: decodedW, decodedHeight: decodedH, scale, roi: [roiW, roiH],
            canvas: canvas ? [canvas.width, canvas.height] : null, css: rect ? [rect.width, rect.height] : null };
          state.results.push(result); pending.resolve(result); state.pending = null;
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    document.addEventListener('keydown', capture, true);
    document.addEventListener('click', capture, true);
    state.cleanup = () => { document.removeEventListener('keydown', capture, true); document.removeEventListener('click', capture, true); };
  });
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
  navigation: for (let run = 0; run < 3; run++) {
    for (const [key, index] of [['ArrowRight', 1], ['ArrowLeft', 0]]) {
      await arm('sharp', index, key);
      await page.keyboard.press(key);
      const sample = await observation();
      report.samples.push({run, ...sample, budgetMs: 100, pass: sample.presented && sample.ms < 100});
      if (!sample.presented) break navigation;
    }
  }
  const focusedIndex = await page.locator('.lib-survey-cell.cmp-focus').getAttribute('data-survey-idx');
  await arm('native', Number(focusedIndex));
  await page.locator('#lib-survey [data-detail="native"]').click();
  const native = await observation();
  report.samples.push({...native, budgetMs: 500, pass: native.presented && native.ms < 500});
  report.nativeStages = await page.evaluate(() => (window.__rawPerfLog || []).slice(-100));
  report.failures = report.samples.filter(s => !s.pass).map(s => `${s.mode} ${s.index}: ${s.presented ? s.ms.toFixed(1)+'ms' : 'no qualifying frame'} (budget ${s.budgetMs}ms)`);
  await save();
  console.log(JSON.stringify({samples:report.samples, failures:report.failures, output}));
  if (report.failures.length) process.exitCode = 1;
} catch (error) {
  report.failures.push(String(error.stack || error)); await save(); throw error;
} finally {
  await page.evaluate(() => window.__chr267PresentationProbe?.cleanup?.()).catch(() => {});
  // Disconnect only. Never close the native app or reset the user's preferences/cache.
  await browser.close();
}
