// Inject the built photo assets into index.html, between the HTML comment markers.
//
//   node site/build-assets.mjs && node site/build-page.mjs
//
// Why a generator rather than fetching manifest.json from the page: the gallery is the whole
// point of the page, and a fetch would leave it empty for anyone with JavaScript blocked, on a
// slow first paint, or reading the HTML source. The markers keep the page hand-editable —
// everything outside them is written by hand and never touched here.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(__dirname, '..', 'index.html');
const MANIFEST = path.join(__dirname, 'assets', 'manifest.json');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function replaceRegion(html, name, body) {
  const start = `<!-- ${name}:START -->`, end = `<!-- ${name}:END -->`;
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a === -1 || b === -1) throw new Error(`index.html is missing the ${name} markers`);
  return html.slice(0, a + start.length) + body + html.slice(b);
}

function gallery(pairs) {
  if (!pairs.length) return null;
  return `\n${pairs.map((p, i) => {
    const cap = p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : '';
    return `      <figure class="ba">
        <div class="ba-stage" style="--x:50%">
          <img src="${p.after.src}" alt="After: the same photo graded in Chromasmith" loading="lazy" width="${p.after.w}" height="${p.after.h}">
          <img class="b" src="${p.before.src}" alt="Before: the original camera file" loading="lazy" width="${p.before.w}" height="${p.before.h}">
          <span class="ba-handle"></span>
          <span class="ba-tag l">Before</span><span class="ba-tag r">After</span>
          <input type="range" min="0" max="100" value="50" aria-label="Reveal the edited version of sample photo ${i + 1}">
        </div>${cap}
      </figure>`;
  }).join('\n')}\n    `;
}

const html0 = await readFile(PAGE, 'utf8');
let manifest = { hero: null, pairs: [] };
try { manifest = JSON.parse(await readFile(MANIFEST, 'utf8')); }
catch { console.log('No site/assets/manifest.json — run node site/build-assets.mjs first.'); }

let html = html0;
const g = gallery(manifest.pairs || []);
if (g) html = replaceRegion(html, 'GALLERY', `\n    <div class="ba-grid">${g}</div>\n    `);
if (manifest.hero) {
  html = replaceRegion(html, 'HERO-IMG',
    `<div class="hero-img" style="background-image:url('${manifest.hero.src}'),url('${manifest.hero.lqip}')"></div>`);
}
if (html === html0) { console.log('index.html unchanged.'); process.exit(0); }
await writeFile(PAGE, html);
console.log(`index.html updated — hero: ${manifest.hero ? 'yes' : 'no'}, pairs: ${(manifest.pairs || []).length}`);
