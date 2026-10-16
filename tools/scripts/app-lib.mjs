// Shared split/build logic for chromasmith-22.html <-> src/app/ (docs/plans/refactor-plan.md, Phase 1).
// Each target is a committed generated file with a src dir that can be edited instead (two-way sync, app-sync.mjs).
export const TARGETS = [
  { target: 'chromasmith-22.html', dir: 'src/app', mode: 'html' },
  { target: 'desktop/library-ui.js', dir: 'src/library-ui', mode: 'text', cutRe: /^ {0,2}\/\/ ── / },
  { target: 'desktop/src-tauri/src/catalog.rs', dir: 'src/catalog', mode: 'text', cutRe: /^\/\/ ── / },
  { target: 'desktop/src-tauri/src/library.rs', dir: 'src/library', mode: 'text', cutRe: /^\/\/ ── / },
  { target: 'desktop/src-tauri/src/main.rs', dir: 'src/main-rs', mode: 'text', cutRe: /^\/\/ ── / },
];
const TARGET = 'chromasmith-22.html';
// Domain folders for the cut sections of the big script. Layout only: parts' order is in manifest.json, so
// this never changes the built file. A part is classified by the first identifier it declares (IDENT_RULES),
// then by its header slug (SLUG_RULES), else "editor".
const IDENT_RULES = [
  ['renderer', /^(?:float|vec[234]|mat[234]|int|void|uniform|FX|FXR|FXExport|FXDisplay|GLSL)|^fxPrepareExportRenderer|^renderSnapshotTo/],
  ['masks', /^_?msk|^MSK_|^heal|^_?sam[A-Z_]|^PASTE_|^_PASTE|^_paste|^CR_MAX/],
  ['subjects-ai', /^_?subj|^SUBJ|^_?face|^_?depth|^fxHasDepth|^fxDepth|^fxSyncDepth|^FN_|^fn[A-Z]|^SKIN_|^_?skin/],
  ['collage', /^CL_|^cl[A-Z]|^_cat|^applyClLayout/],
  ['google-photos', /^_GP|^_?gp[A-Z]|^pkce/],
  ['color-raw', /^DCP|^CAMERA_DCP|^cameraDcp|^resolveDcp|^rawProfileFor|^srgb|^_srgb|^s2l|^l2s|^r2hsv|^applyHSL|^sampleLUT|^_ok|^rgb2|^oklch|^PROPHOTO|^XYZ|^_mat3|^proPhoto|^convertProPhoto|^LUT_|^_lut|^presetBytes|^lutWarm|^CHART|^chartSize|^makeLutChart|^HSL_|^hsl|^_hsl|^_?autoEnh|^_AE_|^autoEnhance|^fxGamut|^fxClip|^fxPeak|^fxTogglePeak|^fxRawNr|^fxDemosaic|^_fxDenoise|^FMT_RAW|^RAW_|^IMG_EXT|^RUST_ONLY|^_circ|^getPx/],
  ['export-io', /^_?exp[A-Z_]|^EXP_|^_?export|^fxJpeg|^fxExport|^_fmt|^readExif|^_?xmp|^buildRecipeXmp|^mergeExport|^jpegMeta|^png|^_crc|^crc32|^injectMeta|^neutralize|^exifRes|^readDPI|^capNative|^_u8b64|^cap[A-Z]|^_cap|^tauriNative|^fxHdr|^fxSyncHdr|^_?videoInfo|^_fxPeoplePath|^_EXPPRESET/],
  ['history-presets', /^_?ver[A-Z]|^_?styles?[A-Z_]|^_STYLES|^_ALLFX|^allFx|^_?pm[A-Z]|^_SESS|^_?sess|^snapDiff|^_fxFieldLabel|^_FX_ID|^_fxPrettyId|^_?fxTimeline|^_fxTimelinePreview|^resolveSplit|^_fxSplit|^fxSetSplitSrc|^fxComparePrevious|^FX_ORIG|^exportPreset/],
  ['shell-ui', /^a11y|^csFocus|^_?ovf|^ovf|^tools(Build|Close)|^_?cp[A-Z]|^_cpCommands|^appH|^fxSyncDeskbar|^_diag|^diagLayout|^_mq|^applyFxLayout|^relocatePreview|^applyMobileFx|^LS_EDITOR_BG|^EDITOR_BG|^editorBg|^toggleTheme|^syncTheme|^fxSetTheme|^fxPaintSlider|^initSlider|^EXP_SHARP|^_lf[A-Z]|^fxLiveFit|^_fxWinResize|^_SEC_|^_sec[A-Z]|^_ADV|^csShowAdvanced|^_csAdv|^csAbout|^toggleLog|^fxPaintAll|^fxClampPopover|^fxUpdateHistoryBtn|^initCompareButton|^isMemoryConstrained/],
];
const SLUG_RULES = [
  ['masks', /mask|brush|coat|retouch|selective|eyedropper|pointer-photo/],
  ['subjects-ai', /subject|face|eye-detect|depth|skin|ai-brush|taught|scan-every|confirm-reject|small-client|film-negative/],
  ['color-raw', /dcp|raw|icc|oklab|prophoto|hlg|lut|calibrated|halation|built-in-preset|auto-enhance|wb-|hue-pop|panasonic|a19|gamut|c4-|auto-seed/],
  ['google-photos', /google-photos|pkce|import-picker/],
  ['export-io', /export|dpi|splice|exif|metadata|native-save|capacitor|plain-export|tauri/],
  ['history-presets', /history|versions|copy-on-write|session|b2-|b3-|chr-197|chr-203|styles|all-fx|named-export|presets|b1-/],
  ['shell-ui', /theme|layout|deskx|sheet|live-fit|command-palette|accessib|first-timer|about|app-height|fx-editor|slider|workspace|a15|a18/],
];
const firstIdent = text => { const m = /^(?:async\s+)?(?:function\*?\s+|(?:const|let|var|class)\s+)([A-Za-z_$][\w$]*)/m.exec(text); return m ? m[1] : ''; };
const domainOf = (slug, text) => {
  const id = firstIdent(text);
  return (IDENT_RULES.find(([, re]) => id && re.test(id)) || SLUG_RULES.find(([, re]) => re.test(slug)) || ['editor'])[0];
};
const BIG = 2000;
const SUB = 450, SUB_STEP = 250; // see sub-cutting below // script segments longer than this are cut at section headers

// text -> { files: {name: content}, manifest }  (lossless: join(parts, '\n') === text)
const slugOf = l => l.replace(/^\s*\/\/ ── /, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'section';

// Generic text target: cut at every line matching cfg.cutRe; parts re-join with "\n".
function splitPlain(text, cfg) {
  const lines = text.split('\n'), cuts = [0];
  for (let n = 1; n < lines.length; n++) if (cfg.cutRe.test(lines[n])) cuts.push(n);
  cuts.push(lines.length);
  const files = {}, info = [], used = new Set();
  for (let k = 0; k < cuts.length - 1; k++) {
    let base = k === 0 ? 'head' : slugOf(lines[cuts[k]]), name = base + '.part', d = 2;
    while (used.has(name)) name = base + '-' + d++ + '.part';
    used.add(name);
    files[name] = lines.slice(cuts[k], cuts[k + 1]).join('\n');
    info.push({ file: name, firstLine: cuts[k] + 1, lines: cuts[k + 1] - cuts[k] });
  }
  const manifest = { target: cfg.target, join: '\n', parts: info.map(m => m.file), info };
  files['manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { files, manifest };
}

export function splitText(text, cfg = TARGETS[0]) {
  if (cfg.mode === 'text') return splitPlain(text, cfg);
  const lines = text.split('\n');
  const segs = [];
  let start = 0, inScript = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inScript && /^<script(\s[^>]*)?>/.test(l)) {
      if (i > start) segs.push({ kind: 'html', from: start, to: i });
      start = i;
      if (/<\/script>\s*$/.test(l)) { segs.push({ kind: 'script', from: i, to: i + 1 }); start = i + 1; }
      else inScript = true;
    } else if (inScript && /<\/script>\s*$/.test(l)) {
      segs.push({ kind: 'script', from: start, to: i + 1 }); start = i + 1; inScript = false;
    }
  }
  if (start < lines.length) segs.push({ kind: 'html', from: start, to: lines.length });
  const files = {}, info = [], used = new Set();
  const add = (name, kind, from, to) => {
    files[name] = lines.slice(from, to).join('\n');
    info.push({ file: name, kind, firstLine: from + 1, lines: to - from });
  };
  segs.forEach((s, i) => {
    const base = String(i).padStart(2, '0') + '-' + s.kind;
    const ext = s.kind === 'script' ? '.js.html' : '.html';
    if (s.kind !== 'script' || s.to - s.from < BIG) return add(base + ext, s.kind, s.from, s.to);
    // Big script: cut at every column-0 "// ── " section header. Pure text cuts (parts re-join with
    // "\n"), named by header slug so adding/removing a section doesn't rename its neighbours.
    const cuts = [s.from];
    for (let n = s.from + 1; n < s.to; n++) if (lines[n].startsWith('// ── ')) cuts.push(n);
    cuts.push(s.to);
    // Sections still over SUB lines (header covered a long mixed run) are cut further at column-0
    // declarations outside template literals, every >= SUB_STEP lines, named by the first declared identifier.
    const sub = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      sub.push({ from: cuts[k], to: cuts[k + 1], head: true });
      if (cuts[k + 1] - cuts[k] <= SUB) continue;
      let tick = 0, last = cuts[k];
      for (let n = cuts[k]; n < cuts[k + 1]; n++) {
        const l = lines[n];
        if (n - last >= SUB_STEP && tick % 2 === 0 && /^(?:async\s+)?(?:function\b|(?:const|let|var|class)\s+[A-Za-z_$])/.test(l)) {
          sub[sub.length - 1].to = n; sub.push({ from: n, to: cuts[k + 1], head: false }); last = n;
        }
        const bt = l.replace(/\\./g, '').split('`').length - 1; tick += bt;
      }
    }
    sub.forEach((c, k) => {
      const text = lines.slice(c.from, c.to).join('\n');
      const hdr = c.head && c.from !== s.from ? slugOf(lines[c.from]) : c.head ? 'head' : null;
      const ident = firstIdent(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'part';
      const slug = hdr || ('cont-' + ident);
      const dom = domainOf(slug, text);
      let name = base + '/' + (hdr === 'head' ? 'head' : dom + '/' + slug) + ext, d = 2;
      while (used.has(name)) name = base + '/' + (hdr === 'head' ? 'head' : dom + '/' + slug) + '-' + d++ + ext;
      used.add(name);
      add(name, 'script', c.from, c.to);
    });
  });
  const manifest = { target: cfg.target, join: '\n', parts: info.map(m => m.file), info };
  files['manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { files, manifest };
}

// (manifest, readPart(name)) -> text
export function buildText(manifest, readPart) {
  return manifest.parts.map(readPart).join(manifest.join);
}
