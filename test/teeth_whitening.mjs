#!/usr/bin/env node
// Browser-level contract for the guided, manual teeth-whitening Brush workflow.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  let checks;
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });
    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.getUISnapshot === 'function', null, { timeout: 30000 });
    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([
        new File([arr], 'portrait-a.png', { type: 'image/png' }),
        new File([arr], 'portrait-b.png', { type: 'image/png' }),
      ]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0 && fxWork && curItem()?.img, null, { timeout: 15000 });
    await page.evaluate(() => updateWork());

    checks = await Promise.race([page.evaluate(async () => {
      const out = [];
      const ck = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
      const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
      fxState.masks.length = 0; mskSel = -1; mskPaintStop();
      mskPaintErase = true; mskPaintErase_sync();
      fxHistory = []; fxHistIdx = -1; _fxHistLocked = false;
      fxHistoryPush();
      const startIdx = fxHistIdx;
      document.querySelector('button[onclick="mskAddMenu(event)"]').click();
      const action = [...document.querySelectorAll('.msk-more-it')]
        .find((button) => button.textContent.includes('Teeth Whitening (manual)'));
      ck('manual Teeth Whitening is discoverable in + Mask', !!action);
      ck('embedded matte action is hidden outside the native desktop shell',
        ![...document.querySelectorAll('.msk-more-it')].some(button=>button.textContent.includes('Embedded Teeth Matte')));
      action?.click();
      const mask = fxState.masks[mskSel];
      ck('action creates a selected Brush mask', !!mask && mask.type === 'brush' && mskSel === 0);
      ck('mask is explicitly named and marked manual', !!mask && mask.name === 'Teeth Whitening (manual)' && mask.origin === 'manual-teeth');
      ck('starter color correction is conservative and editable', !!mask && mask.temp === -0.12 && mask.sat === -0.12 && mask.exp === 0);
      ck('action enters brush painting mode', mskPaintMode && document.getElementById('btn-msk-paint')?.textContent.includes('Painting'));
      ck('action starts in Paint mode even if Erase was previously selected', !mskPaintErase
        && document.getElementById('btn-msk-erase')?.getAttribute('aria-pressed') === 'false');
      ck('panel explains manual selection and lip/gum erasing', document.getElementById('local-ctl')?.textContent.includes('The app does not detect teeth automatically')
        && document.getElementById('local-ctl')?.textContent.includes('lips and gums'));
      ck('on-photo guide appears while painting', document.getElementById('msk-teeth-guide')?.textContent.includes('Paint enamel only'));

      await new Promise((resolve) => setTimeout(resolve, 450)); // let fxUpdate's history debounce settle
      ck('create + starter settings form one undo entry', fxHistIdx === startIdx + 1 && fxHistory.length === startIdx + 2,
        `${startIdx} -> ${fxHistIdx}, ${fxHistory.length} entries`);
      await fxUndo();
      ck('one undo removes the complete workflow mask', fxState.masks.length === 0);
      await fxRedo();
      ck('one redo restores the name, settings and raster', fxState.masks.length === 1
        && fxState.masks[0].name === 'Teeth Whitening (manual)' && fxState.masks[0].temp === -0.12
        && fxState.masks[0].sat === -0.12 && fxState.masks[0].px instanceof Uint8ClampedArray);

      const m = fxState.masks[0];
      const sourcePixels = mskSourceData(64, 48, fxWork);
      let sourceEnergy = 0;
      for (let i = 0; i < sourcePixels.length; i += 4) sourceEnergy += sourcePixels[i] + sourcePixels[i + 1] + sourcePixels[i + 2];
      ck('source fixture contains nonblack photo pixels', sourceEnergy > 0, `${sourceEnergy} RGB energy`);
      const x0 = Math.floor(m.mtW * 0.23), x1 = Math.floor(m.mtW * 0.40);
      const y0 = Math.floor(m.mtH * 0.52), y1 = Math.floor(m.mtH * 0.76);
      m.px.fill(0);
      for (let y = y0; y < y1; y++) m.px.fill(255, y * m.mtW + x0, y * m.mtW + x1);
      _mskTexDirty = true; mskBuildTex(FX, fxState.masks);
      const maskTexture = _mskTexBufs.buf;
      let packedPainted = 0, packedOutside = 0, packedOtherChannels = 0;
      for (let y = 0; y < m.mtH; y++) for (let x = 0; x < m.mtW; x++) {
        const idx = (y * m.mtW + x) * 4;
        if (maskTexture[idx] > 0) {
          if (x >= x0 && x < x1 && y >= y0 && y < y1) packedPainted++;
          else packedOutside++;
        }
        if (maskTexture[idx + 1] || maskTexture[idx + 2] || maskTexture[idx + 3]) packedOtherChannels++;
      }
      const params = getFXParams();
      ck('packed Brush coverage confines whitening to the painted region', packedPainted === (x1 - x0) * (y1 - y0) && packedOutside === 0,
        `${packedPainted} painted / ${packedOutside} outside; px ${m.mtW}x${m.mtH} ${m.px[x0 + y0 * m.mtW]}`);
      ck('packed mask reserves no unintended neighboring channels', packedOtherChannels === 0);
      ck('renderer recipe carries cooling/desaturation on the same local Brush', params.masks.length === 1
        && params.masks[0].type === 'brush' && params.masks[0].temp === -0.12 && params.masks[0].sat === -0.12);

      const saved = JSON.parse(JSON.stringify(getUISnapshot()));
      applyUISnapshot(saved);
      const restored = fxState.masks[0];
      ck('save/reopen snapshot retains manual label, correction and painted selection', restored.origin === 'manual-teeth'
        && restored.name === 'Teeth Whitening (manual)' && restored.temp === -0.12 && restored.sat === -0.12
        && same(restored.px, m.px));

      await new Promise((resolve) => setTimeout(resolve, 450));
      // Mock the native macOS auxiliary extractor while exercising the real browser helper.
      // The two-tone PNG makes the imported raster's resampling/coverage observable without
      // depending on a machine-specific HEIC/RAW auxiliary-matte fixture.
      const embeddedChecks = [];
      const eck = (name, pass, detail) => embeddedChecks.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
      const matteWidth = 32, matteHeight = Math.max(2, Math.round(32 / (fxImages[0].img.naturalWidth / fxImages[0].img.naturalHeight)));
      const pixel = document.createElement('canvas'); pixel.width = matteWidth; pixel.height = matteHeight;
      const ctx = pixel.getContext('2d'), id = ctx.createImageData(matteWidth, matteHeight);
      for (let y = 0; y < matteHeight; y++) for (let x = 0; x < matteWidth; x++) {
        const i = (y * matteWidth + x) * 4, value = x < matteWidth / 2 ? 0 : 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = value; id.data[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      const pngB64 = pixel.toDataURL('image/png').split(',')[1];
      fxImages[0].path = 'fixture/portrait-a.heic'; fxImages[1].path = 'fixture/portrait-b.heic';
      const calls = [];
      let embeddedKind = 'teeth';
      window.__embeddedMatteCore = window.__TAURI__?.core;
      window.__TAURI__ = { ...(window.__TAURI__ || {}), core: { invoke: async (command, args) => {
        calls.push({ command, args });
        if (command !== 'extract_embedded_auxiliary') throw new Error('Unexpected native command: ' + command);
        return [{ kind: embeddedKind, width: matteWidth, height: matteHeight, png_b64: pngB64 }];
      } } };
      window.CS_PLATFORM = { os: 'windows' };
      document.querySelector('button[onclick="mskAddMenu(event)"]').click();
      ck('embedded matte action is hidden on unsupported desktop platforms',
        ![...document.querySelectorAll('.msk-more-it')].some(button=>button.textContent.includes('Embedded Teeth Matte')||button.textContent.includes('Embedded Hair Matte')));
      document.querySelectorAll('.msk-more-menu').forEach(menu=>menu.remove());
      window.CS_PLATFORM.os = 'macos';
      document.querySelector('button[onclick="mskAddMenu(event)"]').click();
      ck('embedded matte action is available on macOS desktop',
        [...document.querySelectorAll('.msk-more-it')].some(button=>button.textContent.includes('Embedded Teeth Matte'))
        && [...document.querySelectorAll('.msk-more-it')].some(button=>button.textContent.includes('Embedded Hair Matte')));
      document.querySelectorAll('.msk-more-menu').forEach(menu=>menu.remove());
      const preEmbeddedCount = fxState.masks.length;
      const embeddedResult = await mskAddEmbeddedTeethWhitening();
      const embedded = fxState.masks[mskSel];
      const embeddedEnergy = embedded?.px?.reduce((n, v) => n + v, 0) || 0;
      const extractionCalls = calls.filter(call=>call.command==='extract_embedded_auxiliary');
      eck('embedded teeth matte invokes native extraction for the current photo path', extractionCalls.length === 1
        && extractionCalls[0].args?.path === 'fixture/portrait-a.heic');
      eck('embedded matte creates a selected editable raster Brush mask', !!embeddedResult
        && fxState.masks.length === preEmbeddedCount + 1 && embedded?.type === 'brush'
        && embedded.px instanceof Uint8ClampedArray && embedded.px.length === embedded.mtW * embedded.mtH
        && embeddedEnergy > 0 && embeddedEnergy < embedded.px.length * 255,
        `${embedded?.mtW}x${embedded?.mtH}, energy ${embeddedEnergy}`);
      eck('embedded matte records teeth source provenance', embedded?.origin === 'embedded-teeth'
        && embedded?.name === 'Teeth Whitening (embedded matte)'
        && embedded?.sourcePath === 'fixture/portrait-a.heic' && embedded?.sourceKind === 'teeth'
        && embedded?.sourceWidth === matteWidth && embedded?.sourceHeight === matteHeight);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const embeddedAfterCreate = fxState.masks.length;
      await fxUndo();
      eck('one undo removes the imported embedded matte', fxState.masks.length === embeddedAfterCreate - 1);
      await fxRedo();
      eck('one redo restores the embedded raster and provenance', fxState.masks.length === embeddedAfterCreate
        && fxState.masks.some(mask => mask.origin === 'embedded-teeth' && mask.px instanceof Uint8ClampedArray
          && mask.px.some(value => value > 0)));

      // Hair uses the same photo-bound extraction and editable Brush raster, but has no teeth
      // whitening color correction. The original image remains the provenance source.
      embeddedKind = 'hair'; delete fxImages[0]._embeddedAuxiliaryPromise;
      const preHairCount = fxState.masks.length;
      const hairResult = await mskAddEmbeddedHairMatte();
      const hair = fxState.masks[mskSel];
      eck('embedded hair matte creates a selected editable Brush mask', !!hairResult
        && fxState.masks.length === preHairCount + 1 && hair?.type === 'brush'
        && hair.px instanceof Uint8ClampedArray && hair.px.length === hair.mtW * hair.mtH
        && hair.px.some(value => value > 0));
      eck('embedded hair matte records source path, kind, and dimensions', hair?.origin === 'embedded-hair'
        && hair?.name === 'Hair (embedded matte)' && hair?.sourcePath === 'fixture/portrait-a.heic'
        && hair?.sourceKind === 'hair' && hair?.sourceWidth === matteWidth && hair?.sourceHeight === matteHeight);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const hairCount = fxState.masks.length;
      await fxUndo();
      eck('one undo removes the imported hair matte', fxState.masks.length === hairCount - 1);
      await fxRedo();
      eck('redo and snapshot round trip preserve the hair selection and provenance', fxState.masks.length === hairCount
        && fxState.masks.some(mask => mask.origin === 'embedded-hair' && mask.sourceKind === 'hair'
          && mask.px instanceof Uint8ClampedArray && mask.px.some(value => value > 0)));
      const hairSnapshot = JSON.parse(JSON.stringify(getUISnapshot())); applyUISnapshot(hairSnapshot);
      eck('save/reopen snapshot retains the hair matte Brush raster', fxState.masks.some(mask => mask.origin === 'embedded-hair'
        && mask.sourceKind === 'hair' && mask.sourcePath === 'fixture/portrait-a.heic' && mask.px?.some(value => value > 0)));

      // An unsupported file returns no teeth map; a native error also leaves the recipe intact.
      const beforeNoMatte = JSON.stringify(getUISnapshot()), nativeInvoke = window.__TAURI__.core.invoke;
      delete fxImages[0]._embeddedAuxiliaryPromise;
      window.__TAURI__.core.invoke = async (command, args) => { calls.push({ command, args }); return []; };
      await mskAddEmbeddedTeethWhitening();
      eck('missing embedded teeth matte leaves masks unchanged', JSON.stringify(getUISnapshot()) === beforeNoMatte);
      delete fxImages[0]._embeddedAuxiliaryPromise;
      await mskAddEmbeddedHairMatte();
      eck('missing embedded hair matte leaves masks unchanged', JSON.stringify(getUISnapshot()) === beforeNoMatte);
      delete fxImages[0]._embeddedAuxiliaryPromise;
      const emptyCanvas = document.createElement('canvas'); emptyCanvas.width = matteWidth; emptyCanvas.height = matteHeight;
      const emptyContext = emptyCanvas.getContext('2d'); emptyContext.fillStyle = '#000'; emptyContext.fillRect(0, 0, matteWidth, matteHeight);
      const emptyPngB64 = emptyCanvas.toDataURL('image/png').split(',')[1];
      window.__TAURI__.core.invoke = async (command, args) => {
        calls.push({ command, args });
        return [{ kind: 'teeth', width: matteWidth, height: matteHeight, png_b64: emptyPngB64 }];
      };
      await mskAddEmbeddedTeethWhitening();
      eck('empty embedded teeth matte does not create a blank whitening mask', JSON.stringify(getUISnapshot()) === beforeNoMatte);
      delete fxImages[0]._embeddedAuxiliaryPromise;
      window.__TAURI__.core.invoke = async (command, args) => { calls.push({ command, args }); throw new Error('fixture extraction failure'); };
      await mskAddEmbeddedTeethWhitening();
      eck('native extraction error leaves masks unchanged', JSON.stringify(getUISnapshot()) === beforeNoMatte);
      delete fxImages[0]._embeddedAuxiliaryPromise;
      await mskAddEmbeddedHairMatte();
      eck('native extraction error also leaves the hair mask list unchanged', JSON.stringify(getUISnapshot()) === beforeNoMatte);

      // A photo can change while the returned PNG is decoding, after native extraction has
      // already completed. The import must recheck photo identity at this second async boundary.
      await fxSelectImage(0); embeddedKind = 'hair'; delete fxImages[0]._embeddedAuxiliaryPromise;
      const nativeDecode = window.Image.prototype.decode;
      let decodeStarted = false, releaseDecode;
      window.Image.prototype.decode = function(){
        if(!this.src.startsWith('data:image/png;base64,'))return nativeDecode.call(this);
        decodeStarted = true;
        return new Promise((resolve,reject)=>{releaseDecode=()=>nativeDecode.call(this).then(resolve,reject);});
      };
      window.__TAURI__.core.invoke = async (command,args)=>{
        calls.push({command,args});
        return [{kind:'hair',width:matteWidth,height:matteHeight,png_b64:pngB64}];
      };
      const beforeDecodeSwitch = fxState.masks.length, decodeWork = mskAddEmbeddedHairMatte();
      for(let i=0;i<100&&!decodeStarted;i++)await new Promise(resolve=>setTimeout(resolve,5));
      eck('hair matte PNG reaches the asynchronous decode step',decodeStarted);
      await fxSelectImage(1);
      const afterDecodeSwitch = fxState.masks.length, outgoingAfterSwitch = fxImages[0].masks.length;
      releaseDecode?.();
      const staleDecodeResult = await Promise.race([decodeWork,new Promise(resolve=>setTimeout(()=>resolve('timeout'),1500))]);
      window.Image.prototype.decode = nativeDecode;
      eck('photo switch during PNG decode cannot attach hair mask to either photo',staleDecodeResult===false
        && fxCurIdx===1 && fxState.masks.length===afterDecodeSwitch
        && fxImages[0].masks.length===outgoingAfterSwitch && beforeDecodeSwitch===outgoingAfterSwitch);

      // Resolve a delayed native response after switching photos: it must not attach to either
      // the outgoing or newly selected photo.
      let releaseExtraction;
      delete fxImages[0]._embeddedAuxiliaryPromise;
      window.__TAURI__.core.invoke = async (command, args) => {
        calls.push({ command, args });
        if(command!=='extract_embedded_auxiliary')return [];
        return new Promise(resolve => { releaseExtraction = () => resolve([{ kind: embeddedKind, width: matteWidth, height: matteHeight, png_b64: pngB64 }]); });
      };
      await fxSelectImage(0);
      const firstPhotoMaskCount = fxState.masks.length;
      const staleWork = mskAddEmbeddedHairMatte();
      await new Promise(resolve => setTimeout(resolve, 20));
      await fxSelectImage(1);
      const secondPhotoMaskCount = fxState.masks.length;
      releaseExtraction?.();
      const staleResult = await Promise.race([staleWork.then(value=>value,e=>{throw e;}),
        new Promise(resolve=>setTimeout(()=>resolve('timeout'),1500))]);
      eck('photo switch discards a stale embedded hair matte result', staleResult === false && fxCurIdx === 1
        && fxState.masks.length === secondPhotoMaskCount
        && fxImages[0].masks.length === firstPhotoMaskCount);
      window.__TAURI__.core.invoke = nativeInvoke;
      if (window.__embeddedMatteCore) window.__TAURI__.core = window.__embeddedMatteCore;
      out.push(...embeddedChecks);

      while (fxState.masks.length < MSK_MAX) mskAdd('brush');
      const beforeFailure = JSON.stringify(getUISnapshot()), selectedBefore = mskSel;
      const createdAtCapacity = mskAddTeethWhitening();
      ck('mask-cap refusal leaves selection and recipe untouched', createdAtCapacity === false
        && fxState.masks.length === MSK_MAX && mskSel === selectedBefore
        && JSON.stringify(getUISnapshot()) === beforeFailure);
      mskPaintStop();
      return out;
    }), new Promise((_, reject) => setTimeout(() => reject(new Error('Browser evaluation timed out after 45 seconds')), 45000))]);
  } finally {
    await browser.close();
    server.close();
  }

  let fail = 0;
  console.log('\nmanual teeth whitening workflow');
  console.log('-------------------------------------------------------------------------');
  for (const c of checks) {
    if (!c.pass) fail++;
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`);
  }
  console.log('-------------------------------------------------------------------------');
  console.log(`${checks.length - fail}/${checks.length} PASS`);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
