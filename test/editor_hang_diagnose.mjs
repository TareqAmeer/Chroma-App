// T28 (editor_ux_spec.json) — a reusable hang/infinite-loop diagnostic tool for the Editor.
//
// Built after diagnosing the mskRebuild()/fxEnsureDepthMap() infinite loop (2026-09-10) by hand:
// that took a sequence of throwaway Node+Playwright+CDP scripts (fire the suspect action
// un-awaited, poll Debugger.pause on a timer, print the call-stack sample) written and discarded
// one at a time before the actual loop became visible. This is that process, kept.
//
// WHY THIS EXISTS AS ITS OWN TOOL, not just "add a longer timeout" to a behaviour test: once the
// renderer is genuinely wedged in a tight loop, it also stops responding to ordinary CDP calls
// (page.evaluate, screenshots, traces) for the SAME reason a normal test timeout gives you no
// diagnostic — the loop is consuming the one JS thread those calls need to run on. Debugger.pause
// is different: it is a V8 inspector primitive that can interrupt a running script between
// bytecode ops, so it works even while page.evaluate() is stuck. Polling it on a timer and
// printing the call stack each tick turns "the page hung" into "the stack keeps returning to
// mskRebuild -> fxEnsureDepthMap -> mskRebuild" — a REAL loop reads as the same few frames
// repeating; slow-but-real progress reads as a stack that keeps changing, or eventually settles.
//
// USAGE:
//   node test/editor_hang_diagnose.mjs "<expression>" [options]
//
//   <expression>          A JS expression evaluated in the page, fired UN-AWAITED (so this tool
//                          keeps control of the Node process even if the expression itself
//                          never returns). Example: "mskAdd('radial')"
//
//   --setup "<expr>"      Optional JS run and AWAITED before the target expression, once, to put
//                          the app in the right state (e.g. select a rail section, toggle a
//                          section on). Can be passed multiple times; each runs in order.
//   --seconds N           How long to keep polling for (default 15).
//   --interval N          Seconds between Debugger.pause samples (default 1).
//   --frames N            Call-stack frames to print per sample (default 6).
//   --fixture <path>      Fixture image to load (default test/fixtures/portrait.png).
//   --no-libtest          Boot without ?libtest=1 (plain browser boot, no Tauri/Library mock).
//
// EXIT CODE: 0 if the expression's evaluate() resolved before --seconds elapsed, 1 if it never
// resolved (a real hang candidate — inspect the printed stack samples for a repeating pattern).
//
// This is a manual diagnostic tool, not a gate — it is not wired into editor_gates.mjs/npm test.
// Run it by hand when a behaviour test times out and you need to know WHERE, not just THAT.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = { setups: [], seconds: 15, interval: 1, frames: 6, fixture: 'test/fixtures/portrait.png', libtest: true, expr: null };
  const rest = [...argv];
  out.expr = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--setup') out.setups.push(rest.shift());
    else if (a === '--seconds') out.seconds = parseFloat(rest.shift());
    else if (a === '--interval') out.interval = parseFloat(rest.shift());
    else if (a === '--frames') out.frames = parseInt(rest.shift(), 10);
    else if (a === '--fixture') out.fixture = rest.shift();
    else if (a === '--no-libtest') out.libtest = false;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.expr) throw new Error('Usage: node test/editor_hang_diagnose.mjs "<expression>" [--setup "<expr>"]... [--seconds N] [--interval N]');
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const server = createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const d = await readFile(path.join(ROOT, u.slice(1)));
      const ext = path.extname(u);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;

  const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
  const context = await browser.newContext(DETERMINISTIC_CONTEXT_OPTIONS);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.on('console', (m) => console.log('[page]', m.text()));

  const qs = opts.libtest ? '?libtest=1&deskx=1' : '';
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html${qs}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    if (typeof applyFxLayout === 'function') applyFxLayout();
  });
  await page.keyboard.press('Escape').catch(() => {});

  const fixtureB64 = (await readFile(path.join(ROOT, opts.fixture))).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'fixture.png', { type: 'image/png' });
    if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
  }, fixtureB64);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);

  for (const setup of opts.setups) {
    console.log(`[diagnose] setup: ${setup}`);
    await page.evaluate(setup);
  }

  await cdp.send('Debugger.enable');
  await cdp.send('Runtime.enable');

  console.log(`[diagnose] firing (un-awaited): ${opts.expr}`);
  const t0 = Date.now();
  let resolved = false;
  const evalPromise = page.evaluate(opts.expr)
    .then(() => { resolved = true; console.log(`[diagnose] RESOLVED after ${Date.now() - t0}ms`); })
    .catch((e) => { resolved = true; console.log(`[diagnose] THREW after ${Date.now() - t0}ms:`, e.message); });

  const samples = [];
  const ticks = Math.ceil(opts.seconds / opts.interval);
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, opts.interval * 1000));
    if (resolved) break;
    try {
      const pausedPromise = new Promise((resolve) => cdp.once('Debugger.paused', resolve));
      await cdp.send('Debugger.pause');
      const paused = await Promise.race([
        pausedPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('nopause')), Math.min(500, opts.interval * 1000))),
      ]);
      const stack = paused.callFrames.slice(0, opts.frames).map((f) => f.functionName || '(anon)');
      samples.push(stack.join(' <- '));
      console.log(`[diagnose] t=${((i + 1) * opts.interval).toFixed(1)}s STACK: ${stack.join(' <- ')}`);
      await cdp.send('Debugger.resume').catch(() => {});
    } catch {
      console.log(`[diagnose] t=${((i + 1) * opts.interval).toFixed(1)}s: idle (no pause captured — thread not busy at that instant)`);
    }
  }

  // ⚠️ Decide settled-vs-hung from `resolved` as it stands RIGHT NOW, before touching the
  // browser at all. Closing the browser makes any still-pending evaluate() reject with a
  // "Target page, context or browser has been closed" error — that rejection would otherwise
  // flip `resolved` to true via evalPromise's own .catch(), misreporting a genuine hang as a
  // clean settle (caught live: the buggy-fxEnsureDepthMap regression check below reproduced the
  // real loop, correctly, in the printed stack samples, but originally still exited 0 "settled"
  // because of exactly this ordering bug).
  const hungAtDecisionTime = !resolved;

  await Promise.race([evalPromise, new Promise((r) => setTimeout(r, 200))]);
  await browser.close().catch(() => {});
  server.close();

  if (!hungAtDecisionTime) {
    console.log('[diagnose] RESULT: settled — not a hang (or resolved within --seconds).');
    process.exit(0);
  } else {
    const repeating = samples.length >= 3 && new Set(samples.slice(-3)).size === 1;
    console.log(`[diagnose] RESULT: did NOT settle within ${opts.seconds}s.`);
    if (repeating) console.log('[diagnose] The last 3 stack samples are IDENTICAL — strong signal of a real infinite loop at that exact call chain.');
    else console.log('[diagnose] Stack samples varied — could be a slow-but-real render, or a loop that cycles through several functions (check the full sample list above for a repeating cycle, not just the last 3).');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
