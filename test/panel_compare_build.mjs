// Stage 2 of the Editor panel redesign (docs/editor-redesign-plan.md). Reads
// test/output/panel_inventory.json (Stage 1's live-app extraction) and generates, per undesigned
// panel, chromasmith-design/project/panels/<panel>.compare.html — CURRENT (app markup, verbatim
// from the extraction) next to PROPOSED (identical content, translated into the wireframe's own
// component vocabulary from chromasmith-design/project/panels/_components.compare.html).
//
// WHAT THIS TOOL DOES NOT DO: it does not design anything. PROPOSED starts as a faithful,
// mechanical re-expression of CURRENT — same controls, same order, same defaults — because the
// actual cuts/merges/demotions are design judgement (docs/editor-redesign-plan.md: "2b — the
// PROPOSED redesigns", Opus, think hard) and this script has none of that context. Its job is to
// get every real control onto the page correctly so nothing is silently dropped or invented; a
// human (or a later, design-focused pass) edits the PROPOSED column from there.
//
// RE-RUN SAFETY: a panel file already carrying `data-reviewed="1"` on `.col.proposed` is treated
// as hand-edited and is never overwritten — this tool only ever produces a first draft.
//
// Usage:
//   node test/panel_compare_build.mjs                 # build every undesigned panel
//   node test/panel_compare_build.mjs --panel=color    # build (or re-check) just one
//   node test/panel_compare_build.mjs --force          # overwrite even a reviewed file (rare —
//                                                        confirm with the user first)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'chromasmith-design/project/panels');
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ONLY_PANEL = (argv.find((a) => a.startsWith('--panel=')) || '').split('=')[1] || null;

// ── Panel membership ────────────────────────────────────────────────────────────────────────
// Mirrors FX_GROUPS in chromasmith-22.html plus the D2 decisions recorded in
// test/editor_ux_spec.json (wheels -> Color, deconv -> Detail). NOT parsed from the app source
// here — Stage 0's tool (test/editor_coverage.mjs) already does that derivation for the panels
// FX_GROUPS actually groups; this map additionally covers panels FX_GROUPS doesn't touch
// (crop, masks, export, info are 1:1 with a single fxsec key) and the two D2 moves that aren't
// implemented in FX_GROUPS yet. If FX_GROUPS changes, re-check this map by hand — a silent
// drift here would draft a panel with the wrong sections in it.
const PANEL_SECTIONS = {
  color: ['curves', 'hsl', 'pointcolor', 'wheels'],
  detail: ['nr', 'lens', 'deconv'],
  film: ['grain', 'hal', 'bloom', 'art', 'vig'],
  frame: ['borders', 'canvas'],
  crop: ['crop'],
  retouch: ['retouch'],
  masks: ['local'],
  export: ['export'],
  info: ['info'],
};

const inventory = JSON.parse(await readFile(path.join(ROOT, 'test/output/panel_inventory.json'), 'utf8'));

// ── Shared page chrome, copied from _components.compare.html so all panel pages (and the
//    component sheet) render identically and share one CSS source for review purposes. ──────
const HEAD = `<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/fonts.css">
<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/colors.css">
<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/typography.css">
<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/spacing.css">
<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/radius.css">
<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/elevation.css">
<link rel="stylesheet" href="../_ds/chromasmith-design-system-b665ef58-b41a-450d-9234-1b4802ee28e1/tokens/base.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a1c;color:var(--ink-on-dark);font-family:var(--font-text);padding:32px 28px 80px}
.pagehead{max-width:1080px;margin:0 auto 36px}
.pagehead h1{font-family:var(--font-display);font-size:var(--type-display-md-size);font-weight:var(--weight-semibold);letter-spacing:-.374px;margin-bottom:10px}
.pagehead p{font-size:var(--type-caption-size);color:var(--ink-on-dark-muted);max-width:70ch;line-height:1.5}
.pagehead .warn{margin-top:14px;font-size:var(--type-fine-print-size);color:var(--orange-ember);border-left:2px solid var(--orange-ember);padding-left:10px}
.cmp{max-width:1080px;margin:0 auto 44px;border-top:1px solid rgba(255,255,255,.1);padding-top:26px}
.cmp>h2{font-family:var(--font-display);font-size:var(--type-tagline-size);font-weight:var(--weight-semibold);margin-bottom:4px}
.cmp>.where{font-size:var(--type-fine-print-size);color:var(--ink-on-dark-muted);margin-bottom:18px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
/* chromasmith-design/project/CLAUDE.md: no UI elements may ever visually overlap at any
   viewport width — collapse instead. Same reasoning as _components.compare.html. */
@media (max-width:700px){.cols{grid-template-columns:1fr}.changes li{padding-left:0}.changes li b{position:static;display:inline-block;margin-right:6px}}
.col>.tag{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-on-dark-muted);margin-bottom:8px;display:block}
.col.proposed>.tag{color:var(--primary-on-dark)}
.spec{width:300px;background:var(--surface-tile-1);border:1px solid rgba(255,255,255,.1);border-radius:var(--radius-sm);padding:14px;display:flex;flex-direction:column;gap:16px}
.changes{grid-column:1/-1;margin-top:16px;font-size:var(--type-fine-print-size);line-height:1.6}
.changes li{list-style:none;color:var(--ink-on-dark-muted);padding-left:74px;position:relative;margin-bottom:4px}
.changes li b{position:absolute;left:0;top:0;font-size:9px;letter-spacing:.07em;text-transform:uppercase;font-weight:var(--weight-semibold);padding:1px 6px;border-radius:3px}
.changes li b.kept{background:rgba(255,255,255,.1);color:var(--ink-on-dark-muted)}
.changes li b.new{background:rgba(33,78,29,.5);color:#9ad48f}
.changes li b.unlabeled{background:rgba(232,192,122,.2);color:#e8c07a}

/* ── CURRENT column: app's own CSS, verbatim values ─────────────────────────────────── */
.app{--sur:#2a2a2c;--sur2:#252527;--bdr:rgba(255,255,255,.12);--acc:#61a0af;--txt:#ffffff;--mut:#cccccc;
  --r:8px;--fs-0:10px;--fs-1:11px;--fs-2:12px;--fs-3:13px;--sp-1:4px;--sp-2:8px;--sp-3:12px;
  --sans:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-family:var(--sans);font-size:var(--fs-2)}
.app .fx-ctrl-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-0);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600}
.app .fx-toggle{width:32px;height:18px;border-radius:9px;background:var(--bdr);position:relative;flex-shrink:0;box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}
.app .fx-toggle.on{background:var(--acc);box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}
.app .fx-toggle::after{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;top:2px;left:2px;box-shadow:0 1px 2px rgba(0,0,0,.4),0 0 0 .5px rgba(0,0,0,.06)}
.app .fx-toggle.on::after{left:16px}
.app .fx-fields{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.app .fx-fields.ff-off{opacity:.42}
.app .fx-hint{font-size:11px;color:var(--mut);line-height:1.45;margin:-2px 0 8px}
.app .fx-color{width:32px;height:22px;border-radius:4px;border:1px solid var(--bdr);background:none;padding:1px}
.app .fx-row{display:flex;align-items:center;gap:8px}
.app .fx-row>*{order:2}
.app .fx-label{order:1;flex:0 0 88px;font-size:var(--fs-2);color:var(--txt)}
.app .fx-slider{order:3;flex:1;accent-color:var(--acc);height:4px}
.app .fx-select{order:3;flex:1;background:var(--sur2);color:var(--txt);border:1px solid var(--bdr);border-radius:6px;font:inherit;padding:4px 6px}
.app .btn{font:inherit;font-size:var(--fs-2);color:var(--txt);background:none;border:1px solid var(--bdr);border-radius:6px;padding:5px 9px}
.app .btn.bgh{background:rgba(255,255,255,.04)}
.app .app-cb{order:3;width:16px;height:16px;accent-color:var(--acc)}
.app .app-canvas{width:100%;aspect-ratio:1;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);border-radius:8px}
.app .grp-hd{font-size:var(--fs-0);text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:8px 0 2px}
.app .unlabeled-flag{outline:1.5px dashed #e8c07a;outline-offset:2px}

/* ── PROPOSED column: wireframe's own component CSS, copied from
      Editor (Developer) View.dc.html and _components.compare.html ────────────────────── */
.wf{font-family:var(--font-text);font-size:12px;color:var(--ink-on-dark)}
.wf .fieldlabel{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-on-dark-muted);margin-bottom:6px;display:block}
.wf .slider-row{display:flex;flex-direction:column;gap:8px}
.wf .slider-row .sr-top{display:flex;justify-content:space-between;font-size:12px}
.wf .slider-row .sr-val{color:var(--ink-on-dark-muted);font-variant-numeric:tabular-nums}
.wf .slider-row input[type=range]{width:100%;accent-color:var(--primary-on-dark);height:4px;margin-top:2px}
.wf .select-btn{width:100%;height:32px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.14);background:var(--surface-tile-2);display:flex;align-items:center;justify-content:space-between;padding:0 10px;font-size:12px;color:inherit}
.wf .select-btn svg{width:12px;height:12px;stroke:var(--ink-on-dark-muted);flex:none;fill:none;stroke-width:2}
.wf .ibtn{width:30px;height:30px;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;flex:none;background:none;border:none}
.wf .grp{display:flex;flex-direction:column;gap:10px}
.wf .grp-hd{display:flex;align-items:center;gap:8px;min-height:22px}
.wf .grp-hd .fieldlabel{margin-bottom:0;flex:1}
.wf .sw{width:30px;height:18px;border-radius:var(--radius-pill);background:rgba(255,255,255,.14);position:relative;flex:none;border:none;padding:0}
.wf .sw::after{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;top:2px;left:2px;box-shadow:0 1px 2px rgba(0,0,0,.35)}
.wf .sw.on{background:var(--primary-on-dark)}
.wf .sw.on::after{left:14px}
.wf .grp-bd{display:flex;flex-direction:column;gap:14px}
.wf .grp.off .grp-bd{opacity:.4}
.wf .grp.off .grp-hd .fieldlabel{color:rgba(204,204,204,.6)}
.wf .hint{font-size:var(--type-fine-print-size);color:var(--ink-on-dark-muted);line-height:1.5}
.wf .wf-canvas{width:100%;aspect-ratio:1;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.12);background:var(--surface-tile-2)}
.wf .cb-row{display:flex;align-items:center;gap:8px;font-size:12px}
.wf .unlabeled-flag{outline:1.5px dashed #e8c07a;outline-offset:2px}
</style>`;

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function stepLabel(min, max, step) {
  return step && step !== '1' ? ` step="${step}"` : '';
}

// ── CURRENT renderer: app's own vocabulary (.fx-row/.fx-label/.fx-slider/.btn) ────────────────
function renderAppControl(c) {
  const flag = c.unlabeled ? ' unlabeled-flag' : '';
  const label = esc(c.label || `(unlabeled ${c.kind}${c.id ? ' #' + c.id : ''})`);
  switch (c.kind) {
    case 'slider':
      return `<div class="fx-row${flag}"><div class="fx-label">${label}</div><input class="fx-slider" type="range" min="${c.min}" max="${c.max}"${stepLabel(c.min, c.max, c.step)} value="${c.default}"></div>`;
    case 'select':
      return `<div class="fx-row${flag}"><div class="fx-label">${label}</div><select class="fx-select">${c.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>`;
    case 'checkbox':
      return `<div class="fx-row${flag}"><div class="fx-label">${label}</div><input class="app-cb" type="checkbox" ${c.default ? 'checked' : ''}></div>`;
    case 'color':
      return `<div class="fx-row${flag}"><div class="fx-label">${label}</div><input class="fx-color" type="color" value="${c.default || '#ffffff'}"></div>`;
    case 'text':
      return `<div class="fx-row${flag}"><div class="fx-label">${label}</div><input class="fx-select" type="text" value="${esc(c.default || '')}"></div>`;
    case 'canvas':
      return `<div class="${flag.trim()}"><div class="fx-label" style="margin-bottom:4px">${label}</div><div class="app-canvas"></div></div>`;
    case 'button':
      return `<button class="btn bgh${flag}">${label}</button>`;
    default:
      return `<div class="fx-row${flag}">${label}</div>`;
  }
}

// ── PROPOSED renderer: wireframe vocabulary. A faithful 1:1 translation of the same control —
//    NOT a redesign. Buttons are grouped into one .btn-row-equivalent flex wrap below the loop. ─
function renderWfControl(c) {
  const flag = c.unlabeled ? ' unlabeled-flag' : '';
  const label = esc(c.label || `(unlabeled ${c.kind}${c.id ? ' #' + c.id : ''})`);
  switch (c.kind) {
    case 'slider':
      return `<div class="slider-row${flag}"><div class="sr-top"><span>${label}</span><span class="sr-val">${esc(c.default)}</span></div><input type="range" min="${c.min}" max="${c.max}"${stepLabel(c.min, c.max, c.step)} value="${c.default}"></div>`;
    case 'select':
      return `<div class="${flag.trim()}"><span class="fieldlabel">${label}</span><button class="select-btn"><span>${esc(c.options[0] || '')}</span><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button></div>`;
    case 'checkbox':
      return `<div class="cb-row${flag}"><button class="sw${c.default ? ' on' : ''}" aria-label="${label}"></button><span>${label}</span></div>`;
    case 'color':
      return `<div class="cb-row${flag}"><span class="swatch" style="width:24px;height:24px;border-radius:5px;border:1px solid rgba(255,255,255,.2);background:${c.default || '#fff'}"></span><span>${label}</span></div>`;
    case 'text':
      return `<div class="${flag.trim()}"><span class="fieldlabel">${label}</span><input class="select-btn" style="border:1px solid rgba(255,255,255,.14)" value="${esc(c.default || '')}"></div>`;
    case 'canvas':
      return `<div class="${flag.trim()}"><span class="fieldlabel">${label}</span><div class="wf-canvas"></div></div>`;
    case 'button':
      return `<button class="ibtn" style="width:auto;padding:0 10px;height:28px;border:1px solid rgba(255,255,255,.14);border-radius:var(--radius-sm);font-size:12px;gap:6px${flag}">${label}</button>`;
    default:
      return `<div class="${flag.trim()}">${label}</div>`;
  }
}

function buildColumn(sectionsData, renderFn, vocabClass) {
  const groups = [];
  for (const s of sectionsData) {
    const nonButtons = s.controls.filter((c) => c.kind !== 'button');
    const buttons = s.controls.filter((c) => c.kind === 'button');
    const body = [
      ...nonButtons.map(renderFn),
      buttons.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${buttons.map(renderFn).join('')}</div>` : '',
    ].filter(Boolean).join('\n          ');
    if (vocabClass === 'app') {
      groups.push(`<div>
          <div class="fx-ctrl-title">${esc(s.title || s.key)} ${s.hasToggle ? `<div class="fx-toggle${s.defaultOn ? ' on' : ''}"></div>` : ''}</div>
          <div class="fx-fields${s.defaultOn ? '' : ' ff-off'}">
          ${body || '<div style="color:var(--mut);font-size:11px">(no static controls — see extraction notes)</div>'}
          </div>
        </div>`);
    } else {
      groups.push(`<div class="grp${s.defaultOn ? '' : ' off'}">
          <div class="grp-hd"><span class="fieldlabel">${esc(s.title || s.key)}</span>${s.hasToggle ? `<button class="sw${s.defaultOn ? ' on' : ''}" aria-label="${esc(s.title)} ${s.defaultOn ? 'on' : 'off'}"></button>` : ''}</div>
          <div class="grp-bd">
          ${body || '<p class="hint">(no static controls — see extraction notes)</p>'}
          </div>
        </div>`);
    }
  }
  return groups.join('\n        ');
}

function buildDiffList(sectionsData) {
  const items = [];
  for (const s of sectionsData) {
    for (const c of s.controls) {
      if (c.unlabeled) items.push(`<li><b class="unlabeled">Unlabeled</b>[${s.key}] a ${c.kind}${c.id ? ' (#' + c.id + ')' : ''} has no discoverable label in the live DOM — confirm its real name before drafting a proposal for it.</li>`);
      else items.push(`<li><b class="kept">Kept</b>[${s.key}] ${esc(c.label)} — carried over unchanged. This is a starting point, not a recommendation: edit the PROPOSED column and this line stops applying.</li>`);
    }
  }
  return items.join('\n      ');
}

async function buildPanel(panelKey) {
  const sectionKeys = PANEL_SECTIONS[panelKey];
  if (!sectionKeys) { console.log(`  skip ${panelKey}: not in PANEL_SECTIONS`); return; }
  const sections = sectionKeys.map((k) => inventory[k] ? { ...inventory[k], key: k } : null).filter(Boolean);
  const missing = sectionKeys.filter((k) => !inventory[k]);
  if (missing.length) console.log(`  ⚠ ${panelKey}: no extraction data for [${missing.join(', ')}] — run panel_extract.mjs first / check the section key`);
  if (!sections.length) { console.log(`  skip ${panelKey}: nothing extracted`); return; }

  const outPath = path.join(OUT_DIR, `${panelKey}.compare.html`);
  let existing = null;
  try { existing = await readFile(outPath, 'utf8'); } catch { /* new file */ }
  if (existing && existing.includes('data-reviewed="1"') && !FORCE) {
    console.log(`  skip ${panelKey}: marked data-reviewed="1" — pass --force to overwrite (confirm with the user first)`);
    return;
  }

  const totalControls = sections.reduce((n, s) => n + s.controls.length, 0);
  const totalUnlabeled = sections.reduce((n, s) => n + s.controls.filter((c) => c.unlabeled).length, 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Chromasmith — ${esc(panelKey)} panel (current vs proposed)</title>
<!--
  AUTO-GENERATED DRAFT by test/panel_compare_build.mjs from test/output/panel_inventory.json
  (Stage 1 live-app extraction, ${new Date().toISOString().slice(0, 10)}). PROPOSED is a
  mechanical 1:1 translation of CURRENT into the wireframe's component vocabulary — it is a
  starting point for review, not a design. Edit the PROPOSED column directly; once you do, add
  data-reviewed="1" to .col.proposed below so a re-run of this tool never overwrites your edits.

  App sections in this panel: ${sections.map((s) => s.key).join(', ')}.
  ${totalUnlabeled ? `⚠ ${totalUnlabeled} of ${totalControls} controls have no discoverable label in the live DOM (see the diff list) — confirm their real names before finalizing.` : `All ${totalControls} controls extracted with a label.`}
-->
${HEAD}
</head>
<body>
<div class="pagehead">
  <h1>${esc(panelKey.charAt(0).toUpperCase() + panelKey.slice(1))} panel — current vs proposed</h1>
  <p>Auto-drafted from the live app. CURRENT is exactly what ships today (${totalControls} controls
  across ${sections.length} section${sections.length === 1 ? '' : 's'}: ${sections.map((s) => esc(s.title || s.key)).join(', ')}).
  PROPOSED starts as the same content in the wireframe's component vocabulary — nothing has been
  cut, merged, or reordered yet. Edit the PROPOSED column to actually redesign the panel.</p>
  ${totalUnlabeled ? `<div class="warn">${totalUnlabeled} control${totalUnlabeled === 1 ? '' : 's'} below could not be labeled automatically — flagged with a dashed outline in both columns.</div>` : ''}
</div>
<section class="cmp">
  <h2>${esc(panelKey.charAt(0).toUpperCase() + panelKey.slice(1))}</h2>
  <div class="where">chromasmith-22.html: data-fxsec="${sections.map((s) => s.key).join('", "')}"</div>
  <div class="cols">
    <div class="col">
      <span class="tag">Current — app</span>
      <div class="spec app">
        ${buildColumn(sections, renderAppControl, 'app')}
      </div>
    </div>
    <div class="col proposed">
      <span class="tag">Proposed (unreviewed draft)</span>
      <div class="spec wf">
        ${buildColumn(sections, renderWfControl, 'wf')}
      </div>
    </div>
    <ul class="changes">
      ${buildDiffList(sections)}
    </ul>
  </div>
</section>
</body>
</html>
`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(outPath, html);
  console.log(`  wrote ${path.relative(ROOT, outPath)} (${sections.length} sections, ${totalControls} controls, ${totalUnlabeled} unlabeled)`);
}


const targets = ONLY_PANEL ? [ONLY_PANEL] : Object.keys(PANEL_SECTIONS);
console.log(`Building ${targets.length} panel compare page(s)...`);
for (const p of targets) await buildPanel(p);
