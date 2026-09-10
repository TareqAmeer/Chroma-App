// One-off tool: bundles the component sheet + all panel compare pages into a single
// self-contained HTML file for publishing as a shareable Artifact — the localhost preview
// server only works on the machine it's running on, not from another device.
//
// Inlines every design-system token CSS file so nothing depends on a relative path or a
// running server. Font @font-face declarations are deliberately dropped, not inlined: they
// point at local .otf files an Artifact sandbox can never fetch, and the app's own font stack
// already falls back to system-ui/-apple-system, which reads close enough to SF Pro for a
// design review. Each source page's own <style> block is concatenated as-is (some duplication
// across pages is harmless — they share the same class vocabulary and token values).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PANELS_DIR = path.join(ROOT, 'chromasmith-design/project/panels');
const DS_DIR = path.join(ROOT, 'chromasmith-design/project/_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens');

const PAGES = [
  { file: '_components.compare.html', slug: 'components', label: 'Components' },
  { file: 'color.compare.html', slug: 'color', label: 'Color' },
  { file: 'detail.compare.html', slug: 'detail', label: 'Detail' },
  { file: 'film.compare.html', slug: 'film', label: 'Film' },
  { file: 'frame.compare.html', slug: 'frame', label: 'Frame' },
  { file: 'crop.compare.html', slug: 'crop', label: 'Crop' },
  { file: 'retouch.compare.html', slug: 'retouch', label: 'Retouch' },
  { file: 'masks.compare.html', slug: 'masks', label: 'Masks' },
  { file: 'export.compare.html', slug: 'export', label: 'Export' },
  { file: 'info.compare.html', slug: 'info', label: 'Info' },
];

function extract(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}

const tokenFiles = ['colors.css', 'typography.css', 'spacing.css', 'radius.css', 'elevation.css', 'base.css'];
const tokenCss = (await Promise.all(tokenFiles.map((f) => readFile(path.join(DS_DIR, f), 'utf8')))).join('\n');

let allStyle = '';
let allBodySections = '';
const navItems = [];

for (const [i, p] of PAGES.entries()) {
  const html = await readFile(path.join(PANELS_DIR, p.file), 'utf8');
  const style = extract(html, 'style');
  const body = extract(html, 'body');
  allStyle += `\n/* ── from ${p.file} ── */\n${style}\n`;
  allBodySections += `<section class="page" data-page="${p.slug}"${i === 0 ? '' : ' hidden'}>${body}</section>\n`;
  navItems.push(p);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Chromasmith Editor — panel redesign review</title>
<style>
${tokenCss}
${allStyle}
/* ── Aggregate nav chrome (not from any source page) ───────────────────────────────── */
:root{color-scheme:dark}
body{margin:0}
.nav{position:sticky;top:0;z-index:50;display:flex;gap:2px;flex-wrap:wrap;padding:10px 16px;
  background:#141416;border-bottom:1px solid rgba(255,255,255,.1)}
.nav button{font:inherit;font-size:12px;color:var(--ink-on-dark-muted, #ccc);background:none;
  border:none;border-radius:6px;padding:7px 12px;cursor:pointer}
.nav button:hover{background:rgba(255,255,255,.08)}
.nav button.on{background:rgba(97,160,175,.22);color:#fff}
.page[hidden]{display:none}
</style>
</head>
<body>
<nav class="nav">
${navItems.map((p, i) => `<button data-nav="${p.slug}"${i === 0 ? ' class="on"' : ''}>${p.label}</button>`).join('\n')}
</nav>
${allBodySections}
<script>
document.querySelectorAll('.nav button').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll('.page').forEach(x=>x.hidden=true);
    b.classList.add('on');
    document.querySelector('.page[data-page="'+b.dataset.nav+'"]').hidden=false;
    scrollTo(0,0);
  };
});
</script>
</body>
</html>
`;

const outPath = path.join(ROOT, 'test/output/editor_panels_review.html');
await writeFile(outPath, html);
console.log(`Wrote ${path.relative(ROOT, outPath)} (${(html.length / 1024).toFixed(0)} KB, ${PAGES.length} pages)`);
