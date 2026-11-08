// Progressive-disclosure completeness scan (docs/plans/ux-progressive-disclosure.md, "Completeness check").
// Enumerates EVERY control of every Editor tool card from the running app, never a typed list, and asserts:
//   1. nothing lost vs test/baselines/disclosure_controls.json (the keep-every-control rule)
//   2. every control is classified essential | advanced (inside details.fx-adv); unclassified = 0
//   3. every advanced control is reachable from the command palette ("Tool: Label"), and running that
//      entry opens the card + its fold and puts the control on screen
//   4. default-visible numbers: Exposure & Tone sliders <= 11
//   5. the same control set in dark + light, widths 320/390/700/701/1024/1280/1920, panel width min/default/max,
//      and empty / loaded-photo / mask-active states
//   6. "N changed" badge truth: change one advanced control -> badge reads 1 changed; reset -> hidden; fold state persists
// Usage: node test/disclosure_scan.mjs [--json] [--update-baseline]
import fs from 'node:fs';
import { bootEditor } from './editor_state_harness.mjs';
const BASE = new URL('./baselines/disclosure_controls.json', import.meta.url);
const update = process.argv.includes('--update-baseline');
const asJson = process.argv.includes('--json');
const fails = [];
const fail = (m) => fails.push(m);

const scan = () => {
  const out = {};
  const hiddenByState = (el, card) => { for (let n = el; n && n !== card; n = n.parentElement) { if (n.hidden || n.style.display === 'none') return true; } return false; };
  document.querySelectorAll('.fx-ctrl[data-fxsec]').forEach((card) => {
    const sec = card.dataset.fxsec, seen = {};
    card.querySelectorAll('input,select,textarea,button').forEach((el) => {
      const row = el.closest('.fx-row,.btn-row,.vrow,label') || el;
      const lab = ((row.querySelector('.fx-label,.vlb')?.textContent || el.getAttribute('aria-label') || el.textContent || el.title || '').trim().replace(/\s+/g, ' ')).slice(0, 48);
      let key = sec + ':' + (el.id || el.tagName.toLowerCase() + ':' + lab);
      seen[key] = (seen[key] || 0) + 1; if (seen[key] > 1) key += '#' + seen[key];
      const adv = el.closest('details.fx-adv');
      const info = el.classList.contains('fx-info-i');
      out[key] = { cls: adv ? 'advanced' : 'essential', slider: el.type === 'range', label: lab, open: adv ? adv.open : null, info, vis: !hiddenByState(el, card) && !(adv && !adv.open) };
    });
  });
  return out;
};

const matrix = [];
for (const theme of ['dark', 'light']) for (const [w, h] of [[320, 700], [390, 800], [700, 800], [701, 800], [1024, 800], [1280, 900], [1920, 1080]]) matrix.push({ theme, w, h });
let first = null;
const b = await bootEditor({ withPhoto: false });
const { page } = b;
const setState = async ({ theme, w, h }) => {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate((t) => { document.body.classList.toggle('light', t === 'light'); document.documentElement.classList.toggle('light', t === 'light'); }, theme);
  await page.waitForTimeout(60);
};
const compare = (label, cur) => {
  if (!first) { first = cur; return; }
  const lost = Object.keys(first).filter((k) => !(k in cur));
  if (lost.length) fail(`${label}: ${lost.length} controls vanished vs first state (${lost.slice(0, 4).join(', ')})`);
};
// empty state
for (const m of matrix) { await setState(m); compare(`empty ${m.theme} ${m.w}`, await page.evaluate(scan)); }
// panel width min/default/max (desktop width)
await page.setViewportSize({ width: 1440, height: 900 });
for (const pw of [220, 320, 440]) {
  await page.evaluate((w) => { if (typeof fxPanelWidth === 'function') fxPanelWidth(w); }, pw);
  compare(`panel ${pw}`, await page.evaluate(scan));
}
await page.evaluate(() => { if (typeof fxPanelWidth === 'function') fxPanelWidth(320); });
await b.close();

// loaded-photo state (superset: JS-built controls exist) -> the baseline source
const b2 = await bootEditor({ withPhoto: true });
const p2 = b2.page;
await p2.setViewportSize({ width: 1440, height: 900 });
let cur = await p2.evaluate(scan);
// mask-active state: add a radial mask, controls must still all exist
await p2.evaluate(() => { try { if (typeof mskAdd === 'function') mskAdd('radial'); } catch (e) {} });
await p2.waitForTimeout(300);
const withMask = await p2.evaluate(scan);
for (const k of Object.keys(cur)) if (!(k in withMask)) fail(`mask state: control ${k} vanished`);
cur = { ...withMask, ...cur };

// baseline
if (update || !fs.existsSync(BASE)) {
  const snap = Object.fromEntries(Object.entries(cur).filter(([k]) => !/mask|msk/i.test(k)).map(([k, v]) => [k, v.cls]));
  fs.mkdirSync(new URL('./baselines/', import.meta.url), { recursive: true });
  fs.writeFileSync(BASE, JSON.stringify({ note: 'Every Editor tool-card control by key -> classification. Regenerate with --update-baseline ONLY when a control is deliberately added; a removal must fail.', total: Object.keys(snap).length, controls: snap }, null, 1));
  console.log(`baseline written: ${Object.keys(snap).length} controls`);
} else {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8')).controls;
  for (const k of Object.keys(base)) if (!(k in cur)) fail(`LOST control vs baseline: ${k}`);
}
// 2. classification
for (const [k, v] of Object.entries(cur)) if (v.cls !== 'essential' && v.cls !== 'advanced') fail(`unclassified: ${k}`);
// numbers
const adjVisSliders = Object.entries(cur).filter(([k, v]) => k.startsWith('adjust:') && v.slider && v.vis).length;
if (adjVisSliders > 11) fail(`Exposure & Tone default-visible sliders ${adjVisSliders} > 11`);
const perCard = {};
for (const [k, v] of Object.entries(cur)) { const c = k.split(':')[0]; perCard[c] ??= { total: 0, advanced: 0, visibleDefault: 0 }; perCard[c].total++; if (v.cls === 'advanced') perCard[c].advanced++; if (v.vis) perCard[c].visibleDefault++; }

// 3. palette reachability of every advanced control with a label
const advKeys = Object.entries(cur).filter(([, v]) => v.cls === 'advanced' && v.label && !v.info);
const reach = await p2.evaluate((keys) => {
  const cmds = _cpCommands(); const bad = [];
  for (const [k, lab] of keys) {
    const sec = k.split(':')[0];
    const hit = cmds.find((c) => c.group === 'Control' && c.label === (CS_NAMES[sec] || sec) + ': ' + lab);
    if (!hit) bad.push(k);
  }
  return bad;
}, advKeys.map(([k, v]) => [k, v.label]));
// buttons/selects living directly in a row label differ; only rows with a labelled input are required
const unreached = reach.filter((k) => !/^[a-z]+:(button|input|select|textarea):/.test(k) || true);
if (unreached.length) fail(`not reachable from palette (${unreached.length}): ${unreached.slice(0, 8).join(', ')}`);
// run one palette entry per card: fold must open
const opened = await p2.evaluate(async () => {
  const res = {}; const cmds = _cpCommands();
  for (const sec of ['adjust', 'nr', 'straighten', 'borders', 'retouch', 'export']) {
    const d = document.getElementById('fx-adv-' + sec); d.open = false;
    const c = cmds.find((x) => x.group === 'Control' && x.label.startsWith((CS_NAMES[sec] || sec) + ': ') && d.contains(document.querySelector('[id]')) || x.group === 'Control' && x.label.startsWith((CS_NAMES[sec] || sec) + ': '));
    if (!c) { res[sec] = 'no-entry'; continue; }
    c.run(); await new Promise((r) => setTimeout(r, 600));
    res[sec] = d.open;
    if (sec === 'export' && d.closest('#sk2-export')) { // desktop: drawer + its More fold must be open and the control focused
      const mf = document.querySelector('#sk2-export details.sk2x-more');
      res[sec] = d.open && document.body.classList.contains('sk2-exp-open') && !!mf && mf.open && d.contains(document.activeElement);
    }
  }
  return res;
});
for (const [s, o] of Object.entries(opened)) if (o !== true) fail(`palette entry did not open Advanced fold on ${s}: ${o}`);

// 6. modified badge truth + persistence
const badge = await p2.evaluate(async () => {
  const d = document.getElementById('fx-adv-adjust'), s = document.getElementById('sl-adj-mix-rr');
  const t = d.querySelector('.fx-adv-n'), r = {};
  r.before = t.hidden; s.value = 120; s.dispatchEvent(new Event('input', { bubbles: true })); fxAdvUpdate(); r.after = t.textContent;
  s.value = s.defaultValue; s.dispatchEvent(new Event('input', { bubbles: true })); fxAdvUpdate(); r.cleared = t.hidden;
  d.open = true; await new Promise((x) => setTimeout(x, 50)); r.stored = JSON.parse(localStorage.getItem('chromasmith_fx_adv_open') || '{}').adjust;
  return r;
});
if (!badge.before || badge.after !== '1 changed' || !badge.cleared || badge.stored !== true) fail('modified badge/persistence: ' + JSON.stringify(badge));
await b2.close();

const report = { controls: Object.keys(cur).length, perCard, adjustDefaultVisibleSliders: adjVisSliders, badge, opened, failures: fails };
if (asJson) console.log(JSON.stringify(report, null, 1));
else { console.log(`controls ${report.controls}; Exposure&Tone default-visible sliders ${adjVisSliders}`); console.table(perCard); }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS disclosure_scan');
