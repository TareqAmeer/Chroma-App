// Generates design/components.json from the two production UI sources.
// This is a source registry, not a visual catalogue: it answers which instances a component
// change affects and where each one is declared. Dynamic instances remain explicit coverage gaps.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHECK = process.argv.includes('--check');
const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'design/components.json');
const SOURCES = ['chromasmith-22.html', 'desktop/library-ui.js'];

const FAMILY_DEFS = {
  'section-card': { selectors: ['.fx-ctrl'], appleComponent: 'UtilityCard' },
  'control-row': { selectors: ['.fx-row'], appleComponent: null },
  toggle: { selectors: ['.fx-toggle', '.opt-toggle'], appleComponent: null },
  slider: { selectors: ['input[type="range"]', '.fx-slider'], appleComponent: null },
  select: { selectors: ['select', '.fx-select'], appleComponent: null },
  'segmented-control': { selectors: ['.seg', '.lib-seg'], appleComponent: null },
  button: { selectors: ['button', '.btn', '.lib-btn'], appleComponent: 'Button' },
  'icon-button': { selectors: ['.btn-icon', '.lib-btn-icon', '.lib-iconchip'], appleComponent: 'IconButton' },
  chip: { selectors: ['.lib-chip'], appleComponent: 'OptionChip' },
  'info-button': { selectors: ['.fx-info-i'], appleComponent: 'IconButton' },
  'search-input': { selectors: ['.lib-search-wrap'], appleComponent: 'SearchInput' },
  menu: { selectors: ['.lib-menu', '.fx-settings-menu', '.fx-bgmenu'], appleComponent: null },
  icon: { selectors: ['icon(name,size)', 'ic(name,size)'], appleComponent: 'IconButton' },
};

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function attr(raw, name) {
  const match = raw.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? match[2] : null;
}

function cleanText(raw) {
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\$\{[^}]+\}/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 100) : null;
}

function stableSelector(id, classes, attrs) {
  if (id && !id.includes('${')) return `#${id}`;
  for (const key of ['data-fxsec', 'data-act', 'data-fgrp', 'data-fval', 'aria-label']) {
    const value = attr(attrs, key);
    if (value && !value.includes('${')) return `[${key}="${value}"]`;
  }
  const useful = classes.find((c) => /^(fx|lib|msk|cl)-/.test(c) && !c.includes('${'));
  return useful ? `.${useful}` : null;
}

function familiesFor(tag, classes, attrs) {
  const out = [];
  const has = (c) => classes.includes(c);
  if (has('fx-ctrl')) out.push('section-card');
  if (has('fx-row')) out.push('control-row');
  if (has('fx-toggle') || has('opt-toggle')) out.push('toggle');
  if (tag === 'input' && (attr(attrs, 'type') === 'range' || has('fx-slider'))) out.push('slider');
  if (tag === 'select' || has('fx-select')) out.push('select');
  if (has('seg') || has('lib-seg')) out.push('segmented-control');
  if (tag === 'button' || has('btn') || has('lib-btn')) out.push('button');
  if (has('btn-icon') || has('lib-btn-icon') || has('lib-iconchip')) out.push('icon-button');
  if (has('lib-chip')) out.push('chip');
  if (has('fx-info-i')) out.push('info-button');
  if (has('lib-search-wrap')) out.push('search-input');
  if (has('lib-menu') || has('fx-settings-menu') || has('fx-bgmenu')) out.push('menu');
  return [...new Set(out)];
}

function scanMarkup(source, sourcePath) {
  const instances = [];
  const tagRe = /<(button|div|input|select)\b([^>]*?)(?:>|\/>)/gi;
  let match;
  while ((match = tagRe.exec(source))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const classValue = attr(attrs, 'class') || '';
    const classes = classValue.split(/\s+/).filter(Boolean);
    const families = familiesFor(tag, classes, attrs);
    if (!families.length) continue;
    const id = attr(attrs, 'id');
    const line = lineAt(source, match.index);
    const after = source.slice(tagRe.lastIndex, tagRe.lastIndex + 240);
    const explicitLabel = attr(attrs, 'aria-label') || attr(attrs, 'title');
    for (const family of families) {
      instances.push({
        key: `${sourcePath}:${line}:${family}`,
        family,
        source: sourcePath,
        line,
        tag,
        selector: stableSelector(id, classes, attrs),
        id: id && !id.includes('${') ? id : null,
        classes: classes.filter((c) => !c.includes('${')),
        label: (explicitLabel || (tag === 'button' ? cleanText(after.split('</button>')[0]) : null)),
        dynamic: match[0].includes('${'),
      });
    }
  }
  return instances;
}

function scanIcons(source, sourcePath) {
  const instances = [];
  const literal = /\b(icon|ic)\(\s*(["'])([a-zA-Z0-9_-]+)\2\s*,\s*([^,)]+)/g;
  let match;
  while ((match = literal.exec(source))) {
    const line = lineAt(source, match.index);
    instances.push({
      key: `${sourcePath}:${line}:icon:${match[3]}`,
      family: 'icon', source: sourcePath, line, selector: null,
      icon: match[3], size: match[4].trim(), dynamic: /[^\d.]/.test(match[4].trim()),
    });
  }
  return instances;
}

const instances = [];
for (const sourcePath of SOURCES) {
  const source = await readFile(path.join(ROOT, sourcePath), 'utf8');
  instances.push(...scanMarkup(source, sourcePath), ...scanIcons(source, sourcePath));
}
instances.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line || a.family.localeCompare(b.family));

const counts = {};
for (const key of Object.keys(FAMILY_DEFS)) counts[key] = instances.filter((x) => x.family === key).length;
const dynamic = instances.filter((x) => x.dynamic).map((x) => x.key);
const withoutStableSelector = instances.filter((x) => x.family !== 'icon' && !x.selector).map((x) => x.key);
const heartInstances = instances.filter((x) => x.family === 'icon' && x.icon === 'heart').map((x) => x.key);

const registry = {
  schemaVersion: 1,
  generatedFrom: SOURCES,
  designRules: 'chromasmith-design/project/design.md',
  purpose: 'App-wide source map for global component and semantic-icon changes.',
  families: Object.fromEntries(Object.entries(FAMILY_DEFS).map(([key, value]) => [key, { ...value, instanceCount: counts[key] }])),
  semanticQueries: { favouriteIcon: { icon: 'heart', instances: heartInstances } },
  coverage: {
    sourceLocatableInstances: instances.length,
    dynamicInstances: dynamic,
    withoutStableSelector,
    note: 'Source line is authoritative. A missing selector or dynamic declaration is visible debt, not silently treated as covered.',
  },
  instances,
};
const rendered = JSON.stringify(registry, null, 2) + '\n';

if (CHECK) {
  const current = await readFile(OUTPUT, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('component registry is stale; run npm run components:build');
    process.exit(1);
  }
  console.log(`component registry: up to date (${instances.length} instances, ${heartInstances.length} heart uses)`);
} else {
  await writeFile(OUTPUT, rendered);
  console.log(`component registry: wrote design/components.json (${instances.length} instances, ${heartInstances.length} heart uses)`);
  console.log(`coverage debt: ${dynamic.length} dynamic, ${withoutStableSelector.length} without stable selectors`);
}
