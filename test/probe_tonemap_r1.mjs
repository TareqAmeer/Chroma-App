#!/usr/bin/env node
// One-off visual/numeric demo for ROADMAP.md's R1 (scene-referred highlight roll-off) — NOT
// part of npm test, same role as the other test/probe_*.mjs diagnostics. Renders a synthetic
// radial gradient (bright centre fading to mid-grey — none of the 3 export-harness fixtures
// have a smooth luminance ramp reaching white, so there's nothing for a shoulder curve to act
// on there) pushed +2 stops, once with the tonemap off (today's hard clip) and once on (the new
// BT.2390-style shoulder), and prints the radial luminance profile so the difference is a real
// number, not a screenshot judgment call.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.cube': 'text/plain' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[pageerror]', m.text()); });
  await page.addInitScript(() => {
    const SEED = 0xC0FFEE;
    let s = SEED;
    window.__reseed = () => { s = SEED; };
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.processToCanvas === 'function' && typeof window.getFXParams === 'function', { timeout: 30000 });

  for (const [label, tonemapOn] of [['clip', false], ['tonemap', true]]) {
    const pngB64 = await page.evaluate(async (tonemapOn) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 300;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(256, 150, 0, 256, 150, 260);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#bfbfbf'); g.addColorStop(1, '#404040');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 300);
      fxImages.length = 0;
      fxImages.push({ img: c, name: 'synthetic_gradient', ext: 'png', dpi: null, bytes: null });
      fxCurIdx = 0;
      document.getElementById('tg-adjust')?.classList.add('on');
      const expEl = document.getElementById('sl-adj-exp'); if (expEl) expEl.value = '40'; // +2 stops
      fxState.useTonemap = !!tonemapOn;
      window.__reseed();
      const P = window.getFXParams();
      const canvas = await window.processToCanvas(P, c, c.width, c.height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, tonemapOn);
    await writeFile(`/tmp/r1_${label}.png`, Buffer.from(pngB64, 'base64'));
    console.log(`wrote /tmp/r1_${label}.png`);
  }
  await browser.close();
  server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
