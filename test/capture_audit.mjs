// Audits design/asbuilt/<id>/*.webp against the S6c capture plan (docs/ui-workflow/STATE.md).
// Per surface, checks:
//   - the image count matches what the plan for that surface's kind expects, minus any recorded
//     skip (unreachable surfaces have no images at all, which is itself a checked expectation)
//   - no image is blank or near-uniform (stddev of luma across the frame)
//   - each image's overall brightness matches the theme its filename claims (dark/light)
//   - Editor section crops are well taller than a bare title bar
//   - filenames only use the real layout-axis vocabulary (rail=/panel=/dock=/sidebar=/panel220/
//     panel440), never an invented one
//
// node test/capture_audit.mjs            # PASS/FAIL per surface
// node test/capture_audit.mjs --json      # full finding list
import { chromium } from 'playwright';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DUMP_JSON = process.argv.includes('--json');
const surfacesDoc = JSON.parse(await readFile(path.join(ROOT, 'design/surfaces.json'), 'utf8'));

const KNOWN_LABELS = new Set([
  'default', 'rail-icons', 'rail-labels', 'rail-hidden',
  'panel-220', 'panel-440', 'panel-closed',
  'dock-90', 'dock-420', 'dock-closed',
  'sidebar-150', 'sidebar-420', 'sidebar-hidden',
]);

function expectedFilesFor(entry) {
  if (entry.id === 'panel-fx') {
    const files = [];
    for (const w of [760, 1920]) for (const t of ['dark', 'light']) for (const l of ['default', 'rail-icons', 'rail-labels', 'rail-hidden', 'panel-220', 'panel-440', 'panel-closed', 'dock-90', 'dock-420', 'dock-closed']) files.push(`whole_${w}_${t}_${l}.webp`);
    return files;
  }
  if (entry.id === 'library') {
    const files = [];
    for (const w of [760, 1920]) for (const t of ['dark', 'light']) for (const l of ['default', 'sidebar-150', 'sidebar-420', 'sidebar-hidden']) files.push(`whole_${w}_${t}_${l}.webp`);
    return files;
  }
  if (entry.kind === 'fxsec') {
    const files = [];
    for (const p of [220, 440]) for (const t of ['dark', 'light']) { files.push(`panel${p}_${t}.webp`); files.push(`panel${p}_${t}_crop.webp`); }
    return files;
  }
  const OTHER_KINDS = new Set(['menu', 'modal', 'confirm', 'toast']);
  if (OTHER_KINDS.has(entry.kind) || (entry.kind === 'page' && entry.id !== 'panel-fx' && entry.id !== 'library')) {
    const files = [];
    for (const t of ['dark', 'light']) { files.push(`open_${t}.webp`); files.push(`open_${t}_crop.webp`); }
    return files;
  }
  return null; // chrome/layout/other kinds — no dedicated images expected (judged from core shots)
}

const b = await chromium.launch();
const page = await b.newPage();

async function analyzeImage(filePath) {
  const buf = await readFile(filePath);
  const b64 = buf.toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    img.src = 'data:image/webp;base64,' + b64;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, sumSq = 0, n = 0, topSum = 0, topN = 0;
    for (let i = 0; i < data.length; i += 4 * 37) { // sample every 37th pixel — plenty for mean/variance, much faster than every pixel
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum; sumSq += lum * lum; n++;
      const pixel = i / 4;
      if (Math.floor(pixel / canvas.width) < Math.max(1, canvas.height * 0.1)) { topSum += lum; topN++; }
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return { width: canvas.width, height: canvas.height, meanLuma: mean, topLuma: topSum / topN, stdLuma: Math.sqrt(Math.max(0, variance)) };
  }, b64);
}

const findings = [];
const surfaceResults = [];
for (const entry of surfacesDoc.surfaces) {
  const expected = expectedFilesFor(entry);
  const dir = path.join(ROOT, 'design/asbuilt', entry.id);
  let actualFiles = [];
  try { actualFiles = (await readdir(dir)).filter((f) => f.endsWith('.webp')); } catch { /* no dir at all */ }

  if (entry.opened !== true || entry.unreachable === true) {
    // An unreachable marker is never self-approving, regardless of surface kind or whether a
    // partial image happens to exist. Splash is a documented static wireframe stand-in.
    const approved = entry.approvedBy === 'user' || entry.id === 'splash';
    if (!approved) findings.push({ id: entry.id, kind: 'NOT_CAPTURED', detail: `marked unreachable (${String(entry.note || 'no reason given').slice(0, 140)}). Find a real way to open it, or get the user to approve skipping it (approvedBy:"user")` });
    surfaceResults.push({ id: entry.id, ok: approved, note: approved ? 'documented stand-in/user-approved skip' : 'NOT CAPTURED' });
    continue;
  }

  if (expected === null) {
    // 2026-09-12: S6d chunks A/B/C gave a real "open_dark/open_light(+crop)" capture to small
    // kind:"chrome" elements too (icons/menus-within-chrome like ic-split, fx-secnav, hdr-about)
    // whose real appearance only shows in a specific state, not just from the whole-window shot —
    // the same reasoning the OTHER_KINDS set already applies to menu/modal/confirm/toast. This
    // table just hadn't been told "chrome" can legitimately do that too. Accept it when the files
    // on disk are EXACTLY that recognized open_* shape (not a looser check — an actual stray file
    // still fails below), rather than flag every one of them as unexpected.
    const chromeOpenSet = ['open_dark.webp', 'open_dark_crop.webp', 'open_light.webp', 'open_light_crop.webp'];
    const isRecognizedChromeCapture = entry.kind === 'chrome' && actualFiles.length === chromeOpenSet.length && chromeOpenSet.every((f) => actualFiles.includes(f));
    if (actualFiles.length && !isRecognizedChromeCapture) findings.push({ id: entry.id, kind: 'UNEXPECTED_IMAGES', detail: `${actualFiles.length} images present for a chrome/layout surface judged from whole-window shots — should have none: ${actualFiles.join(',')}` });
    surfaceResults.push({ id: entry.id, ok: actualFiles.length === 0 || isRecognizedChromeCapture });
    continue;
  }
  const missing = expected.filter((f) => !actualFiles.includes(f));
  const extra = actualFiles.filter((f) => !expected.includes(f));
  if (missing.length) findings.push({ id: entry.id, kind: 'MISSING_IMAGES', detail: missing.join(',') });
  if (extra.length) findings.push({ id: entry.id, kind: 'EXTRA_IMAGES', detail: extra.join(',') });

  // filename label vocabulary check (whole_* files only — panel/open files have a fixed shape)
  for (const f of actualFiles) {
    if (!f.startsWith('whole_')) continue;
    const m = /^whole_(\d+)_(dark|light)_(.+)\.webp$/.exec(f);
    if (!m) { findings.push({ id: entry.id, kind: 'BAD_FILENAME', detail: f }); continue; }
    if (!KNOWN_LABELS.has(m[3])) findings.push({ id: entry.id, kind: 'INVENTED_LABEL', detail: `${f} — "${m[3]}" is not a real layout-axis value` });
  }

  let surfaceOk = missing.length === 0 && extra.length === 0;
  for (const f of actualFiles) {
    const filePath = path.join(dir, f);
    let info;
    try { info = await analyzeImage(filePath); }
    catch (e) { findings.push({ id: entry.id, kind: 'DECODE_FAIL', detail: `${f}: ${e.message}` }); surfaceOk = false; continue; }

    if (info.stdLuma < 3) { findings.push({ id: entry.id, kind: 'BLANK_OR_UNIFORM', detail: `${f}: stddev=${info.stdLuma.toFixed(2)} (mean=${info.meanLuma.toFixed(1)})` }); surfaceOk = false; }

    const themeMatch = /_(dark|light)/.exec(f);
    if (themeMatch) {
      const theme = themeMatch[1];
      // Whole-window shots include a lot of near-black thumbnail rail regardless of theme (real
      // app behaviour, not a bug — verified visually in this session), which pulls the frame
      // average down; crops of a single panel are a cleaner signal. Use a lenient band for
      // whole-window shots and a tighter one for section/menu crops.
      const isCrop = f.includes('crop') || f.startsWith('panel') || f.startsWith('open_');
      const lo = isCrop ? (theme === 'dark' ? -1 : 100) : (theme === 'dark' ? -1 : 60);
      const hi = isCrop ? (theme === 'dark' ? 140 : 999) : (theme === 'dark' ? 170 : 999);
      // Compare/full-canvas surfaces can be mostly true black in BOTH themes. Their top chrome
      // remains theme-coloured, so a bright top band is valid evidence for light mode.
      const lightChromeMatches = theme === 'light' && info.topLuma >= 100;
      if (!lightChromeMatches && (info.meanLuma < lo || info.meanLuma > hi)) {
        findings.push({ id: entry.id, kind: 'THEME_MISMATCH', detail: `${f}: meanLuma=${info.meanLuma.toFixed(1)}, expected ${theme} theme range [${lo},${hi}]` });
        surfaceOk = false;
      }
    }

    if (entry.kind === 'fxsec' && f.endsWith('_crop.webp')) {
      if (info.height < 80) { findings.push({ id: entry.id, kind: 'CROP_TOO_SHORT', detail: `${f}: height=${info.height}px — looks like a title-bar-only crop` }); surfaceOk = false; }
    }
  }
  surfaceResults.push({ id: entry.id, ok: surfaceOk });
}

await page.close();
await b.close();

if (DUMP_JSON) {
  console.log(JSON.stringify({ findings, surfaceResults }, null, 2));
} else {
  const passCount = surfaceResults.filter((r) => r.ok).length;
  console.log(`capture_audit: ${passCount}/${surfaceResults.length} surfaces PASS\n`);
  for (const r of surfaceResults) if (!r.ok) console.log(`  FAIL ${r.id}`);
  if (findings.length) {
    console.log(`\n${findings.length} finding(s):`);
    for (const f of findings) console.log(`  [${f.id}] ${f.kind}: ${f.detail}`);
  }
  console.log(findings.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
process.exit(findings.length ? 1 : 0);
