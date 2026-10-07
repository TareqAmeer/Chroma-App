// CHR-213: the Preview carousel falls back to a static grid under Reduce Motion (OS preference or
// the app's own --k-motion-reduce-motion setting). Runs the real pvCarousel/pvReduced source
// from desktop/library-ui.js against a fake `pv` in a real browser.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const src = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `markers ${a}`); return src.slice(i, j + b.length); };
const reduced = cut('// CHR-213 reduced begin', '// CHR-213 reduced end');
const carousel = cut('// CHR-213 carousel begin', '// CHR-213 carousel end');
const pvImg = src.match(/function pvImg\(p, css\) \{[^\n]*\}/)[0];
const code = `${reduced}\n${pvImg}\nlet opened=null;function pvOpen(p){opened=p;}\n${carousel}\nwindow.__t={pvReduced,run(){const stage=document.createElement('div');stage.style.cssText='position:fixed;inset:0';document.body.appendChild(stage);
  const px='data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
  window.pv={stage,stop:[],raf:0,photos:Array.from({length:8},(_,i)=>({url:px,path:'/p'+i+'.jpg'}))};pvCarousel();
  return {stage,pv:window.pv,opened:()=>opened};}};`;
const b = await chromium.launch();
const results = {};
for (const [name, ctxOpts, tok, expectStatic] of [
  ['no-preference', { reducedMotion: 'no-preference' }, null, false],
  ['os-reduce', { reducedMotion: 'reduce' }, null, true],
  ['app-setting-on', { reducedMotion: 'no-preference' }, 'on', true],
  ['app-setting-off-overrides-os', { reducedMotion: 'reduce' }, 'off', false],
]) {
  const ctx = await b.newContext({ ...ctxOpts, viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent('<body style="margin:0;background:#000"></body>');
  if (tok) await p.addStyleTag({ content: `body{--k-motion-reduce-motion:${tok}}` });
  await p.addScriptTag({ content: code });
  const r = await p.evaluate(async () => {
    const t = window.__t.run();
    const grid = t.stage.querySelector('.pv-static-grid');
    const snap = () => [...t.stage.querySelectorAll('img')].map(i => { const r = i.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)].join(','); }).join('|');
    const a = snap(); await new Promise(r => setTimeout(r, 400)); const bb = snap();
    const ring3d = [...t.stage.querySelectorAll('div')].some(d => getComputedStyle(d).transformStyle === 'preserve-3d');
    if (grid) t.stage.querySelectorAll('img')[2].click();
    return { reducedFn: window.__t.pvReduced(), grid: !!grid, tiles: t.stage.querySelectorAll('img').length, ring3d, raf: !!window.pv.raf, moved: a !== bb, opened: t.opened() };
  });
  results[name] = r;
  assert.deepEqual(errs, [], name);
  assert.equal(r.grid, expectStatic, `${name}: static grid ${expectStatic}`);
  assert.equal(r.ring3d, !expectStatic, `${name}: 3D ring ${!expectStatic}`);
  if (expectStatic) { assert.equal(r.tiles, 8); assert.equal(r.raf, false, 'no animation loop'); assert.equal(r.moved, false, 'tiles do not move'); assert.equal(r.opened, '/p2.jpg', 'click still opens the photo'); }
  else { assert.equal(r.raf, true); assert.equal(r.moved, true, 'ring spins'); }
  await ctx.close();
}
console.log(JSON.stringify(results));
console.log('PASS carousel Reduce Motion fallback (OS preference + app setting)');
await b.close();
