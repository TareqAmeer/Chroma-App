// Complete previous/implemented production exportFX trials, same input/edit and successful native saves.
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {connect,adb,adbText,PKG} from './cdp.mjs';
const OUT=path.join(import.meta.dirname,'out'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const methods=process.argv.slice(2);if(!methods.length)methods.push('previous-photos','implemented-photos');
adb('shell','input','keyevent','224');adb('shell','input','keyevent','82');adb('shell','svc','power','stayon','true');
for(const p of ['POST_NOTIFICATIONS','READ_MEDIA_IMAGES'])adb('shell','pm','grant',PKG,'android.permission.'+p);
adb('shell','am','force-stop',PKG);adb('shell','am','start','-n',PKG+'/.MainActivity');
let c;for(let i=0;i<60;i++){try{c=await connect();if(await c.ev('typeof MobileLibrary==="object"&&typeof exportFX==="function"'))break;c.close();c=null;}catch{}await pause(1000);}if(!c)throw Error('not ready');
async function job(expr){await c.ev(`window.__fullJob={};Promise.resolve().then(()=>(${expr})).then(value=>window.__fullJob={done:true,value},error=>window.__fullJob={done:true,error:String(error)});true`);for(let i=0;i<180;i++){await pause(500);const r=await c.ev('__fullJob');if(r.done){if(r.error)throw Error(r.error);return r.value;}}throw Error('job timeout');}
try{
  await pause(2500);const b64=fs.readFileSync(path.join(OUT,'bench-6000x4000.jpg')).toString('base64');
  await job(`(async()=>{const b=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));const ids=await MobileLibrary.importFiles([new File([b],'full-methods-6000x4000.jpg',{type:'image/jpeg'})]);await new Promise(r=>setTimeout(r,2500));if(!await MobileLibrary.openPhoto(ids[0],{original:true}))throw Error('open failed');document.getElementById('tg-adjust').classList.add('on');applyAdjustVals({exp:5});fxState.sharedAdjust=domAdjustVals();fxImages[fxCurIdx].adjustOverride=null;setExportScope('current');return getFXParams().adjust;})()`);
  const oldMobile=execFileSync('git',['show','5b45190286a584549b3443b7fc7a49e08622b275:mobile/mobile-export.js'],{encoding:'utf8'});
  await c.ev(`window.__newMobile={save:capShareFiles,batch:MobileExport,result:chromasmithShowMobileExportResult};true`);
  await c.ev(oldMobile);
  await c.ev(`(()=>{
    window.__oldMobile={save:capShareFiles,batch:MobileExport,result:chromasmithShowMobileExportResult};
    window.__encoder=fxEncodeExportCanvas;window.__fullRow={};
    fxEncodeExportCanvas=async(canvas,type,q)=>{const a=__fullRow,t=performance.now();try{
      const blob=a.method==='previous-photos'?await new Promise(r=>canvas.toBlob(r,type,q)):await __encoder(canvas,type,q);a.bytes=blob.size;return blob;
    }finally{a.encodeMs=performance.now()-t;}};
    const process=processToCanvas;processToCanvas=async(...args)=>{const t=performance.now();try{return await process(...args);}finally{__fullRow.processMs=performance.now()-t;}};
    capShareFiles=async(items)=>{const a=__fullRow,t=performance.now(),mobile=a.method==='previous-photos'?__oldMobile:__newMobile;
      a.receipts=await mobile.save(items);a.saveMs=performance.now()-t;return a.receipts;};return true;
  })()`);
  const rows=[];
  for(let run=0;run<4;run++)for(const method of run%2?[...methods].reverse():methods){
    if(!adbText('shell','dumpsys','activity','activities').match(/topResumedActivity=.*com.tareq.chromasmith/))throw Error('not foreground');
    await c.ev(`(()=>{window.chromasmithMobileExportDestination='photos';document.getElementById('sel-exp-fmt').value='jpg';document.getElementById('sl-exp-q').value=99;document.getElementById('sel-exp-size').value='full';
      __fullRow={method:${JSON.stringify(method)},run:${run},warmup:${run===0},width:6000,height:4000,quality:99,adjust:getFXParams().adjust};const mobile=__fullRow.method==='previous-photos'?__oldMobile:__newMobile;MobileExport=mobile.batch;chromasmithShowMobileExportResult=mobile.result;return true;})()`);
    const row=await job(`(async()=>{const t=performance.now();await exportFX();__fullRow.totalMs=performance.now()-t;return __fullRow;})()`);
    if(row.error||row.receipts?.length!==1||!row.receipts[0].ok)throw Error('failed export '+JSON.stringify(row));
    let remote=row.receipts[0].uri||row.receipts[0].path;
    if(remote.startsWith('Photos')){
      const query=adbText('shell','content','query','--uri','content://media/external/images/media','--projection','_id:_data:_display_name');
      const fname=row.receipts[0].fname;
      const hits=query.split('\n').filter(l=>l.endsWith('_display_name='+fname)).map(l=>({id:Number(l.match(/_id=(\d+)/)?.[1]),path:l.match(/_data=(.*?), _display_name=/)?.[1]})).sort((a,b)=>b.id-a.id);
      remote=hits[0]?.path;if(!remote)throw Error('missing saved Photos row');row.mediaStoreFile=remote;
    }else remote=decodeURIComponent(new URL(remote).pathname);
    row.savedFile=`production-${method}-${run}.jpg`;adb('pull',remote,path.join(OUT,row.savedFile));rows.push(row);console.log(JSON.stringify(row));fs.writeFileSync(path.join(OUT,'production-methods-'+methods.join('_')+'.json'),JSON.stringify(rows,null,2));await pause(1000);
  }
}finally{c.close();}
