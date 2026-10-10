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
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startServer } from './editor_state_harness.mjs';
import { enumerate, fingerprint, locate, alreadyAtReplayDestination, captureReplayDestination, setColorInput, setReplayValue } from './sweep_lib.mjs';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const DEPTH = +arg('depth', 2), LIMIT = +arg('limit', 1e9), ONLY = arg('surface', null);
const ACCEPTED = 'test/control_sweep_accepted.json';
const CHECKPOINT = 'test/output/control_sweep.checkpoint.json';
const SOURCE_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// Controls that leave the app or destroy the test session rather than exercising a feature.
const SKIP = /^(quit|sign out|log out)$/i;

const SURFACES = {
  library: { query: 'libtest=1&libn=18&deskx=1', photo: false },
  editor: { query: 'libtest=1&deskx=1', photo: true },
};

async function boot(page, port, s, storageBaseline) {
  // A prior queued path may persist panel/disclosure preferences (Library section visibility,
  // filters) that were not part of the target's recorded action path. Restore the surface's
  // original boot storage before each replay while preserving state within that replay.
  if (storageBaseline.value) {
    await page.evaluate((snapshot) => {
      localStorage.clear(); for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
    }, storageBaseline.value);
  }
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
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, undefined, { timeout: 10000 }).catch(() => {});
    // Loading the portrait can open the First edit coach after the pre-fixture Escape above.
    // It covers the Gallery collection controls and makes valid targets look unreachable.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const overlay = document.getElementById('cs-modal-ov');
      return !overlay || !overlay.checkVisibility();
    }, undefined, { timeout: 3000 });
  }
  await page.waitForTimeout(400);
  if (!storageBaseline.value) storageBaseline.value = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

async function act(page, c, replayDestination = null) {
  if (replayDestination?.valueType === 'value') {
    await page.evaluate(setReplayValue, { key: c.key, value: replayDestination.value });
    return;
  }
  if (c.kind === 'range') {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('input') || document.elementFromPoint(x, y);
      const lo = +el.min || 0, hi = el.max === '' ? 100 : +el.max, v = +el.value;
      el.value = String(Math.abs(v - hi) < Math.abs(v - lo) ? lo + (hi - lo) * 0.25 : lo + (hi - lo) * 0.75);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }, c);
  } else if (c.kind === 'color') {
    await page.evaluate(setColorInput, c);
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
await mkdir('test/output', { recursive: true });
let activeSurface = null, activeResults = null, activeQueue = null, activeContext = null;

async function saveCheckpoint(surface, results, queued, terminationReason = 'in_progress') {
  report[surface] = Object.fromEntries(results);
  const tmp = `${CHECKPOINT}.tmp`;
  await writeFile(tmp, JSON.stringify({
    meta: {
      surface, terminationReason, traversalComplete: terminationReason === 'exhausted' && queued === 0,
      depth: DEPTH, limit: LIMIT, completed: results.size, queued,
      sourceCommit: SOURCE_COMMIT, capturedAt: new Date().toISOString(),
    },
    report,
  }, null, 2));
  await rename(tmp, CHECKPOINT);
}

process.once('SIGINT', async () => {
  if (activeSurface && activeResults && activeQueue) {
    await saveCheckpoint(activeSurface, activeResults, activeQueue.length, 'interrupted').catch(() => {});
  }
  await activeContext?.close().catch(() => {});
  await browser.close().catch(() => {});
  server.close();
  process.exit(130);
});

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

  const storageBaseline = { value: null };
  await boot(page, port, s, storageBaseline); errs = [];
  let atBaseline = true;
  // Repeated items (grid tiles, list rows, swatches) are one control family: test 3 of each, not 5,000.
  const famCount = new Map(), FAMILY_CAP = 3;
  const results = new Map(), queue = (await page.evaluate(enumerate)).map((c) => ({ ...c, path: [] }));
  activeSurface = name; activeResults = results; activeQueue = queue; activeContext = ctx;
  const known = new Set(queue.map((c) => c.key));
  const t0 = Date.now();

  // Wait until the page stops changing (async sidebars, counts, dialogs) — a fixed 250ms after a
  // replay step left later controls not yet rendered, reported as unreach (CHR-230).
  const settle = async () => {
    let prev = null;
    for (let t = 0; t < 2500; t += 150) {
      const fp = await page.evaluate(fingerprint).catch(() => null);
      if (fp !== null && fp === prev) return; prev = fp; await page.waitForTimeout(150);
    }
  };
  const find = async (key) => {
    const c = (await page.evaluate(enumerate)).find((x) => x.key === key);
    const at = c && await page.evaluate(locate, key);
    return at ? { ...c, ...at } : null;
  };
  // Fingerprint stability does not include CSS transform progress. Wait for the actual next
  // path control (or final target) to become enumerable and hit-test reachable after a slide-in.
  const waitForFind = async (key) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const found = await find(key); if (found) return found;
      await page.waitForTimeout(100);
    }
    return null;
  };
  const reach = async (c) => {
    let cur = await find(c.key);
    if (cur) return cur; // still visible and uncovered: reuse the page instead of a 2-10s reboot
    await boot(page, port, s, storageBaseline); await settle(); atBaseline = true;
    for (let i = 0; i < c.path.length; i++) {
      const sc = await find(c.path[i]); if (!sc) return null;
      const nextKey = i + 1 < c.path.length ? c.path[i + 1] : c.key;
      // Stateful controls replay toward the state captured after discovery activated them. A
      // null destination means an ordinary action button; always replay it so dialogs still open.
      if (alreadyAtReplayDestination(c.pathSel?.[i], sc)) {
        // Some destination indicators survive reload while their dependent content does not
        // (for example the Histogram tab can remain selected with its details disclosure closed).
        // Re-assert only explicit destination setters; generic toggles remain untouched.
        const next = await waitForFind(nextKey);
        if (next) continue;
        if (!sc.replayIdempotent) return null;
      }
      await act(page, sc, c.pathSel?.[i]); await settle(); atBaseline = false;
      if (c.pathSel?.[i]?.valueType === 'value' && sc.label === '#lib-search') await page.keyboard.press('Enter');
      if (c.label === 'Export proof toggle' && sc.label === '#btn-export-db') {
        await page.waitForFunction(() => {
          const toggle = document.querySelector('#sk2-export .sk2x-proof-toggle');
          return document.body.classList.contains('sk2-exp-open') && !!toggle && toggle.checkVisibility();
        }, undefined, { timeout: 3000 });
      } else if (c.label === 'Cancel' && sc.label === '#sel-crop-ar') {
        await page.waitForFunction(() => {
          const tools = document.getElementById('fx-crop-tools');
          return !!tools && tools.checkVisibility() && [...tools.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Cancel' && b.checkVisibility());
        }, undefined, { timeout: 3000 });
      }
      if (!await waitForFind(nextKey)) return null;
    }
    return c.path.length ? find(c.key) : waitForFind(c.key);
  };

  while (queue.length && results.size < LIMIT) {
    const c = queue.shift();
    if (results.has(c.key) || SKIP.test(c.label)) continue;
    const fk = c.family + '@' + c.path.length, fc = (famCount.get(fk) || 0) + 1;
    famCount.set(fk, fc); if (fc > FAMILY_CAP) continue;
    const cur = await reach(c);
    if (!cur) {
      results.set(c.key, { status: 'unreach', label: c.label, path: c.path });
      if (results.size % 10 === 0) await saveCheckpoint(name, results, queue.length);
      continue;
    }
    errs = [];
    const before = await page.evaluate(fingerprint);
    try { await act(page, cur); } catch (e) { errs.push('act: ' + e.message.split('\n')[0]); }
    // Poll rather than one fixed wait: thumbnails, the add-photo picker and zoom settle async
    // (300ms marked them inert falsely; triage showed them changing by ~1s).
    let after = before;
    if (c.label === 'Export proof toggle' && !errs.length) {
      // The click schedules a full preview render; the text/canvas fingerprint changes only once
      // that render finishes, which can exceed the generic interaction interval.
      await page.waitForFunction(() => document.querySelector('#sk2-export .sk2x-proof canvas')?.getAttribute('aria-label')?.startsWith('Original preview'), undefined, { timeout: 12000 }).catch(() => {});
    }
    for (let t = 0; t < 1500 && after === before; t += 150) {
      await page.waitForTimeout(150);
      try { after = await page.evaluate(fingerprint); } catch (e) { errs.push('navigated: ' + e.message.split('\n')[0]); break; }
    }
    // Re-pressing the already-selected chip/tab is a correct no-op, not an inert control.
    const status = errs.length ? 'error' : after !== before ? 'changed' : cur.selected ? 'selected' : 'inert';
    results.set(c.key, { status, label: c.label, kind: c.kind, path: c.path, errors: errs.slice(0, 3) });
    if (results.size % 10 === 0) await saveCheckpoint(name, results, queue.length);
    if (status === 'changed') {
      atBaseline = false;
      if (c.path.length < DEPTH) {
          // Read the activated DOM node directly before enumerate() replaces its element map.
          // Opening Library can move the toggle off-screen, but its desired state still matters
          // when paths to the newly revealed collection headers are replayed after a reload.
          const capturedDestination = await page.evaluate(captureReplayDestination, { key: c.key, statefulEvidence: cur.stateful }).catch(() => null);
          const afterControls = await page.evaluate(enumerate).catch(() => []);
          const selectedAfter = new Map(afterControls.map((n) => [n.key, n]));
          for (const n of afterControls) {
          if (!known.has(n.key)) {
            known.add(n.key);
            const destination = selectedAfter.get(c.key);
            const state = capturedDestination || ((cur.stateful || destination?.stateful) ? { stateful: true, selected: destination?.selected ?? false } : null);
            queue.push({ ...n, path: [...c.path, c.key], pathSel: [...(c.pathSel || []), state] });
          }
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    if (results.size % 25 === 0) console.log(`  ${name}: ${results.size} done, ${queue.length} queued, ${((Date.now() - t0) / 1000) | 0}s`);
  }
  await saveCheckpoint(name, results, queue.length, queue.length === 0 ? 'exhausted' : 'limit');
  await ctx.close();
}
await browser.close(); server.close();

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
