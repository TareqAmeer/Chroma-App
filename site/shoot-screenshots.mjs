// Capture the product screenshots the landing page and README use.
//
// These used to be a hand-made, untracked folder (`ui-review-screenshots/`), which is exactly
// how they went missing. Driving the REAL app through Playwright instead means a screenshot can
// be regenerated after any UI change with one command, and can never drift into showing a build
// that no longer exists:
//
//   node site/shoot-screenshots.mjs
//
// The photo in the editor shots is site/photos-src/hero.png when present (so the marketing shots
// show a real photograph), falling back to test/fixtures/portrait.png so the script always runs
// on a clean checkout. Library shots use the app's own `?libtest=1` mock (CLAUDE.md §10.14) —
// the Library is native-gated and renders nothing in a plain browser without it.
import { chromium } from 'playwright';
import { withEncoder } from './img-encode.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'assets', 'ui');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream', '.mp4': 'video/mp4', '.cube': 'text/plain' };

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

const exists = (p) => access(p).then(() => true, () => false);

// The first-run tour modal covers the whole editor, so every shot would be a picture of it.
// Setting its own once-only flag before the app boots is how the app itself suppresses a repeat
// visit — cheaper and less brittle than hunting for the "Got it" button after the fact.
const SUPPRESS_TOUR = () => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} };

async function photoB64() {
  for (const p of [path.join(__dirname, 'photos-src', 'hero.png'),
                   path.join(ROOT, 'test', 'fixtures', 'portrait.png')]) {
    if (await exists(p)) return { b64: (await readFile(p)).toString('base64'), name: path.basename(p) };
  }
  throw new Error('no photo to load');
}

async function loadPhoto(page, photo) {
  await page.evaluate(async ({ b64, name }) => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.loadFXImages([new File([arr], name, { type: 'image/png' })]);
  }, photo);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0,
    null, { timeout: 20000 });
  await page.waitForTimeout(700);
}

// Each editor shot is one rail section, opened the way a click opens it.
// The ?libtest=1 mock answers get_thumbnail with a 1x1 BLACK png — right for a layout/perf
// harness, useless for a marketing shot, which comes out as a grid of black rectangles. The
// mock cannot be wrapped through window.__TAURI__ (library-ui.js captures `invoke` into a
// const at module scope under LIBTEST, so the object is never consulted again), so the demo
// image is swapped into the rendered <img> elements instead, once, immediately before the
// shutter. Nothing in the app changes: this runs only on a page this script opened.
const paintThumbs = (page, b64) => page.evaluate((src) => {
  document.querySelectorAll('.lib-thumb-wrap img').forEach((im) => {
    im.src = src; im.classList.add('loaded'); im.classList.remove('thumb-error');
  });
}, `data:image/png;base64,${b64}`);

const EDITOR_SHOTS = [
  { file: 'looks.webp', section: 'looks' },
  { file: 'local.webp', section: 'local', seed: 'mask' },
  { file: 'color.webp', section: 'color' },
  { file: 'film.webp', section: 'film' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(ROOT);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  const photo = await photoB64();

  try {
  await withEncoder(async ({ writeWebp }) => {
    // Screenshots are captured at 2x and written out at 1600px wide WebP: the PNG a retina
    // capture produces is 3200px and ~250KB each, which is a page nobody on a phone waits for.
    const shot = async (page, file, maxWidth = 1600) => {
      const png = await page.screenshot();
      const r = await writeWebp(path.join(OUT, file), png, { maxWidth });
      console.log(`  wrote site/assets/ui/${file}  ${r.width}x${r.height}`);
    };

    // ── Desktop editor ───────────────────────────────────────────────────────────────────
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });
    await page.addInitScript(SUPPRESS_TOUR);
    await page.goto(`${base}/chromasmith-22.html?deskx=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.fxSection === 'function', null, { timeout: 30000 });
    await loadPhoto(page, photo);

    for (const s of EDITOR_SHOTS) {
      await page.evaluate((sec) => {
        try { fxSection(sec, true); } catch {}
        const p = document.querySelector('.fx-panel'); if (p) { p.scrollTop = 0; }
      }, s.section);
      if (s.seed === 'mask') {
        await page.evaluate(() => { if (typeof mskAdd === 'function') { mskAdd('radial'); mskRebuild?.(); } });
      }
      await page.waitForTimeout(500);
      await shot(page, s.file);
    }
    await page.close();

    // ── Phone shell (≤700px is a different layout entirely — CLAUDE.md §4) ───────────────
    const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await mp.addInitScript(SUPPRESS_TOUR);
    await mp.goto(`${base}/chromasmith-22.html`, { waitUntil: 'load' });
    await mp.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
    await loadPhoto(mp, photo);
    await mp.evaluate(() => { try { fxSection('looks', true); } catch {} });
    await mp.waitForTimeout(600);
    await shot(mp, 'mobile.webp', 900);
    await mp.close();

    // ── Library / DAM ────────────────────────────────────────────────────────────────────
    // The Library lives in desktop/library-ui.js, which the plain single file never loads — it
    // is injected at build time by build-desktop.sh. So this shot is taken against the STAGED
    // desktop build, not chromasmith-22.html, and then driven by the app's own ?libtest=1 mock
    // (CLAUDE.md §10.14). Shooting the bare file instead just photographs an empty editor,
    // which is what the first version of this script did.
    const lp = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    lp.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    await lp.addInitScript(SUPPRESS_TOUR);
    await lp.goto(`${base}/desktop/dist/index.html?libtest=1&libcat=1&libn=240`, { waitUntil: 'load' });
    // ⚠️ Do NOT call chromasmithToggleLibrary() here: under ?libtest=1 the Library overlay is
    // already open on load, so toggling it photographs the empty editor behind it instead.
    await lp.waitForFunction(() => {
      const o = document.getElementById('lib-overlay');
      return o && getComputedStyle(o).display !== 'none';
    }, null, { timeout: 30000 });
    await lp.waitForTimeout(4000);
    await paintThumbs(lp, photo.b64);
    await lp.waitForTimeout(400);
    await shot(lp, 'library.webp');
    await lp.close();
  });
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
