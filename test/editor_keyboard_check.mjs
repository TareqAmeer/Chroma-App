// T14 (editor_ux_spec.json, 2026-09-10): no Editor gate asserted anything about KEYBOARD
// accessibility — tab order, or that a clickable control is a real <button>/<a>/<input> (reachable
// and operable via Tab+Enter/Space) rather than a styled `<div onclick>` (invisible to keyboard
// users entirely). ui_audit.mjs already checks pointer-target size and colour contrast; this is
// the operability half it explicitly does not cover.
//
// Two checks, both scoped to .fx-ctrl[data-fxsec] cards (the same universe editor_snap_lists_check
// and editor_html_validity_check already treat as "real Editor UI", not chrome/menus):
//   1. Every element carrying an onclick attribute (the app's dominant interaction pattern — see
//      CLAUDE.md §3b's icon/button conventions) is EITHER a real interactive tag (BUTTON, A,
//      SELECT, INPUT, TEXTAREA) OR a non-native element the app has explicitly made operable —
//      `role="button"/"switch"` plus a non-negative `tabindex` (chromasmith-22.html's
//      a11yEnhanceToggles() does exactly this for every `.fx-toggle`/`.fx-toggle-lb`). A bare
//      DIV/SPAN with onclick and neither is a keyboard dead end.
//   2. No interactive element in that scope carries `tabindex="-1"` — that explicitly REMOVES it
//      from the Tab order, and nothing in this app's design calls for a permanently
//      keyboard-unreachable control (a temporarily-hidden one is handled by `hidden`/display:none
//      dropping it from the accessibility tree entirely, not by tabindex).
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
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'SELECT', 'INPUT', 'TEXTAREA']);
const result = await page.evaluate((interactiveTags) => {
  const scope = document.querySelectorAll('.fx-ctrl[data-fxsec] *');
  const nonInteractiveOnclick = [];
  const negativeTabindex = [];
  for (const el of scope) {
    if (el.hasAttribute('onclick')) {
      const nativelyInteractive = interactiveTags.includes(el.tagName);
      const role = el.getAttribute('role');
      const tabindex = el.getAttribute('tabindex');
      const madeOperable = (role === 'button' || role === 'switch') && tabindex !== null && tabindex !== '-1';
      if (!nativelyInteractive && !madeOperable) {
        nonInteractiveOnclick.push({ tag: el.tagName, id: el.id || null, cls: el.className || null, onclick: el.getAttribute('onclick').slice(0, 60) });
      }
    }
    if (el.getAttribute('tabindex') === '-1' && (interactiveTags.includes(el.tagName) || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'switch')) {
      negativeTabindex.push({ tag: el.tagName, id: el.id || null });
    }
  }
  return { nonInteractiveOnclick, negativeTabindex };
}, [...INTERACTIVE_TAGS]);
await browser.close();
server.close();

console.log('EDITOR KEYBOARD-OPERABILITY CHECK (.fx-ctrl[data-fxsec] scope)');
console.log('='.repeat(78));
const findings = [];
for (const f of result.nonInteractiveOnclick) {
  findings.push(`non-interactive <${f.tag}> has onclick="${f.onclick}..." — not reachable/operable by keyboard (id=${f.id}, class=${f.cls})`);
}
for (const f of result.negativeTabindex) {
  findings.push(`<${f.tag}> id=${f.id} has tabindex="-1" — explicitly removed from Tab order`);
}
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('Every onclick-bearing element in Editor sections is a real interactive tag; nothing is tabindex-excluded.');
  console.log('RESULT: PASS');
}
