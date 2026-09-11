// T45 (editor_ux_spec.json, 2026-09-11): no forced-colors/prefers-contrast (Windows High Contrast
// Mode) check — a real accessibility mode that can strip author backgrounds/colours entirely,
// distinct from the light/dark theme pair already tested. A custom-painted control with a
// `background` but no real `border` (e.g. .fx-toggle, painted purely via background-color) is the
// classic forced-colors casualty: the browser can strip the background and leave it invisible.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const URL = `http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.emulateMedia({ forcedColors: 'active' });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('adjust', true); });
await page.waitForTimeout(300);

// Check every visible .fx-toggle and .btn for a zero-size or fully-transparent rendered box under
// forced-colors — the shape of "vanished entirely" this mode is documented to cause when a
// control leans on background-color with no border for its visible shape.
const findings = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.fx-toggle, .btn, .fx-chip, .fx-rail-btn').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return; // not rendered (hidden section) — not this check's concern
    const cs = getComputedStyle(el);
    const hasBorder = cs.borderStyle !== 'none' && parseFloat(cs.borderWidth) > 0;
    const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const hasVisibleBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    // Under forced-colors, custom background-color is typically stripped by the browser to
    // Canvas/ButtonFace — a control that visually depends ONLY on that background (no border, no
    // outline, no text/icon content) has nothing left to make it visible or show its boundary.
    const hasContent = el.textContent.trim().length > 0 || el.querySelector('svg, img');
    if (!hasBorder && !hasOutline && !hasContent) {
      out.push({ id: el.id || null, cls: el.className, tag: el.tagName });
    }
  });
  return out;
});

await browser.close();
server.close();

console.log('EDITOR FORCED-COLORS (HIGH CONTRAST MODE) CHECK (T45)');
console.log('='.repeat(78));
if (findings.length) {
  findings.forEach((f) => console.log(`  ${f.tag}${f.id ? '#' + f.id : ''}.${f.cls} — no border/outline/content, relies purely on background colour that forced-colors mode can strip`));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('No interactive control relies purely on background-colour under forced-colors mode.');
  console.log('RESULT: PASS');
}
