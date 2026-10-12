// RAW face close-ups use the saved developed review recipe, with per-panel stale-work guards.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourceRelative = relative === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : relative;
    const file = path.resolve(root, sourceRelative);
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
assert.ok(process.env.PLAYWRIGHT_EXECUTABLE_PATH, 'set PLAYWRIGHT_EXECUTABLE_PATH to the canonical headless shell');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmithQuickLookDeveloped', '1'); } catch {}
    localStorage.removeItem('chromasmith_lib_theme');
    localStorage.setItem('csTheme', 'dark');
    window.__rawFaceCalls = [];
    window.__rawFaceResolvers = {};
    window.__rawFaceDetailResolvers = {};
    window.__rawFaceDecodeActive = 0;
    window.__rawFaceMaxDecodeActive = 0;
    window.__libtestCatalogInvoke = (command, args) => {
      if (command === 'catalog_faces_for_path') {
        (window.__rawFaceCalls ||= []).push({ command, args });
        const faces = args.path.endsWith('/A.RW2') ? [11] : args.path.endsWith('/B.RW2') ? [21, 22]
          : args.path.endsWith('/C.RW2') ? [31] : args.path.endsWith('/E.RW2') ? [51, 52]
          : args.path.endsWith('/F.RW2') ? [61] : args.path.endsWith('/G.RW2') ? [71]
            : args.path.endsWith('/H.RW2') ? [81] : [41, 42];
        return { __libtestHandled: true, result: faces.map((face_id, i) => ({ face_id, x0: .1 + i * .2, y0: .2, x1: .3 + i * .2, y1: .4,
          person_id: i ? null : 3, name: i ? null : 'Sofia', kind: 'person', confirmed: true, auto_tagged: false, person_auto: false })) };
      }
      if (command === 'peek_raw_camera_path') return { __libtestHandled: true, result: { make: 'Panasonic', model: 'Test RAW' } };
      if (command === 'cache_raw_decode') {
        (window.__rawFaceCalls ||= []).push({ command, args });
        window.__rawFaceDecodeActive++;
        window.__rawFaceMaxDecodeActive = Math.max(window.__rawFaceMaxDecodeActive, window.__rawFaceDecodeActive);
        const entry = { resolveNative: null, rejectNative: null, settled: false };
        entry.resolve = value => { if (!entry.settled) { entry.settled = true; window.__rawFaceDecodeActive--; entry.resolveNative(value); } };
        entry.reject = error => { if (!entry.settled) { entry.settled = true; window.__rawFaceDecodeActive--; entry.rejectNative(error); } };
        (window.__rawFaceResolvers[args.path] ||= []).push(entry);
        return { __libtestHandled: true, result: new Promise((resolve, reject) => { entry.resolveNative = resolve; entry.rejectNative = reject; }) };
      }
      if (command === 'catalog_face_crop') {
        (window.__rawFaceCalls ||= []).push({ command, args });
        const entry = { resolveNative: null, rejectNative: null };
        entry.resolve = () => entry.resolveNative(window.__rawFaceJpeg);
        entry.reject = error => entry.rejectNative(error);
        (window.__rawFaceCropResolvers ||= {})[args.faceId] = entry;
        return { __libtestHandled: true, result: new Promise((resolve, reject) => { entry.resolveNative = resolve; entry.rejectNative = reject; }) };
      }
      if (command === 'catalog_raw_face_detail') {
        (window.__rawFaceCalls ||= []).push({ command, args });
        const entry = { resolveNative: null, rejectNative: null };
        entry.resolve = (malformed = false) => {
          const payload = window.__rawFaceJpeg;
          const crops = args.faceIds.map((faceId, index) => ({ faceId, width: 80 + index, height: 60 + index,
            offset: malformed && index === 0 ? payload.length * (args.faceIds.length + 1) : index * payload.length, length: payload.length }));
          const metadata = new TextEncoder().encode(JSON.stringify({ sourceWidth: 6000, sourceHeight: 4000, lensCorrectionApplied: true, crops }));
          const response = new Uint8Array(4 + metadata.length + payload.length * crops.length);
          new DataView(response.buffer).setUint32(0, metadata.length, true);
          response.set(metadata, 4);
          if (!malformed) crops.forEach((crop, index) => response.set(payload, 4 + metadata.length + crop.offset));
          entry.resolveNative(response.buffer);
        };
        entry.resolveMalformed = () => entry.resolve(true);
        entry.reject = error => entry.rejectNative(error);
        (window.__rawFaceDetailResolvers[args.path] ||= []).push(entry);
        return { __libtestHandled: true, result: new Promise((resolve, reject) => { entry.resolveNative = resolve; entry.rejectNative = reject; }) };
      }
      if (command === 'get_quicklook_preview') {
        (window.__rawFaceCalls ||= []).push({ command, args });
        return { __libtestHandled: true, result: Promise.reject(new Error('RAW must not use embedded preview')) };
      }
      return null;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libtestOpenFaceCloseups === 'function' && typeof window.__libtestSeedSidecar === 'function', { timeout: 30000 });
  await page.evaluate(async () => {
    if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary();
    const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKp//9k=';
    window.__rawFaceJpeg = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  });

  const [a, b, c, failed, detail, staleDetail, malformedDetail, staleSource] = ['/test/RAW/A.RW2', '/test/RAW/B.RW2', '/test/RAW/C.RW2', '/test/RAW/D.RW2', '/test/RAW/E.RW2', '/test/RAW/F.RW2', '/test/RAW/G.RW2', '/test/RAW/H.RW2'];
  const recipe = btoa(JSON.stringify({ rawNr: 'off', demosaicAlgo: 'markesteijn3' }));
  await page.evaluate(([paths, encoded]) => paths.forEach(path => window.__libtestSeedSidecar(path, { recipe: encoded })), [[a, b, c, failed, detail, staleDetail, malformedDetail, staleSource], recipe]);

  // Changing source while A's proxy is active must suppress A entirely and prepare B once for
  // both crops. The face crops then receive precisely the saved RAW recipe key.
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, a);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), a);
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, b);
  await page.waitForFunction(path => window.__libtestRawReviewState().queued.some(job => job.path === path && job.kind === 'face-review'), b);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/A-review.jpg'), a);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), b);
  assert.equal(await page.evaluate(path => window.__rawFaceCalls.some(call => call.command === 'catalog_face_crop' && call.args.faceId === 11), a), false,
    'superseded RAW source cannot dispatch stale face-crop work');
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/B-review.jpg'), b);
  await page.waitForFunction(() => [21, 22].every(id => !!window.__rawFaceCropResolvers?.[id]), { timeout: 30000 });
  const bCalls = await page.evaluate(path => window.__rawFaceCalls.filter(call => call.command === 'cache_raw_decode' && call.args.path === path), b);
  assert.equal(bCalls.length, 1, 'all B faces share one developed review preparation');
  assert.equal(bCalls[0].args.displayOnly, true);
  assert.equal(bCalls[0].args.rawNr, 'off', 'saved per-photo noise reduction is used');
  assert.equal(bCalls[0].args.demosaicAlgo, 'markesteijn3', 'saved per-photo demosaic is used');
  const bCropCalls = await page.evaluate(() => [21, 22].map(faceId => window.__rawFaceCalls.find(call => call.command === 'catalog_face_crop' && call.args.faceId === faceId)));
  assert.ok(bCropCalls.every(call => call?.args.rawReviewRecipeKey === bCalls[0].args.recipeKey), 'each native face crop receives the matching developed review recipe key');

  // A later panel owns the UI even when earlier B crop calls complete afterward.
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, c);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), c);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/C-review.jpg'), c);
  await page.waitForFunction(() => !!window.__rawFaceCropResolvers?.[31], { timeout: 30000 });
  await page.evaluate(() => { window.__rawFaceCropResolvers[21].resolve(); window.__rawFaceCropResolvers[22].resolve(); });
  await page.waitForFunction(() => document.querySelector('#lib-people-edit [role="dialog"]')?.textContent.includes('C.RW2'));
  assert.ok(!(await page.locator('#lib-people-edit [data-face-id="31"] img').getAttribute('src')), 'late B crops cannot populate the current C panel');
  await page.evaluate(() => window.__rawFaceCropResolvers[31].resolve());
  await page.waitForFunction(() => document.querySelector('#lib-people-edit [data-face-id="31"] img.loaded'));
  assert.ok(await page.locator('#lib-people-edit [role="dialog"]').textContent().then(text => text.includes('C.RW2')));

  // A failed developed proxy leaves crops explicitly unavailable and never falls back to a
  // camera-embedded JPEG or legacy face-id-only crop request.
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, failed);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), failed);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).reject(new Error('simulated developed RAW failure')), failed);
  await page.waitForFunction(() => document.querySelectorAll('#lib-people-edit .lib-face-closeup-item img.failed').length === 2, { timeout: 30000 });

  // Detail is explicit and uses the saved full-resolution decode profile. Native returns a
  // bounded header plus crop payloads; one call supplies every face in the photo.
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, detail);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), detail);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/E-review.jpg'), detail);
  await page.waitForFunction(() => [51, 52].every(id => !!window.__rawFaceCropResolvers?.[id]), { timeout: 30000 });
  await page.evaluate(() => { window.__rawFaceCropResolvers[51].resolve(); window.__rawFaceCropResolvers[52].resolve(); });
  await page.waitForFunction(() => document.querySelectorAll('#lib-people-edit .lib-face-closeup-item img.loaded').length === 2);
  assert.ok(await page.locator('#lib-people-edit').innerText().then(text => text.includes('Fit preview')), 'RAW face crops identify the default fit-preview mode');
  await page.locator("#lib-people-edit [data-raw-face-mode='detail']").click();
  await page.waitForFunction(path => window.__rawFaceDetailResolvers?.[path]?.length === 1, detail, { timeout: 30000 });
  const detailArgs = await page.evaluate(path => window.__rawFaceCalls.find(call => call.command === 'catalog_raw_face_detail' && call.args.path === path)?.args, detail);
  assert.deepEqual(detailArgs.faceIds, [51, 52], 'one detail request batches all faces for the current source');
  assert.equal(detailArgs.rawNr, 'off', 'detail uses saved per-photo RAW noise reduction');
  assert.equal(detailArgs.demosaicAlgo, 'markesteijn3', 'detail uses saved per-photo demosaic');
  assert.equal(typeof detailArgs.recipeKey, 'string');
  assert.ok(detailArgs.recipeKey.length > 0, 'detail cache/profile key is present');
  assert.ok(['lut', 'srgb'].includes(detailArgs.mode), 'native detail receives the saved color mode');
  await page.evaluate(path => window.__rawFaceDetailResolvers[path][0].resolve(), detail);
  await page.waitForFunction(() => document.querySelectorAll('#lib-people-edit .lib-face-closeup-item img.loaded').length === 2);
  assert.equal(await page.locator('#lib-people-edit').innerText().then(text => text.includes('Full-resolution source')), true,
    'detail results are labeled as full-resolution source crops');
  const detailQuality = page.locator('#lib-people-edit .lib-face-closeup-quality').first();
  assert.match(await detailQuality.innerText(), /Check face position/, 'lens-corrected detail warns when preview-derived face geometry may shift');
  assert.match(await detailQuality.getAttribute('title'), /Lens correction may shift detected face positions/);
  const inspect = page.locator('#lib-people-edit [data-face-id="51"] [data-inspect-face]');
  assert.equal(await inspect.isEnabled(), true, 'successful detail enables the inspect control');
  await inspect.click();
  assert.equal(await page.locator('#lib-people-edit [data-face-id="51"]').getAttribute('data-inspecting'), 'true', 'inspect expands the chosen face tile');
  assert.equal(await page.locator('#lib-people-edit [data-face-id="51"] [data-inspect-face]').innerText(), 'Fit crop', 'expanded crop offers a direct return to fit');
  assert.equal(await page.locator('#lib-people-edit [data-face-id="51"]').evaluate(el => getComputedStyle(el).gridColumn), '1 / -1', 'inspected crop receives the full grid row');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { localStorage.setItem('csTheme', theme); window.chromasmithSyncLibTheme?.(); }, theme);
    const layout = await page.locator('#lib-people-edit .lib-pe-card').evaluate(card => {
      const box = card.getBoundingClientRect(), viewport = card.querySelector('.lib-face-closeup-viewport');
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight,
        maxHeight: parseFloat(getComputedStyle(viewport).maxHeight), viewportHeight: innerHeight,
        expanded: card.querySelector('[data-inspecting="true"]') !== null,
        inspectEnabled: !card.querySelector('[data-inspect-face]').disabled,
        theme: document.querySelector('#lib-overlay')?.classList.contains('lib-light') ? 'light' : 'dark' };
    });
    assert.ok(layout.left >= 0 && layout.top >= 0 && layout.right <= layout.width && layout.bottom <= layout.height, `${theme}: expanded dialog stays inside the laptop viewport`);
    assert.ok(layout.maxHeight <= layout.viewportHeight * .6 + 1, `${theme}: inspected image viewport is capped at 60vh`);
    assert.equal(layout.expanded, true);
    assert.equal(layout.inspectEnabled, true);
    assert.equal(layout.theme, theme, 'layout check uses the actual synchronized Library theme');
  }
  await page.locator('#lib-people-edit [data-face-id="51"] [data-inspect-face]').click();
  assert.equal(await page.locator('#lib-people-edit [data-face-id="51"]').getAttribute('data-inspecting'), 'false', 'Fit crop collapses the tile');

  // A detail call finishing after switching the source cannot replace the new panel.
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, staleDetail);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), staleDetail);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/F-review.jpg'), staleDetail);
  await page.waitForFunction(() => !!window.__rawFaceCropResolvers?.[61], { timeout: 30000 });
  await page.locator("#lib-people-edit [data-raw-face-mode='detail']").click();
  await page.waitForFunction(path => window.__rawFaceDetailResolvers?.[path]?.length === 1, staleDetail, { timeout: 30000 });
  await page.locator("#lib-people-edit [data-raw-face-mode='fit']").click();
  await page.evaluate(path => window.__rawFaceDetailResolvers[path][0].resolve(), staleDetail);
  await page.waitForFunction(() => document.querySelector('#lib-people-edit')?.innerText.includes('Fit preview'));
  assert.equal(await page.locator('#lib-people-edit').innerText().then(text => text.includes('Full-resolution source')), false,
    'a late detail response cannot overwrite a switch back to fit mode');
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, staleSource);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), staleSource);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/H-review.jpg'), staleSource);
  await page.waitForFunction(() => !!window.__rawFaceCropResolvers?.[81], { timeout: 30000 });
  await page.locator("#lib-people-edit [data-raw-face-mode='detail']").click();
  await page.waitForFunction(path => window.__rawFaceDetailResolvers?.[path]?.length === 1, staleSource, { timeout: 30000 });
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups('/test/RAW/C.RW2'); }, staleSource);
  await page.evaluate(path => window.__rawFaceDetailResolvers[path][0].resolve(), staleSource);
  await page.waitForFunction(() => document.querySelector('#lib-people-edit [role="dialog"]')?.textContent.includes('C.RW2'));
  await page.waitForFunction(() => (window.__rawFaceCalls.filter(call => call.command === 'cache_raw_decode' && call.args.path === '/test/RAW/C.RW2').length) >= 2);
  await page.evaluate(() => window.__rawFaceResolvers['/test/RAW/C.RW2'].at(-1).resolve('/test/cache/C-review-late.jpg'));
  await page.waitForFunction(() => window.__rawFaceCalls.filter(call => call.command === 'catalog_face_crop' && call.args.faceId === 31).length >= 2, { timeout: 30000 });
  await page.evaluate(() => window.__rawFaceCropResolvers[31].resolve());
  assert.equal(await page.locator('#lib-people-edit').innerText().then(text => text.includes('Full-resolution source')), false,
    'late detail results cannot relabel or populate a different photo panel');

  // Malformed native offsets are treated as unavailable; no partial crop or camera-JPEG path.
  await page.evaluate(path => { void window.__libtestOpenFaceCloseups(path); }, malformedDetail);
  await page.waitForFunction(path => window.__rawFaceCalls.some(call => call.command === 'cache_raw_decode' && call.args.path === path), malformedDetail);
  await page.evaluate(path => window.__rawFaceResolvers[path].at(-1).resolve('/test/cache/G-review.jpg'), malformedDetail);
  await page.waitForFunction(() => !!window.__rawFaceCropResolvers?.[71], { timeout: 30000 });
  await page.locator("#lib-people-edit [data-raw-face-mode='detail']").click();
  await page.waitForFunction(path => window.__rawFaceDetailResolvers?.[path]?.length === 1, malformedDetail, { timeout: 30000 });
  await page.evaluate(path => window.__rawFaceDetailResolvers[path][0].resolveMalformed(), malformedDetail);
  await page.waitForFunction(() => document.querySelectorAll('#lib-people-edit .lib-face-closeup-quality').length === 1
    && [...document.querySelectorAll('#lib-people-edit .lib-face-closeup-quality')].every(el => el.textContent === 'Detail unavailable'), { timeout: 30000 });
  assert.equal(await page.locator("#lib-people-edit [data-raw-face-mode='detail']").innerText(), 'Retry RAW detail', 'malformed batch offers an explicit retry');
  assert.equal(await page.locator("#lib-people-edit [data-raw-face-mode='detail']").isEnabled(), true, 'failed detail has an enabled retry control');
  await page.locator("#lib-people-edit [data-raw-face-mode='detail']").click();
  await page.waitForFunction(path => window.__rawFaceDetailResolvers?.[path]?.length === 2, malformedDetail, { timeout: 30000 });
  await page.evaluate(path => window.__rawFaceDetailResolvers[path][1].resolve(), malformedDetail);
  await page.waitForFunction(() => [...document.querySelectorAll('#lib-people-edit .lib-face-closeup-quality')].every(el => el.textContent.startsWith('Full-resolution source')), { timeout: 30000 });
  const outcomes = await page.evaluate(() => ({
    faceCrops: window.__rawFaceCalls.filter(call => call.command === 'catalog_face_crop'),
    embedded: window.__rawFaceCalls.filter(call => call.command === 'get_quicklook_preview'),
    maxDecode: window.__rawFaceMaxDecodeActive,
  }));
  assert.ok(outcomes.faceCrops.every(call => typeof call.args.rawReviewRecipeKey === 'string' && call.args.rawReviewRecipeKey.length), 'RAW face-crop calls never use the legacy identity-only request');
  assert.deepEqual(outcomes.embedded, [], 'RAW face review failure never falls back to the embedded camera preview');
  assert.equal(outcomes.maxDecode, 1, 'RAW review preparation shares the serialized decode lane');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: RAW face close-ups share one saved-recipe review proxy, forward its key, and guard stale/failing panels without JPEG fallback.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
