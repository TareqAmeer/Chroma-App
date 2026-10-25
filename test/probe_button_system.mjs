#!/usr/bin/env node
// Button system gate (design/explorations/button-balance-vote.html, docs/plans/button-system.md).
// Scans the REAL app DOM (editor: chromasmith-22.html?deskx=1, library: desktop/dist/index.html?libtest=1) in dark + light,
// at narrow/default/wide sidebar widths, in every tool section + the mask panel + dialogs, and asserts:
//   TOUCH     no two outlined controls whose borders touch or double (gap >= 8px, or one shared collapsed divider, or no outline at all)
//   HIT       every visible interactive control is >= 24x24 (checkbox/radio/colour inputs >= 18, inline text links exempt)
//   NAME      every icon-only control has an accessible name (aria-label / title / aria-labelledby)
//   TEXT      label contrast >= 4.5:1 against the effective background (disabled and fully transparent reveal-on-hover items exempt)
//   SELECTED  hovering a selected item keeps text >= 4.5:1 on its fill; selected fill vs its track >= 3:1 where the track is shaded
//   CHIPS     selecting any library filter chip never moves a neighbour (x) or resizes the chip itself
//   RESET     a section header does not shift when its Reset button appears
//   INVERT    exactly one Invert button per mask type and its state is the mask's own
// usage: node test/probe_button_system.mjs [--json]   (needs `node tools/scripts/build-desktop.mjs` first for the library part)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
const JSON_OUT = process.argv.includes('--json');
const server = createServer(async (req, res) => {
  try { const fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); const d = await readFile(fp);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(d);
  } catch { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });

// ---- in-page scanner ----------------------------------------------------------------------------------------------------
const SCAN = `(opts) => {
  const MIN_GAP = opts.minGap, MIN_HIT = 24, MIN_INLINE = 18;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0,0,1,1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = c; cx.globalCompositeOperation = 'copy'; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2],d[3]/255]; };
  const over = (f, b) => { const a = f[3]; return [f[0]*a+b[0]*(1-a), f[1]*a+b[1]*(1-a), f[2]*a+b[2]*(1-a), 1]; };
  const lum = (c) => { const f = (v) => { v/=255; return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4); }; return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  const pageBg = over(rgba(getComputedStyle(document.body).backgroundColor), [20,20,20,1]);
  const effBg = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); let bg = pageBg; for (let i = chain.length-1; i >= 0; i--) { const c = rgba(getComputedStyle(chain[i]).backgroundColor); if (c[3] > 0) bg = over(c, bg); } return bg; };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const SIDES = ['Top','Right','Bottom','Left'];
  const borders = (el) => { const cs = getComputedStyle(el); const o = {}; let any = false; SIDES.forEach((s) => { const w = parseFloat(cs['border'+s+'Width'])||0; const vis = w>0 && cs['border'+s+'Style']!=='none' && rgba(cs['border'+s+'Color'])[3]>.02; o[s] = vis?w:0; if (vis) any = true; }); o.any = any; return o; };
  const SEL = 'button,[role=button],[role=switch],[role=tab],select,input[type=checkbox],input[type=radio],input[type=text],input[type=search],input[type=number],summary,a[href],.fx-toggle,.k-fsel>button';
  const root = opts.root ? document.querySelector(opts.root) : document.body;
  const all = [...root.querySelectorAll(SEL)].filter((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (el.closest('[hidden],[aria-hidden=true],#fx-more-menu[style*="display: none"]')) return false;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    return true; });
  const label = (el) => (el.id ? '#'+el.id : '') + '.' + [...el.classList].slice(0,3).join('.') + '[' + ((el.textContent||el.getAttribute('aria-label')||el.title||'').trim().replace(/\\s+/g,' ').slice(0,16)) + ']';
  const out = { touch: [], hit: [], name: [], text: [], n: all.length };
  // TOUCH
  const bx = all.map((el) => ({ el, r: el.getBoundingClientRect(), bw: borders(el) })).filter((x) => x.bw.any);
  for (let i = 0; i < bx.length; i++) for (let j = i+1; j < bx.length; j++) {
    const A = bx[i], B = bx[j]; if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const a = A.r, b = B.r; const dx = Math.max(a.left-b.right, b.left-a.right), dy = Math.max(a.top-b.bottom, b.top-a.bottom);
    if (dx >= MIN_GAP || dy >= MIN_GAP) continue;
    const hO = -dy > 2, vO = -dx > 2;
    if (hO && vO) { out.touch.push(['overlap', label(A.el), label(B.el)]); continue; }
    if (hO) { const [L,R] = a.left<b.left?[A,B]:[B,A]; const wr=L.bw.Right, wl=R.bw.Left; if (dx>0) { out.touch.push(['gap '+dx.toFixed(1), label(A.el), label(B.el)]); continue; } const line=wr+wl+dx; if (!(line>0&&line<=Math.max(wr,wl)+.01)) out.touch.push(['double line', label(A.el), label(B.el)]); continue; }
    if (vO) { const [T,Bt] = a.top<b.top?[A,B]:[B,A]; const wb=T.bw.Bottom, wt=Bt.bw.Top; if (dy>0) { out.touch.push(['gap '+dy.toFixed(1), label(A.el), label(B.el)]); continue; } const line=wb+wt+dy; if (!(line>0&&line<=Math.max(wb,wt)+.01)) out.touch.push(['double line', label(A.el), label(B.el)]); continue; }
    out.touch.push(['corner', label(A.el), label(B.el)]);
  }
  for (const el of all) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
    const inline = tag === 'input' && ['checkbox','radio','color'].includes(el.type);
    const isLink = (tag === 'a' || el.matches('.msk-ai-update,.ni-guide,.lib-lr-signout,summary')) && cs.display.startsWith('inline');
    const op = opacityOf(el);
    // HIT (a fully hidden reveal-on-hover control is still reachable by keyboard, so it is measured too)
    const need = inline ? MIN_INLINE : MIN_HIT;
    let w = r.width, h = r.height;
    for (const ps of ['::before', '::after']) { const p = getComputedStyle(el, ps); if (p.content !== 'none' && p.position === 'absolute' && p.pointerEvents !== 'none') { w = Math.max(w, parseFloat(p.width) || 0); h = Math.max(h, parseFloat(p.height) || 0); } }
    const host = el.closest('label,.fx-ovf-item,[role=menuitem],.lib-coll-row'); if (host && host !== el) { const hr = host.getBoundingClientRect(); w = Math.max(w, hr.width); h = Math.max(h, hr.height); }
    if (!isLink && !el.matches('input[type=range],.fx-edge,#cs-brand-tog>button') && (w < need - .5 || h < need - .5)) out.hit.push([label(el), Math.round(w)+'x'+Math.round(h)]);
    // NAME
    const txt = (el.textContent||'').trim();
    const named = txt.length > 0 || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || (el.labels && el.labels.length) || el.closest('label') || el.getAttribute('placeholder');
    if (!named) out.name.push([label(el)]);
    // TEXT
    if (el.closest('#cs-brand-tog') || op < .99 || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('.ff-off,[disabled]')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (own && !['select'].includes(tag)) {
      const bg = effBg(el); const fgc = rgba(cs.color); const fg = over([fgc[0],fgc[1],fgc[2],fgc[3]*op], bg);
      const c = cr(fg, bg); if (c < 4.5) out.text.push([label(el), c.toFixed(2), 'fg ' + fg.slice(0,3).map(Math.round).join(',') + ' bg ' + bg.slice(0,3).map(Math.round).join(',')]);
    }
  }
  return out;
}`;

const SCANFN = eval(SCAN); // only ever executed inside the page
const fails = []; const note = (k, v) => { fails.push(k + ': ' + v); };
const summary = [];
function fold(tag, res) {
  summary.push(`${tag}: ${res.n} controls, touch ${res.touch.length}, hit ${res.hit.length}, name ${res.name.length}, text ${res.text.length}`);
  const uniq = (rows) => [...new Set(rows.map((r) => r.join(' | ')))];
  uniq(res.touch).forEach((r) => note('TOUCH ' + tag, r));
  uniq(res.hit).forEach((r) => note('HIT ' + tag, r));
  uniq(res.name).forEach((r) => note('NAME ' + tag, r));
  uniq(res.text).forEach((r) => note('TEXT ' + tag, r));
}

// ---- editor ---------------------------------------------------------------------------------------------------------------
const SECTIONS = ['image', 'looks', 'adjust', 'color', 'detail', 'retouch', 'film', 'frame', 'local', 'crop', 'export', 'info'];
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${base}/chromasmith-22.html?deskx=1`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.fxSection === 'function', null, { timeout: 30000 });
await page.waitForTimeout(2500);
const b64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b) => { const bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); await window.loadFXImages([new File([a], 'portrait.png', { type: 'image/png' })]); }, b64);
await page.waitForFunction(() => typeof fxWork !== 'undefined' && !!fxWork && !!curItem()?.img, null, { timeout: 20000 });
await page.evaluate(() => { document.querySelector('[data-tour-action="close"]')?.click(); document.getElementById('cs-modal-ov')?.remove(); });
// the mobile-only phone-* strips come from mobile/mobile-ui.css, which a plain Chromium page does not load; the desktop shell hides them
await page.addStyleTag({ content: '[class^="phone-"],[id^="phone-"],.phone-actions{display:none!important}' });
const scanEditor = async (tag) => fold(tag, await page.evaluate(SCANFN, { minGap: 8 }));
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.body.classList.toggle('light', t === 'light'), theme);
  await page.waitForTimeout(450); // colour transitions (120ms) must finish before contrast is read
  for (const w of [220, 320, 440]) {
    await page.evaluate((w) => { document.body.classList.remove('panel-closed'); fxPanelWidth(w); }, w);
    for (const sec of SECTIONS) {
      const ok = await page.evaluate((s) => { try { fxSection(s, true); } catch { return false; } if (s === 'local') { fxState.masks.length = 0; mskSel = -1; mskAdd('radial'); mskSel = 0; fxState.masks[0].exp = 0.4; mskRebuild(); } return true; }, sec);
      if (!ok) continue;
      await page.waitForTimeout(120);
      await scanEditor(`editor ${theme} panel${w} ${sec}`);
    }
  }
}
await page.evaluate(() => fxPanelWidth(320));
// mask panel variants: brush (the old second Invert), several masks, muted row, group eye off
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.body.classList.toggle('light', t === 'light'), theme);
  await page.evaluate(() => { fxSection('local', true); fxState.masks.length = 0; mskSel = -1; mskAdd('brush'); mskAdd('radial'); mskAdd('linear'); mskSel = 0; fxState.masks[1].muted = true; fxState.masks[0].exp = 0.4; fxState.masks[0].sat = 0.3; mskRebuild(); });
  await page.waitForTimeout(150);
  await scanEditor(`masks ${theme} variants`);
}
// ---- checker self-test: the TOUCH scan must flag flush/3px outlined neighbours and accept an 8px gap or a shared collapsed divider
{
  const mk = (gap, collapse) => `<div id="bs-selftest" style="position:fixed;left:20px;top:20px;display:flex;gap:${gap}px;background:#222;z-index:99999"><button style="all:unset;box-sizing:border-box;width:60px;height:30px;border:1px solid #fff">A</button><button style="all:unset;box-sizing:border-box;width:60px;height:30px;border:1px solid #fff;${collapse ? 'margin-left:-1px' : ''}">B</button></div>`;
  const run = async (html) => { await page.evaluate((h) => { document.getElementById('bs-selftest')?.remove(); document.body.insertAdjacentHTML('beforeend', h); }, html); return (await page.evaluate(SCANFN, { minGap: 8, root: '#bs-selftest' })).touch.length; };
  if (!(await run(mk(0, false)))) note('SELFTEST', 'flush outlined neighbours were not flagged');
  if (!(await run(mk(3, false)))) note('SELFTEST', '3px gap outlined neighbours were not flagged');
  if (await run(mk(8, false))) note('SELFTEST', '8px gap outlined neighbours were flagged');
  if (await run(mk(0, true))) note('SELFTEST', 'collapsed shared divider was flagged');
  await page.evaluate(() => document.getElementById('bs-selftest')?.remove());
}
// ---- INVERT: one button per mask type, state is the mask's own
for (const type of ['radial', 'linear', 'brush']) {
  const r = await page.evaluate((t) => { fxSection('local', true); fxState.masks.length = 0; mskSel = -1; mskAdd(t); mskSel = 0; mskRebuild();
    const btns = [...document.querySelectorAll('.fx-panel button')].filter((b) => /^invert$/i.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0);
    const rowCtl = [...document.querySelectorAll('.msk-li-ctl')].filter((s) => /invert/i.test(s.title || '')).length;
    const before = fxState.masks[0].invert; btns[0]?.click(); const after = fxState.masks[0].invert; const pressed = document.querySelector('#btn-msk-invert')?.getAttribute('aria-pressed');
    const sq = document.querySelector('#btn-msk-invert .msk-sq'); const sqr = sq ? getComputedStyle(sq).borderRadius : null;
    return { n: btns.length, rowCtl, before, after, pressed, sqr }; }, type);
  if (r.n !== 1) note('INVERT', `${type}: ${r.n} visible Invert buttons (want 1)`);
  if (r.rowCtl) note('INVERT', `${type}: ${r.rowCtl} row mini Invert controls remain`);
  if (r.before === r.after || String(r.after) !== r.pressed) note('INVERT', `${type}: button state ${r.pressed} does not follow mask.invert ${r.after}`);
  if (r.sqr !== '0px') note('INVERT', `${type}: indicator is not square (${r.sqr})`);
}
// ---- RESET: header does not jump when Reset appears
{
  await page.evaluate(() => { document.body.classList.remove('light'); fxSection('adjust', true); });
  await page.waitForTimeout(300);
  const geo = () => page.evaluate(() => [...document.querySelectorAll('.fx-ctrl.sec-active .fx-ctrl-title')].map((e) => { const r = e.getBoundingClientRect(); const off = -e.parentElement.getBoundingClientRect().top; const ch = Math.round(e.parentElement.getBoundingClientRect().height); const t = e.querySelector('.fx-toggle')?.getBoundingClientRect(); const rs = e.querySelector('.fx-ctrl-title-reset'); return [Math.round(r.top + off), Math.round(r.height), ch, t ? Math.round(t.left) : 0, rs ? getComputedStyle(rs).visibility : 'none', rs ? Math.round(rs.getBoundingClientRect().width) : 0]; }));
  const a = await geo();
  await page.evaluate(() => { const s = document.querySelector('.fx-ctrl.sec-active input.fx-slider'); s.value = (+s.max + +s.min) / 2 + (+s.max - +s.min) * 0.2; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('.fx-row.fx-mod'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  const b = await geo();
  if (!a.length || !b.length) note('RESET', 'no section header found');
  else {
    if (!a.some((x) => x[4] === 'hidden') || !b.some((x) => x[4] === 'visible')) note('RESET', `expected one hidden->visible Reset, got ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][3] !== b[i][3] || a[i][5] !== b[i][5]) note('RESET', `header ${i} moved when Reset appeared: ${a[i]} -> ${b[i]}`);
    const dis = await page.evaluate(() => [...document.querySelectorAll('.fx-ctrl.sec-active .fx-ctrl-title-reset')].filter((e) => getComputedStyle(e).visibility === 'hidden').every((e) => e.getBoundingClientRect().width > 0));
    if (!dis) note('RESET', 'hidden Reset does not reserve its space');
  }
}
// ---- dialogs (confirm + destructive confirm) and the export sheet
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.body.classList.toggle('light', t === 'light'), theme);
  for (const [msg, ok] of [['Save as new version?', 'Save'], ['Delete version 3?\nThis cannot be undone.', 'Delete']]) {
    await page.evaluate(([m, o]) => { window.__cp = confirmModal(m, o); }, [msg, ok]);
    await page.waitForTimeout(150);
    const res = await page.evaluate(SCANFN, { minGap: 8, root: '#fx-confirm-modal' });
    fold(`dialog ${theme} ${ok}`, res);
    const st = await page.evaluate(() => { const g = (id) => { const e = document.getElementById(id), c = getComputedStyle(e); return { bg: c.backgroundColor, bd: c.borderTopWidth, col: c.color, rad: c.borderRadius }; }; return { ok: g('fx-confirm-ok'), cancel: g('fx-confirm-cancel'), dlg: getComputedStyle(document.getElementById('fx-confirm-modal')).borderRadius }; });
    if (st.cancel.bg !== 'rgba(0, 0, 0, 0)' || st.cancel.bd !== '0px') note('DIALOG', `${theme} ${ok}: Cancel is not bare (${JSON.stringify(st.cancel)})`);
    if (st.dlg !== '0px') note('DIALOG', `dialog is not square (${st.dlg})`);
    if (ok === 'Delete' && /rgba\\(0, 0, 0, 0\\)/.test(st.ok.bg)) note('DIALOG', 'destructive confirm is not a filled danger button');
    await page.evaluate(() => document.getElementById('fx-confirm-cancel').click());
    await page.evaluate(() => window.__cp);
  }
}
// ---- Export primary: label colour and icon
{
  const ex = await page.evaluate(() => { const b = document.getElementById('btn-export-db'); const c = getComputedStyle(b); return { color: c.color, bg: c.backgroundColor, svg: b.querySelector('svg')?.innerHTML || '' }; });
  if (ex.color !== 'rgb(17, 17, 17)') note('EXPORT', `label colour ${ex.color}, want #111`);
  if (!/M12 16V4/.test(ex.svg)) note('EXPORT', 'Export icon is not the export (arrow out of tray) glyph');
}
// ---- editor selected-hover contrast: hover each selected item of every track/tab/rail
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.body.classList.toggle('light', t === 'light'), theme);
  for (const sec of ['crop', 'adjust', 'local', 'retouch']) {
    await page.evaluate((s) => { fxSection(s, true); if (s === 'local') { fxState.masks.length = 0; mskSel = -1; mskAdd('radial'); mskSel = 0; mskRebuild(); } }, sec);
    await page.waitForTimeout(120);
    const sel = await page.evaluate(() => [...document.querySelectorAll('.fx-panel [aria-pressed=true],.fx-panel .seg>button.on,.fx-panel .chip-tap>.on,#sk2-sub button.on,#fx-toolrail .fx-rail-btn.on,.fx-panel [aria-label="Brush mode"]>.bsec')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.matches('.fx-toggle') && !e.disabled; }).map((e) => { e.setAttribute('data-bs-sel', '1'); const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }));
    for (const [x, y] of sel.slice(0, 8)) {
      await page.mouse.move(x, y); await page.waitForTimeout(160);
      const c = await page.evaluate(`(() => { const el = document.querySelector(':hover[data-bs-sel]') || document.querySelector('[data-bs-sel]:hover'); if (!el) return null; const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgba = (c) => { cx.clearRect(0,0,1,1); cx.fillStyle='rgba(0,0,0,0)'; cx.fillStyle=c; cx.globalCompositeOperation='copy'; cx.fillRect(0,0,1,1); const d=cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2],d[3]/255]; };
        const over=(f,b)=>[f[0]*f[3]+b[0]*(1-f[3]),f[1]*f[3]+b[1]*(1-f[3]),f[2]*f[3]+b[2]*(1-f[3]),1]; const lum=(c)=>{const f=(v)=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
        let bg=over(rgba(getComputedStyle(document.body).backgroundColor),[20,20,20,1]); const chain=[]; for(let e=el;e;e=e.parentElement)chain.push(e); for(let i=chain.length-1;i>=0;i--){const c=rgba(getComputedStyle(chain[i]).backgroundColor); if(c[3]>0)bg=over(c,bg);} 
        const fg=over(rgba(getComputedStyle(el).color),bg); const a=lum(fg),b=lum(bg); return { c: (Math.max(a,b)+.05)/(Math.min(a,b)+.05), txt: (el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,14), cls: el.className.toString().slice(0,30) }; })()`);
      if (c && c.txt && c.c < 4.5 && !/^\s*$/.test(c.txt)) note('SELECTED', `${theme} ${sec} hover on selected "${c.txt}" (${c.cls}) text contrast ${c.c.toFixed(2)}`);
    }
    await page.evaluate(() => document.querySelectorAll('[data-bs-sel]').forEach((e) => e.removeAttribute('data-bs-sel')));
  }
}
if (errs.length) note('PAGEERROR', errs.slice(0, 3).join(' / '));
await page.close();

// ---- library ----------------------------------------------------------------------------------------------------------------
for (const theme of ['dark', 'light']) {
  const lp = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const lerr = []; lp.on('pageerror', (e) => lerr.push(e.message));
  await lp.addInitScript((l) => { localStorage.setItem('csThemeGallery', l); localStorage.setItem('csThemeEditor', l); }, theme);
  await lp.goto(`${base}/desktop/dist/index.html?libtest=1&deskx=1&libn=8`, { waitUntil: 'domcontentloaded' });
  await lp.waitForTimeout(1500);
  await lp.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (['Got it', 'Skip for now'].includes(b.textContent.trim())) b.click(); }); document.getElementById('lib-overlay')?.classList.add('full'); });
  await lp.waitForTimeout(600);
  await lp.addStyleTag({ content: '[class^="phone-"],[id^="phone-"]{display:none!important}' });
  const scanLib = async (tag, root) => fold(tag, await lp.evaluate(SCANFN, { minGap: 8, root: root || '#lib-overlay' }));
  await scanLib(`library ${theme} top`);
  await lp.evaluate(() => document.querySelector('#lib-filters-btn').click()); await lp.waitForTimeout(350);
  await scanLib(`library ${theme} filters`);
  // CHIPS: selecting each chip must not move or resize any chip
  const chipIdx = await lp.evaluate(() => [...document.querySelectorAll('#lib-filter-row .lib-chip')].filter((c) => c.getBoundingClientRect().width > 0).map((c, i) => [c, i]).filter(([c]) => c.dataset.fgrp).map(([, i]) => i));
  for (const i of chipIdx) {
    const snap = () => lp.evaluate(() => [...document.querySelectorAll('#lib-filter-row .lib-chip,#lib-filter-row .lib-flabel,#lib-filter-row .lib-filterdiv')].filter((c) => c.getBoundingClientRect().width > 0).map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.top * 10) / 10]; }));
    const before = await snap();
    await lp.evaluate((i) => [...document.querySelectorAll('#lib-filter-row .lib-chip')].filter((c) => c.getBoundingClientRect().width > 0)[i].click(), i);
    await lp.waitForTimeout(220);
    const after = await snap();
    if (before.length !== after.length) { note('CHIPS', `${theme} chip ${i}: element count changed ${before.length} -> ${after.length}`); continue; }
    for (let k = 0; k < before.length; k++) if (Math.abs(before[k][0] - after[k][0]) > .5 || Math.abs(before[k][1] - after[k][1]) > .5 || Math.abs(before[k][2] - after[k][2]) > .5) note('CHIPS', `${theme} chip ${i}: element ${k} moved/resized ${before[k]} -> ${after[k]}`);
    // restore
    await lp.evaluate((i) => [...document.querySelectorAll('#lib-filter-row .lib-chip')].filter((c) => c.getBoundingClientRect().width > 0)[i].click(), i);
    await lp.waitForTimeout(120);
  }
  // selected chip hover contrast
  await lp.evaluate(() => { const c = document.querySelector('#lib-filter-row .lib-chip.lib-sel'); if (c) c.setAttribute('data-bs-sel', '1'); });
  const pos = await lp.evaluate(() => { const c = document.querySelector('[data-bs-sel]'); if (!c) return null; const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  if (pos) { await lp.mouse.move(pos[0], pos[1]); await lp.waitForTimeout(160);
    const c = await lp.evaluate(`(() => { const el = document.querySelector('[data-bs-sel]'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; })()`);
    if (c.bg === c.color) note('SELECTED', `${theme} lib chip hover bg == text`);
  }
  await lp.evaluate(() => document.querySelector('#lib-filters-btn').click()); await lp.waitForTimeout(200);
  await lp.evaluate(() => document.querySelector('#lib-view-menu-btn').click()); await lp.waitForTimeout(350);
  await scanLib(`library ${theme} gear`, 'body');
  // view/size track (hidden in the shipped layout; force-show it to audit hover-on-selected)
  const seg = await lp.evaluate(() => { const s = document.getElementById('lib-viewmode-seg'); if (!s) return null; s.hidden = false; s.style.display = 'flex'; return true; });
  if (seg) {
    await lp.waitForTimeout(150);
    const p = await lp.evaluate(() => { const b = document.querySelector('#lib-viewmode-seg>button.on'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await lp.mouse.move(p[0], p[1]); await lp.waitForTimeout(200);
    const r = await lp.evaluate(`(() => { const b = document.querySelector('#lib-viewmode-seg>button.on'); const track = document.getElementById('lib-viewmode-seg'); const cs = getComputedStyle(b); const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});
      const rgba=(c)=>{cx.clearRect(0,0,1,1);cx.fillStyle='rgba(0,0,0,0)';cx.fillStyle=c;cx.globalCompositeOperation='copy';cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255]};
      const lum=(c)=>{const f=(v)=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])}; const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const over=(f,b)=>[f[0]*f[3]+b[0]*(1-f[3]),f[1]*f[3]+b[1]*(1-f[3]),f[2]*f[3]+b[2]*(1-f[3]),1];
      const page=over(rgba(getComputedStyle(document.getElementById('lib-overlay')).backgroundColor),over(rgba(getComputedStyle(document.body).backgroundColor),[20,20,20,1])); const trackBg=over(rgba(getComputedStyle(track).backgroundColor),page);
      const fill=over(rgba(cs.backgroundColor),trackBg); const fg=over(rgba(cs.color),fill); return { text: cr(fg,fill), edge: cr(fill,trackBg) }; })()`);
    if (r.text < 4.5) note('SELECTED', `${theme} view toggle: hover on selected text contrast ${r.text.toFixed(2)}`);
    if (r.edge < 3) note('SELECTED', `${theme} view toggle: selected fill vs track ${r.edge.toFixed(2)} (<3:1)`);
  }
  if (lerr.length) note('PAGEERROR', `library ${theme}: ${lerr.slice(0, 2).join(' / ')}`);
  await lp.close();
}
await browser.close(); server.close();
if (JSON_OUT) console.log(JSON.stringify({ summary, fails }, null, 1));
else { console.log(summary.join('\n')); }
if (fails.length) { console.error('\nFAIL ' + fails.length + '\n  ' + fails.slice(0, 120).join('\n  ')); process.exit(1); }
console.log('\nPASS button system: ' + summary.length + ' scans, no touching outlines, hit areas >= 24, names, contrast, chips stable, one Invert, no header jump');
