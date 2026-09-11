#!/usr/bin/env node
// ── VISUAL REGRESSION BASELINE ───────────────────────────────────────────────────────────────
// Screenshots a handful of representative panel states from the REAL chromasmith-22.html and
// either saves them as baselines or drops them in test/output/ for test/visual_scorecard.mjs to
// diff. Built for the UI/UX redesign phase: a pixel-diff safety net that's local, offline, and
// free (no Percy/Applitools), extending export_harness.mjs/ui_audit.mjs's own pattern —
// deliberately not a new tool, since a Playwright rig for this exact file already exists twice.
//
//   node test/visual_baseline.mjs              # capture into test/output/visual/
//   node test/visual_baseline.mjs --baseline   # capture into test/baselines/visual/ instead
//
// Then diff with:  node test/visual_scorecard.mjs
//
// Scope deliberately small: a handful of representative panels at one viewport, not every
// section/state/viewport ui_audit.mjs already covers structurally. This catches "a redesign
// pass visibly changed panel X" — it is not a replacement for ui_audit.mjs's invariant checks.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WRITE_BASELINE = process.argv.includes('--baseline');
const OUT_DIR = WRITE_BASELINE
  ? path.join(__dirname, 'baselines', 'visual')
  : path.join(__dirname, 'output', 'visual');

const VIEWPORT = { w: 1440, h: 820 };

// One representative screenshot per scenario. Kept small on purpose — see file header.
const SCENARIOS = [
  { name: 'default', section: null },
  { name: 'looks', section: 'looks' },
  { name: 'adjust', section: 'adjust' },
  { name: 'color', section: 'color' },
  { name: 'local_masks', section: 'local', seedMask: true },
  { name: 'crop', section: 'crop' },
  // T51 (editor_ux_spec.json): widening this SAME harness's coverage from one baseline per
  // component/panel to a small state matrix (theme x viewport), rather than building a new
  // commercial-visual-AI-shaped tool — exactly what the spec item asked for. Not attempting the
  // FULL default/hover/active/disabled/error x light/dark x desktop/mobile cross product in one
  // pass (that's a much larger baseline set to maintain) — this adds the two axes (theme,
  // viewport) that had ZERO coverage before, on the one panel state (default) most likely to
  // regress silently under either.
  { name: 'default_light', section: null, theme: 'light' },
  { name: 'default_mobile', section: null, viewport: { w: 390, h: 844 }, mobile: true },
  { name: 'adjust_hover', section: 'adjust', hoverSelector: '.fx-row' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json',
  '.css': 'text/css', '.cube': 'text/plain' };

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

function seedMaskFn() {
  if (typeof mskAdd !== 'function') return;
  mskAdd('radial');
  const m = fxState.masks[0];
  if (m) {
    m.crOn = true;
    m.crSamples = [{ h: 0.05, s: 0.30, v: 0.70, rgb: [200, 150, 120] },
                   { h: 0.02, s: 0.25, v: 0.50, rgb: [160, 110, 90] }];
  }
  if (typeof mskRebuild === 'function') mskRebuild();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h } });
    page.on('pageerror', (e) => { console.error('  [pageerror]', e.message); failed = true; });
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });

    // Same fix as export_harness.mjs, for the same reason: grain draws Math.random() directly
    // (no fxState knob pins it the way artSeed pins artifacts), so an un-seeded preview render
    // produces a full-frame-noise-sized diff between any two captures of identical state —
    // confirmed live: without this, even a re-run against its own just-written baseline came
    // back ~60% different. addInitScript runs before the app's own script, so this only affects
    // this Playwright page — chromasmith-22.html on disk is untouched.
    await page.addInitScript(() => {
      const SEED = 0xC0FFEE;
      let s = SEED;
      window.__reseed = () => { s = SEED; };
      Math.random = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    });

    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html?deskx=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.fxSection === 'function', null, { timeout: 30000 });

    const b = await page.$('button:has-text("Got it")').catch(() => null);
    if (b) await b.click().catch(() => {});

    // Same fixture as ui_audit.mjs/export_harness.mjs — most panels render nothing without a photo.
    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });
    // Fixed seed so grain/artifacts don't add render-to-render noise a pixel diff can't tell
    // apart from a real regression — same rationale as export_harness.mjs's own fxState.artSeed.
    await page.evaluate(() => { if (typeof fxState !== 'undefined') fxState.artSeed = 7.7; });

    for (const scenario of SCENARIOS) {
      // Reset any per-scenario state from a PRIOR iteration (theme/viewport/mobile-class) so
      // scenarios don't leak into each other — every scenario before T51's additions ran at the
      // same fixed viewport/theme/class, so this reset never mattered until state-varying
      // scenarios existed.
      await page.setViewportSize({ width: VIEWPORT.w, height: VIEWPORT.h });
      await page.evaluate(() => { document.body.classList.remove('light', 'mobile-fx'); });

      if (scenario.section) {
        const ok = await page.evaluate((s) => {
          if (typeof fxSection !== 'function') return false;
          try { fxSection(s, true); } catch { return false; }
          const p = document.querySelector('.fx-panel'); if (p) { p.scrollTop = 0; p.scrollLeft = 0; }
          return !!document.querySelector('.fx-ctrl.sec-active');
        }, scenario.section);
        if (!ok) { console.error(`  section "${scenario.section}" did not open — skipping ${scenario.name}`); failed = true; continue; }
      }
      if (scenario.seedMask) await page.evaluate(seedMaskFn);

      // Finish any in-flight CSSTransition after toggling theme/mobile classes — same fix as
      // editor_gates.mjs's E7 (wireframe_diff_lib.mjs's settleForCapture): reading rendered state
      // while a colour transition is still interpolating gives a flaky, run-to-run-different
      // screenshot. Confirmed live here too: default_light initially came back ~2.4% different
      // between two BACK-TO-BACK captures of identical state, before this fix.
      const finishAnimations = () => document.getAnimations().forEach((a) => a.finish());
      if (scenario.theme === 'light') { await page.evaluate(() => document.body.classList.add('light')); await page.evaluate(finishAnimations); }
      if (scenario.viewport) await page.setViewportSize({ width: scenario.viewport.w, height: scenario.viewport.h });
      if (scenario.mobile) { await page.evaluate(() => document.body.classList.add('mobile-fx')); await page.evaluate(finishAnimations); }

      // Reseed THEN force one fresh render — the canvas already holds whatever grain the last
      // (unseeded, pre-reseed) render painted, and reseeding Math.random alone doesn't repaint it.
      await page.evaluate(() => {
        if (typeof window.__reseed === 'function') window.__reseed();
        if (typeof renderPreview === 'function') renderPreview();
      });
      await page.waitForTimeout(150);

      if (scenario.hoverSelector) {
        const el = page.locator(scenario.hoverSelector).locator('visible=true').first();
        if (await el.count()) { await el.hover({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); }
      }

      const outPath = path.join(OUT_DIR, `${scenario.name}.png`);
      await page.screenshot({ path: outPath });
      console.log(`  ${WRITE_BASELINE ? 'baseline' : 'captured'}: ${scenario.name}.png`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failed) { console.error('\nOne or more scenarios failed to render — see above.'); process.exit(1); }
  console.log(`\n${WRITE_BASELINE ? 'Baselines' : 'Screenshots'} written to ${path.relative(ROOT, OUT_DIR)}/`);
  if (!WRITE_BASELINE) console.log('Diff with: node test/visual_scorecard.mjs');
}

main().catch((e) => { console.error(e); process.exit(1); });
