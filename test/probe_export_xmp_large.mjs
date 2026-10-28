#!/usr/bin/env node
// Exports with a sidecar XMP bigger than one JPEG APP1 segment (64KB) used to throw and fail the
// export. Checks: Library edit state is dropped, oversize metadata goes to Extended XMP, the GUID
// is a correct MD5, and exiftool reassembles it.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await new Promise(r => { const s = createServer(async (q, res) => {
  try { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); } }); s.listen(0, '127.0.0.1', () => r(s)); });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.injectRecipeXmp === 'function');
const r = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
  const wrap = d => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:chromasmith="http://chromasmith.app/ns/1.0/" xmp:Rating="4" chromasmith:ColorLabel="red" ${d}/></rdf:RDF></x:xmpmeta>`;
  const big = 'A'.repeat(150000);
  const recipeOnly = injectRecipeXmp(jpg, 'jpg', 'Portra', '', wrap(`chromasmith:Recipe="${big}" chromasmith:Versions="${big}"`));
  const bigDesc = injectRecipeXmp(jpg, 'jpg', 'Portra', '', wrap(`dc:description="${'B'.repeat(150000)}"`));
  const t = b => new TextDecoder('latin1').decode(b);
  return { recipeOnlyLen: recipeOnly.length - jpg.length, recipeDropped: !t(recipeOnly).includes('AAAA'),
    keptLabel: t(recipeOnly).includes('ColorLabel'), bigDesc: Array.from(bigDesc),
    md5: _md5Hex(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')) };
});
const fail = [];
if (r.md5 !== createHash('md5').update('The quick brown fox jumps over the lazy dog').digest('hex').toUpperCase()) fail.push('md5');
if (!r.recipeDropped || r.recipeOnlyLen > 65535) fail.push('edit state not dropped');
if (!r.keptLabel) fail.push('colour label lost');
const f = path.join(os.tmpdir(), 'cs_xmp_large.jpg'); await writeFile(f, Uint8Array.from(r.bigDesc));
const ex = JSON.parse(execFileSync('exiftool', ['-j', '-XMP:Description', '-XMP:Rating', '-XMP:Look', '-XMP:HasExtendedXMP', f]))[0];
const buf = Buffer.from(r.bigDesc), txt = buf.toString('latin1');
const guid = ex.HasExtendedXMP, sOff = txt.indexOf('http://ns.adobe.com/xmp/extension/');
if (!guid || (ex.Description || '').length !== 150000 || ex.Rating !== 4 || ex.Look !== 'Portra') fail.push('exiftool read-back ' + JSON.stringify({ guid, d: (ex.Description||'').length, rating: ex.Rating, look: ex.Look }));
if (sOff < 0) fail.push('no extension segment');
console.log(fail.length ? 'FAIL ' + fail.join('; ') : 'PASS large XMP export (edit state dropped, Extended XMP read back by exiftool, MD5 ok)');
await browser.close(); server.close(); process.exit(fail.length ? 1 : 0);
