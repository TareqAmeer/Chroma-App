// test/panel_pair_shots.mjs --panel <id>
// Writes wireframe-vs-app side-by-side screenshots for one Editor panel, in both themes, for
// every state the WIREFRAME itself actually defines — not a hand-typed list (CLAUDE.md rule 8:
// completeness comes from the running/authored artifact, not a guess). "State" here means a real
// CSS pseudo-class (:hover/:focus/:active/:disabled) the wireframe's own stylesheet declares for
// a selector that matches something inside this panel AND that this panel's CONTROL_PAIRS entry
// set already maps to a real app selector — without that mapping there is no way to apply the
// same state to the app side, so it's skipped (noted in the manifest) rather than guessed at.
// A panel with no such CSS-defined, mappable state (most of them — plain static markup) gets only
// 'rest', per the docs/ui-workflow/STATE.md instruction: "a static wireframe may only have rest".
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';
import { CONTROL_PAIRS } from './generated_pairs.mjs';

const argv = process.argv.slice(2);
const panelFlagIdx = argv.indexOf('--panel');
const PANEL_ID = panelFlagIdx >= 0 ? argv[panelFlagIdx + 1] : null;
if (!PANEL_ID) { console.error('usage: node test/panel_pair_shots.mjs --panel <id>'); process.exit(1); }

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'design', 'asbuilt', '_panel_pairs', PANEL_ID);
await mkdir(OUT_DIR, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const VIEWPORT = { width: 1440, height: 900 };
const PANEL_ROOT_SEL = `.tp-panel[data-panel="${PANEL_ID}"]`;
const pairs = CONTROL_PAIRS.filter((p) => p.panel === PANEL_ID);

// ── Discover states the wireframe's OWN stylesheet actually defines for this panel ──────────
// Real pseudo-class rules only (:hover/:focus/:active/:disabled), matched against elements that
// actually exist inside this panel right now, and only kept if a CONTROL_PAIRS entry already
// gives us the corresponding app selector to apply the same state to on the app side.
const PSEUDOS = ['hover', 'focus', 'active', 'disabled'];
async function discoverStates(page) {
  return page.evaluate(({ panelRootSel, pseudos }) => {
    const root = document.querySelector(panelRootSel);
    if (!root) return [];
    const found = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        for (const pseudo of pseudos) {
          const marker = `:${pseudo}`;
          if (!rule.selectorText.includes(marker)) continue;
          // Only handle the simple, common case: one compound selector ending in the pseudo
          // (e.g. ".rst:hover", "button:disabled") — not full combinators/lists, which this
          // panel's own CSS doesn't use for state rules (verified against the file this reads).
          for (const part of rule.selectorText.split(',').map((s) => s.trim())) {
            if (!part.endsWith(marker)) continue;
            const base = part.slice(0, -marker.length);
            let matches;
            try { matches = [...root.querySelectorAll(base)]; } catch { continue; }
            if (matches.length) found.push({ pseudo, base });
          }
        }
      }
    }
    return found;
  }, { panelRootSel: PANEL_ROOT_SEL, pseudos: PSEUDOS });
}

async function applyState(page, sel, pseudo) {
  const el = page.locator(sel).first();
  if (pseudo === 'hover') await el.hover().catch(() => {});
  else if (pseudo === 'focus') await el.evaluate((n) => n.focus && n.focus()).catch(() => {});
  else if (pseudo === 'active') { await el.hover().catch(() => {}); await page.mouse.down().catch(() => {}); }
  else if (pseudo === 'disabled') await el.evaluate((n) => { n.disabled = true; }).catch(() => {});
}
async function clearState(page, pseudo) {
  if (pseudo === 'active') await page.mouse.up().catch(() => {});
}

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });

// Discover states once, off a plain dark-theme wireframe load.
const probe = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
await probe.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Editor%20(Developer)%20View.dc.html`, { waitUntil: 'load' });
const discovered = await discoverStates(probe);
await probe.close();

// Only keep a discovered state if some CONTROL_PAIRS entry's wf selector is exactly (or a
// descendant match of) the discovered base selector, scoped to this panel — that's what gives us
// a real app-side selector to apply the same state to. Otherwise there is no honest way to show
// the app side in that state, so it's dropped rather than shown wrong.
const mappable = [];
for (const d of discovered) {
  const pair = pairs.find((p) => p.wf.endsWith(d.base) || p.wf === `${PANEL_ROOT_SEL} ${d.base}`);
  if (pair) mappable.push({ ...d, wfSel: pair.wf, appSel: pair.app });
}
const states = [{ name: 'rest', wfSel: null, appSel: null, pseudo: null }, ...mappable.map((m) => ({ name: m.pseudo, wfSel: m.wfSel, appSel: m.appSel, pseudo: m.pseudo }))];

const manifest = { panel: PANEL_ID, generatedAt: new Date().toISOString(), states: [], skippedDiscovered: discovered.filter((d) => !mappable.some((m) => m.base === d.base)) };

for (const theme of ['dark', 'light']) {
  const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Editor%20(Developer)%20View.dc.html`, { waitUntil: 'load' });
  if (theme === 'light') await wf.evaluate(() => document.getElementById('app')?.classList.add('light'));
  // .tp-panel is display:none until .active — the tab switcher never gets driven here, so set it directly.
  await wf.evaluate((sel) => document.querySelector(sel)?.classList.add('active'), PANEL_ROOT_SEL);
  await settleForCapture(wf);

  const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await app.waitForTimeout(1500);
  await app.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    if (typeof applyFxLayout === 'function') applyFxLayout();
    if (typeof switchTab === 'function') switchTab('fx');
  });
  await app.keyboard.press('Escape');
  if (theme === 'light') await app.evaluate(() => { if (typeof toggleTheme === 'function' && !document.body.classList.contains('light')) toggleTheme(); });
  // Load a photo (several fxsec panels stay disabled/empty without one) and open this section —
  // same pattern surface_capture.mjs uses.
  const buf = await readFile(path.join(ROOT, 'test/fixtures/portrait.png'));
  const b64 = buf.toString('base64');
  await app.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'portrait.png', { type: 'image/png' });
    if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
  }, b64);
  await app.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
  await app.evaluate((id) => { if (typeof fxSection === 'function') fxSection(id === 'masks' ? 'local' : id); }, PANEL_ID);
  await app.waitForTimeout(200);
  await settleForCapture(app);

  const wfPanelEl = wf.locator(PANEL_ROOT_SEL).first();
  const appPanelEl = app.locator(`.fx-ctrl[data-fxsec="${PANEL_ID}"], [data-fxsec="${PANEL_ID}"]`).first();

  for (const state of states) {
    if (state.pseudo) await applyState(wf, state.wfSel, state.pseudo);
    if (state.pseudo && state.appSel) await applyState(app, state.appSel, state.pseudo);

    const wfPath = path.join(OUT_DIR, `wireframe_${theme}_${state.name}.webp`);
    const appPath = path.join(OUT_DIR, `app_${theme}_${state.name}.webp`);
    let wfOk = true, appOk = true;
    await wfPanelEl.screenshot({ path: wfPath, type: 'webp', quality: 88 }).catch(() => { wfOk = false; });
    await appPanelEl.screenshot({ path: appPath, type: 'webp', quality: 88 }).catch(() => { appOk = false; });

    if (state.pseudo) await clearState(wf, state.pseudo);
    if (state.pseudo && state.appSel) await clearState(app, state.pseudo);

    manifest.states.push({
      theme, state: state.name,
      wireframe: wfOk ? path.relative(ROOT, wfPath) : null,
      app: appOk ? path.relative(ROOT, appPath) : null,
      appSelectorUsed: state.appSel || null,
    });
  }
  await wf.close();
  await app.close();
}
await b.close();
server.close();

await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`panel_pair_shots: ${PANEL_ID} — ${states.length} state(s) [${states.map((s) => s.name).join(', ')}], ${manifest.states.length} image pairs written to ${path.relative(ROOT, OUT_DIR)}`);
if (manifest.skippedDiscovered.length) {
  console.log(`  (${manifest.skippedDiscovered.length} CSS-defined state(s) found but not shown — no CONTROL_PAIRS mapping to an app selector: ${manifest.skippedDiscovered.map((d) => `${d.base}:${d.pseudo}`).join(', ')})`);
}
