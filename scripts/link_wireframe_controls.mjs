// Adds data-app="<app css selector>" to every wireframe control that has an app counterpart.
// Controls without a match get data-app="none" data-note="<reason>".
// Sources: panel_inventory.json (app controls), wireframe DOM (Playwright parse).
//
// Strategy: Playwright walks the DOM to match controls, then we extract per-element positions
// using unique marker attributes and apply them to the source HTML via regex.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT = process.cwd();
const WF_PATH = 'chromasmith-design/project/Editor (Developer) View.dc.html';
const INV_PATH = 'test/output/panel_inventory.json';

const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.webp': 'image/webp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const port = server.address().port;

const inventory = JSON.parse(await readFile(INV_PATH, 'utf8'));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/${WF_PATH}`);
await page.waitForLoadState('domcontentloaded');

// Phase 1: Tag every control element with a unique data-wf-idx so we can find it in source later
// Phase 2: Match controls to app inventory
// Phase 3: Extract the modifications as a list of {idx, dataApp, dataNote}
const results = await page.evaluate((inv) => {
  const PANEL_ALIAS = { masks: 'local' };
  function appKey(k) { return PANEL_ALIAS[k] || k; }
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function cleanLabel(s) { return norm(s).replace(/\s*\bi\b\s*$/, '').replace(/[©]/g, '').trim(); }
  function labelsMatch(wf, app) {
    const w = cleanLabel(wf), a = cleanLabel(app);
    if (!w || !a) return false;
    return w === a || w.startsWith(a) || a.startsWith(w);
  }
  function kindsMatch(wk, ak) {
    if (wk === ak) return true;
    if ((wk === 'toggle' || wk === 'checkbox') && ak === 'checkbox') return true;
    // wireframe cb-row .sw checkboxes map to app .fx-toggle elements
    if (wk === 'checkbox' && ak === 'button') return false;
    return false;
  }

  // Section toggles: wireframe .grp-hd .sw → app #tg-<sectionKey>
  // Sub-toggles: map wireframe checkbox label to known app toggle id
  const TOGGLE_MAP = {
    'white glow': 'tg-hal-white',
    'no remjet': 'tg-hal-noremjet',
    'extreme': 'tg-hal-extreme',
    'edge only': 'ck-msk-selview-outline',
  };
  // Segments that don't match by label — map by section + context
  const SEGMENT_MAP = {
    'curves/': 'sel-curve-ch',    // channel selector
    'crop/grid': 'sel-crop-grid',
    'art/dust colour': 'sel-dust-mode',
    'export/': 'sel-scope',       // current photo / all photos
    'masks/show on photo': 'sel-msk-overlay',
    'masks/': 'sel-msk-combine',  // combine mode
  };

  let idx = 0;
  const controls = [];

  for (const panel of document.querySelectorAll('.tp-panel[data-panel]')) {
    const panelKey = panel.dataset.panel;

    // Find grps DIRECTLY inside this panel (not nested in sub-panels)
    const grps = [...panel.querySelectorAll(':scope > .grp, :scope > div > .grp')].filter(
      g => g.closest('.tp-panel') === panel
    );

    function processContainer(container, sectionKey) {
      const appControls = inv[sectionKey]?.controls || [];
      const usedIds = new Set();

      function findMatch(kind, label, extra) {
        for (const ac of appControls) {
          if (ac.id && usedIds.has(ac.id)) continue;
          if (!kindsMatch(kind, ac.kind)) continue;
          if (labelsMatch(label, ac.label)) {
            if (ac.id) usedIds.add(ac.id);
            return ac;
          }
        }
        if (kind === 'slider' && extra) {
          for (const ac of appControls) {
            if (ac.id && usedIds.has(ac.id)) continue;
            if (ac.kind !== 'slider') continue;
            if (extra.min === ac.min && extra.max === ac.max && extra.value === ac.default) {
              if (ac.id) usedIds.add(ac.id);
              return ac;
            }
          }
        }
        return null;
      }

      function tag(el, kind, label, extra) {
        const match = findMatch(kind, label, extra);
        const selector = match?.id ? '#' + match.id : null;
        const i = idx++;
        el.setAttribute('data-wf-idx', String(i));
        controls.push({
          idx: i, panelKey, sectionKey,
          kind, label,
          appSelector: selector || 'none',
          note: selector ? undefined : (match ? 'app control has no id' : 'no match')
        });
      }

      // Sliders
      for (const row of container.querySelectorAll('.slider-row')) {
        if (row.closest('.tp-panel') !== panel) continue;
        const nearestGrp = row.closest('.grp');
        if (grps.length && nearestGrp && nearestGrp !== container && !container.contains(nearestGrp)) continue;
        if (grps.length && nearestGrp && nearestGrp !== container && container !== panel) continue;
        const label = row.querySelector('.sr-top span:first-child')?.textContent?.trim() || '';
        const input = row.querySelector('input[type="range"]');
        if (input) tag(input, 'slider', label, { min: input.min, max: input.max, value: input.value });
      }

      // Select buttons
      for (const btn of container.querySelectorAll('.select-btn')) {
        if (btn.closest('.tp-panel') !== panel) continue;
        const nearestGrp = btn.closest('.grp');
        if (grps.length && nearestGrp && nearestGrp !== container && container !== panel) continue;
        const p = btn.closest('div:not(.select):not(.grp):not(.grp-bd):not(.tp-panel)');
        const label = p?.querySelector('.fieldlabel')?.textContent?.trim() || '';
        tag(btn, 'select', label);
      }

      // Checkboxes (cb-row .sw) — first check TOGGLE_MAP, then fall back to inventory
      for (const row of container.querySelectorAll('.cb-row')) {
        if (row.closest('.tp-panel') !== panel) continue;
        const nearestGrp = row.closest('.grp');
        if (grps.length && nearestGrp && nearestGrp !== container && container !== panel) continue;
        const sw = row.querySelector('.sw');
        const label = [...row.querySelectorAll('span')].map(s => s.textContent.trim()).filter(Boolean).join(' ') || '';
        if (!sw) continue;
        const mappedId = TOGGLE_MAP[cleanLabel(label)];
        if (mappedId) {
          const i = idx++;
          sw.setAttribute('data-wf-idx', String(i));
          controls.push({ idx: i, panelKey, sectionKey, kind: 'checkbox', label, appSelector: '#' + mappedId });
        } else {
          tag(sw, 'checkbox', label);
        }
      }

      // Text inputs
      for (const input of container.querySelectorAll('input.txt')) {
        if (input.closest('.tp-panel') !== panel) continue;
        const nearestGrp = input.closest('.grp');
        if (grps.length && nearestGrp && nearestGrp !== container && container !== panel) continue;
        const p = input.closest('div:not(.grp):not(.grp-bd):not(.tp-panel)');
        const label = p?.querySelector('.fieldlabel')?.textContent?.trim() || input.placeholder || '';
        tag(input, 'text', label);
      }

      // Segments — wireframe .seg maps to app select (selectToSeg) or sometimes a real .seg
      for (const seg of container.querySelectorAll('.seg')) {
        if (seg.closest('.tp-panel') !== panel) continue;
        const nearestGrp = seg.closest('.grp');
        if (grps.length && nearestGrp && nearestGrp !== container && container !== panel) continue;
        const p = seg.parentElement;
        let label = p?.querySelector(':scope > .fieldlabel')?.textContent?.trim() || '';
        if (!label) label = p?.parentElement?.querySelector(':scope > .fieldlabel')?.textContent?.trim() || '';
        // Try matching as select (since selectToSeg converts selects to segments)
        const match = findMatch('select', label);
        if (match?.id) {
          const i = idx++;
          seg.setAttribute('data-wf-idx', String(i));
          controls.push({ idx: i, panelKey, sectionKey, kind: 'segment', label, appSelector: '#' + match.id });
        } else {
          tag(seg, 'segment', label);
        }
      }

      // Section toggle (header .sw) → #tg-<sectionKey>
      if (container.classList?.contains('grp')) {
        const headerToggle = container.querySelector(':scope > .grp-hd > .sw');
        if (headerToggle) {
          const grpLabel = container.querySelector(':scope > .grp-hd .fieldlabel')?.textContent?.trim() || '';
          // Section toggles map to #tg-<appSectionKey> directly, not via inventory
          const toggleId = 'tg-' + sectionKey;
          const i = idx++;
          headerToggle.setAttribute('data-wf-idx', String(i));
          controls.push({
            idx: i, panelKey, sectionKey,
            kind: 'toggle', label: grpLabel,
            appSelector: '#' + toggleId,
          });
        }
      }

      // Action buttons
      for (const btn of container.querySelectorAll('.wide-btn, .autoenhance')) {
        if (btn.closest('.tp-panel') !== panel) continue;
        const nearestGrp = btn.closest('.grp');
        if (grps.length && nearestGrp && nearestGrp !== container && container !== panel) continue;
        const label = btn.textContent?.trim() || '';
        tag(btn, 'button', label);
      }
    }

    if (grps.length === 0) {
      // Flat panel (adjust, looks)
      processContainer(panel, appKey(panelKey));
    } else {
      for (const grp of grps) {
        const fxsec = grp.dataset?.fxsec;
        const sectionKey = (fxsec && fxsec !== 'info-meta' && fxsec !== 'info-people')
          ? appKey(fxsec) : appKey(panelKey);
        processContainer(grp, sectionKey);
      }
    }
  }

  return { controls, totalIdx: idx };
}, inventory);

// Phase 3: Apply data-app attributes to the original HTML source
// Each tagged element now has data-wf-idx="N" in the DOM. We need to find each element
// in the source by its unique context and insert data-app.
//
// Strategy: get each element's opening tag from Playwright (which now has data-wf-idx),
// then find the ORIGINAL tag in source (without data-wf-idx) and insert data-app.

// Get the tag info for each indexed element
const tagInfos = await page.evaluate((totalIdx) => {
  const infos = [];
  for (let i = 0; i < totalIdx; i++) {
    const el = document.querySelector(`[data-wf-idx="${i}"]`);
    if (!el) { infos.push(null); continue; }
    const tag = el.tagName.toLowerCase();
    // Get the original attributes minus data-wf-idx
    const attrs = {};
    for (const a of el.attributes) {
      if (a.name !== 'data-wf-idx' && a.name !== 'data-app' && a.name !== 'data-note') {
        attrs[a.name] = a.value;
      }
    }
    // Get text right before/after for context
    const parent = el.parentElement;
    const siblings = parent ? [...parent.children] : [];
    const myIdx = siblings.indexOf(el);
    const prevSibTag = myIdx > 0 ? siblings[myIdx - 1]?.tagName?.toLowerCase() : null;
    const prevSibText = myIdx > 0 ? siblings[myIdx - 1]?.textContent?.trim()?.slice(0, 30) : null;
    infos.push({ tag, attrs, prevSibTag, prevSibText });
  }
  return infos;
}, results.totalIdx);

let origHtml = await readFile(path.join(ROOT, WF_PATH), 'utf8');

// For each panel, find the panel section boundaries in the source
const panelBounds = [];
for (const m of origHtml.matchAll(/<div class="tp-panel[^"]*" data-panel="([a-z]+)">/g)) {
  const key = m[1];
  let depth = 0, i = m.index, end = -1;
  while (i < origHtml.length) {
    if (origHtml.startsWith('<div', i)) depth++;
    else if (origHtml.startsWith('</div>', i)) { depth--; if (depth === 0) { end = i + 6; break; } }
    i++;
  }
  panelBounds.push({ key, start: m.index, end });
}

// Build a mapping: for each control, find its position in the source
// We'll process controls in reverse document order so insertions don't shift later positions
const insertions = []; // {pos, text} where pos is right before the > of the opening tag

for (const ctrl of results.controls) {
  const info = tagInfos[ctrl.idx];
  if (!info) continue;

  const pb = panelBounds.find(p => p.key === ctrl.panelKey);
  if (!pb) continue;

  const panelSrc = origHtml.slice(pb.start, pb.end);

  // Build a regex to find this specific element
  // Match by tag + key attributes
  let needle;
  if (info.tag === 'input' && info.attrs.type === 'range') {
    const min = info.attrs.min || '', max = info.attrs.max || '', val = info.attrs.value || '';
    needle = `<input type="range"`;
    // Find all range inputs in this panel section with matching min/max/value
    const re = new RegExp(`<input[^>]*type="range"[^>]*min="${min}"[^>]*max="${max}"[^>]*value="${val}"[^>]*>`, 'g');
    let match, occurrences = [];
    while ((match = re.exec(panelSrc)) !== null) occurrences.push(match);
    // If unique, use it; else disambiguate by context
    if (occurrences.length === 1) {
      const pos = pb.start + occurrences[0].index + occurrences[0][0].length - 1; // before >
      const appAttr = ` data-app="${ctrl.appSelector}"${ctrl.note ? ` data-note="${ctrl.note}"` : ''}`;
      insertions.push({ pos, text: appAttr });
      continue;
    }
    // Multiple matches — use occurrence order within the section for the grp
    if (ctrl.sectionKey !== ctrl.panelKey) {
      // Find grp boundary
      const fxsecAttr = ctrl.sectionKey === 'local' ? 'masks' : ctrl.sectionKey;
      const grpStart = panelSrc.indexOf(`data-fxsec="${fxsecAttr}"`);
      if (grpStart >= 0) {
        // Re-search within grp
        const grpSrc = panelSrc.slice(grpStart);
        const re2 = new RegExp(`<input[^>]*type="range"[^>]*min="${min}"[^>]*max="${max}"[^>]*value="${val}"[^>]*>`, 'g');
        const m2 = re2.exec(grpSrc);
        if (m2) {
          const pos = pb.start + grpStart + m2.index + m2[0].length - 1;
          const appAttr = ` data-app="${ctrl.appSelector}"${ctrl.note ? ` data-note="${ctrl.note}"` : ''}`;
          insertions.push({ pos, text: appAttr });
          continue;
        }
      }
    }
  } else if (info.tag === 'button' && info.attrs.class?.includes('sw')) {
    // Toggle/checkbox button
    const ariaLabel = info.attrs['aria-label'] || '';
    if (ariaLabel) {
      needle = `aria-label="${ariaLabel}"`;
      const idx = panelSrc.indexOf(needle);
      if (idx >= 0) {
        // Find the > after this
        const closeIdx = panelSrc.indexOf('>', idx);
        const pos = pb.start + closeIdx;
        const appAttr = ` data-app="${ctrl.appSelector}"${ctrl.note ? ` data-note="${ctrl.note}"` : ''}`;
        insertions.push({ pos, text: appAttr });
        continue;
      }
    }
    // cb-row .sw — find by context (preceding span text)
  } else if (info.tag === 'button' && info.attrs.class?.includes('select-btn')) {
    // Select button — find by the span text inside
  } else if (info.tag === 'input' && info.attrs.class?.includes('txt')) {
    // Text input
  } else if (info.tag === 'div' && info.attrs.class?.includes('seg')) {
    // Segment control
  }

  // Fallback: skip this control (can't reliably locate it)
  // We'll handle these via a DOM-level approach instead
}

// The regex approach is too fragile for all control types. Let me use a different strategy:
// Use Playwright to add data-app/data-note directly, then use page.content() and
// extract ONLY the portions that changed (elements with data-app attributes).

// Actually, let's go simpler: use page.content() as the new file.
// The risk is reformatting, but for a wireframe file that's acceptable.

// Add data-app attributes via Playwright
await page.evaluate((controls) => {
  for (const ctrl of controls) {
    const el = document.querySelector(`[data-wf-idx="${ctrl.idx}"]`);
    if (!el) continue;
    el.setAttribute('data-app', ctrl.appSelector);
    if (ctrl.note) el.setAttribute('data-note', ctrl.note);
    el.removeAttribute('data-wf-idx');
  }
}, results.controls);

// Get full page content
const newContent = await page.content();

// Extract just the body content (between the first <body...> and last </body>)
// Actually, let's be more surgical: extract each .tp-panel from the new content
// and replace only those in the original, using the known panel boundaries.

// Get each panel's new HTML
const newPanelHtmls = await page.evaluate(() => {
  const r = {};
  for (const p of document.querySelectorAll('.tp-panel[data-panel]')) {
    // Remove any remaining data-wf-idx
    for (const el of p.querySelectorAll('[data-wf-idx]')) el.removeAttribute('data-wf-idx');
    r[p.dataset.panel] = p.outerHTML;
  }
  return r;
});

// Replace panels in reverse order (to preserve offsets)
let result = origHtml;
for (let i = panelBounds.length - 1; i >= 0; i--) {
  const { key, start, end } = panelBounds[i];
  if (newPanelHtmls[key]) {
    result = result.substring(0, start) + newPanelHtmls[key] + result.substring(end);
  }
}

await writeFile(path.join(ROOT, WF_PATH), result);

// Summary
const linked = results.controls.filter(c => c.appSelector !== 'none').length;
const unlinked = results.controls.filter(c => c.appSelector === 'none').length;
console.log(`Linked: ${linked}, Unlinked: ${unlinked}`);

const byPanel = {};
for (const c of results.controls) {
  if (!byPanel[c.panelKey]) byPanel[c.panelKey] = { linked: 0, total: 0, unlinked: [] };
  byPanel[c.panelKey].total++;
  if (c.appSelector !== 'none') byPanel[c.panelKey].linked++;
  else byPanel[c.panelKey].unlinked.push(c);
}

for (const [panel, data] of Object.entries(byPanel)) {
  console.log(`  ${panel}: ${data.linked}/${data.total} linked`);
}

console.log('\nUnlinked controls:');
for (const c of results.controls.filter(c => c.appSelector === 'none')) {
  console.log(`  [${c.panelKey}/${c.sectionKey}] ${c.kind} "${c.label}" — ${c.note}`);
}

await writeFile(path.join(ROOT, 'test/output/wireframe_control_links.json'), JSON.stringify(results, null, 2));
console.log('\nWrote test/output/wireframe_control_links.json');

await browser.close();
server.close();
