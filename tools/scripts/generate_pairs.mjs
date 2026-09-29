// Generates test/generated_pairs.mjs from the wireframe's data-app attributes and
// the S1(b) rule: one entry per .grp[data-fxsec], else whole panel → .fx-ctrl[data-fxsec=<key>].
// Keeps hand-written labels from LABELS below. Alias: wireframe masks → app local.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT = process.cwd();
const WF_PATH = 'chromasmith-design/project/Editor (Developer) View.dc.html';

// Hand-written labels and zone names — preserved across regeneration.
// Key is either a panel key or a "panel/fxsec" composite.
const LABELS = {
  'topbar': { label: 'topbar', zone: 'topbar' },
  'topbar/undogrp': { label: 'undo/redo cluster', zone: 'topbar' },
  'topbar/zoomctl': { label: 'zoom control', zone: 'zoom' },
  'topbar/btn-tools': { label: 'Settings button (was Tools)', zone: 'topbar' },
  'topbar/btn-allfx': { label: 'All FX button', zone: 'topbar' },
  'topbar/btn-export': { label: 'Export button', zone: 'topbar' },
  'rail': { label: 'tool rail', zone: 'rail' },
  'panel': { label: 'tool panel', zone: 'panel' },
  'filmstrip': { label: 'filmstrip (docked library)', zone: 'filmstrip' },
  'statusbar': { label: 'status bar', zone: 'statusbar' },
  'retouch': { label: 'retouch panel', zone: 'retouch-panel' },
  'detail/nr': { label: 'noise reduction section', zone: 'detail-panel' },
  'detail/lens': { label: 'lens correction section', zone: 'detail-panel' },
  'detail/deconv': { label: 'deconvolution section', zone: 'detail-panel' },
  'film/grain': { label: 'film grain section', zone: 'film-panel' },
  'film/hal': { label: 'halation section', zone: 'film-panel' },
  'film/bloom': { label: 'bloom section', zone: 'film-panel' },
  'film/art': { label: 'film artifacts section', zone: 'film-panel' },
  'film/vig': { label: 'vignette section', zone: 'film-panel' },
  'frame/borders': { label: 'border section', zone: 'frame-panel' },
  'frame/canvas': { label: 'canvas section', zone: 'frame-panel' },
  'crop/crop': { label: 'crop panel', zone: 'crop-panel' },
  'export': { label: 'export panel', zone: 'export-panel' },
  'info': { label: 'info panel', zone: 'info-panel' },
  'color/curves': { label: 'tone curves section', zone: 'color-panel' },
  'color/hsl': { label: 'color mixer section', zone: 'color-panel' },
  'color/pointcolor': { label: 'point color section', zone: 'color-panel' },
  'color/wheels': { label: 'colour wheels section', zone: 'color-panel' },
  'adjust': { label: 'adjust panel', zone: 'adjust-panel' },
  'looks': { label: 'looks panel', zone: 'looks-panel' },
  'masks': { label: 'masks panel', zone: 'masks-panel' },
};

const PANEL_ALIAS = { masks: 'local' };
function appKey(k) { return PANEL_ALIAS[k] || k; }

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

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/${WF_PATH}`);
await page.waitForLoadState('domcontentloaded');

// Extract panel structure
const panelData = await page.evaluate(() => {
  const result = [];
  for (const panel of document.querySelectorAll('.tp-panel[data-panel]')) {
    const key = panel.dataset.panel;
    const grps = [...panel.querySelectorAll(':scope .grp[data-fxsec]')].filter(
      g => g.closest('.tp-panel') === panel
    );
    const grpKeys = grps.map(g => g.dataset.fxsec);

    // Per-control pairs: elements with data-app inside this panel
    const controls = [];
    for (const el of panel.querySelectorAll('[data-app]')) {
      const appSel = el.getAttribute('data-app');
      if (appSel === 'none') continue;
      const nearestGrp = el.closest('.grp[data-fxsec]');
      const fxsec = nearestGrp?.dataset?.fxsec || null;
      // Build a wireframe CSS path for this control
      const tag = el.tagName.toLowerCase();
      const classes = [...el.classList].filter(c => c !== 'on').join('.');
      const parentPanel = `.tp-panel[data-panel="${key}"]`;
      const grpPart = fxsec ? ` .grp[data-fxsec="${fxsec}"]` : '';
      // Use class-based selector for the control itself
      let controlPart = tag;
      if (classes) controlPart += '.' + classes;
      // Add label context if available
      const row = el.closest('.slider-row, .cb-row, div');
      const labelEl = row?.querySelector('.sr-top span:first-child, .fieldlabel, span:not(.sw)');
      const label = labelEl?.textContent?.trim() || '';

      controls.push({
        wfSelector: `${parentPanel}${grpPart} ${controlPart}`,
        appSelector: appSel,
        label,
        fxsec,
        tag,
        classes: [...el.classList],
      });
    }

    result.push({ key, grpKeys, controls });
  }
  return result;
});

// Build section-level PAIRS
const sectionPairs = {};

// Chrome pairs (topbar, rail, panel, filmstrip, statusbar) — not from panels
const CHROME_PAIRS = {
  '.topbar': { app: '#fx-deskbar', ...LABELS['topbar'] },
  '.tb-left .undogrp': { app: '.fx-undogrp', ...LABELS['topbar/undogrp'] },
  '.zoomctl': { app: '#fx-zoom-ctrl', ...LABELS['topbar/zoomctl'] },
  '#btn-tools': { app: '#fx-settings .fx-db', ...LABELS['topbar/btn-tools'] },
  '#btn-allfx': { app: '.js-allfx', ...LABELS['topbar/btn-allfx'] },
  '.btn-export': { app: '#btn-fx-export, [onclick*="exportFX"]', ...LABELS['topbar/btn-export'] },
  '.rail': { app: '#fx-toolrail', ...LABELS['rail'] },
  '.toolpanel': { app: '.fx-panel', ...LABELS['panel'] },
  '.filmstrip': { app: '#lib-overlay:not(.full)', ...LABELS['filmstrip'] },
  '.statusbar': { app: '#fx-statusbar', ...LABELS['statusbar'] },
};
Object.assign(sectionPairs, CHROME_PAIRS);

// Panel pairs — S1(b) rule
for (const pd of panelData) {
  const { key, grpKeys } = pd;
  const fxsecGrps = grpKeys.filter(k => k !== 'info-meta' && k !== 'info-people');

  if (fxsecGrps.length > 0) {
    // Multi-section: one entry per grp[data-fxsec]
    for (const fxsec of fxsecGrps) {
      const wfSel = `.tp-panel[data-panel="${key}"] .grp[data-fxsec="${fxsec}"]`;
      const ak = appKey(fxsec);
      const appSel = `.fx-ctrl[data-fxsec="${ak}"]`;
      const labelKey = `${key}/${fxsec}`;
      const meta = LABELS[labelKey] || { label: `${fxsec} section`, zone: `${key}-panel` };
      sectionPairs[wfSel] = { app: appSel, ...meta };
    }
  } else {
    // Single-section or flat: whole panel → whole card
    const ak = appKey(key);
    const wfSel = `.tp-panel[data-panel="${key}"]`;
    const appSel = `.fx-ctrl[data-fxsec="${ak}"]`;
    const meta = LABELS[key] || { label: `${key} panel`, zone: `${key}-panel` };
    sectionPairs[wfSel] = { app: appSel, ...meta };
  }
}

// Build per-control CONTROL_PAIRS
const controlPairs = [];
for (const pd of panelData) {
  for (const ctrl of pd.controls) {
    controlPairs.push({
      wf: ctrl.wfSelector,
      app: ctrl.appSelector,
      label: ctrl.label,
      panel: pd.key,
      fxsec: ctrl.fxsec,
    });
  }
}

// Build INVENTORY_ZONES (for editor_wireframe_inventory.mjs)
const inventoryZones = [];
for (const pd of panelData) {
  const { key, grpKeys } = pd;
  const fxsecGrps = grpKeys.filter(k => k !== 'info-meta' && k !== 'info-people');

  const meta = LABELS[key] || {};
  const zone = meta.zone || `${key}-panel`;

  if (fxsecGrps.length > 0) {
    const wfSels = fxsecGrps.map(f => `.tp-panel[data-panel="${key}"] .grp[data-fxsec="${f}"]`).join(',');
    const appSels = fxsecGrps.map(f => `[data-fxsec="${appKey(f)}"]`).join(',');
    inventoryZones.push({
      label: zone,
      wf: wfSels,
      app: appSels,
      appSection: key,
      wfPanel: key,
    });
  } else {
    const ak = appKey(key);
    inventoryZones.push({
      label: zone,
      wf: `.tp-panel[data-panel="${key}"]`,
      app: `[data-fxsec="${ak}"]`,
      appSection: key,
      wfPanel: key,
    });
  }
}

// Write generated file
const output = `// AUTO-GENERATED by scripts/generate_pairs.mjs — do not hand-edit.
// Regenerate: node scripts/link_wireframe_controls.mjs && node scripts/generate_pairs.mjs
// Section-level PAIRS follow the S1(b) rule: one entry per .grp[data-fxsec],
// else whole panel → .fx-ctrl[data-fxsec=<key>]. Alias: wireframe masks → app local.
// Labels are hand-written (LABELS map in the generator), preserved across regeneration.

export const SECTION_PAIRS = ${JSON.stringify(sectionPairs, null, 2)};

export const CONTROL_PAIRS = ${JSON.stringify(controlPairs, null, 2)};

export const INVENTORY_ZONES = ${JSON.stringify(inventoryZones, null, 2)};
`;

await writeFile(path.join(ROOT, 'test/generated_pairs.mjs'), output);

// Print diff check for retouch and export
console.log('Section PAIRS generated:');
for (const [sel, val] of Object.entries(sectionPairs)) {
  if (sel.includes('panel')) console.log(`  ${sel} → ${val.app} (${val.label})`);
}
console.log(`\nControl pairs: ${controlPairs.length} total`);
console.log(`Inventory zones: ${inventoryZones.length} total`);

await browser.close();
server.close();
