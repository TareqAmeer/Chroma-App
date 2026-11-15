#!/usr/bin/env node
// Regression probe: native <video> playback engine (_fxVeStart/_fxVeStop, FX.setVideoElement) and its JS-decoder fallback.
// The achieved-fps claim is measured in the real desktop app (tools/diagnostics, WKWebView); this covers the state machine:
// play/pause bookkeeping, the FX.render tap being removed, and the exact-frame re-present on pause.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]));
    const d = await readFile(p); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
let fail = 0; const check = (l, c, d) => { if (c) console.log('  ok   ' + l); else { fail++; console.error('  FAIL ' + l + (d ? ' - ' + d : '')); } };
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', e => { fail++; console.error('  [pageerror]', e.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const blob = await (await fetch('/test/fixtures/video_tiny.mp4')).blob();
    await window.loadFXImages([new File([blob], 'video_tiny.mp4', { type: 'video/mp4' })]);
    await new Promise(r => setTimeout(r, 300));
    const it = curItem(); const out = {};
    out.hasApi = typeof FX.setVideoElement === 'function' && typeof _fxVeEligible === 'function';
    // The element path is desktop-shell only; force it here so the probe covers the engine + its fallback.
    window.__fxVeForce = true;
    out.eligible = _fxVeEligible(it);
    const renderBefore = FX.render, ownBefore = Object.prototype.hasOwnProperty.call(FX, 'render');
    if (!fxVideoLoop) fxVideoLoopToggle(); // 10-frame fixture would otherwise end inside the wait
    await fxVideoSeekTo(it, 0);
    fxVideoPlayToggle();
    await new Promise(r => setTimeout(r, 1500)); // element load + start (or the JS fallback when this Chromium cannot play H.264)
    out.playing = !!_fxPlayRAF; out.frameWhilePlaying = it.curFrame; out.usedElement = !!_fxVe; out.fail = !!it._veFail;
    fxVideoPause();
    await new Promise(r => setTimeout(r, 400));
    out.paused = !_fxPlayRAF && !_fxVe;
    out.renderRestored = FX.render === renderBefore && Object.prototype.hasOwnProperty.call(FX, 'render') === ownBefore;
    // paused frame is the exact seek-path frame: scrub value, curFrame and the shown frame agree
    out.scrub = +document.getElementById('vid-scrub').value; out.cur = it.curFrame; out.shown = it._shownFrame;
    // a manual scrub afterwards still works
    await fxVideoSeekTo(it, 3); out.afterSeek = it.curFrame;
    return out;
  });
  check('element-playback API present', r.hasApi);
  check('forced eligibility is true for the fixture', r.eligible === true, String(r.eligible));
  check('Play starts (element path or JS fallback)', r.playing === true);
  check('playhead advanced while playing', r.frameWhilePlaying > 0, String(r.frameWhilePlaying));
  check('Pause stops the run and clears the sentinel', r.paused === true);
  check('FX.render tap removed after playback (same function, same own-ness)', r.renderRestored === true, String(r.renderRestored));
  check('paused frame: scrub == curFrame == shown frame', r.scrub === r.cur && r.cur === r.shown, JSON.stringify([r.scrub, r.cur, r.shown]));
  check('scrub after playback still lands on frame 3', r.afterSeek === 3, String(r.afterSeek));
  console.log('  info: usedElement=' + r.usedElement + ' fail=' + r.fail);
} finally { await browser.close(); server.close(); }
process.exit(fail ? 1 : 0);
