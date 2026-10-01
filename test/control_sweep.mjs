// control:sweep — docs/test-everything-plan.md Layer 2. Presses every control the running app
// shows, instead of a hand-typed list of controls someone remembered to test.
//
// For each surface (Library, Editor-with-photo) it boots ?libtest=1 (the browser stand-in for
// the native engine), enumerates every visible interactive element, and crawls: activate a
// control, record what changed, queue any NEW controls it revealed (a panel, menu, dialog) with
// the path of clicks that reaches them, up to --depth levels. A control is found again by a
// stable key (id / aria-label / title / text / data-* + occurrence), and if it is not in the
// current DOM the page is reset and its path replayed — so one control's side effects can't hide
// the next one.
//
// Per control it records:
//   error     page error or console.error raised while it ran            -> FAIL
//   changed   DOM, form values, URL or app canvas changed                -> ok
//   inert     nothing observable changed                                 -> reported (ratchet)
//   selected  already-selected chip/tab re-pressed, no change (correct) -> ok
//   unreach   path replay could not find it again (conditional control)  -> reported
//
// Output: test/output/control_sweep.json + a summary table. Exit 1 on any `error`, or on an
// `inert` control not in test/control_sweep_accepted.json (--update rewrites that list).
//
//   node test/control_sweep.mjs [--surface=editor|library] [--depth=2] [--limit=N] [--update]
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startServer } from './editor_state_harness.mjs';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const DEPTH = +arg('depth', 2), LIMIT = +arg('limit', 1e9), ONLY = arg('surface', null);
const ACCEPTED = 'test/control_sweep_accepted.json';
// Controls that leave the app or destroy the test session rather than exercising a feature.
const SKIP = /^(quit|sign out|log out)$/i;

const SURFACES = {
  library: { query: 'libtest=1&libn=18&deskx=1', photo: false },
  editor: { query: 'libtest=1&deskx=1', photo: true },
};

// Runs in the page: list visible, enabled interactive elements with stable keys.
function enumerate() {
  const sel = 'button,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=option],input:not([type=hidden]),select,textarea,a[href],[onclick],[tabindex="0"]';
  const seen = new Map(), out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.disabled || el.closest('[inert],[aria-hidden=true]')) continue;
    // Closed <details> content still has layout boxes in Chromium but is never painted or
    // focusable (the Export sheet's "More" cards were reported inert for this reason).
    if (el.closest('details:not([open])') && !el.closest('summary')) continue;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; // covered
    const data = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-sweep')).map((a) => `${a.name}=${a.value}`).slice(0, 3).join(',');
    const label = (el.id ? '#' + el.id : '') || el.getAttribute('aria-label') || el.title || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.getAttribute('name') || el.getAttribute('placeholder') || '';
    const base = `${el.tagName.toLowerCase()}${el.type ? ':' + el.type : ''}|${label}|${data}`;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const family = `${el.tagName}|${el.type || ''}|${el.className}|${[...el.attributes].map((a) => a.name).filter((a) => a.startsWith('data-')).sort().join(',')}`;
    const selected = el.classList.contains('on') || el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
    out.push({ family, selected, key: `${base}|${n}`, kind: el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? (el.type || el.tagName.toLowerCase()) : 'click', label, x: cx, y: cy });
  }
  return out;
}

// Runs in the page: a cheap fingerprint of everything a control could observably change.
function fingerprint() {
  let h = 0; const s = document.body.innerHTML + '|' + location.href + '|' +
    [...document.querySelectorAll('input,select,textarea')].map((e) => e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value).join(',');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  let c = '';
  try {
    const cv = [...document.querySelectorAll('canvas')].filter((x) => x.width > 50 && x.offsetParent).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (cv) { const t = document.createElement('canvas'); t.width = t.height = 8; const g = t.getContext('2d'); g.drawImage(cv, 0, 0, 8, 8); c = [...g.getImageData(0, 0, 8, 8).data].join(''); }
  } catch (_) {}
  return h + ':' + c.length + ':' + c.slice(0, 256);
}

async function boot(page, port, s) {
  for (let i = 0; ; i++) {
    try { await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?${s.query}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); break; }
    catch (e) { if (i >= 2) throw e; await page.waitForTimeout(1000); }
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }); });
  await page.keyboard.press('Escape');
  if (s.photo) {
    const b64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
    await page.evaluate(async (b) => {
      const f = new File([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], 'portrait.png', { type: 'image/png' });
      if (typeof window.loadFXImages === 'function') await window.loadFXImages([f]);
    }, b64);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

async function act(page, c) {
  if (c.kind === 'range') {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('input') || document.elementFromPoint(x, y);
      const lo = +el.min || 0, hi = el.max === '' ? 100 : +el.max, v = +el.value;
      el.value = String(Math.abs(v - hi) < Math.abs(v - lo) ? lo + (hi - lo) * 0.25 : lo + (hi - lo) * 0.75);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }, c);
  } else if (/^(text|search|number|email|url|textarea|password)$/.test(c.kind)) {
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type(c.kind === 'number' ? '7' : 'sweep');
    await page.keyboard.press('Enter');
  } else if (c.kind === 'select-one' || c.kind === 'select') {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('select'); if (!el) return;
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', { bubbles: true }));
    }, c);
  } else if (/resizer|splitter|divider/i.test(c.label)) {
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x - 40, c.y - 40, { steps: 5 }); await page.mouse.up();
  } else if (c.kind === 'file') {
    return; // file pickers are native dialogs; imports are covered by the flow layer
  } else {
    await page.mouse.click(c.x, c.y);
  }
}

const accepted = new Set(existsSync(ACCEPTED) ? JSON.parse(readFileSync(ACCEPTED, 'utf8')).inert : []);
const { server, port } = await startServer();
const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const report = {};

for (const [name, s] of Object.entries(SURFACES)) {
  if (ONLY && ONLY !== name) continue;
  const ctx = await browser.newContext({ ...DETERMINISTIC_CONTEXT_OPTIONS, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch (_) {} });
  const page = await ctx.newPage();
  page.on('filechooser', () => {}); page.on('dialog', (d) => d.dismiss().catch(() => {}));
  ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
  let errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await boot(page, port, s); errs = [];
  let atBaseline = true;
  // Repeated items (grid tiles, list rows, swatches) are one control family: test 3 of each, not 5,000.
  const famCount = new Map(), FAMILY_CAP = 3;
  const results = new Map(), queue = (await page.evaluate(enumerate)).map((c) => ({ ...c, path: [] }));
  const known = new Set(queue.map((c) => c.key));
  const t0 = Date.now();

  const find = async (key) => (await page.evaluate(enumerate)).find((c) => c.key === key);
  const reach = async (c) => {
    let cur = await find(c.key);
    if (cur) return cur; // still visible and uncovered: reuse the page instead of a 2-10s reboot
    await boot(page, port, s); atBaseline = true;
    for (const step of c.path) {
      const sc = await find(step); if (!sc) return null;
      await act(page, sc); await page.waitForTimeout(250); atBaseline = false;
    }
    return find(c.key);
  };

  while (queue.length && results.size < LIMIT) {
    const c = queue.shift();
    if (results.has(c.key) || SKIP.test(c.label)) continue;
    const fk = c.family + '@' + c.path.length, fc = (famCount.get(fk) || 0) + 1;
    famCount.set(fk, fc); if (fc > FAMILY_CAP) continue;
    const cur = await reach(c);
    if (!cur) { results.set(c.key, { status: 'unreach', label: c.label, path: c.path }); continue; }
    errs = [];
    const before = await page.evaluate(fingerprint);
    try { await act(page, cur); } catch (e) { errs.push('act: ' + e.message.split('\n')[0]); }
    // Poll rather than one fixed wait: thumbnails, the add-photo picker and zoom settle async
    // (300ms marked them inert falsely; triage showed them changing by ~1s).
    let after = before;
    for (let t = 0; t < 1500 && after === before; t += 150) {
      await page.waitForTimeout(150);
      try { after = await page.evaluate(fingerprint); } catch (e) { errs.push('navigated: ' + e.message.split('\n')[0]); break; }
    }
    // Re-pressing the already-selected chip/tab is a correct no-op, not an inert control.
    const status = errs.length ? 'error' : after !== before ? 'changed' : cur.selected ? 'selected' : 'inert';
    results.set(c.key, { status, label: c.label, kind: c.kind, path: c.path, errors: errs.slice(0, 3) });
    if (status === 'changed') {
      atBaseline = false;
      if (c.path.length < DEPTH) {
        for (const n of await page.evaluate(enumerate).catch(() => [])) {
          if (!known.has(n.key)) { known.add(n.key); queue.push({ ...n, path: [...c.path, c.key] }); }
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    if (results.size % 25 === 0) console.log(`  ${name}: ${results.size} done, ${queue.length} queued, ${((Date.now() - t0) / 1000) | 0}s`);
  }
  report[name] = Object.fromEntries(results);
  await ctx.close();
}
await browser.close(); server.close();

await mkdir('test/output', { recursive: true });
await writeFile('test/output/control_sweep.json', JSON.stringify(report, null, 2));

const inertKeys = [];
let fail = false;
console.log('\nsurface    found  changed  inert  unreach  error');
for (const [name, r] of Object.entries(report)) {
  const v = Object.values(r), n = (st) => v.filter((x) => x.status === st).length;
  console.log(`${name.padEnd(9)} ${String(v.length).padStart(6)} ${String(n('changed')).padStart(8)} ${String(n('inert')).padStart(6)} ${String(n('unreach')).padStart(8)} ${String(n('error')).padStart(6)}`);
  for (const [k, x] of Object.entries(r)) {
    if (x.status === 'error') { fail = true; console.log(`  ERROR ${name} ${k}\n    ${x.errors.join('\n    ')}`); }
    if (x.status === 'inert') inertKeys.push(`${name}::${k}`);
  }
}
if (process.argv.includes('--update')) {
  await writeFile(ACCEPTED, JSON.stringify({ note: 'Controls the sweep pressed with no observable effect. Each is a bug or needs a reason; the list may only shrink.', inert: inertKeys.sort() }, null, 2) + '\n');
  console.log(`wrote ${ACCEPTED} (${inertKeys.length} inert)`);
} else {
  const fresh = inertKeys.filter((k) => !accepted.has(k));
  if (fresh.length) { fail = true; console.log(`  ${fresh.length} inert control(s) not in ${ACCEPTED}:`); fresh.slice(0, 40).forEach((k) => console.log('    ' + k)); }
}
console.log(fail ? 'control:sweep — FAIL' : 'control:sweep — PASS');
process.exit(fail ? 1 : 0);
