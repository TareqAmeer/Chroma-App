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
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0 && fxWork && curItem()?.img, null, { timeout: 15000 });
    await page.evaluate(() => updateWork());

    checks = await page.evaluate(async () => {
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
      while (fxState.masks.length < MSK_MAX) mskAdd('brush');
      const beforeFailure = JSON.stringify(getUISnapshot()), selectedBefore = mskSel;
      const createdAtCapacity = mskAddTeethWhitening();
      ck('mask-cap refusal leaves selection and recipe untouched', createdAtCapacity === false
        && fxState.masks.length === MSK_MAX && mskSel === selectedBefore
        && JSON.stringify(getUISnapshot()) === beforeFailure);
      mskPaintStop();
      return out;
    });
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
