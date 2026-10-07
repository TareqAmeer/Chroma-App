// Complete previous/implemented production exportFX trials, same input/edit and successful native saves.
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {connect,adb,adbText,PKG} from './cdp.mjs';
const OUT=path.join(import.meta.dirname,'out'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const methods=process.argv.slice(2);if(!methods.length)methods.push('old','center','direct');
const label=(process.env.EXPORT_BENCH_LABEL||methods.join('_')).replace(/[^a-z0-9_-]/gi,'_');
adb('shell','input','keyevent','224');adb('shell','input','keyevent','82');adb('shell','svc','power','stayon','true');
const api=Number(adbText('shell','getprop','ro.build.version.sdk').trim());
for(const p of api>=33?['POST_NOTIFICATIONS','READ_MEDIA_IMAGES']:['READ_EXTERNAL_STORAGE'])adb('shell','pm','grant',PKG,'android.permission.'+p);
if(api<=29)adb('shell','pm','grant',PKG,'android.permission.WRITE_EXTERNAL_STORAGE');
adb('shell','am','force-stop',PKG);adb('shell','am','start','-n',PKG+'/.MainActivity');
let c;for(let i=0;i<60;i++){try{c=await connect();if(await c.ev('typeof MobileLibrary==="object"&&typeof exportFX==="function"'))break;c.close();c=null;}catch{}await pause(1000);}if(!c)throw Error('not ready');
async function job(expr){await c.ev(`window.__fullJob={};Promise.resolve().then(()=>(${expr})).then(value=>window.__fullJob={done:true,value},error=>window.__fullJob={done:true,error:String(error)});true`);for(let i=0;i<180;i++){await pause(500);const r=await c.ev('__fullJob');if(r.done){if(r.error)throw Error(r.error);return r.value;}}throw Error('job timeout');}
try{
  await pause(2500);const device=await c.ev('({userAgent:navigator.userAgent,memory:navigator.deviceMemory??null,worker:typeof OffscreenCanvas,bridge:typeof ChromaPhotoExport})');device.api=api;device.serial=process.env.ANDROID_SERIAL||null;console.log('device',JSON.stringify(device));fs.writeFileSync(path.join(OUT,'portable-device-'+label+'.json'),JSON.stringify(device,null,2));const b64=fs.readFileSync(path.join(OUT,'bench-6000x4000.jpg')).toString('base64');
  await job(`(async()=>{const b=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));const ids=await MobileLibrary.importFiles([new File([b],'full-methods-6000x4000.jpg',{type:'image/jpeg'})]);await new Promise(r=>setTimeout(r,2500));if(!await MobileLibrary.openPhoto(ids[0],{original:true}))throw Error('open failed');document.getElementById('tg-adjust').classList.add('on');applyAdjustVals({exp:5});fxState.sharedAdjust=domAdjustVals();fxImages[fxCurIdx].adjustOverride=null;setExportScope('current');return getFXParams().adjust;})()`);
  const oldText=execFileSync('git',['show','243991b0:chromasmith-22.html'],{encoding:'utf8',maxBuffer:64*1024*1024});
  const oldTile=oldText.slice(oldText.indexOf('async function renderTiled('),oldText.indexOf('// Export scope:',oldText.indexOf('async function renderTiled(')));
  await c.ev(`window.__portableCenter=renderTiled;window.__portableOld=(${oldTile});true`);
  await c.ev(`(()=>{
    let direct=__portableOld.toString().replace('const{px}=renderer.getPixels();','/* direct GPU canvas copy */').replace('rcCtx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer),rw,rh),0,0);','rcCtx.clearRect(0,0,rw,rh);rcCtx.drawImage(renderer.cv,0,0);');
    window.__portableDirect=eval('('+direct+')');
    const dirty=__portableOld.toString().replace('rcCtx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer),rw,rh),0,0);','/* put center directly into the output canvas */').replace('octx.drawImage(rc,tx-sx,ty-sy,tw,th,tx,ty,tw,th);','octx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer),rw,rh),sx,sy,tx-sx,ty-sy,tw,th);');
    window.__portableDirty=eval('('+dirty+')');
    window.__portableTimer=eval('('+__portableOld.toString().replace('await new Promise(r=>requestAnimationFrame(r));','await new Promise(r=>setTimeout(r,0));')+')');
    window.__portableSoft=eval('('+__portableCenter.toString().replace("octx=out.getContext('2d',software?{willReadFrequently:true}:undefined)","octx=out.getContext('2d',{willReadFrequently:true})").replace("octx=out.getContext('2d')","octx=out.getContext('2d',{willReadFrequently:true})")+')');
    window.__portableJpegBridge=window.ChromaJpegDecode;
    const timed=fn=>eval('('+fn.toString().replace('await new Promise(r=>requestAnimationFrame(r));','await new Promise(r=>{const t=performance.now();requestAnimationFrame(()=>{__fullRow.yieldMs=(__fullRow.yieldMs||0)+performance.now()-t;r();});});').replace('await new Promise(r=>setTimeout(r,0));','await new Promise(r=>{const t=performance.now();setTimeout(()=>{__fullRow.yieldMs=(__fullRow.yieldMs||0)+performance.now()-t;r();},0);});')+')');
    [__portableOld,__portableCenter,__portableDirect,__portableDirty,__portableTimer,__portableSoft]=[__portableOld,__portableCenter,__portableDirect,__portableDirty,__portableTimer,__portableSoft].map(timed);window.__fullRow={};
    const encoder=fxEncodeExportCanvas;fxEncodeExportCanvas=async(...args)=>{const t=performance.now();try{const b=await encoder(...args);__fullRow.bytes=b.size;return b;}finally{__fullRow.encodeMs=performance.now()-t;}};
    const decode=fxDecodeFullAndroidJpeg;fxDecodeFullAndroidJpeg=async(...args)=>{const t=performance.now();try{return await decode(...args);}finally{__fullRow.decodeMs=performance.now()-t;}};
    const process=processToCanvas;processToCanvas=async(...args)=>{if(args[2]!==6000||args[3]!==4000)throw Error('Reduced-resolution export: '+args[2]+'x'+args[3]);const t=performance.now();try{return await process(...args);}finally{__fullRow.processMs=performance.now()-t;}};
    const save=capShareFiles;capShareFiles=async(items)=>{const t=performance.now();__fullRow.receipts=await save(items);__fullRow.saveMs=performance.now()-t;return __fullRow.receipts;};return true;
  })()`);
  const rows=[];
  for(let run=0;run<4;run++)for(const method of run%2?[...methods].reverse():methods){
    if(!adbText('shell','dumpsys','activity','activities').match(/(?:topResumedActivity|mResumedActivity).*com\.tareq\.chromasmith/))throw Error('not foreground');
    await c.ev(`(()=>{window.chromasmithMobileExportDestination='photos';document.getElementById('sel-exp-fmt').value='jpg';document.getElementById('sl-exp-q').value=99;document.getElementById('sel-exp-size').value='full';
      __fullRow={method:${JSON.stringify(method)},run:${run},warmup:${run===0},width:6000,height:4000,quality:99,adjust:getFXParams().adjust};window.ChromaJpegDecode=__fullRow.method==='legacy'?null:__portableJpegBridge;__fullRow.decoderTransport=window.ChromaJpegDecode?.postMessage?'binary':'base64';if(__fullRow.method==='legacy'&&__fullRow.decoderTransport!=='base64')throw Error('Legacy bridge override failed');document.querySelector('.phone-dialog .phone-close')?.click();renderTiled=__fullRow.method==='old'?__portableOld:__fullRow.method==='direct'?__portableDirect:__fullRow.method==='dirty'?__portableDirty:__fullRow.method==='timer'?__portableTimer:__fullRow.method==='soft'?__portableSoft:__portableCenter;return true;})()`);
    const row=await job(`(async()=>{const t=performance.now();await exportFX();__fullRow.totalMs=performance.now()-t;return __fullRow;})()`);
    if(row.error||row.receipts?.length!==1||!row.receipts[0].ok)throw Error('failed export '+JSON.stringify(row));
    let remote=row.receipts[0].uri||row.receipts[0].path;
    if(remote.startsWith('Photos')){
      const query=adbText('shell','content','query','--uri','content://media/external/images/media','--projection','_id:_data:_display_name');
      const fname=row.receipts[0].fname;
      const hits=query.split('\n').filter(l=>l.endsWith('_display_name='+fname)).map(l=>({id:Number(l.match(/_id=(\d+)/)?.[1]),path:l.match(/_data=(.*?), _display_name=/)?.[1]})).sort((a,b)=>b.id-a.id);
      remote=hits[0]?.path;if(!remote)throw Error('missing saved Photos row');row.mediaStoreFile=remote;
    }else remote=decodeURIComponent(new URL(remote).pathname);
    row.savedFile=`portable-${label}-${method}-${run}.jpg`;adb('pull',remote,path.join(OUT,row.savedFile));rows.push(row);console.log(JSON.stringify(row));fs.writeFileSync(path.join(OUT,'portable-methods-'+label+'.json'),JSON.stringify(rows,null,2));await pause(1000);
  }
}finally{c.close();}
