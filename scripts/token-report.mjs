// Visual token report: renders design/tokens.json as a browsable catalogue (Colors / Typography /
// Layout) and cross-checks chromasmith-22.html's <style> block for font-family / font-size /
// font-weight / line-height literals that don't byte-match any :root token — the font-side
// counterpart to test/editor_token_check.mjs (which covers colour/spacing/radius only).
//
// Usage: node scripts/token-report.mjs
// Output: scripts/token-report.html (open directly in a browser; not published anywhere)
//
// Strictness: same rule as editor_token_check.mjs — a value is "matched" only if it is
// byte-identical (after whitespace/case normalization) to a :root custom-property value. A
// legitimate one-off (e.g. `line-height: 1` as a CSS keyword-ish reset) is not auto-allowlisted;
// triage findings same as the color/spacing check.
import { readFileSync, writeFileSync } from 'node:fs';

const tokensDoc = JSON.parse(readFileSync('design/tokens.json', 'utf8'));
const html = readFileSync('chromasmith-22.html', 'utf8');
const componentsDoc = JSON.parse(readFileSync('design/components.json', 'utf8'));
const componentsRuntimeDoc = JSON.parse(readFileSync('design/components-runtime.json', 'utf8'));
let libraryUiJs = '';
try { libraryUiJs = readFileSync('desktop/library-ui.js', 'utf8'); } catch { /* optional */ }

// ---------- 1. Flatten design/tokens.json into a catalogue ----------
// Color category taxonomy: every token's $extensions.chromasmith.role prefix maps to one of the
// 4 buckets the report groups colors into. Falls back to 'other' rather than silently dropping a
// token that doesn't fit — 'other' is rendered too, at the end of the Colors tab, so nothing goes
// missing just because a future role prefix isn't in this list yet.
function categorizeRole(role) {
  if (!role) return 'other';
  if (role.startsWith('action.') || role.startsWith('state.')) return 'brand';
  if (role.startsWith('surface.') || role.startsWith('interaction.') || role.startsWith('component.')) return 'surfaces';
  if (role.startsWith('text.')) return 'text';
  if (role.startsWith('border.')) return 'borders';
  if (role.startsWith('scrim.')) return 'scrims';
  return 'other';
}
const CATEGORY_LABEL = { brand: 'Brand & Accent', surfaces: 'Surfaces', text: 'Text', borders: 'Borders & Hairlines', scrims: 'Scrims & Shadows', other: 'Other' };

const catalogue = { color: [], fontFamily: [], fontSize: [], fontWeight: [], lineHeight: [], dimension: [], other: [] };
(function walk(o, path) {
  if (Array.isArray(o)) return;
  if (o && typeof o === 'object') {
    if ('$type' in o && '$value' in o) {
      const ext = (o.$extensions && o.$extensions.chromasmith) || {};
      const entry = {
        path, type: o.$type, value: String(o.$value), desc: o.$description || '',
        role: ext.role || null,
        appVar: ext.appVar || null,
        modes: ext.modes || null, // { light, dark } when the app value actually swaps by theme
      };
      if (o.$type === 'color') { entry.category = categorizeRole(entry.role); catalogue.color.push(entry); }
      else if (o.$type === 'fontFamily') catalogue.fontFamily.push(entry);
      else if (o.$type === 'fontWeight') catalogue.fontWeight.push(entry);
      else if (o.$type === 'dimension' && /(^|\/)typography\/size(\/|$)/.test(path)) catalogue.fontSize.push(entry);
      else if (o.$type === 'number' && /(^|\/)typography\/lineHeight(\/|$)/.test(path)) catalogue.lineHeight.push(entry);
      else if (o.$type === 'dimension') catalogue.dimension.push(entry);
      else catalogue.other.push(entry);
      return;
    }
    for (const k of Object.keys(o)) {
      if (k.startsWith('$')) continue;
      walk(o[k], path ? `${path}/${k}` : k);
    }
  }
})(tokensDoc, '');

// ---------- 1b. Resolve var(--x) aliases to their literal value for display ----------
// A token's own $value/modes can be `var(--blue-slate)` (an alias to another token's appVar)
// rather than a literal — that renders as a blank swatch otherwise, so follow the chain.
const byAppVar = new Map();
for (const e of catalogue.color) if (e.appVar) byAppVar.set(e.appVar, e);
const byAppVarAny = new Map();
for (const list of [catalogue.color, catalogue.fontFamily, catalogue.fontSize, catalogue.fontWeight, catalogue.dimension]) {
  for (const e of list) if (e.appVar) byAppVarAny.set(e.appVar, e);
}
function resolveAny(val, depth = 0) {
  if (!val || depth > 10) return val;
  const m = String(val).trim().match(/^var\((--[a-zA-Z0-9-]+)\)$/);
  if (!m) return val;
  const target = byAppVarAny.get(m[1]);
  if (!target) return val;
  return resolveAny(target.value, depth + 1);
}
function resolvedLiteral(val, mode) {
  let cur = val;
  for (let i = 0; i < 10; i++) {
    const m = String(cur).trim().match(/^var\((--[a-zA-Z0-9-]+)\)$/);
    if (!m) return cur;
    const target = byAppVar.get(m[1]);
    if (!target) return cur;
    cur = mode && target.modes && target.modes[mode] ? target.modes[mode] : target.value;
  }
  return cur;
}

// ---------- 2. Extract :root tokens from the live app CSS ----------
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) { console.log('FAIL: no <style> block found in chromasmith-22.html'); process.exit(1); }
let css = styleMatch[1].replace(/url\(data:[^)]*\)/g, 'url(DATA_URI_STRIPPED)');
css = css.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments so they never get scanned as a selector/decl

const rootBlocks = [...css.matchAll(/:root(?:\.[a-zA-Z-]+)?\s*\{([^}]*)\}/g)].map((m) => m[1]);
const fontFamilyTokens = new Set();
const fontSizeTokens = new Set();
const fontWeightTokens = new Set();
const lineHeightTokens = new Set();
for (const block of rootBlocks) {
  for (const decl of block.split(';')) {
    const m = decl.match(/--([a-zA-Z0-9-]+)\s*:\s*(.+)/);
    if (!m) continue;
    const [, name, rawVal] = m;
    const val = rawVal.trim();
    const lname = name.toLowerCase();
    if (/font(-family)?$|^font$/.test(lname) || lname.includes('font-family') || lname.includes('font-text') || lname.includes('font-display')) {
      fontFamilyTokens.add(val.toLowerCase().replace(/\s+/g, ' '));
    }
    if (/^fs-|font-size|^fs$/.test(lname)) fontSizeTokens.add(val.toLowerCase());
    if (/^fw-|font-weight/.test(lname)) fontWeightTokens.add(val.toLowerCase());
    if (/line-height|^lh-/.test(lname)) lineHeightTokens.add(val.toLowerCase());
  }
}

// ---------- 2a2. Spacing/radius px tokens (:root literals + dimension catalogue) — same rule as
// test/editor_token_check.mjs's spacing pass, so the visual report and the CLI gate agree. ----------
const pxTokens = new Set();
for (const block of rootBlocks) {
  for (const decl of block.split(';')) {
    const m = decl.match(/--[a-zA-Z0-9-]+\s*:\s*(.+)/);
    if (!m) continue;
    const val = m[1].trim().toLowerCase();
    if (/^-?\d+(\.\d+)?px$/.test(val)) pxTokens.add(val);
  }
}
for (const e of catalogue.dimension) {
  const v = String(e.value).trim().toLowerCase();
  if (/^-?\d+(\.\d+)?px$/.test(v)) pxTokens.add(v);
}
const ALLOW_SPACING_PX = new Set(['0px', '1px', '2px', '-1px', '-2px']); // hairline/reset values and small negative visual nudges, not a token concept
// Also fold in design/tokens.json's font values (source of truth even if a :root var name doesn't
// self-describe as font-ish, e.g. --font-text / --font-display already caught above by name, but
// catch any dimension-typed size token too).
for (const e of catalogue.fontFamily) fontFamilyTokens.add(e.value.toLowerCase().replace(/\s+/g, ' '));
for (const e of catalogue.fontSize) fontSizeTokens.add(e.value.toLowerCase());
for (const e of catalogue.fontWeight) fontWeightTokens.add(String(e.value).toLowerCase());

// ---------- 2b. Approved color set (both :root/body.light literals AND tokens.json's own values) ----------
const ALLOW_COLORS = new Set(['#fff', '#ffffff', '#000', '#000000', 'transparent', 'currentcolor']);
function normColor(v) { return v.trim().toLowerCase().replace(/\s+/g, ''); }
const approvedColors = new Set();
for (const block of rootBlocks) {
  for (const decl of block.split(';')) {
    const m = decl.match(/--[a-zA-Z0-9-]+\s*:\s*(.+)/);
    if (!m) continue;
    const val = m[1].trim().toLowerCase();
    if (/^#[0-9a-f]{3,8}$/.test(val) || /^rgba?\(/.test(val)) approvedColors.add(val.replace(/\s+/g, ''));
  }
}
const bodyLightBlocks = [...css.matchAll(/body\.light\s*\{([^}]*)\}/g)].map((m) => m[1]);
for (const block of bodyLightBlocks) {
  for (const decl of block.split(';')) {
    const m = decl.match(/--[a-zA-Z0-9-]+\s*:\s*(.+)/);
    if (!m) continue;
    const val = m[1].trim().toLowerCase();
    if (/^#[0-9a-f]{3,8}$/.test(val) || /^rgba?\(/.test(val)) approvedColors.add(val.replace(/\s+/g, ''));
  }
}
for (const e of catalogue.color) {
  approvedColors.add(normColor(e.value));
  if (e.modes) { if (e.modes.light) approvedColors.add(normColor(e.modes.light)); if (e.modes.dark) approvedColors.add(normColor(e.modes.dark)); }
}

// ---------- 2c. Unapproved-color heuristic categorizer (selector/prop based, same spirit as
// editor_token_check.mjs's ROLE_HINTS — advisory, not a guarantee) ----------
function categorizeFinding(selector, prop, value) {
  const s = selector.toLowerCase();
  const p = prop.toLowerCase();
  const isNeutral = value && /^(#fff|#000|rgba?\(0,0,0|rgba?\(255,255,255)/i.test(value.trim());
  if (/primary|accent|\bbpri\b|export|danger|destructive|\berr\b|success|\bok\b|warning|\bwarn\b/.test(s)) return 'brand';
  // Shadows/elevation and neutral black/white overlays are the "scrim scale" family, not a
  // brand-color or border-hairline concern — same split the design/tokens.json scrim category uses.
  if (p === 'box-shadow' || isNeutral) return 'scrims';
  if (/^border|outline-color/.test(p) || /bdr|border|hairline|divider/.test(s)) return 'borders';
  if (/^color$|^fill$|^stroke$/.test(p)) return 'text';
  if (/^background/.test(p)) return 'surfaces';
  return 'other';
}
const ruleBodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => !/:root/.test(m[1]) && !/@font-face/i.test(m[1]))
  .map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));

const spacingFindings = [];
for (const { selector, body } of ruleBodies) {
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, prop, rawVal] = m;
    if (rawVal.includes('var(--')) continue;
    if (!/^(border-radius|gap|padding|margin|row-gap|column-gap)$/i.test(prop) && !/^border(-top|-bottom|-left|-right)?(-left|-right)?-radius$/i.test(prop)) continue;
    const pxMatches = rawVal.match(/-?\d+(\.\d+)?px/g) || [];
    for (const px of pxMatches) {
      if (ALLOW_SPACING_PX.has(px)) continue;
      if (!pxTokens.has(px)) spacingFindings.push({ kind: 'spacing', selector, prop, value: px });
    }
  }
}

const colorFindings = [];
for (const { selector, body } of ruleBodies) {
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, prop, rawVal] = m;
    if (rawVal.includes('var(--')) continue;
    const lprop = prop.toLowerCase();
    if (!/^(color|background|background-color|border-color|border|box-shadow|fill|stroke|outline-color)$/.test(lprop) && !/border(-top|-bottom|-left|-right)?-color/.test(lprop)) continue;
    const hexMatches = rawVal.match(/#[0-9a-fA-F]{3,8}/g) || [];
    const rgbaMatches = rawVal.match(/rgba?\([^)]*\)/g) || [];
    for (const hex of hexMatches) {
      const norm = hex.toLowerCase();
      if (ALLOW_COLORS.has(norm) || approvedColors.has(norm)) continue;
      colorFindings.push({ selector, prop, value: hex, category: categorizeFinding(selector, prop, hex) });
    }
    for (const rgba of rgbaMatches) {
      const norm = normColor(rgba);
      if (approvedColors.has(norm)) continue;
      colorFindings.push({ selector, prop, value: rgba, category: categorizeFinding(selector, prop, rgba) });
    }
  }
}

// ---------- 3. Scan rule bodies (non :root) for font literals not matching a token ----------
const ALLOW_LINE_HEIGHT = new Set(['normal', 'inherit', '1']); // unitless resets, not a token concept
const findings = [];
for (const { selector, body } of ruleBodies) {
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, prop, rawVal] = m;
    if (rawVal.includes('var(--')) continue; // already token-driven
    const lprop = prop.toLowerCase();
    const val = rawVal.trim();
    const lval = val.toLowerCase().replace(/\s+/g, ' ');

    if (lprop === 'font-family') {
      if (!fontFamilyTokens.has(lval)) findings.push({ kind: 'font-family', selector, prop, value: val });
    } else if (lprop === 'font-size') {
      if (!fontSizeTokens.has(lval)) findings.push({ kind: 'font-size', selector, prop, value: val });
    } else if (lprop === 'font-weight') {
      if (!fontWeightTokens.has(lval)) findings.push({ kind: 'font-weight', selector, prop, value: val });
    } else if (lprop === 'line-height') {
      if (!ALLOW_LINE_HEIGHT.has(lval) && !lineHeightTokens.has(lval)) findings.push({ kind: 'line-height', selector, prop, value: val });
    } else if (lprop === 'font') {
      // shorthand `font: <weight> <size>/<lh> <family>` — flag as a single finding for review
      findings.push({ kind: 'font-shorthand', selector, prop, value: val });
    }
  }
}

// ---------- 3b. Components: reuse design/components.json (static registry) + design/components-
// runtime.json (983 real-page appearances from test/component_runtime_check.mjs's Playwright
// sweep across 18 app states) rather than rescanning the app — same data `npm run components:check`
// already gates on. ----------
const componentFamilies = Object.entries(componentsDoc.families).map(([name, def]) => {
  const instances = componentsDoc.instances.filter((i) => i.family === name);
  return { name, ...def, instances };
});
const componentCoverage = componentsDoc.coverage || {};
const runtimeUnresolved = componentsRuntimeDoc.unresolved || [];
const runtimeVariants = componentsRuntimeDoc.variants || [];

// ---------- 3c. Icons: parse the ICONS glyph map + every static icon('name',size)/ic('name',size)
// call site in chromasmith-22.html and desktop/library-ui.js, then cross-reference. Ternary
// literals (`cond?'a':'b'`) are split into both branches; a call whose argument isn't a string
// literal (a variable) is counted as "dynamic" — informational, not a violation, since it may
// still resolve to any ICONS key at runtime. ----------
const iconsMatch = html.match(/const ICONS=\{([\s\S]*?)\n\};/);
const ICONS = {};
if (iconsMatch) {
  const block = iconsMatch[1];
  const re = /(?:^|\n)\s*(?:\/\/[^\n]*\n\s*)*([a-zA-Z0-9_]+):'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(block))) ICONS[m[1]] = m[2];
}
const iconUsage = new Map(); // name -> [{file, calls}]
function recordIconUse(name, file) {
  if (!iconUsage.has(name)) iconUsage.set(name, new Set());
  iconUsage.get(name).add(file);
}
const iconCallFindings = []; // calls that don't statically resolve to a known ICONS key
let dynamicIconCallCount = 0;
for (const [file, src] of [['chromasmith-22.html', html], ['desktop/library-ui.js', libraryUiJs]]) {
  if (!src) continue;
  const callRe = /\b(?:icon|ic)\(([^)]*)\)/g;
  let cm;
  while ((cm = callRe.exec(src))) {
    const args = cm[1];
    const literalMatch = args.match(/^\s*['"]([a-zA-Z0-9_-]+)['"]/);
    const ternaryMatch = args.match(/^\s*[^?]*\?\s*['"]([a-zA-Z0-9_-]+)['"]\s*:\s*['"]([a-zA-Z0-9_-]+)['"]/);
    if (ternaryMatch) {
      for (const name of [ternaryMatch[1], ternaryMatch[2]]) {
        if (ICONS[name] !== undefined) recordIconUse(name, file);
        else iconCallFindings.push({ file, call: cm[0], name });
      }
    } else if (literalMatch) {
      const name = literalMatch[1];
      if (ICONS[name] !== undefined) recordIconUse(name, file);
      else iconCallFindings.push({ file, call: cm[0], name });
    } else {
      dynamicIconCallCount++;
    }
  }
}
const iconEntries = Object.entries(ICONS).map(([name, path]) => ({
  name, path, usedIn: [...(iconUsage.get(name) || [])],
})).sort((a, b) => (b.usedIn.length - a.usedIn.length) || a.name.localeCompare(b.name));
const orphanIcons = iconEntries.filter((e) => e.usedIn.length === 0);

// ---------- 4. Render HTML report ----------
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function swatch(name, value, displayValue) {
  const shown = displayValue || value;
  return `
    <div class="swatch">
      <div class="chip" style="background:${esc(value)}"></div>
      <div class="chip-path">${esc(name)}</div>
      <div class="chip-val">${esc(shown)}</div>
    </div>`;
}

// Merge swatches that resolve to the identical value: one chip, all its token paths listed
// underneath (1:1 duplicates read as one fact — "these N names are the same color" — instead of
// N separate, easy-to-miss identical-looking chips).
function groupedSwatches(items) {
  const byValue = new Map(); // value -> [names]
  for (const { name, value } of items) {
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(name);
  }
  return [...byValue.entries()].map(([value, names]) => `
    <div class="swatch">
      <div class="chip" style="background:${esc(value)}"></div>
      <div class="chip-val">${esc(value)}</div>
      ${names.map((n) => `<div class="chip-path">${esc(n)}</div>`).join('')}
    </div>`).join('');
}

// A token whose own value (or either mode) is just `var(--otherAppVar)` is a pure passthrough
// alias — same literal color as the token it points to, just a different name. The user asked
// these be hidden entirely (not resolved-and-shown), since they read as confusing duplicates.
function isAliasEntry(e) {
  const raw = [e.value, e.modes && e.modes.light, e.modes && e.modes.dark].filter(Boolean);
  return raw.some((v) => /^var\(--/.test(String(v).trim()));
}

function colorSections() {
  const order = ['brand', 'surfaces', 'text', 'borders', 'scrims', 'other'];
  return order.filter((cat) => catalogue.color.some((e) => e.category === cat && !isAliasEntry(e)) || colorFindings.some((f) => f.category === cat)).map((cat) => {
    const entries = catalogue.color.filter((e) => e.category === cat && !isAliasEntry(e));
    const light = groupedSwatches(entries.map((e) => ({ name: e.path, value: resolvedLiteral(e.modes ? e.modes.light : e.value, 'light') })));
    const dark = groupedSwatches(entries.map((e) => ({ name: e.path, value: resolvedLiteral(e.modes ? e.modes.dark : e.value, 'dark') })));
    const unapproved = colorFindings.filter((f) => f.category === cat);
    const unapprovedHtml = unapproved.length
      ? groupedSwatches(unapproved.map((f) => ({ name: `${f.selector} (${f.prop})`, value: f.value })))
      : `<div class="empty-inline">No unapproved literals found in this category.</div>`;
    return `
    <section class="cat-section">
      <h2 class="cat-title">${esc(CATEGORY_LABEL[cat])} <span class="cat-count">${entries.length} token${entries.length === 1 ? '' : 's'}</span></h2>
      <div class="mode-cols">
        <div class="mode-col">
          <div class="mode-label">Light Mode</div>
          <div class="swatch-grid">${light || '<div class="empty-inline">None</div>'}</div>
        </div>
        <div class="mode-col">
          <div class="mode-label">Dark Mode</div>
          <div class="swatch-grid">${dark || '<div class="empty-inline">None</div>'}</div>
        </div>
        <div class="mode-col mode-col-unapproved">
          <div class="mode-label mode-label-bad">Unapproved <span class="cat-count">${unapproved.length}</span></div>
          <div class="swatch-grid">${unapprovedHtml}</div>
        </div>
      </div>
    </section>`;
  }).join('');
}

function typographyRows() {
  return `
    <div class="subhead">Font sizes — 1:1 duplicates merged</div>
    ${groupedTypeRows(
      catalogue.fontSize.map((e) => ({ name: e.path, value: e.value })),
      (value) => `font-size:${parseFloat(value) || 16}px`,
    )}
    <div class="subhead">Font families — typography &amp; designSystem combined, 1:1 duplicates merged</div>
    ${groupedTypeRows(
      catalogue.fontFamily.filter((e) => !isAliasEntry(e)).map((e) => ({ name: e.path, value: resolveAny(e.value) })),
      (value) => `font-family:${esc(value)}`,
    )}
    <div class="subhead">Font weights — typography &amp; designSystem combined, 1:1 duplicates merged</div>
    ${groupedTypeRows(
      catalogue.fontWeight.map((e) => ({ name: e.path, value: String(e.value) })),
      (value) => `font-weight:${esc(value)}`,
      (value) => `weight ${esc(value)}`,
    )}
    <div class="subhead">Line heights — validated against Apple HIG + Adobe Spectrum</div>
    ${groupedTypeRows(
      catalogue.lineHeight.map((e) => ({ name: e.path, value: String(e.value) })),
      (value) => `font-size:16px;line-height:${esc(value)}`,
      (value) => `line-height ${esc(value)}`,
    )}`;
}

// Font families/weights have the same "same value, two names" pattern as colors (a typography/*
// token and a designSystem/* token both declaring the identical face or weight) — quote style
// ('SF Pro Text' vs "SF Pro Text") differs but is CSS-equivalent, so normalize before grouping.
function normalizeFontValue(v) { return String(v).trim().replace(/"/g, "'").toLowerCase(); }
function groupedTypeRows(items, sampleStyle, detailLabel) {
  const byValue = new Map(); // normalized value -> { value, names: [] }
  for (const { name, value } of items) {
    const key = normalizeFontValue(value);
    if (!byValue.has(key)) byValue.set(key, { value, names: [] });
    byValue.get(key).names.push(name);
  }
  return [...byValue.values()].map(({ value, names }) => `
    <div class="type-row">
      <div class="type-meta">
        <div class="type-detail">${detailLabel ? detailLabel(value) : esc(value)}</div>
        ${names.map((n) => `<div class="type-path">${esc(n)}</div>`).join('')}
      </div>
      <div class="type-sample" style="${sampleStyle(value)}">The quick brown fox jumps over the lazy dog</div>
    </div>`).join('');
}

function layoutRows() {
  return catalogue.dimension.map((e) => `
    <div class="layout-row">
      <div class="layout-path">${esc(e.path)}</div>
      <div class="layout-bar-wrap"><div class="layout-bar" style="width:min(${parseFloat(e.value) || 0}px, 100%)"></div></div>
      <div class="layout-val">${esc(e.value)}</div>
    </div>`).join('');
}

function componentSections() {
  const families = componentFamilies.slice().sort((a, b) => b.instances.length - a.instances.length);
  const familyRows = families.map((f) => `
    <div class="comp-row">
      <div class="comp-name">${esc(f.name)}<div class="comp-sub">${esc(f.appleComponent || '')}</div></div>
      <div class="comp-selectors">${(f.selectors || []).map((s) => `<code>${esc(s)}</code>`).join(' ')}</div>
      <div class="comp-count">${f.instances.length}</div>
    </div>`).join('');

  const dynamicList = (componentCoverage.dynamicInstances || []);
  const unstableList = (componentCoverage.withoutStableSelector || []);
  const unresolvedList = runtimeUnresolved;

  function issueList(items, render) {
    if (!items.length) return `<div class="empty-inline">None.</div>`;
    return items.slice(0, 100).map(render).join('') + (items.length > 100 ? `<div class="empty-inline">... and ${items.length - 100} more</div>` : '');
  }

  return `
    <section class="cat-section">
      <h2 class="cat-title">Component Registry <span class="cat-count">${families.length} families, ${componentsDoc.instances.length} static instances</span></h2>
      <div class="comp-table">
        <div class="comp-row comp-head"><div>Family</div><div>Selectors</div><div>Instances</div></div>
        ${familyRows}
      </div>
    </section>
    <section class="cat-section">
      <h2 class="cat-title">Runtime Coverage <span class="cat-count">${componentsRuntimeDoc.appearanceCount} live appearances across ${componentsRuntimeDoc.states?.length || '?'} app states</span></h2>
      <div class="mode-cols">
        <div class="mode-col">
          <div class="mode-label">Variants seen live</div>
          <div class="issue-list">${issueList(runtimeVariants, (v) => `<div class="issue-row"><code>${esc(v)}</code></div>`)}</div>
        </div>
        <div class="mode-col mode-col-unapproved">
          <div class="mode-label mode-label-bad">Dynamic instances <span class="cat-count">${dynamicList.length}</span></div>
          <div class="issue-list">${issueList(dynamicList, (v) => `<div class="issue-row"><code>${esc(v)}</code></div>`)}</div>
        </div>
        <div class="mode-col mode-col-unapproved">
          <div class="mode-label mode-label-bad">Without stable selector <span class="cat-count">${unstableList.length}</span></div>
          <div class="issue-list">${issueList(unstableList, (v) => `<div class="issue-row"><code>${esc(v)}</code></div>`)}</div>
        </div>
      </div>
      <div class="subhead">Runtime-unresolved semantics <span class="cat-count">${unresolvedList.length}</span></div>
      <div class="issue-list">${issueList(unresolvedList, (u) => `<div class="issue-row"><code>${esc(u.state)}</code> ${esc(u.family)} — ${esc(u.semantic)}</div>`)}</div>
    </section>`;
}

function iconGlyph(path) {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function iconSections() {
  const used = iconEntries.filter((e) => e.usedIn.length > 0);
  const orphan = orphanIcons;
  const broken = iconCallFindings;
  return `
    <section class="cat-section">
      <h2 class="cat-title">Icon Set <span class="cat-count">${iconEntries.length} glyphs in ICONS, ${used.length} with a statically-found call site</span></h2>
      <div class="icon-grid">
        ${iconEntries.map((e) => `
        <div class="icon-cell${e.usedIn.length === 0 ? ' icon-cell-orphan' : ''}">
          <div class="icon-glyph">${iconGlyph(e.path)}</div>
          <div class="icon-name">${esc(e.name)}</div>
          <div class="icon-used">${e.usedIn.length ? esc(e.usedIn.join(', ')) : 'no static call site found'}</div>
        </div>`).join('')}
      </div>
    </section>
    <section class="cat-section">
      <h2 class="cat-title">Unapproved <span class="cat-count">${broken.length} broken reference${broken.length === 1 ? '' : 's'}, ${dynamicIconCallCount} dynamic call site${dynamicIconCallCount === 1 ? '' : 's'} (not statically checkable)</span></h2>
      ${broken.length
        ? broken.map((f) => `<div class="issue-row"><code>${esc(f.file)}</code> — ${esc(f.call)} references unknown icon "${esc(f.name)}"</div>`).join('')
        : `<div class="empty-inline">No call site references a name missing from ICONS.</div>`}
      <div class="subhead">Orphan glyphs <span class="cat-count">${orphan.length}</span> — defined in ICONS with no literal call site found (may still be used via a dynamic/variable call)</div>
      <div class="icon-grid">
        ${orphan.map((e) => `
        <div class="icon-cell icon-cell-orphan">
          <div class="icon-glyph">${iconGlyph(e.path)}</div>
          <div class="icon-name">${esc(e.name)}</div>
        </div>`).join('') || '<div class="empty-inline">None.</div>'}
      </div>
    </section>`;
}

function violationRows() {
  const all = [
    ...colorFindings.map((f) => ({ kind: `color (${CATEGORY_LABEL[f.category]})`, selector: f.selector, prop: f.prop, value: f.value })),
    ...spacingFindings,
    ...findings,
  ];
  if (!all.length) return `<div class="empty">No color, spacing, or font literals found outside the token set. PASS.</div>`;
  return all.map((f) => `
    <div class="viol-row">
      <div class="viol-kind">${esc(f.kind)}</div>
      <div class="viol-selector">${esc(f.selector)}</div>
      <div class="viol-decl">${esc(f.prop)}: ${esc(f.value)}</div>
    </div>`).join('');
}

const generatedAt = new Date().toISOString();
const out = `<!doctype html>
<html><head><meta charset="utf-8"><title>Chromasmith Token Report</title>
<style>
  :root { color-scheme: light dark; --rep-bg:#fff; --rep-fg:#111; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --rep-bg:#1a1a1a; --rep-fg:#eee; } }
  :root[data-theme="dark"] { --rep-bg:#1a1a1a; --rep-fg:#eee; }
  :root[data-theme="light"] { --rep-bg:#fff; --rep-fg:#111; }
  body { margin:0; font-family:-apple-system,system-ui,sans-serif; background:var(--rep-bg); color:var(--rep-fg); }
  header { padding:20px 28px 0; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .meta { color:#888; font-size:12px; margin-bottom:16px; }
  #theme-toggle { flex:none; background:none; border:1px solid rgba(128,128,128,.35); border-radius:8px; font:inherit; font-size:13px; padding:6px 12px; cursor:pointer; color:inherit; }
  #theme-toggle:hover { border-color:rgba(128,128,128,.6); }
  nav { display:flex; gap:24px; padding:0 28px; border-bottom:1px solid rgba(128,128,128,.25); }
  nav button { background:none; border:none; font:inherit; font-size:15px; padding:10px 0; cursor:pointer; color:inherit; opacity:.55; border-bottom:2px solid transparent; }
  nav button.active { opacity:1; border-bottom-color:#0066cc; font-weight:600; }
  nav button .count { font-size:12px; opacity:.6; margin-left:4px; }
  main { padding:24px 28px 60px; }
  .panel { display:none; }
  .panel.active { display:block; }
  .subhead { font-weight:600; margin:24px 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; opacity:.6; }
  .swatch-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:14px; }
  .swatch { font-size:11px; }
  .chip { height:48px; border-radius:8px; border:1px solid rgba(128,128,128,.25); }
  .chip-path { margin-top:4px; font-weight:600; word-break:break-all; }
  .chip-path + .chip-path { margin-top:2px; padding-top:2px; border-top:1px dotted rgba(128,128,128,.25); }
  .chip-val { opacity:.6; font-family:ui-monospace,monospace; margin-top:6px; }
  .chip-decl { opacity:.5; font-family:ui-monospace,monospace; font-size:10px; }
  .cat-section { margin-bottom:32px; }
  .cat-title { font-size:16px; margin:0 0 14px; padding-bottom:8px; border-bottom:1px solid rgba(128,128,128,.2); }
  .cat-count { font-size:12px; font-weight:400; opacity:.55; }
  .mode-cols { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; align-items:start; }
  .mode-col { min-width:0; }
  .mode-label { font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; opacity:.6; margin-bottom:10px; }
  .mode-label-bad { color:#e05454; opacity:1; }
  .mode-col-unapproved { border-left:1px dashed rgba(224,84,84,.3); padding-left:20px; }
  .empty-inline { opacity:.45; font-size:12px; padding:8px 0; }
  @media (max-width: 900px) { .mode-cols { grid-template-columns:1fr; } .mode-col-unapproved { border-left:none; padding-left:0; border-top:1px dashed rgba(224,84,84,.3); padding-top:12px; } }
  .type-row { display:flex; gap:20px; align-items:center; padding:14px 0; border-bottom:1px solid rgba(128,128,128,.15); }
  .type-meta { width:220px; flex:none; }
  .type-path { font-weight:600; font-size:13px; word-break:break-all; }
  .type-detail { font-family:ui-monospace,monospace; font-size:11px; opacity:.6; }
  .type-sample { flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .layout-row { display:flex; align-items:center; gap:12px; padding:8px 0; font-size:12px; }
  .layout-path { width:220px; flex:none; font-weight:600; word-break:break-all; }
  .layout-bar-wrap { flex:1; background:rgba(128,128,128,.15); border-radius:4px; height:10px; max-width:300px; }
  .layout-bar { height:100%; background:#0066cc; border-radius:4px; }
  .layout-val { font-family:ui-monospace,monospace; opacity:.7; width:70px; }
  .comp-table { display:flex; flex-direction:column; }
  .comp-row { display:grid; grid-template-columns:180px 1fr 90px; gap:16px; padding:10px 0; border-bottom:1px solid rgba(128,128,128,.15); align-items:start; font-size:13px; }
  .comp-head { font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em; opacity:.6; border-bottom:1px solid rgba(128,128,128,.25); }
  .comp-name { font-weight:600; }
  .comp-sub { font-weight:400; opacity:.55; font-size:11px; }
  .comp-selectors code { font-family:ui-monospace,monospace; font-size:11px; background:rgba(128,128,128,.12); padding:1px 5px; border-radius:4px; margin:0 4px 4px 0; display:inline-block; }
  .comp-count { text-align:right; font-family:ui-monospace,monospace; opacity:.7; }
  .issue-list { max-height:340px; overflow-y:auto; font-size:12px; }
  .issue-row { padding:4px 0; border-bottom:1px dotted rgba(128,128,128,.15); word-break:break-all; }
  .issue-row code { font-family:ui-monospace,monospace; opacity:.75; }
  .icon-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:14px; }
  .icon-cell { text-align:center; font-size:11px; border:1px solid rgba(128,128,128,.2); border-radius:8px; padding:12px 6px; }
  .icon-cell-orphan { border-style:dashed; border-color:rgba(224,84,84,.4); }
  .icon-glyph { display:flex; justify-content:center; margin-bottom:6px; }
  .icon-name { font-weight:600; word-break:break-all; }
  .icon-used { opacity:.55; font-size:10px; margin-top:2px; word-break:break-all; }
  .viol-row { display:grid; grid-template-columns:120px 1fr 1fr; gap:12px; padding:10px 0; border-bottom:1px solid rgba(224,84,84,.2); font-size:13px; }
  .viol-kind { font-weight:700; color:#e05454; }
  .viol-selector { font-family:ui-monospace,monospace; font-size:12px; word-break:break-all; }
  .viol-decl { font-family:ui-monospace,monospace; font-size:12px; word-break:break-all; }
  .empty { padding:24px; text-align:center; opacity:.6; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Chromasmith Token Report</h1>
    <div class="meta">Generated ${generatedAt} from design/tokens.json + chromasmith-22.html — re-run <code>node scripts/token-report.mjs</code> to refresh.</div>
  </div>
  <button id="theme-toggle" onclick="toggleReportTheme()">Toggle theme</button>
</header>
<nav>
  <button data-tab="colors" class="active">Colors <span class="count">${catalogue.color.filter((e) => !isAliasEntry(e)).length}</span></button>
  <button data-tab="typography">Typography <span class="count">${catalogue.fontFamily.filter((e) => !isAliasEntry(e)).length + catalogue.fontSize.length + catalogue.fontWeight.length}</span></button>
  <button data-tab="layout">Layout <span class="count">${catalogue.dimension.length}</span></button>
  <button data-tab="components">Components <span class="count">${componentFamilies.length}</span></button>
  <button data-tab="icons">Icons <span class="count">${iconEntries.length}</span></button>
  <button data-tab="violations">Violations <span class="count">${findings.length + colorFindings.length + spacingFindings.length}</span></button>
</nav>
<main>
  <div class="panel active" id="panel-colors">${colorSections()}</div>
  <div class="panel" id="panel-typography">${typographyRows()}</div>
  <div class="panel" id="panel-layout">${layoutRows()}</div>
  <div class="panel" id="panel-components">${componentSections()}</div>
  <div class="panel" id="panel-icons">${iconSections()}</div>
  <div class="panel" id="panel-violations">${violationRows()}</div>
</main>
<script>
(function initReportTheme() {
  let saved = null;
  try { saved = localStorage.getItem('token-report-theme'); } catch {}
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  updateThemeToggleLabel();
})();
function updateThemeToggleLabel() {
  const btn = document.getElementById('theme-toggle');
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  btn.textContent = current === 'dark' ? 'Switch to light' : 'Switch to dark';
}
function toggleReportTheme() {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('token-report-theme', next); } catch {}
  updateThemeToggleLabel();
}
document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById('panel-' + b.dataset.tab).classList.add('active');
  });
});
</script>
</body></html>`;

writeFileSync('scripts/token-report.html', out);
console.log(`Wrote scripts/token-report.html — ${catalogue.color.length} colors, ${catalogue.fontFamily.length} font families, ${catalogue.fontSize.length} font sizes, ${catalogue.fontWeight.length} font weights, ${colorFindings.length} color + ${spacingFindings.length} spacing + ${findings.length} font violation(s).`);
if (colorFindings.length) {
  console.log('\nColor literals not matching any :root/body.light/tokens.json value:');
  for (const f of colorFindings.slice(0, 50)) console.log(`  [${CATEGORY_LABEL[f.category]}] ${f.selector} { ${f.prop}: ${f.value} }`);
  if (colorFindings.length > 50) console.log(`  ... and ${colorFindings.length - 50} more (see the report for the full list)`);
}
if (spacingFindings.length) {
  console.log('\nSpacing/radius px literals not matching any :root or tokens.json dimension value:');
  for (const f of spacingFindings.slice(0, 50)) console.log(`  [spacing] ${f.selector} { ${f.prop}: ${f.value} }`);
  if (spacingFindings.length > 50) console.log(`  ... and ${spacingFindings.length - 50} more (see the report for the full list)`);
}
if (findings.length) {
  console.log('\nFont/typography literals not matching any :root or tokens.json value:');
  for (const f of findings.slice(0, 50)) console.log(`  [${f.kind}] ${f.selector} { ${f.prop}: ${f.value} }`);
  if (findings.length > 50) console.log(`  ... and ${findings.length - 50} more (see the report for the full list)`);
}
