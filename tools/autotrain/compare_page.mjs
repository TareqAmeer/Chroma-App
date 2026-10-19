#!/usr/bin/env node
// Builds ONE self-contained HTML page to eyeball Auto-enhance versions side by side on real photos:
// original | rule engine (before this work's learned prior) | learned hybrid (what the app now does).
// Uses the real app renderer in headless Chrome, so what you see is what the editor would produce.
//
//   node tools/autotrain/compare_page.mjs <folder> <out.html> [--count 20] [--size 900] [--match IMG_]
// Photos are taken evenly from the folder's .jpg/.jpeg/.png files whose name contains --match
// (ordinary sRGB photos, so no RAW-decode differences). _edited copies are skipped.
import { readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !['--count', '--size', '--match'].includes(argv[i - 1]));
const [dir, out] = pos; if (!dir || !out) { console.error('usage: compare_page.mjs <folder> <out.html> [--count N] [--size px] [--match str]'); process.exit(2); }
const count = parseInt(opt('--count', '20'), 10), size = parseInt(opt('--size', '900'), 10), match = opt('--match', '');
const all = readdirSync(dir).filter(n => !n.startsWith('.') && /\.(jpe?g|png)$/i.test(n) && !/_edited\./i.test(n) && n.includes(match));
const picks = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / count)) === 0).slice(0, count);
console.log(`${picks.length} photos`);
const tmp = mkdtempSync(path.join(tmpdir(), 'cmp-'));

const IDS = { exp: 'sl-adj-exp', hi: 'sl-adj-hi', sh: 'sl-adj-sh', con: 'sl-adj-con', wh: 'sl-adj-wh', bl: 'sl-adj-bl', vib: 'sl-adj-vib', temp: 'sl-adj-temp', tint: 'sl-adj-tint' };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const cards = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof autoEnhanceRules === 'function');
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });
  console.log('learned model embedded in app:', await page.evaluate(() => !!AUTO_MODEL));
  for (const [k, f] of picks.entries()) {
    const small = path.join(tmp, `p${k}.jpg`);
    execFileSync('sips', ['-Z', String(size), '-s', 'format', 'jpeg', path.join(dir, f), '--out', small], { stdio: 'ignore' });
    const b64 = readFileSync(small).toString('base64');
    const r = await page.evaluate(async ({ b64, IDS }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      await loadFXImages([new File([bytes], 'p.jpg', { type: 'image/jpeg' })]);
      document.body.classList.add('fx-single'); if (!document.getElementById('tg-adjust').classList.contains('on')) toggleFX('adjust');
      const src = fxWork || fxImg, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      const t = document.createElement('canvas'); const mw = Math.min(w, 128), mh = Math.max(1, Math.round(mw * h / w)); t.width = mw; t.height = mh;
      t.getContext('2d').drawImage(src, 0, 0, mw, mh); const td = t.getContext('2d').getImageData(0, 0, mw, mh).data;
      const variants = { original: {}, rules: autoEnhanceRules(td), learned: autoEnhanceParams(td) }, res = {};
      for (const [name, v] of Object.entries(variants)) {
        for (const id of Object.values(IDS)) document.getElementById(id).value = '0';
        for (const [key, x] of Object.entries(v)) if (IDS[key]) document.getElementById(IDS[key]).value = String(x);
        fxUpdate();
        const cv = await processToCanvas(getFXParams(), src, w, h, undefined, fxPrepareExportRenderer());
        res[name] = { img: cv.toDataURL('image/jpeg', 0.82), v };
      }
      return res;
    }, { b64, IDS });
    cards.push({ name: f, r });
    console.log(`${k + 1}/${picks.length} ${f}`);
  }
} finally { await browser.close(); rmSync(tmp, { recursive: true, force: true }); }

const fmt = v => Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k} ${x > 0 ? '+' : ''}${x}`).join(' · ') || 'no change';
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Auto-enhance comparison</title><style>
body{margin:0;background:#161616;color:#ddd;font:14px -apple-system,system-ui,sans-serif}h1{font-size:18px;margin:16px}p.n{margin:0 16px 16px;color:#999;max-width:900px}
.card{margin:0 16px 28px}.card h2{font-size:13px;color:#aaa;margin:0 0 6px;font-weight:500}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.row figure{margin:0}.row img{width:100%;display:block;border-radius:4px}.row figcaption{font-size:12px;margin-top:4px;color:#bbb}.row b{color:#fff}
@media (max-width:800px){.row{grid-template-columns:1fr}}</style></head><body>
<h1>Auto-enhance: original · rule engine · learned hybrid</h1>
<p class="n">Same photo, rendered by the editor's own pipeline. Middle = histogram rules only; right = what Auto-enhance now does (rules + learned Lightroom-style priors). Slider values are Chromasmith's own.</p>
${cards.map(c => `<div class="card"><h2>${c.name}</h2><div class="row">${['original', 'rules', 'learned'].map(k => `<figure><img src="${c.r[k].img}" loading="lazy"><figcaption><b>${{ original: 'Original', rules: 'Rule engine', learned: 'Learned hybrid' }[k]}</b><br>${fmt(c.r[k].v)}</figcaption></figure>`).join('')}</div></div>`).join('\n')}
</body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1e6).toFixed(1)} MB)`);
