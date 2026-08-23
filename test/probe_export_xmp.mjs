#!/usr/bin/env node
// Sanity probe for injectRecipeXmp/buildRecipeXmp (backlog item 1) — not a golden gate, just
// verifies the XMP packet round-trips through a real JPEG/PNG re-encode and parses back out.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        const data = await readFile(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const server = await startServer(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.injectRecipeXmp === 'function');

const result = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#804020'; ctx.fillRect(0, 0, 8, 8);
  const jpegBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const pngBlob = await new Promise(r => c.toBlob(r, 'image/png'));
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  const outJ = injectRecipeXmp(jpegBytes, 'jpg', 'Portra 400', 'Kodak Print');
  const outP = injectRecipeXmp(pngBytes, 'png', 'Portra 400', 'Kodak Print');
  const txtJ = new TextDecoder('latin1').decode(outJ);
  const txtP = new TextDecoder('latin1').decode(outP);
  return {
    jpegGrewBy: outJ.length - jpegBytes.length,
    pngGrewBy: outP.length - pngBytes.length,
    jpegHasSig: txtJ.includes('http://ns.adobe.com/xap/1.0/'),
    jpegHasLook: txtJ.includes('Portra 400') && txtJ.includes('Kodak Print'),
    pngHasKeyword: txtP.includes('XML:com.adobe.xmp'),
    pngHasLook: txtP.includes('Portra 400') && txtP.includes('Kodak Print'),
    jpegStartsOk: outJ[0] === 0xFF && outJ[1] === 0xD8,
    pngStartsOk: outP[0] === 0x89 && outP[1] === 0x50,
  };
});
console.log(JSON.stringify(result, null, 2));
const ok = result.jpegHasSig && result.jpegHasLook && result.pngHasKeyword && result.pngHasLook && result.jpegStartsOk && result.pngStartsOk;
await browser.close(); server.close();
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
