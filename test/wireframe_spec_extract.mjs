// Extracts design/specs/<panel>.json from the wireframe (Editor (Developer) View.dc.html).
// Shape matches design/asbuilt/<id>/spec.json (S6c): {id, group, generatedAt, tree, unmapped}.
// Each node: {tag, classes, style: {prop: {value, token, appVar, role}}, children, dataApp}.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT = process.cwd();
const WF_PATH = 'chromasmith-design/project/Editor (Developer) View.dc.html';
const TOKENS_PATH = 'design/tokens.json';
const OUT_DIR = 'design/specs';

const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.webp': 'image/webp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const port = server.address().port;

const tokens = JSON.parse(await readFile(path.join(ROOT, TOKENS_PATH), 'utf8'));

// Build token lookup: {value → {token, appVar, role}} grouped by role family
function buildTokenMap(tokensObj, prefix = '') {
  const map = [];
  for (const [key, val] of Object.entries(tokensObj)) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (val.$value !== undefined) {
      const ext = val.$extensions?.chromasmith || {};
      map.push({ path, value: val.$value, appVar: ext.appVar, role: ext.role, type: val.$type });
    } else if (typeof val === 'object' && !key.startsWith('$')) {
      map.push(...buildTokenMap(val, path));
    }
  }
  return map;
}
const tokenEntries = buildTokenMap(tokens);

// Role families for matching
const ROLE_FAMILIES = {
  fontSize: ['typography', 'fontSize', 'fs'],
  padding: ['spacing', 'sp'],
  paddingTop: ['spacing', 'sp'],
  paddingBottom: ['spacing', 'sp'],
  paddingLeft: ['spacing', 'sp'],
  paddingRight: ['spacing', 'sp'],
  gap: ['spacing', 'sp'],
  rowGap: ['spacing', 'sp'],
  columnGap: ['spacing', 'sp'],
  margin: ['spacing', 'sp'],
  marginTop: ['spacing', 'sp'],
  marginBottom: ['spacing', 'sp'],
  marginLeft: ['spacing', 'sp'],
  marginRight: ['spacing', 'sp'],
  borderRadius: ['radius', 'r'],
  color: ['color'],
  backgroundColor: ['color', 'surface'],
  borderColor: ['color', 'border'],
  outlineColor: ['color'],
};

function matchToken(value, cssProp) {
  if (!value || value === 'none' || value === 'auto' || value === 'normal') return null;
  const families = ROLE_FAMILIES[cssProp] || [];
  // Exact value match within role family
  for (const t of tokenEntries) {
    if (!t.role) continue;
    const roleParts = t.role.toLowerCase().split('.');
    if (families.some(f => roleParts.some(rp => rp.includes(f)))) {
      if (normalizeValue(t.value) === normalizeValue(value)) {
        return { token: t.path, appVar: t.appVar, role: t.role };
      }
    }
  }
  // Fallback: exact value match ignoring role
  for (const t of tokenEntries) {
    if (normalizeValue(t.value) === normalizeValue(value)) {
      return { token: t.path, appVar: t.appVar, role: t.role };
    }
  }
  return null;
}

function normalizeValue(v) {
  if (typeof v !== 'string') return String(v);
  return v.replace(/\s+/g, ' ').trim().toLowerCase();
}

const STYLE_PROPS = [
  'color', 'backgroundColor', 'borderColor', 'outlineColor',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap',
  'borderRadius', 'borderWidth',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'opacity',
  'boxShadow',
  'transition',
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/${WF_PATH}`);
await page.waitForLoadState('domcontentloaded');

// Extract tree for each panel
const panels = await page.evaluate((styleProps) => {
  function extractTree(el, depth = 0) {
    if (depth > 15) return null;
    const cs = getComputedStyle(el);
    const style = {};
    for (const prop of styleProps) {
      const val = cs[prop];
      if (val) style[prop] = val;
    }

    const node = {
      tag: el.tagName.toLowerCase(),
      classes: [...el.classList],
      style,
    };

    if (el.dataset.fxsec) node.dataFxsec = el.dataset.fxsec;
    if (el.dataset.app) node.dataApp = el.dataset.app;
    if (el.dataset.note) node.dataNote = el.dataset.note;
    if (el.id) node.id = el.id;
    if (el.dataset.panel) node.dataPanel = el.dataset.panel;

    const children = [];
    for (const child of el.children) {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
      const c = extractTree(child, depth + 1);
      if (c) children.push(c);
    }
    if (children.length) node.children = children;

    return node;
  }

  const result = {};
  for (const panel of document.querySelectorAll('.tp-panel[data-panel]')) {
    const key = panel.dataset.panel;
    result[key] = extractTree(panel);
  }
  return result;
}, STYLE_PROPS);

await mkdir(path.join(ROOT, OUT_DIR), { recursive: true });

let unmappedTotal = 0;
const panelKeys = Object.keys(panels);

for (const key of panelKeys) {
  const tree = panels[key];

  // Apply token matching to all style values
  let unmapped = 0;
  function applyTokens(node) {
    if (node.style) {
      const newStyle = {};
      for (const [prop, value] of Object.entries(node.style)) {
        const match = matchToken(value, prop);
        if (match) {
          newStyle[prop] = { value, token: match.token, appVar: match.appVar, role: match.role };
        } else {
          newStyle[prop] = { value, token: null };
          unmapped++;
        }
      }
      node.style = newStyle;
    }
    if (node.children) node.children.forEach(applyTokens);
  }
  applyTokens(tree);

  const spec = {
    id: key,
    group: 'wireframe',
    generatedAt: new Date().toISOString(),
    tree,
    unmapped,
  };

  await writeFile(
    path.join(ROOT, OUT_DIR, `${key}.json`),
    JSON.stringify(spec, null, 2)
  );

  unmappedTotal += unmapped;
  console.log(`  ${key}: ${unmapped} unmapped style decls`);
}

console.log(`\nWrote ${panelKeys.length} specs to ${OUT_DIR}/`);
console.log(`Total unmapped: ${unmappedTotal}`);

await browser.close();
server.close();
