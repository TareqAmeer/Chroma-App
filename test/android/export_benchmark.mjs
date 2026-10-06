// Run against an installed debug APK: node test/android/export_benchmark.mjs baseline|optimized
// Fixtures must be 12MP/24MP JPEGs in out/bench-WxH.jpg (same bytes for both APKs).
import fs from 'node:fs';
import path from 'node:path';
import { connect, adb, PKG } from './cdp.mjs';
const OUT=path.join(import.meta.dirname,'out');fs.mkdirSync(OUT,{recursive:true});
const label=process.argv[2]||'benchmark';
if(!/^[\w-]+$/.test(label))throw new Error('Invalid benchmark label');
// Permission dialogs suspend the WebView and invalidate timing; this is a dedicated test APK.
for(const permission of ['POST_NOTIFICATIONS','READ_MEDIA_IMAGES'])adb('shell','pm','grant',PKG,'android.permission.'+permission);
adb('shell','am','force-stop',PKG);adb('shell','am','start','-n',PKG+'/.MainActivity');
let c;
for(let i=0;i<40;i++){
  try{c=await connect();if(await c.ev('typeof MobileLibrary==="object" && typeof exportFX==="function"'))break;c.close();c=null;}catch{}
  await new Promise(r=>setTimeout(r,1000));
}
if(!c)throw new Error('App did not become ready');
try{
  // Install wrappers ONCE after a fresh process. render() is submission time; getPixels()
  // includes GPU completion. Wrap the class, since main uses a separate export renderer.
  await c.ev(`(()=>{
    window.__exportBench={};
    const original=processToCanvas;
    processToCanvas=async(...args)=>{const a=window.__exportBench,t=performance.now();a.inProcess=true;
      try{return await original(...args)}finally{a.inProcess=false;a.processMs=performance.now()-t}};
    for(const name of ['setImage','render','getPixels']){
      const f=FXR.prototype[name];FXR.prototype[name]=function(...args){const a=window.__exportBench,t=performance.now();
        try{return f.apply(this,args)}finally{if(a.active&&a.inProcess){a[name+'Ms']=(a[name+'Ms']||0)+performance.now()-t;a[name+'Count']=(a[name+'Count']||0)+1}}};
    }
    const tb=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(cb,...args){const a=window.__exportBench,t=performance.now(),capture=a.active&&args[0]==='image/jpeg'&&this.width*this.height>1e6;
      return tb.call(this,b=>{if(capture){a.encodeMs=(a.encodeMs||0)+performance.now()-t;a.encodedBytes=b?.size}cb(b)},...args)};
    const save=capShareFiles;capShareFiles=async(...args)=>{const a=window.__exportBench,t=performance.now();
      try{a.receipts=await save(...args);return a.receipts}finally{a.saveMs=performance.now()-t}};
  })()`);
  const rows=[];
  for(const [w,h] of [[4000,3000],[6000,4000]]){
    const b64=fs.readFileSync(path.join(OUT,`bench-${w}x${h}.jpg`)).toString('base64');
    await c.ev(`(async()=>{const u=Uint8Array.from(atob('${b64}'),x=>x.charCodeAt(0));
      const ids=await MobileLibrary.importFiles([new File([u],'bench-${w}x${h}.jpg',{type:'image/jpeg'})]);
      if(!await MobileLibrary.openPhoto(ids[0],{original:true}))throw new Error('Could not open benchmark photo');
      const src=geomCanvas(fxImages[fxCurIdx]);if(src.width!==${w}||src.height!==${h})throw new Error('Wrong benchmark dimensions');
      setExportScope('current');await new Promise(r=>setTimeout(r,1500));})()`);
    for(let run=0;run<4;run++){
      await c.ev(`(()=>{
        window.chromasmithMobileExportDestination='files';document.querySelector('#sel-exp-fmt').value='jpg';
        document.querySelector('#sl-exp-q').value=99;document.querySelector('#sel-exp-size').value='full';
        const p=getFXParams(),gl=FX.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
        if(p.halation.enabled||p.bloom.enabled)throw new Error('Benchmark requires disabled glow');
        const a=window.__exportBench={active:true,width:${w},height:${h},run:${run},warmup:${run===0},quality:99,
          renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),memory:navigator.deviceMemory};
        a.startedMs=performance.now();exportFX().then(()=>{a.totalMs=performance.now()-a.startedMs;a.active=false;a.done=true;},e=>{a.error=String(e);a.done=true;});return true;
      })()`);
      let row;
      for(let poll=0;poll<120;poll++){
        await new Promise(r=>setTimeout(r,1000));
        row=await c.ev('window.__exportBench');if(row.done)break;
      }
      if(!row.done||row.error)throw new Error('Export timed out or failed: '+JSON.stringify(row));
      if(row.receipts?.length!==1||!row.receipts[0].ok)throw new Error('Export did not produce one saved file');
      const remote=decodeURIComponent(new URL(row.receipts[0].path).pathname);
      const saved=path.join(OUT,`${label}-${w}x${h}-${run}.jpg`);adb('pull',remote,saved);
      row.savedFile=path.basename(saved);rows.push(row);console.log(JSON.stringify(row));
      fs.writeFileSync(path.join(OUT,`export-${label}.json`),JSON.stringify(rows,null,2));
      await new Promise(r=>setTimeout(r,1000));
    }
  }
}finally{c.close();}
