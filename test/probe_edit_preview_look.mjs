#!/usr/bin/env node
// Regression: csRenderEditPreview must apply the saved LOOK (sel-lut) -- output with a look recipe
// must differ materially from the same photo with no look. Runs against desktop/dist (the real shell build) when
// present, else chromasmith-22.html.   node test/probe_edit_preview_look.mjs [page]
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageRel = process.argv[2] || 'chromasmith-22.html';
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', m => { if (/error|DEBUG/i.test(m.text())) console.log('[console]', m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/${pageRel}?deskx=1`, { waitUntil: 'domcontentloaded' });
  // Mirrors the Library's epFrame(): a fresh hidden ?csrender=1 iframe, first render fired the instant
  // csRenderEditPreview exists (while the LUT <select> options are still being populated).
  const r = await page.evaluate(async (pageRel) => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${i * 37 % 360},60%,${30 + i % 40}%)`; g.fillRect((i * 47) % 400, (i * 31) % 300, 90, 70); }
    const buf = await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer();
    const mean = async (ab) => { const bmp = await createImageBitmap(new Blob([ab])); const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const x = cv.getContext('2d'); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, cv.width, cv.height).data; let s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } const n = d.length / 4; return s.map(v => v / n); };
    const frame = async () => { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;opacity:0;pointer-events:none;z-index:-1'; f.src = location.pathname + '?csrender=1'; document.body.appendChild(f); const t0 = Date.now(); while (!(f.contentWindow && f.contentWindow.csRenderEditPreview) && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 2)); return f; };
    const mkIn = (w, lut) => { const s = JSON.parse(JSON.stringify(w.getUISnapshot())); s.selects = { ...(s.selects || {}), 'sel-lut': lut, 'sel-print': '' }; return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); };
    const out = [];
    const names = Object.keys(LUT_META).slice(0, 3);
    for (const n of names) { // each look gets its OWN cold instance
      const f = await frame(); const w = f.contentWindow;
      try { out.push({ n, m: await mean(await w.csRenderEditPreview(buf, mkIn(w, 'p:' + n), 400)) }); } catch (e) { out.push({ n, err: String(e.message || e) }); }
      f.remove();
    }
    const f = await frame(); const w = f.contentWindow;
    const base = await mean(await w.csRenderEditPreview(buf, mkIn(w, ''), 400));
    return { base, out };
  }, pageRel);
  const diffs = r.out.map(o => o.err ? -1 : Math.max(...o.m.map((v, i) => Math.abs(v - r.base[i]))));
  console.log('max channel diffs vs no-look', diffs, r.out.filter(o => o.err).map(o => o.err));
  ok = diffs.every(d => d > 1);
} finally { await browser.close(); server.close(); }
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
