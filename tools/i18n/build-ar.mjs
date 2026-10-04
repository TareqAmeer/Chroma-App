// Builds the Arabic website under ar/ from the English pages plus tools/i18n/ar.json.
//
//   node tools/i18n/build-ar.mjs          # write ar/*, fail if any English segment has no Arabic
//   node tools/i18n/build-ar.mjs --check  # only report missing segments
//
// The English pages stay hand-written and are the source of truth; ar/ is generated, never
// hand-edited. Every visible segment (found by segments.mjs, the same scan for both steps) must
// have an Arabic entry in ar.json or be listed under "keep" (film stock names, product names),
// so a new English line can't ship untranslated without the build saying so.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSegments } from './segments.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DICT = JSON.parse(readFileSync(path.join(ROOT, 'tools/i18n/ar.json'), 'utf8'));
const PAGES = ['index.html', 'features.html', 'download/mac.html', 'download/windows.html', 'download/ios.html', 'download/android.html'];
const LOCALISED = new Set(PAGES);
const SITE = 'https://tareqameer.github.io/Chroma-App/';
const WORDMARK_AR = 'كرو-ما-سميث';
const CHECK = process.argv.includes('--check');

const escAttr = (s) => s.replace(/&(?![a-z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;');
const escJson = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const escJs = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// A relative URL in an English page, re-pointed for the same page under ar/: links to another
// localised page stay inside ar/, everything else (images, scripts, the app) points back out.
function relink(url, page) {
  if (!url || /^(#|[a-z][a-z0-9+.-]*:|\/\/|\/|\$\{)/i.test(url)) return url;
  const from = new URL(page, SITE), to = new URL(url, from);
  if (!to.href.startsWith(SITE)) return url;
  let target = decodeURIComponent(to.pathname.slice(new URL(SITE).pathname.length));
  if ((target === '' || target.endsWith('/')) && LOCALISED.has(target + 'index.html')) target += 'index.html';
  const dest = LOCALISED.has(target) ? 'ar/' + target : target;
  if (dest.endsWith('/')) return path.posix.relative(path.posix.dirname('ar/' + page), dest) + '/' + to.search + to.hash;
  let rel = path.posix.relative(path.posix.dirname('ar/' + page), dest);
  if (LOCALISED.has(target)) rel = rel.replace(/(^|\/)index\.html$/, '$1') || './';
  return rel + to.search + to.hash;
}

function relinkHtml(html, page) {
  const one = (u) => relink(u, page);
  html = html.replace(/\s(src|href|poster|action|data-src)="([^"]*)"/g, (m, a, u) => ` ${a}="${one(u)}"`);
  html = html.replace(/\ssrcset="([^"]*)"/g, (m, v) => ` srcset="${v.split(',').map((p) => { const [u, ...r] = p.trim().split(/\s+/); return [one(u), ...r].join(' '); }).join(', ')}"`);
  html = html.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, u) => `url(${q}${one(u)}${q})`);
  // asset paths held in inline-script strings (gallery data, analytics loader)
  html = html.replace(/(['"`])((?:\.\.\/)*(?:site|vendor|assets|download)\/(?:[\w./-]+\.\w+|[\w./-]*\/)|chromasmith-22\.html)\1/g, (m, q, u) => q + one(u) + q);
  return html;
}

const ARABIC_CSS = (fontUrl) => `<style id="ar-locale">
@font-face{font-family:"Noto Kufi Arabic";font-weight:400 800;src:url(${fontUrl}) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200F;font-display:swap}
html[lang=ar] body *{letter-spacing:0!important}
html[lang=ar] .en-mark{display:block;font-size:.4em;line-height:1.2;opacity:.75;direction:ltr;letter-spacing:.06em!important;margin-top:.15em}
html[lang=ar] .word .t,html[lang=ar] .w{line-height:1.15}
html[lang=ar] .intro .name{line-height:1.25;padding-bottom:.12em}
/* Kufi has tall ascenders and deep descenders: the Latin display line-heights (.78-.98) overlap */
html[lang=ar] .k,html[lang=ar] .hero-t,html[lang=ar] .lookn,html[lang=ar] .fl .k,html[lang=ar] .outro .k,html[lang=ar] .stagew span,html[lang=ar] .lbar .gt,html[lang=ar] .bigword{line-height:1.2}
html[lang=ar] .big{line-height:1.05}
html[lang=ar] .bigword-en{direction:ltr;text-align:right;font-weight:700;font-size:2.6vw;letter-spacing:.08em!important;color:#0b0b0a;margin-top:.4em}
html[lang=ar] .intro .name-en{font-size:clamp(14px,2.2vw,34px);font-weight:700;letter-spacing:.08em!important;direction:ltr;color:var(--dim)}
/* scroll-driven tour positions things in JS with left-to-right maths: keep its frame LTR, text RTL */
html[lang=ar] .pin{direction:ltr}
html[lang=ar] .pin .panel{direction:rtl}
html[lang=ar] .langsw{font-family:Gramatika,system-ui,sans-serif}
</style>`;

const missing = new Map();
for (const page of PAGES) {
  let html = readFileSync(path.join(ROOT, page), 'utf8');
  const segs = findSegments(html);
  let out = '', last = 0;
  for (const s of segs) {
    out += html.slice(last, s.start);
    let ar = DICT.strings[s.text];
    if (ar === undefined) {
      if (!DICT.keep.includes(s.text)) missing.set(s.text, page);
      ar = s.text;
    } else if (s.kind === 'text' && s.text === 'CHRO-MA-SMITH') {
      ar = `${WORDMARK_AR}<small class="en-mark" lang="en">CHRO-MA-SMITH</small>`;
    } else if (s.kind === 'attr') ar = escAttr(ar);
    else if (s.kind === 'jsonld') ar = escJson(ar);
    else if (s.kind === 'js') ar = escJs(ar);
    out += ar;
    last = s.end;
  }
  html = out + html.slice(last);

  // single-word UI strings inside inline scripts (chip labels, button states)
  html = html.replace(/(<script(?![^>]*ld\+json)[^>]*>)([\s\S]*?)(<\/script>)/g, (m, a, body, c) =>
    a + body.replace(/'([A-Z][A-Za-z-]+)'/g, (q, w) => (DICT.jsWords[w] ? `'${escJs(DICT.jsWords[w])}'` : q)) + c);

  // aria-labels inside HTML strings that scripts inject (lightbox buttons)
  html = html.replace(/(<script(?![^>]*ld\+json)[^>]*>)([\s\S]*?)(<\/script>)/g, (m, a, body, c) =>
    a + body.replace(/aria-label="([^"]+)"/g, (q, w) => (DICT.strings[w] ? `aria-label="${escJs(escAttr(DICT.strings[w]))}"` : q)) + c);

  // scripts that split headings into letters would break Arabic joins: animate whole words instead
  html = html.split("[...wd].map(c=>'<i>'+c+'</i>').join('')").join("'<i>'+wd+'</i>'");

  // intro wordmark: whole syllables, not letters, so the Arabic letters stay joined
  html = html.replace(/<div class="name">(?:<span>[^<]*<\/span>)+<\/div>/,
    `<div class="name">${WORDMARK_AR.split(/(?<=-)/).map((p) => `<span>${p}</span>`).join('')}</div><div class="name-en" lang="en">CHRO-MA-SMITH</div>`);

  html = html.replace(/(<div class="bigword"[^>]*>(?:<span>[^<]*<\/span>)+<\/div>)/, '$1<div class="bigword-en" lang="en" aria-hidden="true">CHRO-MA-SMITH</div>');

  const depth = page.split('/').length;               // ar/ + any subfolder
  const up = '../'.repeat(depth);
  html = relinkHtml(html, page);
  html = html.replace(/<html lang="en">/, '<html lang="ar" dir="rtl">');
  html = html.split('assets/brand/og-image.jpeg').join('assets/brand/og-image-ar.jpeg');   // Arabic link-preview card (site/og/og-ar.html)
  html = html.replace(/(@font-face\{[^}]*\})|font-family:Gramatika(?=[,;}])/g, (m, ff) => ff || "font-family:Gramatika,'Noto Kufi Arabic'");
  const enUrl = SITE + page.replace(/(^|\/)index\.html$/, '$1');
  const arUrl = SITE + 'ar/' + page.replace(/(^|\/)index\.html$/, '$1');
  html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${arUrl}">`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*"/, `$1${arUrl}"`);
  html = html.replace(/<link rel="alternate" hreflang="[^>]*>\n?/g, '');
  html = html.replace('</head>', `<link rel="alternate" hreflang="en" href="${enUrl}">\n<link rel="alternate" hreflang="ar" href="${arUrl}">\n<link rel="alternate" hreflang="x-default" href="${enUrl}">\n<meta property="og:locale" content="ar_AR">\n${ARABIC_CSS(up + 'vendor/fonts/noto-kufi-arabic/NotoKufiArabic-arabic.woff2')}\n</head>`);
  // language switcher: the English pages carry <a class="langsw" ...>عربي</a>; point it back
  html = html.replace(/<a class="langsw"[^>]*>[^<]*<\/a>/g, `<a class="langsw" href="${up}${page.replace(/(^|\/)index\.html$/, '$1')}" lang="en" hreflang="en">English</a>`);

  if (!CHECK) {
    const dest = path.join(ROOT, 'ar', page);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, html.replace(/^(<!doctype html>\n?)/i, `$1<!-- GENERATED by tools/i18n/build-ar.mjs from ${page} + tools/i18n/ar.json. Do not edit. -->\n`));
  }
}

if (missing.size) {
  console.error(`${missing.size} English segment(s) have no Arabic in tools/i18n/ar.json:`);
  for (const [t, p] of missing) console.error(`  [${p}] ${t}`);
  process.exit(1);
}
console.log(CHECK ? 'ar: every segment translated' : `ar: built ${PAGES.length} pages`);
