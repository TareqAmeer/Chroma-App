// real:sweep — docs/test-everything-plan.md Layer 6 (CHR-231). The control sweep, run inside the
// REAL desktop app (WKWebView + the Rust engine) instead of Chromium + the libtest stand-in.
//
// Transport: the app's own automation channel (chromasmith-22.html, chromasmith_automation_*.json
// in $TMPDIR, polled every 100ms when the enable file holds a token). No mouse or keyboard
// control: clicks are dispatched to the element, so the user's screen is never driven.
//
// Isolation — the sweep presses everything, so it must never touch the user's real library:
//   * CS_CATALOG_DIR / CS_CACHE_DIR point the catalog and thumbnail cache at a temp dir
//   * the only library root is a temp copy of test/fixtures (flags/edits/merges land there)
//   * localStorage (prefs, last folder, views) is backed up to test/output/ before the run and
//     restored after it, even on failure
//   * controls that leave the sandbox (export to disk, reveal/open externally, sign-in, quit,
//     updates) are skipped by label
//
//   node test/real_app_sweep.mjs [--surface=library|editor] [--depth=1] [--limit=N] [--no-launch]
// Prereq: a current build (bash desktop/install-app.sh). Output: test/output/real_app_sweep.json
import { writeFileSync, readFileSync, renameSync, existsSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { enumerate, fingerprint } from './sweep_lib.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const DEPTH = +arg('depth', 1), LIMIT = +arg('limit', 1e9), ONLY = arg('surface', null);
const T = tmpdir(), SANDBOX = path.join(T, 'cs_real_sweep');
const F = (k) => path.join(T, `chromasmith_automation_${k}.json`);
const APP = path.resolve('desktop/src-tauri/target/release/bundle/macos/Chromasmith.app');
const SKIP = /export|save to|reveal|finder|open in|lightroom|google|photos library|sign ?in|sign ?out|log ?out|quit|update|install|download|share|email|report a bug|feedback|website|help|delete|trash|move to|eject/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── transport ────────────────────────────────────────────────────────────────────────────────
let token;
const writeAtomic = (p, v) => { const t = p + '.' + process.pid; writeFileSync(t, JSON.stringify(v)); renameSync(t, p); };
async function evalIn(code, timeout = 15000) {
  const id = randomBytes(8).toString('hex');
  writeAtomic(F('command'), { id, token, action: 'eval', code });
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const r = JSON.parse(readFileSync(F('result'), 'utf8')); if (r.id === id) { if (!r.ok) throw new Error(r.error); return r.result; } }
    catch (e) { if (e.message && !/JSON|ENOENT/.test(e.message) && !/Unexpected/.test(e.message)) throw e; }
    await sleep(60);
  }
  throw new Error('automation timeout');
}
const call = (fn, a) => evalIn(`(${fn.toString()})(${JSON.stringify(a ?? null)})`);
async function waitReady(ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await evalIn('document.readyState', 2000) === 'complete') return; } catch (_) {} await sleep(500); }
  throw new Error('app did not become ready');
}

// ── in-page helpers (self-contained; serialized with toString) ───────────────────────────────
function installErrHook() {
  if (window.__sweepErrs) { window.__sweepErrs.length = 0; return true; }
  window.__sweepErrs = [];
  addEventListener('error', (e) => window.__sweepErrs.push('error: ' + e.message));
  addEventListener('unhandledrejection', (e) => window.__sweepErrs.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a) => { window.__sweepErrs.push('console: ' + a.map(String).join(' ').slice(0, 200)); ce(...a); };
  return true;
}
function actInPage(c) {
  let el = document.elementFromPoint(c.x, c.y);
  if (!el) return 'no element';
  const ctl = el.closest('button,[role],input,select,textarea,a,[onclick],[tabindex]') || el;
  const ev = (t, Ctor = MouseEvent, extra = {}) => ctl.dispatchEvent(new Ctor(t, { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, pointerId: 1, isPrimary: true, ...extra }));
  if (c.kind === 'range') {
    const lo = +ctl.min || 0, hi = ctl.max === '' ? 100 : +ctl.max, v = +ctl.value;
    ctl.value = String(Math.abs(v - hi) < Math.abs(v - lo) ? lo + (hi - lo) * 0.25 : lo + (hi - lo) * 0.75);
    ctl.dispatchEvent(new Event('input', { bubbles: true })); ctl.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (/^(text|search|number|email|url|textarea)$/.test(c.kind)) {
    ctl.focus(); ctl.value = c.kind === 'number' ? '7' : 'sweep';
    ctl.dispatchEvent(new Event('input', { bubbles: true })); ctl.dispatchEvent(new Event('change', { bubbles: true }));
    ctl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  } else if (c.kind === 'select-one' || c.kind === 'select') {
    ctl.selectedIndex = (ctl.selectedIndex + 1) % ctl.options.length; ctl.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (c.kind === 'file' || c.kind === 'password') {
    return 'skipped';
  } else if (/resizer|splitter|divider/i.test(c.label)) {
    ev('pointerdown', PointerEvent); ev('pointermove', PointerEvent, { clientX: c.x - 40, clientY: c.y - 40 }); ev('pointerup', PointerEvent, { clientX: c.x - 40, clientY: c.y - 40 });
  } else {
    ev('pointerdown', PointerEvent); ev('mousedown'); ev('pointerup', PointerEvent); ev('mouseup'); ctl.click();
  }
  return 'ok';
}
function pressEscape() { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; }
function backupLS() { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }
function restoreLS(o) { localStorage.clear(); for (const k in o) localStorage.setItem(k, o[k]); return Object.keys(o).length; }
async function pointAtSandbox(root) {
  for (const k of ['chromasmith_lib_last_folder', 'chromasmith_lib_last_view_v2', 'chromasmith_lib_last_path', 'chromasmith_lib_recents', 'chromasmith_lib_pins', 'chromasmith_lib_views']) localStorage.removeItem(k);
  localStorage.setItem('chromasmith_lib_root', root);
  localStorage.setItem('chromasmith-tour-seen-v1', '1');
  try { await window.__TAURI__.core.invoke('catalog_add_root', { path: root }); } catch (e) { return 'add_root: ' + e; }
  return 'ok';
}
async function openFirstPhoto(root) {
  // Through the Library's own open path (same as a grid double-click) so the sweep doesn't
  // depend on which collection/view the library half of the sweep left on screen.
  for (let i = 0; i < 60 && typeof window.chromasmithOpenInEditor !== 'function'; i++) await new Promise((r) => setTimeout(r, 500));
  const q = await window.__TAURI__.core.invoke('catalog_query', { q: {} });
  const p = (q.entries || []).find((e) => e.is_image);
  if (!p) return false;
  await window.chromasmithOpenInEditor(p.path);
  for (let i = 0; i < 60; i++) { if (typeof FX !== 'undefined' && FX.w > 0) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────
mkdirSync('test/output', { recursive: true });
const BACKUP = 'test/output/real_app_localstorage_backup.json';
if (!process.argv.includes('--no-launch')) {
  spawnSync('pkill', ['-x', 'chromasmith']); await sleep(1500);
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(path.join(SANDBOX, 'photos'), { recursive: true });
  for (const f of readdirSync('test/fixtures')) if (/\.(png|jpe?g|tiff?|rw2|heic|dng)$/i.test(f)) cpSync(path.join('test/fixtures', f), path.join(SANDBOX, 'photos', f));
  token = randomBytes(18).toString('hex');
  writeAtomic(F('enable'), { token });
  execFileSync('open', ['-n', '--env', `CS_CATALOG_DIR=${SANDBOX}/catalog`, '--env', `CS_CACHE_DIR=${SANDBOX}/cache`, APP]);
} else token = JSON.parse(readFileSync(F('enable'), 'utf8')).token;

await waitReady();
await sleep(3000);
const backup = await call(backupLS);
if (!existsSync(BACKUP)) writeFileSync(BACKUP, JSON.stringify(backup)); // never overwrite the first, real backup with a sandboxed one
const realLS = JSON.parse(readFileSync(BACKUP, 'utf8'));
console.log(`localStorage backed up (${Object.keys(realLS).length} keys) -> ${BACKUP}`);

const report = {};
async function reload(surface) {
  try { await evalIn('(setTimeout(()=>location.reload(),50),true)', 3000); } catch (_) {}
  await sleep(2500); await waitReady(); await sleep(2000);
  await call(installErrHook);
  if (surface === 'editor' && !(await evalIn(`(${openFirstPhoto.toString()})()`, 70000))) throw new Error('could not open a photo from the sandbox library');
  await sleep(800);
}
try {
  console.log('sandbox root:', await call(pointAtSandbox, path.join(SANDBOX, 'photos')));
  for (const surface of ['library', 'editor']) {
    if (ONLY && ONLY !== surface) continue;
    await reload(surface);
    const results = new Map(), famCount = new Map();
    const queue = (await call(enumerate)).map((c) => ({ ...c, path: [] }));
    const known = new Set(queue.map((c) => c.key));
    const find = async (k) => (await call(enumerate)).find((c) => c.key === k);
    while (queue.length && results.size < LIMIT) {
      const c = queue.shift();
      if (results.has(c.key)) continue;
      if (SKIP.test(c.label)) { results.set(c.key, { status: 'skipped', label: c.label, path: c.path }); continue; }
      const fk = c.family + '@' + c.path.length, fc = (famCount.get(fk) || 0) + 1; famCount.set(fk, fc); if (fc > 3) continue;
      let cur = await find(c.key);
      if (!cur) { await reload(surface); for (const st of c.path) { const sc = await find(st); if (sc) { await call(actInPage, sc); await sleep(300); } } cur = await find(c.key); }
      if (!cur) { results.set(c.key, { status: 'unreach', label: c.label, path: c.path }); continue; }
      await call(installErrHook);
      const before = await call(fingerprint);
      let errs = [];
      try { await call(actInPage, cur); } catch (e) { errs.push('act: ' + e.message); }
      let after = before;
      for (let t = 0; t < 2000 && after === before; t += 200) { await sleep(200); try { after = await call(fingerprint); } catch (e) { errs.push('lost page: ' + e.message); await waitReady(); break; } }
      try { errs = errs.concat(await evalIn('window.__sweepErrs ? window.__sweepErrs.slice(0, 3) : []')); } catch (_) {}
      const status = errs.length ? 'error' : after !== before ? 'changed' : cur.selected ? 'selected' : 'inert';
      results.set(c.key, { status, label: c.label, kind: c.kind, path: c.path, errors: errs });
      if (status === 'changed' && c.path.length < DEPTH) {
        for (const n of await call(enumerate).catch(() => [])) if (!known.has(n.key)) { known.add(n.key); queue.push({ ...n, path: [...c.path, c.key] }); }
      }
      if (status === 'changed') await call(pressEscape).catch(() => {});
      if (results.size % 20 === 0) console.log(`  ${surface}: ${results.size} done, ${queue.length} queued`);
    }
    report[surface] = Object.fromEntries(results);
  }
} finally {
  try { console.log('localStorage restored:', await call(restoreLS, realLS), 'keys'); } catch (e) { console.log('!! RESTORE FAILED — restore manually from', BACKUP, e.message); }
  spawnSync('pkill', ['-x', 'chromasmith']);
  writeFileSync('test/output/real_app_sweep.json', JSON.stringify(report, null, 2));
}

let fail = false;
console.log('\nsurface    found  changed  inert  selected  skipped  unreach  error');
for (const [s, r] of Object.entries(report)) {
  const v = Object.values(r), n = (st) => v.filter((x) => x.status === st).length;
  console.log(`${s.padEnd(9)} ${[v.length, n('changed'), n('inert'), n('selected'), n('skipped'), n('unreach'), n('error')].map((x, i) => String(x).padStart([6, 8, 6, 9, 8, 8, 6][i])).join(' ')}`);
  for (const [k, x] of Object.entries(r)) if (x.status === 'error') { fail = true; console.log(`  ERROR ${s} ${k}\n    ${x.errors.join('\n    ')}`); }
}
console.log(fail ? 'real:sweep — FAIL' : 'real:sweep — PASS');
process.exit(fail ? 1 : 0);
