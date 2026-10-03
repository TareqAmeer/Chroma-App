#!/usr/bin/env node
// ── PHONE LAYOUT AUDIT ───────────────────────────────────────────────────────────────
// Loads the real app at phone widths (touch, mobile layout), opens a photo, walks every tool
// section and checks the things that were found by eye on a device: dead gaps before a tool's
// first control, controls hidden behind the pinned tab strip, sideways overflow, the tools grid's
// dead band above the bottom bar, and any control whose touch target is under 32px.
//
//   node test/phone_audit.mjs          # table + exit 1 on a HARD failure (overflow / overlap)
//   node test/phone_audit.mjs --json   # full finding list
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp' };
const WIDTHS = [{ w: 360, h: 740 }, { w: 390, h: 844 }, { w: 430, h: 932 }];
const MAX_LEAD = 30;     // px between the tab strip and a tool's first control
const MIN_TAP = 32;
const JSON_OUT = process.argv.includes('--json');

const server = await new Promise(res => {
  const s = createServer(async (req, rsp) => {
    try {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, p === '/' ? '/chromasmith-22.html' : p);
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      const d = await readFile(f);
      rsp.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); rsp.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rsp.end(d);
    } catch { rsp.writeHead(404); rsp.end(); }
  });
  s.listen(0, '127.0.0.1', () => res(s));
});
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const findings = [];
for (const vp of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + 'chromasmith-22.html');
  await page.waitForFunction(() => typeof fxSection === 'function');
  await page.setInputFiles('#in-fx-img', path.join(ROOT, 'test/fixtures/gradient.png'));
  await page.waitForTimeout(2500);
  const bodyCls = await page.evaluate(() => document.body.className);
  if (!/sk2/.test(bodyCls) || !/mobile-fx/.test(bodyCls)) findings.push({ vp: vp.w, section: '(page)', hard: ['phone layout not active: body.' + bodyCls], soft: [] });
  const sections = await page.evaluate(() => [...new Set([...document.querySelectorAll('.fx-ctrl[data-fxsec]')].map(e => e.dataset.fxsec))]);
  for (const s of sections) {
    const r = await page.evaluate(async ({ s, MAX_LEAD, MIN_TAP }) => {
      fxSection(s);
      await new Promise(r => setTimeout(r, 450));
      const panel = document.querySelector('.fx-panel'), strip = document.getElementById('fx-sheet-strip');
      const card = document.querySelector('.fx-ctrl.sec-active');
      if (!card || !panel || !strip || !panel.offsetHeight) return { skip: true };
      const sb = strip.getBoundingClientRect().bottom;
      const vis = [...card.querySelectorAll('input,button,select,.fx-label,.fx-sub,.cs-sub,canvas')]
        .filter(e => e.offsetWidth > 0 && e.offsetHeight > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]') && e.getBoundingClientRect().height > 2);
      const first = vis.map(e => e.getBoundingClientRect().top).sort((a, b) => a - b)[0];
      const out = { lead: first == null ? 0 : Math.round(first - sb), overflowX: panel.scrollWidth - panel.clientWidth, hidden: 0, small: [] };
      panel.scrollTop = 0;
      for (const e of vis) { const b = e.getBoundingClientRect(); if (b.bottom > sb + 1 && b.top < sb - 2 && e.matches('input,button,select')) out.hidden++; }
      for (const e of vis) {
        if (!e.matches('button,select,input:not([type=range]):not([type=checkbox]):not([type=color])')) continue;
        const b = e.getBoundingClientRect();
        if ((Math.min(b.width, b.height) < 24 || b.width * b.height < 1200) && !e.closest('.fx-toggle') && getComputedStyle(e, '::after').content === 'none') out.small.push((e.id || e.className || e.tagName).toString().slice(0, 24) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      }
      return out;
    }, { s, MAX_LEAD, MIN_TAP });
    if (r.skip) continue;
    const hard = [];
    if (r.overflowX > 1) hard.push('overflow-x ' + r.overflowX + 'px');
    if (r.hidden) hard.push(r.hidden + ' control(s) under the tab strip');
    const soft = [];
    if (r.lead > MAX_LEAD) soft.push('gap before first control ' + r.lead + 'px');
    if (r.small.length) soft.push('small targets: ' + r.small.slice(0, 3).join(', '));
    findings.push({ vp: vp.w, section: s, hard, soft });
  }
  // Tools list: no dead band between the last tile and the bottom bar.
  const grid = await page.evaluate(async () => {
    fxToolsOpen(); await new Promise(r => setTimeout(r, 500));
    const g = document.getElementById('fx-tool-grid'); if (!g) return null;
    g.scrollTop = g.scrollHeight;
    const last = [...g.children].filter(e => e.offsetHeight).pop();
    return last ? Math.round(g.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : null;
  });
  if (grid != null && grid > 24) findings.push({ vp: vp.w, section: '(tools list)', hard: [], soft: ['dead band under last tile ' + grid + 'px'] });
  if (errors.length) findings.push({ vp: vp.w, section: '(page)', hard: errors.slice(0, 2), soft: [] });
  await ctx.close();
}
await browser.close(); server.close();
const hardN = findings.filter(f => f.hard.length).length, softN = findings.filter(f => f.soft.length).length;
if (JSON_OUT) console.log(JSON.stringify(findings, null, 1));
else {
  for (const f of findings) if (f.hard.length || f.soft.length)
    console.log(`${f.hard.length ? 'FAIL' : 'warn'}  ${String(f.vp).padEnd(4)} ${f.section.padEnd(14)} ${[...f.hard, ...f.soft].join(' | ')}`);
  console.log(`\nphone audit: ${hardN} hard failure(s), ${softN} warning(s) across ${WIDTHS.length} widths`);
}
process.exit(hardN ? 1 : 0);
