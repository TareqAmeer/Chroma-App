#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

const htmlEscape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function readAsset(base, relative, label) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error(`${label} path is required`);
  const file = path.resolve(base, relative);
  const bytes = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
  if (mime) return { file, bytes, sha256: sha256(bytes), dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  return { file, bytes, sha256: sha256(bytes), dataUrl: null };
}

function loadReviewManifest(manifestFile) {
  const file = path.resolve(manifestFile);
  const base = path.dirname(file);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1) throw new Error('manifest.version must be 1');
  if (!manifest.model?.name || !/^([a-f\d]{64})$/i.test(manifest.model.sha256 || '') || !manifest.model.runtime) {
    throw new Error('manifest.model needs name, 64-digit sha256, and runtime');
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) throw new Error('manifest.cases must contain at least one review case');

  const cases = manifest.cases.map((item) => {
    if (!item.id || !['dust', 'wire', 'person'].includes(item.kind)) throw new Error('each case needs an id and kind: dust, wire, or person');
    if (!item.photoSource || !item.photoLicense || !item.maskDescription) throw new Error(`${item.id}: photo source, license, and mask description are required`);
    const source = readAsset(base, item.source, `${item.id} source`);
    if (!source.dataUrl) throw new Error(`${item.id}: source must be PNG or JPEG`);
    const mask = readAsset(base, item.maskDefinition, `${item.id} mask definition`);
    if (!Array.isArray(item.candidates) || item.candidates.length !== 3) throw new Error(`${item.id}: exactly three candidate paths are required`);
    const candidates = item.candidates.map((candidate, index) => {
      const asset = readAsset(base, candidate.path, `${item.id} candidate ${index + 1}`);
      if (!asset.dataUrl) throw new Error(`${item.id} candidate ${index + 1}: candidate must be PNG or JPEG`);
      return { id: candidate.id || `candidate-${index + 1}`, ...asset };
    });
    if (new Set(candidates.map((candidate) => candidate.sha256)).size !== 3) throw new Error(`${item.id}: candidate images must be distinct`);
    return {
      id: String(item.id),
      kind: item.kind,
      photoSource: String(item.photoSource),
      photoLicense: String(item.photoLicense),
      maskDescription: String(item.maskDescription),
      source,
      mask,
      candidates,
    };
  });
  return { file, model: manifest.model, cases };
}

function renderReview({ manifest, outputPath }) {
  const report = {
    createdAt: new Date().toISOString(),
    manifest: path.basename(manifest.file),
    model: manifest.model,
    cases: manifest.cases.map((item) => ({
      id: item.id,
      kind: item.kind,
      photoSource: item.photoSource,
      photoLicense: item.photoLicense,
      sourceSha256: item.source.sha256,
      maskDescription: item.maskDescription,
      maskDefinitionSha256: item.mask.sha256,
      candidates: item.candidates.map(({ id, sha256: hash }) => ({ id, sha256: hash })),
    })),
  };
  const safeReportJson = JSON.stringify(report).replaceAll('<', '\\u003c');
  const caseHtml = manifest.cases.map((item, caseIndex) => {
    const panels = [
      { id: 'source', label: 'Original source', asset: item.source },
      ...item.candidates.map((asset) => ({ id: asset.id, label: asset.id, asset })),
    ].map((panel, panelIndex) => `<section class="panel"><h3>${htmlEscape(panel.label)}</h3><p class="hash">SHA-256 ${htmlEscape(panel.asset.sha256)}</p><div class="viewport"><img src="${panel.asset.dataUrl}" alt="${htmlEscape(item.id)} ${htmlEscape(panel.label)} at 100 percent" data-case="${caseIndex}" data-panel="${panelIndex}"></div></section>`).join('');
    const ratings = item.candidates.map((candidate, candidateIndex) => `<fieldset data-candidate="${candidateIndex}"><legend>${htmlEscape(candidate.id)}</legend><label>Decision <select name="decision"><option value="unreviewed">Not reviewed</option><option value="accept">Accept</option><option value="reject">Reject</option><option value="follow-up">Needs follow-up</option></select></label><div class="checks">${['wire remnants', 'smearing', 'repeat pattern', 'colour shift'].map((artifact) => `<label><input type="checkbox" name="artifacts" value="${artifact}">${artifact}</label>`).join('')}</div><label>100% review note <textarea name="note" rows="2" placeholder="Describe the visible result or crop inspected"></textarea></label></fieldset>`).join('');
    return `<article class="case" data-case="${caseIndex}"><header><h2>${htmlEscape(item.id)} <small>(${htmlEscape(item.kind)} removal)</small></h2><p><b>Photo:</b> ${htmlEscape(item.photoSource)} · ${htmlEscape(item.photoLicense)}</p><p><b>Mask:</b> ${htmlEscape(item.maskDescription)} · definition SHA-256 ${htmlEscape(item.mask.sha256)}</p></header><div class="gallery">${panels}</div><div class="ratings">${ratings}</div></article>`;
  }).join('');

  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CHR-246 inpainting review</title><style>
    :root{color-scheme:dark;font:14px/1.45 system-ui,sans-serif;background:#14171b;color:#edf0f4}body{margin:0}main{padding:20px;max-width:1700px;margin:auto}h1,h2,h3,p{margin-top:0}h2{margin-bottom:4px}small,.muted,.hash{color:#aeb8c5}.toolbar{position:sticky;top:0;z-index:2;background:#20252b;padding:12px;border:1px solid #37404a;border-radius:8px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}.toolbar button{padding:8px 12px}.case{border:1px solid #39414b;border-radius:10px;padding:16px;margin:20px 0}.gallery{display:grid;grid-template-columns:repeat(2,minmax(320px,1fr));gap:10px}.panel{min-width:0;background:#20252b;padding:10px;border-radius:7px}.panel h3{margin:0}.hash{font:11px ui-monospace,monospace;overflow-wrap:anywhere}.viewport{height:min(72vh,820px);overflow:auto;border:1px solid #59636f;background:repeating-conic-gradient(#282d33 0 25%,#1e2329 0 50%) 0/18px 18px}.viewport img{display:block;max-width:none;width:auto;height:auto}.ratings{display:grid;grid-template-columns:repeat(3,minmax(240px,1fr));gap:10px;margin-top:12px}fieldset{border:1px solid #46515e;border-radius:7px}legend{font-weight:650}.checks{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:8px 0}.ratings textarea{display:block;width:95%;margin-top:4px}label{display:block;margin:4px 0}.warning{color:#ffd68a}.hash, .case p{overflow-wrap:anywhere}@media(max-width:800px){.gallery{grid-template-columns:1fr}.ratings{grid-template-columns:1fr}}
    </style><main><h1>CHR-246 candidate review</h1><p class="warning">Visual inspection only. Inspect each candidate at native 100% scale; no score here proves acceptable semantic removal. Original pixels outside the authored mask are expected to remain unchanged.</p><p class="muted">Model: ${htmlEscape(manifest.model.name)} · SHA-256 ${htmlEscape(manifest.model.sha256)} · runtime ${htmlEscape(manifest.model.runtime)}</p><div class="toolbar"><button id="save-review">Download review JSON</button><label>Reviewer <input id="reviewer" autocomplete="name"></label><span id="status" role="status">Review not exported</span></div>${caseHtml}</main><script type="application/json" id="report-data">${safeReportJson}</script><script>
      const baseline=JSON.parse(document.getElementById('report-data').textContent);
      document.querySelectorAll('.case').forEach(card=>{const viewports=[...card.querySelectorAll('.viewport')];viewports.forEach((viewport,index)=>viewport.addEventListener('scroll',()=>{const other=viewports[(index+1)%viewports.length];if(other&&other.dataset.syncing!=='1'){other.dataset.syncing='1';other.scrollTop=viewport.scrollTop;other.scrollLeft=viewport.scrollLeft;requestAnimationFrame(()=>delete other.dataset.syncing)}}))});
      document.getElementById('save-review').addEventListener('click',()=>{const cards=[...document.querySelectorAll('.case')];const result={...baseline,reviewedAt:new Date().toISOString(),reviewer:document.getElementById('reviewer').value.trim(),visualReviewOnly:true,cases:baseline.cases.map((entry,index)=>{const card=cards[index];return {...entry,candidates:[...card.querySelectorAll('fieldset')].map((field,candidateIndex)=>({...entry.candidates[candidateIndex],decision:field.querySelector('[name=decision]').value,artifacts:[...field.querySelectorAll('[name=artifacts]:checked')].map(x=>x.value),note:field.querySelector('textarea').value.trim()}))}})};const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='chr246-quality-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById('status').textContent='Review JSON downloaded'});
    </script></html>`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chr246-review-test-'));
  try {
    const image = (color) => PNG.sync.write(Object.assign(new PNG({ width: 2, height: 2 }), { data: Buffer.from(Array.from({ length: 4 }, () => [...color, 255]).flat()) }));
    fs.writeFileSync(path.join(root, 'source.png'), image([40, 80, 120]));
    fs.writeFileSync(path.join(root, 'mask.json'), '{"polygon":[[0,0],[1,1]]}');
    for (let i = 0; i < 3; i += 1) fs.writeFileSync(path.join(root, `candidate-${i}.png`), image([40 + i * 30, 80, 120]));
    const manifestFile = path.join(root, 'manifest.json');
    const manifest = { version: 1, model: { name: 'test-model', sha256: 'a'.repeat(64), runtime: 'test-runtime' }, cases: [{ id: 'wire-test', kind: 'wire', photoSource: 'synthetic test', photoLicense: 'generated', source: 'source.png', maskDefinition: 'mask.json', maskDescription: 'synthetic polygon', candidates: [0, 1, 2].map((i) => ({ id: `candidate-${i}`, path: `candidate-${i}.png` })) }] };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const parsed = loadReviewManifest(manifestFile);
    const out = path.join(root, 'review.html');
    renderReview({ manifest: parsed, outputPath: out });
    const html = fs.readFileSync(out, 'utf8');
    if (!html.includes('native 100% scale') || !html.includes('repeat pattern') || !html.includes('SHA-256') || !html.includes('Download review JSON')) throw new Error('review report omitted required provenance or inspection controls');
    const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
    if (!inlineScript) throw new Error('review report omitted its interaction script');
    new Function(inlineScript[1]);
    manifest.cases[0].candidates[2].path = 'candidate-1.png';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    let duplicateRefused = false;
    try { loadReviewManifest(manifestFile); } catch (error) { duplicateRefused = /must be distinct/.test(error.message); }
    if (!duplicateRefused) throw new Error('duplicate candidate output must be rejected');
    console.log('PASS: human-review report embeds provenance, review controls, and rejects duplicate candidates.');
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('chr246-review-test-')) throw new Error('refusing to remove unexpected self-test directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const [mode, first, second, third] = process.argv.slice(2);
try {
  if (mode === '--self-test' && first === undefined) selfTest();
  else if (mode === '--manifest' && first && second === '--output' && third) {
    const manifest = loadReviewManifest(first);
    renderReview({ manifest, outputPath: path.resolve(third) });
    console.log(`Wrote ${third} with ${manifest.cases.length} case(s); inspect every candidate at 100% and export the human review.`);
  } else throw new Error('Usage: node test/inpaint_quality_review.mjs --manifest <manifest.json> --output <review.html> | --self-test');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
