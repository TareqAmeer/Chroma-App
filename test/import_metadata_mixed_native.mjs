// Real WebView2 IPC and filesystem validation; requires an isolated native app on CDP.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), fixture = path.join(root, 'test/output/import-metadata-native', String(Date.now()));
const card = path.join(fixture, 'card'), primary = path.join(fixture, 'primary'), backup = path.join(fixture, 'backup'), delivery = path.join(fixture, 'delivery');
for (const dir of [card, primary, backup, delivery]) await mkdir(dir, {recursive:true});
const mixedSource=path.join(fixture,'mixed-source');
await mkdir(mixedSource,{recursive:true});
execFileSync(process.env.PYTHON || 'python',['-c',"from PIL import Image; import sys; from pathlib import Path; im=Image.open(sys.argv[1]).convert('RGB'); p=Path(sys.argv[2]); im.save(p/'portrait-webp.webp',lossless=True); im.save(p/'portrait-tiff.tif')",path.join(root,'test/fixtures/portrait.png'),mixedSource]);
const browser = await chromium.connectOverCDP(process.env.NATIVE_CDP || 'http://127.0.0.1:9223');
try {
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
  await page.waitForFunction(() => typeof loadFXImages === 'function' && !!window.__TAURI__?.core);
  const png = await readFile(path.join(root, 'test/fixtures/portrait.png'));
  await writeFile(path.join(card, 'portrait.png'), png);
  const jpg = await page.evaluate(async bytes => {
    const im = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im,0,0); im.close();
    return Array.from(new Uint8Array(await (await new Promise(r => c.toBlob(r,'image/jpeg',.9))).arrayBuffer()));
  }, Array.from(png));
  await writeFile(path.join(card, 'portrait.jpg'), new Uint8Array(jpg));
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:custom="urn:chr208:fixture" custom:Keep="unrelated-value"/></rdf:RDF></x:xmpmeta>';
  await writeFile(path.join(card, 'portrait.xmp'), xmp);
  for (const name of ['portrait-webp.webp','portrait-tiff.tif']) { await writeFile(path.join(card,name),await readFile(path.join(mixedSource,name))); await writeFile(path.join(card,name.replace(/\.[^.]+$/,'.xmp')),xmp); }
  const result = await page.evaluate(async ({card,primary,backup}) => {
    const invoke = window.__TAURI__.core.invoke;
    const files = await invoke('scan_card', {path:card, destRoot:primary});
    const options = {destRoot:primary, backupRoot:backup, folderTemplate:'{YYYY-MM-DD}', filenameTemplate:null, sequenceStart:1, skipDuplicates:true, only:[], metadata:{creator:'CHR208 Creator', copyright:'CHR208 Copyright', caption:'CHR208 Caption', jobProject:'CHR208 Job', keywords:['CHR208 Keyword'], startingEditRecipe:''}};
    const first = await invoke('ingest_copy', {files,options,jobId:'chr208-native-first'});
    const again = await invoke('ingest_copy', {files,options,jobId:'chr208-native-repeat'});
    return {first,again};
  }, {card,primary,backup});
  assert.equal(result.first.copied,4, JSON.stringify(result));
  assert.equal(result.again.copied,0, 'second import must skip duplicates');
  assert.equal(result.again.duplicates_skipped,4);
  for (const file of result.first.completed_files) {
    const sidecar = file.replace(/\.[^.]+$/, '.xmp');
    const text = await readFile(sidecar,'utf8');
    for (const value of ['CHR208 Creator','CHR208 Copyright','CHR208 Caption','CHR208 Job','CHR208 Keyword','unrelated-value']) assert.ok(text.includes(value),value);
    const second = path.join(backup,path.relative(primary,sidecar));
    assert.equal(await readFile(second,'utf8'),text,'second copy preserves merged XMP');
  }
  await page.evaluate(async ({files,delivery}) => {
    await __TAURI__.core.invoke('set_export_dir',{path:delivery});
    const sources = [];
    for (const p of files) {
      const bytes = await __TAURI__.core.invoke('read_file_bytes',{path:p});
      sources.push(new File([new Uint8Array(bytes)], p.split(/[\\/]/).pop(), {type:p.endsWith('.png')?'image/png':p.endsWith('.webp')?'image/webp':p.endsWith('.tif')?'image/tiff':'image/jpeg'}));
    }
    await loadFXImages(sources);
    window.chromasmithGetOpenedPaths=()=>files;
    fxExportScope='all'; document.getElementById('sel-exp-fmt').value='jpg';document.getElementById('fx-fname').value='{name}{nover}';
    await exportFX();
    document.getElementById('sel-exp-fmt').value='png';
    await exportFX();
    await __TAURI__.core.invoke('set_export_dir',{path:''});
  }, {files:result.first.completed_files,delivery});
  const outputs = (await readdir(delivery)).filter(n=>/\.(jpg|png)$/.test(n));
  assert.equal(outputs.length,8);
  for (const name of outputs) {
    const text=(await readFile(path.join(delivery,name))).toString('utf8');
    for (const value of ['CHR208 Creator','CHR208 Copyright','CHR208 Caption','CHR208 Job','CHR208 Keyword','unrelated-value']) assert.ok(text.includes(value),`export ${name} lost ${value}`);
  }
  const policies = await page.evaluate(() => {
    const xml='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:custom="urn:test" exif:GPSLatitude="51,0N" custom:Keep="yes"><exif:GPSLongitude>0,1W</exif:GPSLongitude></rdf:Description></rdf:RDF></x:xmpmeta>';
    const keep=mergeExportSidecarXmp(buildRecipeXmp('Test',''),xml,true),remove=mergeExportSidecarXmp(buildRecipeXmp('Test',''),xml,false);
    let invalid=false;try{mergeExportSidecarXmp(buildRecipeXmp('Test',''),'<invalid',true)}catch{invalid=true}
    return {keep,remove,invalid};
  });
  assert.ok(policies.keep.includes('GPSLatitude') && policies.keep.includes('GPSLongitude'));
  assert.ok(!policies.remove.includes('GPSLatitude') && !policies.remove.includes('GPSLongitude'));
  assert.ok(policies.remove.includes('custom:Keep="yes"') && policies.invalid);
  console.log(JSON.stringify({passed:true,fixture,outputs,result}));
} finally { await browser.close(); }

