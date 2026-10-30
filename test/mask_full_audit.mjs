#!/usr/bin/env node
// Full Masks-panel audit against the desktop editor build (desktop/dist, ?libtest=1 capability mock).
// The control list comes from a LIVE scan of the panel per mask type and state (every collapsed
// group expanded, every popup menu opened), never from a typed list. Each control is then exercised
// on a fresh copy of its state and classified:
//   error   - a page error / console error while acting
//   noop    - nothing changed: mask state, panel DOM, menus, overlay, or the rendered photo
//   nopix   - an adjustment slider changed the mask but not the rendered photo
//   ok
// Usage: node test/mask_full_audit.mjs [--only=radial,linear] [--json=path]
// Rebuild desktop/dist first (node tools/scripts/build-desktop.mjs) so it matches chromasmith-22.html.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const ONLY = arg('only') ? arg('only').split(',') : null;
const JSON_OUT = arg('json') || path.join(ROOT, 'test/output/mask_full_audit.json');
await copyFile(path.join(ROOT, 'coi-serviceworker.min.js'), path.join(ROOT, 'desktop/dist/coi-serviceworker.min.js')).catch(() => {});
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(ROOT, p.slice(1));
    const b = await readFile(f);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(b);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource|ERR_/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} });
await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }); if (typeof applyFxLayout === 'function') applyFxLayout(); });
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
const png = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  await loadFXImages([new File([bin], 'portrait.png', { type: 'image/png' })]);
  await new Promise((r) => { const p = () => (fxImages.length ? r() : setTimeout(p, 30)); p(); });
  document.getElementById('cs-modal-ov')?.remove();
}, png);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// In-page helpers: state setup, control collection, fingerprint, action.
await page.evaluate(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => { if (!el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || p.hidden) return false; } return true; };
  const CS = [{ rgb: [200, 150, 120], h: 0.6, s: 0.05, v: 0.7 }, { rgb: [180, 130, 100], h: 0.62, s: 0.06, v: 0.6 }];
  const paint = (m) => { const d = mskTexDims(); m.mtW = d.w; m.mtH = d.h; m.px = new Uint8ClampedArray(d.w * d.h); for (let y = Math.floor(d.h * .25); y < d.h * .75; y++) for (let x = Math.floor(d.w * .25); x < d.w * .75; x++) m.px[y * d.w + x] = 255; _mskTexDirty = true; };
  const make = (t) => {
    try { mskPaintStop(); } catch (e) {}
    document.querySelectorAll('.msk-more-menu').forEach((e) => e.remove());
    fxState.masks.length = 0; mskSel = -1; if (typeof mskSolo !== 'undefined') mskSolo = null;
    if (t === 'coatEye') { mskAdd('radial'); fxState.masks[0].origin = 'coatEye'; }
    else if (t === 'manual-teeth') { mskAddTeethWhitening(); }
    else if (t === 'brush') { mskAdd('brush'); paint(fxState.masks[0]); }
    else mskAdd(t);
    mskSel = fxState.masks.length - 1;
  };
  window.__AUD_SCEN = {
    radial: () => make('radial'), linear: () => make('linear'), brush: () => make('brush'), sky: () => make('sky'),
    color: () => { make('color'); Object.assign(fxState.masks[0], { crOn: true, crSamples: CS.map((x) => ({ ...x })) }); },
    lum: () => make('lum'), 'manual-teeth': () => make('manual-teeth'), coatEye: () => make('coatEye'),
    skin: () => { make('skin'); Object.assign(fxState.masks[0], { crOn: true, crSamples: CS.map((x) => ({ ...x })) }); },
    coat: () => { make('coat'); Object.assign(fxState.masks[0], { crOn: true, crSamples: CS.map((x) => ({ ...x })) }); },
    ai: () => make('ai'), depth: () => { make('depth'); fxState.masks[0].depOn = true; },
    'radial+exp': () => { make('radial'); Object.assign(fxState.masks[0], { exp: 0.5, temp: 0.3, tex: 30 }); },
    'brush+painting': () => { make('brush'); mskPaintToggle(); },
    group: () => { make('radial'); Object.assign(fxState.masks[0], { exp: 0.5, cx: .3 }); _mskPendingCompose = { op: 'add', operandId: fxState.masks[0].id }; mskAdd('radial'); Object.assign(fxState.masks[1], { cx: .7 }); mskSel = 1; },
    multiple: () => { make('radial'); Object.assign(fxState.masks[0], { exp: 0.4 }); mskAdd('linear'); fxState.masks[1].exp = -0.3; mskAdd('brush'); paint(fxState.masks[2]); fxState.masks[2].sat = 0.5; mskSel = 1; },
    'muted+inverted': () => { make('radial'); fxState.masks[0].exp = 0.5; mskToggleMute(); mskInvert(); },
  };
  window.__audSetup = async (scen) => {
    if (typeof _resetZoom === 'function') _resetZoom();
    try { if (_mskCrEyeActive) mskCrEyedropper(false); if (_mskLumEyeActive) mskLumEyedropper(false); } catch (e) {} // pick modes are global: never leak between runs
    fxSection('local', true); const tg = document.getElementById('tg-local'); if (tg && !tg.classList.contains('on')) toggleFX('local');
    try { localStorage.removeItem('chromasmith_msk_groups2'); } catch (e) {}
    __AUD_SCEN[scen](); mskRebuild(); fxUpdate(); await sleep(80);
    for (let i = 0; i < 12; i++) { const t = [...document.querySelectorAll('#ff-local [aria-expanded="false"]')].filter((b) => vis(b) && !b.hasAttribute('aria-haspopup')); if (!t.length) break; t.forEach((b) => b.click()); await sleep(30); }
    await sleep(60);
  };
  const SEL = 'input,select,button,[role=button],[role=switch],[role=menuitem],canvas#msk-crv';
  const label = (el) => { const row = el.closest('.fx-row'); const lb = row && row.querySelector('.fx-label'); const t = (lb && !lb.contains(el) ? lb.textContent : '') || el.getAttribute('aria-label') || el.textContent || el.title || el.id || el.getAttribute('data-k') || el.tagName; return t.replace(/\s+/g, ' ').trim().slice(0, 60); };
  window.__audCollect = (scope) => {
    const roots = scope === 'menu' ? [...document.querySelectorAll('.msk-more-menu')] : [document.getElementById('ff-local')];
    const out = [];
    roots.forEach((root) => root && root.querySelectorAll(SEL).forEach((el) => {
      if (!vis(el) || el.disabled) return;
      const kind = el.tagName === 'INPUT' ? 'input:' + (el.type || 'text') : el.tagName === 'SELECT' ? 'select' : el.tagName === 'CANVAS' ? 'canvas' : 'button';
      out.push({ kind, label: label(el), key: el.getAttribute('data-k') || el.id || (el.getAttribute('onclick') || '').slice(0, 60), popup: el.hasAttribute('aria-haspopup') || /mskComposeMenu|mskAddMenu|mskMoreMenu|Menu\(event/.test(el.getAttribute('onclick') || ''), inList: !!el.closest('#local-list') });
    }));
    window.__audEls = []; roots.forEach((root) => root && root.querySelectorAll(SEL).forEach((el) => { if (vis(el) && !el.disabled) window.__audEls.push(el); }));
    return out;
  };
  let rnd = null;
  const pixHash = () => {
    try {
      rnd = rnd || new FXR(document.createElement('canvas'));
      const img = curItem().img, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const P = getFXParams(); P.grain = { enabled: false };
      rnd.setImage(img); rnd.render(P, w, h, { glowScale: 1, seed: 1 });
      const { px } = rnd.getPixels(); let a = 0, b = 0; for (let i = 0; i < px.length; i += 7) { a = (a + px[i]) % 65521; b = (b + a) % 65521; } return b * 65536 + a;
    } catch (e) { return 'err:' + e.message; }
  };
  const strip = (k, v) => (v && (v instanceof Uint8ClampedArray || v instanceof Uint8Array || v instanceof Float32Array) ? 'arr' + v.length + ':' + v.reduce((s, x, i) => (s + x * (i % 97 + 1)) % 1e9, 0) : (k.startsWith('_') ? undefined : v));
  window.__audFP = () => ({
    masks: JSON.stringify(fxState.masks, strip) + '|' + mskSel + '|' + (typeof mskSolo !== 'undefined' ? mskSolo : '') + '|' + (typeof mskPaintMode !== 'undefined' ? mskPaintMode + ':' + mskPaintErase : '') + '|' + (typeof mskPreviewMode !== 'undefined' ? mskPreviewMode : '') + '|' + (typeof mskSelViewStyle !== 'undefined' ? mskSelViewStyle + mskSelViewOpacity + mskSelViewOutline : '') + '|' + (typeof mskHideAll !== 'undefined' ? mskHideAll : '') + '|' + (typeof mskAiTapMode !== 'undefined' ? mskAiTapMode : ''),
    dom: (document.getElementById('ff-local') || {}).innerHTML.length + ':' + [...((document.getElementById('ff-local') || {}).innerHTML || '')].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 1e9, 7),
    menus: [...document.querySelectorAll('.msk-more-menu,[role=dialog],[role=menu],.cs-modal,#cs-modal-ov')].filter(vis).map((e) => e.textContent.slice(0, 60)).join('|'),
    overlay: (document.getElementById('fx-mask-overlay') || {}).innerHTML?.length + ':' + document.body.className.length,
    toast: [...document.querySelectorAll('.toast,#toast,[role=status]')].map((e) => e.textContent).join('|').slice(0, 200),
    pix: pixHash(),
  });
  window.__audAct = async (i, kind) => {
    const el = window.__audEls[i]; if (!el || !el.isConnected) return 'gone';
    if (kind === 'input:range') {
      const min = +el.min, max = +el.max, v = +el.value, nv = Math.round(v > (min + max) / 2 ? min + (max - min) * 0.15 : min + (max - min) * 0.85);
      el.value = String(nv); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (kind === 'input:color') { el.value = '#2a66d0'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    else if (kind === 'select') { const o = [...el.options].find((x) => x.value !== el.value); if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); } }
    else if (kind === 'input:text' || kind === 'input:number' || kind === 'input:search') { el.focus(); el.value = kind === 'input:number' ? '42' : 'Audit'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.blur(); }
    else if (kind === 'canvas') {
      const r = el.getBoundingClientRect(), ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + r.width * x, clientY: r.top + r.height * y, pointerId: 1, button: 0, buttons: t === 'pointerup' ? 0 : 1 }));
      ev('pointerdown', .5, .5); ev('pointermove', .5, .3); ev('pointerup', .5, .3);
    } else el.click();
    if (typeof fxUpdate === 'function') fxUpdate();
    await sleep(kind === 'button' ? 350 : 150);
    return 'acted';
  };
});

if (arg('probe')) { // --probe=file.js : run an async page function body after setup, print its result (debugging aid)
  const code = await readFile(arg('probe'), 'utf8');
  errs = [];
  console.log(JSON.stringify(await page.evaluate(new Function('return (async()=>{' + code + '})()')), null, 1), errs);
  await browser.close(); server.close(); process.exit(0);
}
const ADJ_KEYS = new Set(['exp', 'con', 'hi', 'sh', 'wh', 'bl', 'temp', 'tint', 'vibrance', 'sat', 'hue', 'colAmt', 'tex', 'clarity', 'dehaze', 'sharp', 'nr', 'amount']);
const scenarios = await page.evaluate(() => Object.keys(window.__AUD_SCEN));
const report = [];
const diff = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k] && k !== 'toast');
for (const scen of scenarios) {
  if (ONLY && !ONLY.includes(scen)) continue;
  errs = [];
  await page.evaluate((s) => window.__audSetup(s), scen);
  const setupErrs = errs.slice();
  const ctls = await page.evaluate(() => window.__audCollect('panel'));
  if (setupErrs.length) report.push({ scen, label: '(setup)', verdict: 'error', errs: setupErrs });
  console.log(`== ${scen}: ${ctls.length} controls`);
  await writeFile(JSON_OUT, JSON.stringify(report, null, 1));
  for (let i = 0; i < ctls.length; i++) {
    const c = ctls[i];
    const runOne = async (menuPath) => {
      errs = [];
      await page.evaluate((s) => window.__audSetup(s), scen);
      const now = await page.evaluate(() => window.__audCollect('panel'));
      // nth occurrence of the same control: async chips (scene detection) can appear above it and shift indexes
      const same = (x) => x.kind === c.kind && x.label === c.label && x.key === c.key;
      const nth = ctls.slice(0, i).filter(same).length;
      const j = now.map((x, k) => (same(x) ? k : -1)).filter((k) => k >= 0)[nth] ?? -1;
      if (j < 0) return { scen, label: c.label, kind: c.kind, verdict: 'unstable' };
      let before = await page.evaluate(() => window.__audFP());
      if (menuPath != null) {
        await page.evaluate((j) => window.__audAct(j, 'button'), j);
        const items = await page.evaluate(() => window.__audCollect('menu'));
        // by label: earlier actions can enable/disable items (e.g. Paste after Copy), shifting indexes
        const mi = items.findIndex((x) => x.label === menuPath.label);
        if (mi < 0) return { scen, label: c.label + ' > ' + menuPath.label, verdict: 'unstable' };
        before = await page.evaluate(() => window.__audFP());
        errs = [];
        await page.evaluate((k) => window.__audAct(k, 'button'), mi);
      } else await page.evaluate(([j, k]) => window.__audAct(j, k), [j, c.kind]);
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => window.__audFP());
      const changed = diff(before, after);
      const k = (c.key || '').replace(/^msk-/, '');
      let verdict = errs.length ? 'error' : !changed.length && after.toast === before.toast ? 'noop' : 'ok';
      if (verdict === 'ok' && c.kind === 'input:range' && ADJ_KEYS.has(k) && !changed.includes('pix') && menuPath == null && !/muted/.test(scen)) verdict = 'nopix';
      return { scen, label: menuPath ? c.label + ' > ' + menuPath.label : c.label, kind: c.kind, key: c.key, list: c.inList, verdict, changed, toast: after.toast !== before.toast ? after.toast : undefined, errs: errs.slice(0, 3) };
    };
    // The create / compose menus are the same in every state: audit their items once (radial).
    if (c.popup && scen !== 'radial' && /mskComposeMenu|mskAddMenu/.test(c.key)) continue;
    if (c.popup) {
      errs = [];
      await page.evaluate((s) => window.__audSetup(s), scen);
      const now = await page.evaluate(() => window.__audCollect('panel'));
      const j = now.findIndex((x) => x.kind === c.kind && x.label === c.label && x.key === c.key);
      if (j >= 0) await page.evaluate((j) => window.__audAct(j, 'button'), j);
      const items = j >= 0 ? await page.evaluate(() => window.__audCollect('menu')) : [];
      if (!items.length) { report.push({ scen, label: c.label, kind: 'menu', verdict: 'noop-menu', errs: errs.slice(0, 3) }); continue; }
      for (let m = 0; m < items.length; m++) {
        const r = await runOne({ idx: m, label: items[m].label });
        report.push(r); if (r.verdict !== 'ok') console.log('  ', r.verdict, r.label, (r.errs || []).join(' / ').slice(0, 200));
      }
    } else {
      const r = await runOne(null);
      report.push(r); if (r.verdict !== 'ok') console.log('  ', r.verdict, r.label, r.kind, (r.errs || []).join(' / ').slice(0, 200));
    }
  }
}
await writeFile(JSON_OUT, JSON.stringify(report, null, 1));

const bad = report.filter((r) => r.verdict !== 'ok');
console.log(`\n${report.length} actions, ${bad.length} flagged -> ${JSON_OUT}`);
await browser.close(); server.close();
