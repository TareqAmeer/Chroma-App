// Real WebView2 IPC and filesystem validation; requires an isolated native app on CDP.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), fixture = path.join(root, 'test/output/import-metadata-native', String(Date.now()));
const card = path.join(fixture, 'card'), primary = path.join(fixture, 'primary'), backup = path.join(fixture, 'backup'), delivery = path.join(fixture, 'delivery');
for (const dir of [card, primary, backup, delivery]) await mkdir(dir, {recursive:true});
const browser = await chromium.connectOverCDP(process.env.NATIVE_CDP || 'http://127.0.0.1:9223');
let previousPrefs = null;
let cdp = null;
try {
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
  cdp=await browser.contexts()[0].newCDPSession(page);
  let library=await readFile(path.join(root,'desktop/library-ui.js'),'utf8');
  const importDeclaration='async function openImportPanel(cardPath) {';
  assert.ok(library.includes(importDeclaration),'current Library source exposes the import panel implementation');
  library=library.replace(importDeclaration,`window.__libOpenImportPanelForTest=(path)=>openImportPanel(path);\n  ${importDeclaration}`);
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*library-ui.js*',requestStage:'Request'}]});
  cdp.on('Fetch.requestPaused',async event=>cdp.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(library).toString('base64')}));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof chromasmithToggleLibrary === 'function' && !!window.__TAURI__?.core);
  if(!await page.evaluate(()=>chromasmithLibraryIsOpen()))await page.evaluate(()=>chromasmithToggleLibrary());
  await page.waitForFunction(() => typeof window.__libOpenImportPanelForTest === 'function');
  previousPrefs = await page.evaluate(() => ({recipes:localStorage.getItem('cs.import.recipes.v1'),prefs:localStorage.getItem('cs.import.prefs.v1')}));
  const png = await readFile(path.join(root, 'test/fixtures/portrait.png'));
  await writeFile(path.join(card, 'portrait.png'), png);
  const jpg = await page.evaluate(async bytes => {
    const im = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im,0,0); im.close();
    return Array.from(new Uint8Array(await (await new Promise(r => c.toBlob(r,'image/jpeg',.9))).arrayBuffer()));
  }, Array.from(png));
  await writeFile(path.join(card, 'portrait.jpg'), new Uint8Array(jpg));
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:custom="urn:chr208:fixture" xmlns:exif="http://ns.adobe.com/exif/1.0/" custom:Keep="unrelated-value" exif:GPSLatitude="51,0N"><exif:GPSLongitude>0,1W</exif:GPSLongitude></rdf:Description></rdf:RDF></x:xmpmeta>';
  await writeFile(path.join(card, 'portrait.xmp'), xmp);
  const openImport = async () => {
    await page.evaluate(async card => {
      window.__copiedRecipe='eyJleHBvc3VyZSI6MC4zfQ==';
      window.askTextModal=async()=> 'CHR208 Native Job';
      await window.__libOpenImportPanelForTest(card);
    },card);
    await page.locator('#imp-recipe').waitFor({state:'visible'});
  };
  await openImport();
  const setPath=async(selector,value)=>page.locator(selector).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await setPath('#imp-dest',primary);
  await setPath('#imp-backup',backup);
  await page.locator('#imp-folder').selectOption('{YYYY-MM-DD}');
  await page.locator('#imp-creator').fill('CHR208 Creator');
  await page.locator('#imp-copyright').fill('CHR208 Copyright');
  await page.locator('#imp-caption').fill('CHR208 Caption');
  await page.locator('#imp-job-project').fill('CHR208 Job');
  await page.locator('#imp-keywords').fill('CHR208 Keyword');
  await page.locator('#imp-starting-edit').selectOption('copied');
  await page.locator('#imp-recipe-save').click();
  const recipeId=await page.locator('#imp-recipe').inputValue();
  assert.ok(recipeId,'native import panel saved and selected the job recipe');
  const savedRecipe=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs.import.recipes.v1')).find(r=>r.id===document.getElementById('imp-recipe').value));
  assert.equal(savedRecipe.name,'CHR208 Native Job');
  assert.equal(savedRecipe.startingEditRecipe,'eyJleHBvc3VyZSI6MC4zfQ==');
  await page.locator('#imp-creator').fill('temporary override');
  await page.locator('#imp-recipe').selectOption(recipeId);
  assert.equal(await page.locator('#imp-creator').inputValue(),'CHR208 Creator','saved recipe selection restores metadata fields');
  assert.equal(await page.locator('#imp-starting-edit').inputValue(),'saved','saved edit recipe is selected');
  await page.locator('#imp-go').click();
  await page.locator('#lib-import-back').waitFor({state:'detached',timeout:30000});
  const walk=async dir=>{const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())out.push(...await walk(p));else out.push(p);}return out;};
  const imported=(await walk(primary)).filter(p=>/\.(jpe?g|png)$/i.test(p));
  assert.equal(imported.length,2,`native saved-recipe import produced JPEG and PNG: ${imported.join(', ')}`);
  await openImport();
  const duplicatePreview=await page.locator('#imp-sub').innerText();
  assert.match(duplicatePreview,/2 already imported/);
  assert.equal(await page.locator('#imp-recipe').inputValue(),recipeId,'last-used saved recipe is restored on the next import');
  await page.locator('#imp-go').click();
  await page.locator('#lib-import-back').waitFor({state:'detached',timeout:30000});
  assert.equal((await walk(primary)).filter(p=>/\.(jpe?g|png)$/i.test(p)).length,2,'duplicate re-import creates no additional files');
  for (const file of imported) {
    const sidecar = file.replace(/\.[^.]+$/, '.xmp');
    const text = await readFile(sidecar,'utf8');
    for (const value of ['CHR208 Creator','CHR208 Copyright','CHR208 Caption','CHR208 Job','CHR208 Keyword','unrelated-value']) assert.ok(text.includes(value),value);
    assert.ok(text.includes('chromasmith:Recipe="eyJleHBvc3VyZSI6MC4zfQ=="'),'saved starting edit is applied to the imported sidecar');
    const second = path.join(backup,path.relative(primary,sidecar));
    assert.equal(await readFile(second,'utf8'),text,'second copy preserves merged XMP');
  }
  await page.evaluate(async ({files,delivery}) => {
    await __TAURI__.core.invoke('set_export_dir',{path:delivery});
    const sources = [];
    for (const p of files) {
      const bytes = await __TAURI__.core.invoke('read_file_bytes',{path:p});
      sources.push(new File([new Uint8Array(bytes)], p.split(/[\\/]/).pop(), {type:p.endsWith('.png')?'image/png':'image/jpeg'}));
    }
    await loadFXImages(sources);
    window.chromasmithGetOpenedPaths=()=>files;
    fxExportScope='all'; document.getElementById('sel-exp-fmt').value='jpg';document.getElementById('fx-fname').value='{name}{nover}';
    await exportFX();
    document.getElementById('tg-exp-gps').checked = false;
    document.getElementById('sel-exp-fmt').value='png';
    await exportFX();
    document.getElementById('tg-exp-gps').checked = true;
    await __TAURI__.core.invoke('set_export_dir',{path:''});
  }, {files:imported,delivery});
  const outputs = (await readdir(delivery)).filter(n=>/\.(jpg|png)$/.test(n));
  assert.equal(outputs.length,4);
  for (const name of outputs) {
    const text=(await readFile(path.join(delivery,name))).toString('utf8');
    for (const value of ['CHR208 Creator','CHR208 Copyright','CHR208 Caption','CHR208 Job','CHR208 Keyword','unrelated-value']) assert.ok(text.includes(value),`export ${name} lost ${value}`);
    assert.ok(text.includes('chromasmith:Recipe="eyJleHBvc3VyZSI6MC4zfQ=="'),`export ${name} lost the saved starting edit`);
    if (name.endsWith('.jpg')) assert.ok(text.includes('GPSLatitude') && text.includes('GPSLongitude'), `GPS keep policy failed for ${name}`);
    if (name.endsWith('.png')) assert.ok(!text.includes('GPSLatitude') && !text.includes('GPSLongitude'), `GPS removal policy failed for ${name}`);
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
  console.log(JSON.stringify({passed:true,fixture,outputs,recipe:savedRecipe,duplicatePreview}));
} finally {
  const page=browser.contexts()[0]?.pages().find(p=>!p.url().includes('devtools'));
  if(previousPrefs)await page?.evaluate(value=>{for(const [key,val] of Object.entries(value)){if(val===null)localStorage.removeItem(key);else localStorage.setItem(key,val);}},previousPrefs).catch(()=>{});
  await cdp?.send('Fetch.disable').catch(()=>{});
  await browser.close();
}
