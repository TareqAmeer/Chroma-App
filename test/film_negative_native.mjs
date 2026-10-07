// Connected frontend native-film behavior gate. Native IPC is substituted, not the editor.
// This proves domain routing, async safety and rendering; it is not a real RAW quality oracle.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reference=process.env.FILM_REFERENCE_PATH||path.join(root,'test/fixtures/portrait.png');
const referenceBytes=await readFile(reference);
const server=createServer(async(req,res)=>{try{
  const name=new URL(req.url,'http://localhost').pathname;
  const bytes=name==='/reference-photo'?referenceBytes:await readFile(path.join(root,name));
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(bytes);
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/GLSL compile|LINK FAILED/.test(m.text()))errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof fnEnsureNative==='function'&&typeof loadFXImages==='function');
  const results=await page.evaluate(async()=>{
    const blob=await(await fetch('/reference-photo')).blob();
    await loadFXImages([new File([blob],'reference.jpg',{type:'image/jpeg'})]);
    const it=curItem(),negative=it.img;
    const nativeCanvas=document.createElement('canvas');nativeCanvas.width=192;nativeCanvas.height=128;
    nativeCanvas.getContext('2d').drawImage(negative,0,0,192,128);it.img=nativeCanvas;fxImg=nativeCanvas;
    const rawData=nativeCanvas.getContext('2d').getImageData(0,0,192,128).data;
    const logs=[];let delay=0;
    const decoder={
      async filmBase(nx,ny){logs.push({operation:'sample',nx,ny});return{rgb:[.8,.5,.3],nx,ny,n:289,sourceKey:42};},
      async filmDevelop(recipe){logs.push({operation:'develop',recipe});if(delay)await new Promise(r=>setTimeout(r,delay));
        const data=new Uint8ClampedArray(rawData);
        if(recipe)for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){
          const encoded=data[i+c]/255,linear=encoded<=.04045?encoded/12.92:Math.pow((encoded+.055)/1.055,2.4);
          const v=Math.min(1,recipe.out*Math.pow(Math.max(linear,1/65535)/recipe.ref[c],-recipe.exp[c]));
          data[i+c]=Math.round((v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055)*255);
        }
        return{width:192,height:128,data,rgba:true};
      }
    };
    nativeCanvas._filmRaw=decoder;it.rawFile=new File(['mock RAW bytes'],'reference.dng');
    window.__TAURI__={core:{invoke:()=>Promise.reject(new Error('No unexpected native IPC in frontend gate'))}};
    const pick=await fnPickBaseAtOrig(30,40);
    const recipe=fnNativeRecipe(it),snapshot=getUISnapshot();
    const native=it.img,converted=native.getContext('2d').getImageData(0,0,192,128).data;
    const params=getFXParams(),nativeOn=computeFilmNeg();
    async function pixels(tiled){const src=geomCanvas(it),P=getFXParams();const saved=window.fxExportTileSize;
      if(tiled)window.fxExportTileSize=()=>64;
      try{const c=tiled?await renderTiled(P,src,192,128):await processToCanvas(P,src,192,128);return c.getContext('2d').getImageData(0,0,192,128).data;}
      finally{window.fxExportTileSize=saved;}
    }
    const single=await pixels(false),tile=await pixels(true);
    let maxTile=0;for(let i=0;i<single.length;i++)maxTile=Math.max(maxTile,Math.abs(single[i]-tile[i]));
    // Native source pixels must enter grading once. Disabling only the shader-film block is identity.
    const before=params.filmNeg;params.filmNeg={enabled:false};
    const c=await processToCanvas(params,geomCanvas(it),192,128);params.filmNeg=before;
    const plain=c.getContext('2d').getImageData(0,0,192,128).data;
    let maxDouble=0;for(let i=0;i<plain.length;i++)maxDouble=Math.max(maxDouble,Math.abs(single[i]-plain[i]));
    // Old recipes lacking domain metadata reset to display v0 rather than inheriting native v1.
    const legacy=JSON.parse(JSON.stringify(snapshot));delete legacy.sliders['fneg-domain'];delete legacy.sliders['fneg-source'];
    applyUISnapshot(legacy);const legacyDomain=+document.getElementById('sl-fneg-domain').value;
    applyUISnapshot(snapshot);const restoredSource=+document.getElementById('sl-fneg-source').value;
    document.getElementById('tg-filmneg').classList.remove('on');secScopePersist();await fnEnsureNative(it);
    const restored=it.img.getContext('2d').getImageData(0,0,192,128).data;
    let maxDisabled=0;for(let i=0;i<restored.length;i++)maxDisabled=Math.max(maxDisabled,Math.abs(restored[i]-rawData[i]));
    // A develop racing a recipe change must never install its obsolete result.
    applyUISnapshot(snapshot);delay=30;const first=fnEnsureNative(it);
    document.getElementById('sl-fneg-exp').value=2;secScopePersist();const second=fnEnsureNative(it);
    await Promise.all([first,second]);delay=0;
    const settled=JSON.parse(it.img._filmRecipeKey);
    const liveCanvas=it.img,frozenRecipe=structuredClone(recipe);
    const exported=await fnNativeExportItem(it,frozenRecipe);
    const exportFrozen=fnNativeRecipe(exported).exp[1]===1.5;
    const exportIsolated=it.img===liveCanvas&&exported.img!==liveCanvas;

    return{exportFrozen,exportIsolated,pick:pick.ok,recipe,domain:nativeOn.domain,snapshotDomain:snapshot.sliders['fneg-domain'],restoredSource,legacyDomain,maxDouble,maxTile,maxDisabled,settledGreen:settled.exp[1],operations:logs.length,convertedChanged:converted.some((v,i)=>v!==rawData[i])};
  });
  assert.equal(results.pick,true);assert.equal(results.domain,'camera-linear16-v1');assert.equal(+results.snapshotDomain,1);
  assert.equal(results.restoredSource,42);assert.equal(results.legacyDomain,0);assert.equal(results.maxDouble,0);
  assert.ok(results.maxTile<=1);assert.equal(results.maxDisabled,0);assert.equal(results.settledGreen,2);assert.equal(results.convertedChanged,true);
  assert.equal(results.exportFrozen,true);assert.equal(results.exportIsolated,true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({reference:path.basename(reference),...results}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
