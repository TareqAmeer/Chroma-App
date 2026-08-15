#!/usr/bin/env node
// Headless video-grading gate harness for Chromasmith — same Playwright/SwiftShader rig as
// export_harness.mjs, but for Part B (video grading) instead of stills.
//
// Loads the REAL, unmodified chromasmith-22.html, drives it through the app's own
// loadFXImages()/fxVideoSeekTo() with a tiny committed fixture (test/fixtures/video_tiny.mp4:
// 10 frames, 160x120, 10fps, each frame's luma = (frameIndex*20) mod 255 — a cheap, exact,
// content-addressable way to verify decode/seek land on the RIGHT frame without needing a
// perceptual diff). Chromium's VideoDecoder/VideoEncoder use software codecs even under
// SwiftShader, so this is fully headless — no host GPU or hardware codec dependency.
//
// Usage:
//   node test/video_harness.mjs
//
// Covers demux metadata, footage-quality probes, seek correctness/determinism, the guard that
// video code is invisible to the photo path, and (V6) the trim/step/loop transport wiring.
// It does NOT yet cover playback timing, full encode/export (audio remux, trimmed export frame
// count), or grain-motion determinism — see CLAUDE.md §12 / the video plan's Part 4.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_DIR = path.join(__dirname, 'golden');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json',
  '.css': 'text/css', '.cube': 'text/plain', '.mp4': 'video/mp4' };

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
      } catch (e) {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let failCount = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); }
  else { failCount++; console.error(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const fixturePath = path.join(FIXTURES_DIR, 'video_tiny.mp4');
  await readFile(fixturePath); // throws a clear error if the fixture is missing

  const server = await startServer(ROOT);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    args: [
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (msg) => {
      // GLSL compile errors are the "quiet" bug class (CLAUDE.md §3): they don't white-screen
      // the app, they silently no-op the affected shader program. Surface them loudly here.
      if (msg.type() === 'error') console.error('  [console.error]', msg.text());
    });

    await page.goto(`${baseUrl}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.videoSupported === 'function', null, { timeout: 30000 });

    const supported = await page.evaluate(() => window.videoSupported());
    if (!supported) {
      console.error('FATAL: videoSupported() is false in this Chromium build — cannot run the video harness.');
      process.exit(1);
    }

    // ---- 1. Demux metadata ----------------------------------------------------------------
    console.log('\n[1] Demux metadata (video_tiny.mp4)');
    const meta = await page.evaluate(async () => {
      const resp = await fetch('/test/fixtures/video_tiny.mp4');
      const blob = await resp.blob();
      const file = new File([blob], 'video_tiny.mp4', { type: 'video/mp4' });
      const entry = await window.loadFXVideoFile(file);
      return {
        kind: entry.kind, w: entry.img.width, h: entry.img.height,
        rotation: entry.rotation, isVfr: entry.isVfr, isHdr: entry.isHdr,
        frameCount: entry.frameCount, fps: entry.fps, durationUs: entry.durationUs,
      };
    });
    check('kind === "video"', meta.kind === 'video');
    check('dimensions 160x120', meta.w === 160 && meta.h === 120, JSON.stringify(meta));
    check('rotation 0 (unrotated fixture)', meta.rotation === 0, `got ${meta.rotation}`);
    check('not flagged VFR (CFR fixture)', meta.isVfr === false);
    check('not flagged HDR (SDR fixture)', meta.isHdr === false);
    check('frameCount === 10', meta.frameCount === 10, `got ${meta.frameCount}`);
    check('duration ~= 1s', Math.abs(meta.durationUs - 1e6) < 5e4, `got ${meta.durationUs}us`);

    // ---- 2. Seek correctness ----------------------------------------------------------------
    // Each frame's luma is (frameIndex*20) mod 255 (see gen note below) — an exact, cheap way
    // to verify fxVideoSeekTo() lands on the RIGHT frame rather than an off-by-one neighbour.
    console.log('\n[2] Seek correctness (exact per-frame luma)');
    await page.evaluate(async () => {
      const resp = await fetch('/test/fixtures/video_tiny.mp4');
      const blob = await resp.blob();
      const file = new File([blob], 'video_tiny.mp4', { type: 'video/mp4' });
      await window.loadFXImages([file]);
      await new Promise(r => setTimeout(r, 300));
    });
    const seekResults = await page.evaluate(async () => {
      const it = curItem();
      const out = {};
      for (const f of [0, 3, 6, 9]) {
        await fxVideoSeekTo(it, f);
        const px = it.img.getContext('2d').getImageData(80, 60, 1, 1).data;
        out[f] = px[0]; // R===G===B for this fixture (grey luma ramp)
      }
      return out;
    });
    for (const f of [0, 3, 6, 9]) {
      const expected = (f * 20) % 255;
      const got = seekResults[f];
      check(`frame ${f} luma ~= ${expected}`, Math.abs(got - expected) <= 12, `got ${got}`); // H.264 rounding tolerance
    }

    // ---- 3. Seek determinism (direction-independent) ---------------------------------------
    // The highest-value check in export_harness.mjs's own philosophy: render forward and
    // backward through the same frames and assert the results match. Doesn't yet test frame-
    // seeded grain (that lands with the temporal-grain work in V1+) — it tests that
    // fxVideoSeekTo's generation-counter guard against overlapping async seeks (see its own
    // comment in chromasmith-22.html) doesn't leave a stale frame behind depending on scrub order.
    console.log('\n[3] Seek determinism (forward vs backward walk)');
    const detResults = await page.evaluate(async () => {
      const it = curItem();
      const hashFrame = () => {
        const d = it.img.getContext('2d').getImageData(0, 0, it.img.width, it.img.height).data;
        let h = 0; for (let i = 0; i < d.length; i += 37) h = (h * 31 + d[i]) >>> 0;
        return h;
      };
      const forward = {}, backward = {};
      for (let f = 0; f <= 9; f++) { await fxVideoSeekTo(it, f); forward[f] = hashFrame(); }
      for (let f = 9; f >= 0; f--) { await fxVideoSeekTo(it, f); backward[f] = hashFrame(); }
      return { forward, backward };
    });
    let detOk = true;
    for (let f = 0; f <= 9; f++) if (detResults.forward[f] !== detResults.backward[f]) detOk = false;
    check('frame N identical walking 0→9 and 9→0', detOk,
      detOk ? '' : JSON.stringify({ forward: detResults.forward, backward: detResults.backward }));

    // ---- 4. Video-off-by-default guard: photo path unaffected ------------------------------
    // The single guard the whole plan rests on (CLAUDE.md §12 / Part 4 Gate 0): loading a video
    // must not perturb the photo pipeline. Cheap proxy for the full 18-golden export_harness.mjs
    // suite — render one still through the SAME page (already carrying video/mediabunny state)
    // and diff it against its own golden.
    console.log('\n[4] Photo path unaffected after video code has run');
    const chartGolden = path.join(GOLDEN_DIR, 'chart__identity.png');
    const chartBytes = await readFile(chartGolden);
    const chartFixture = await readFile(path.join(FIXTURES_DIR, 'chart.png'));
    const stillB64 = await page.evaluate(async ({ b64 }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'chart.png', { type: 'image/png' });
      await window.loadFXImages([file]);
      await new Promise(r => setTimeout(r, 100));
      const it = curItem();
      const P = window.getFXParams(it.adjustOverride || undefined);
      const src = window.geomCanvas(it);
      const canvas = await window.processToCanvas(P, src, src.width, src.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'));
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin2 = ''; for (let i = 0; i < bytes.length; i++) bin2 += String.fromCharCode(bytes[i]);
      return btoa(bin2);
    }, { b64: chartFixture.toString('base64') });
    const stillBytes = Buffer.from(stillB64, 'base64');
    check('chart.png x identity still byte-exact vs golden', Buffer.compare(chartBytes, stillBytes) === 0,
      `${chartBytes.length} vs ${stillBytes.length} bytes`);

    // ---- 5. Trim/step/loop transport state (V6) ---------------------------------------------
    // Cheap DOM-level checks for fxVideoStep/fxVideoSetTrimAtPlayhead/fxVideoGoToTrim/loop —
    // no decode needed, just verifies the transport wiring set trimInFrame/trimOutFrame/scrub
    // correctly. The actual trimmed-export frame math is exercised by fxVideoExportSmall itself
    // (trimF0/trimF1/totalFrames) — this only guards the UI plumbing feeding it.
    console.log('\n[5] Trim/step/loop transport state');
    const trimResults = await page.evaluate(async ({ b64 }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'video_tiny.mp4', { type: 'video/mp4' });
      await window.loadFXImages([file]); // check [4] above swapped curItem() to a photo — reload the video
      await new Promise(r => setTimeout(r, 300));
      const it = curItem();
      await fxVideoSeekTo(it, 0);
      document.getElementById('vid-scrub').value = 3;
      fxVideoSetTrimAtPlayhead('in');
      document.getElementById('vid-scrub').value = 7;
      fxVideoSetTrimAtPlayhead('out');
      const afterSet = { in: it.trimInFrame, out: it.trimOutFrame };
      fxVideoStep(-2); // from frame 7 -> 5
      const afterStep = +document.getElementById('vid-scrub').value;
      fxVideoGoToTrim('in');
      const afterGoIn = +document.getElementById('vid-scrub').value;
      fxVideoLoopToggle();
      const loopOn = fxVideoLoop;
      fxVideoLoopToggle();
      const loopOff = fxVideoLoop;
      return { afterSet, afterStep, afterGoIn, loopOn, loopOff };
    }, { b64: (await readFile(path.join(FIXTURES_DIR, 'video_tiny.mp4'))).toString('base64') });
    check('trim-in set to playhead frame 3', trimResults.afterSet.in === 3, JSON.stringify(trimResults.afterSet));
    check('trim-out set to playhead frame 7', trimResults.afterSet.out === 7, JSON.stringify(trimResults.afterSet));
    check('step -2 from frame 7 lands on 5', trimResults.afterStep === 5, `got ${trimResults.afterStep}`);
    check('go-to-trim-in lands on frame 3', trimResults.afterGoIn === 3, `got ${trimResults.afterGoIn}`);
    check('loop toggle flips true then false', trimResults.loopOn === true && trimResults.loopOff === false,
      JSON.stringify(trimResults));

    // ---- 6. Export smoke test (V6) -----------------------------------------------------------
    // fxVideoExportSmall was rewritten wholesale (geometry, borders/canvas-matte, quality/
    // resolution/codec/fps controls, fades) and until now the whole path — including the
    // pre-existing audio remux — had NO coverage in CI. Stubs window.saveFile (a bare top-level
    // function identifier the export path calls, same pattern the stills export already relies
    // on — see its own "bare identifier" comment) to capture the output instead of triggering a
    // real browser download, trims to a 3-frame window, and asserts the export actually produced
    // a non-trivial MP4 blob without throwing.
    console.log('\n[6] Export smoke test (trimmed, small MP4)');
    const exportResult = await page.evaluate(async () => {
      const it = curItem();
      document.getElementById('vid-trim-in').value = 2;
      document.getElementById('vid-trim-out').value = 4; // 3 frames
      fxVideoTrimChanged();
      let saved = null;
      const origSaveFile = window.saveFile;
      window.saveFile = async (content, fname, mime) => { saved = { size: content.size ?? content.byteLength, fname, mime }; };
      let err = null;
      try { await fxVideoExportSmall(it); } catch (e) { err = String(e && e.message || e); }
      window.saveFile = origSaveFile;
      return { saved, err };
    });
    check('export completed without throwing', exportResult.err === null, exportResult.err || '');
    check('export produced a non-trivial MP4', !!exportResult.saved && exportResult.saved.size > 200,
      JSON.stringify(exportResult.saved));
    check('export filename ends in _graded.mp4', !!exportResult.saved && exportResult.saved.fname.endsWith('_graded.mp4'),
      JSON.stringify(exportResult.saved));

    // [7] Film frame through the VIDEO path. Its sizes are precomputed once per clip alongside
    // the borders and matte (see _videoComposeBorderMatte), which is exactly the kind of thing
    // that silently goes one row short — a clipped sprocket row on export and nowhere else. So
    // assert the composed size matches filmFrameOutSize, the same function the renderer uses.
    console.log('\n[7] Film frame in video export');
    const frameResult = await page.evaluate(async () => {
      const it = curItem();
      document.getElementById('sel-film-frame').value = 'sprocket35';
      const sz = filmFrameOutSize(200, 100, { style: 'sprocket35' });
      // Compose a fake graded frame through the real function, with the real dims shape.
      const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
      const dims = { gradedW: 200, gradedH: 100, b1t: 0, b2t: 0, borderedW: 200, borderedH: 100,
                     framedW: sz.w, framedH: sz.h, hasFrame: true, filmFrame: { style: 'sprocket35' },
                     finalW: sz.w, finalH: sz.h, hasMatte: false };
      const out = _videoComposeBorderMatte(mk(200, 100), getFXParams(), dims, null, null, mk(sz.w, sz.h));
      let saved = null;
      const orig = window.saveFile;
      window.saveFile = async (c, f) => { saved = { size: c.size ?? c.byteLength, fname: f }; };
      let err = null;
      try { await fxVideoExportSmall(it); } catch (e) { err = String(e && e.message || e); }
      window.saveFile = orig;
      document.getElementById('sel-film-frame').value = 'none';
      return { expect: [sz.w, sz.h], got: [out.width, out.height], reb: sz.reb, saved, err };
    });
    check('film frame composes to the precomputed size',
      frameResult.got[0] === frameResult.expect[0] && frameResult.got[1] === frameResult.expect[1],
      `expected ${frameResult.expect} got ${frameResult.got}`);
    check('film frame adds a real rebate', frameResult.reb > 0, String(frameResult.reb));
    check('export with a film frame does not throw', frameResult.err === null, frameResult.err || '');
    check('export with a film frame produces an MP4', !!frameResult.saved && frameResult.saved.size > 200,
      JSON.stringify(frameResult.saved));

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failCount === 0 ? 'PASS' : 'FAIL'} — ${failCount} check(s) failed`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
