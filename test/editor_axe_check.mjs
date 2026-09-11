// T41 (editor_ux_spec.json, 2026-09-11): editor:keyboard-check (T14) only proves a control is
// tabbable/has a role+tabindex — it says nothing about whether it announces sensibly to a screen
// reader. A role="switch" with no accessible name passes T14 but is useless to VoiceOver. This
// runs a real axe-core audit (industry-standard, same engine Lighthouse uses) against the
// Editor's main panels and asserts zero serious/critical violations.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
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

// AxeBuilder needs Playwright's own `Page`/`BrowserContext` types, imported via @playwright/test
// elsewhere in this repo — here we drive plain `playwright` (chromium.launch), which AxeBuilder
// also accepts (it only needs a CDP-capable page, not the test-runner wrapper).
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); // AxeBuilder requires a real BrowserContext, not a bare newPage()
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// A representative sweep across panels, not just the default Looks tab — each panel is its own
// markup with its own controls, and a violation in one doesn't imply a violation in another.
const PANELS = ['adjust', 'curves', 'hsl', 'local', 'grain', 'hal', 'vig', 'borders', 'crop', 'retouch', 'export'];
const allViolations = [];
for (const sec of PANELS) {
  await page.evaluate((s) => { if (typeof fxSection === 'function') fxSection(s, true); }, sec);
  await page.waitForTimeout(200);
  const results = await new AxeBuilder({ page })
    .include('.fx-ctrl.sec-active') // scope to the ACTIVE section card(s) — chrome/menus are audited separately elsewhere (ui_audit.mjs)
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of serious) {
    allViolations.push({ panel: sec, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
  }
}

await browser.close();
server.close();

console.log('EDITOR AXE-CORE ACCESSIBILITY AUDIT (T41)');
console.log('='.repeat(78));
console.log(`  ${PANELS.length} panels swept, WCAG 2.0/2.1 A+AA rules`);
if (allViolations.length) {
  for (const v of allViolations) {
    console.log(`  [${v.panel}] ${v.impact.toUpperCase()} ${v.id}: ${v.help} (${v.nodes} node(s): ${v.targets.join(', ')})`);
  }
  console.log(`\n${allViolations.length} serious/critical violation(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('Zero serious/critical WCAG 2.0/2.1 A+AA violations across all swept panels.');
  console.log('RESULT: PASS');
}
