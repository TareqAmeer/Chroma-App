// Complete exportFX prototype trials with a real exposure edit and successful native saves.
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {connect,adb,adbText,PKG} from './cdp.mjs';
const OUT=path.join(import.meta.dirname,'out'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const methods=process.argv.slice(2);if(!methods.length)methods.push('current-photos','binary-photos','worker-photos','worker-binary-photos');
for(const p of ['POST_NOTIFICATIONS','READ_MEDIA_IMAGES'])adb('shell','pm','grant',PKG,'android.permission.'+p);
adb('shell','am','force-stop',PKG);adb('shell','am','start','-n',PKG+'/.MainActivity');
let c;for(let i=0;i<60;i++){try{c=await connect();if(await c.ev('typeof MobileLibrary==="object"&&typeof exportFX==="function"'))break;c.close();c=null;}catch{}await pause(1000);}if(!c)throw Error('not ready');
async function job(expr){await c.ev(`window.__fullJob={};Promise.resolve().then(()=>(${expr})).then(value=>window.__fullJob={done:true,value},error=>window.__fullJob={done:true,error:String(error)});true`);for(let i=0;i<180;i++){await pause(500);const r=await c.ev('__fullJob');if(r.done){if(r.error)throw Error(r.error);return r.value;}}throw Error('job timeout');}
try{
  await pause(2500);const b64=fs.readFileSync(path.join(OUT,'bench-6000x4000.jpg')).toString('base64');
  await job(`(async()=>{const b=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));const ids=await MobileLibrary.importFiles([new File([b],'full-methods-6000x4000.jpg',{type:'image/jpeg'})]);await new Promise(r=>setTimeout(r,2500));if(!await MobileLibrary.openPhoto(ids[0],{original:true}))throw Error('open failed');document.getElementById('tg-adjust').classList.add('on');applyAdjustVals({exp:5});fxState.sharedAdjust=domAdjustVals();fxImages[fxCurIdx].adjustOverride=null;setExportScope('current');return getFXParams().adjust;})()`);
  await c.ev(execFileSync('git',['show','5b45190286a584549b3443b7fc7a49e08622b275:mobile/mobile-export.js'],{encoding:'utf8'}));
  await c.ev(`fxEncodeExportCanvas=(canvas,type,q)=>new Promise(r=>canvas.toBlob(r,type,q));true`);
  await c.ev(fs.readFileSync(path.join(import.meta.dirname,'export_methods_page.js'),'utf8'));
  await job(`(async()=>{__methods.endpoint=(await Capacitor.Plugins.ExportExperiment.start()).url;return true;})()`);
  await c.ev(`(()=>{
    window.__fullRow={};window.__originalSave=capShareFiles;
    capShareFiles=async(items)=>{const a=__fullRow,t=performance.now();
      if(a.method.includes('binary')){a.receipts=[];for(const item of items){const native=await __methods.binary(item.content,'photos');a.native=native;a.receipts.push({ok:true,fname:item.fname,status:'saved',path:'file://'+native.path,err:''});}}
      else a.receipts=await __originalSave(items);a.saveMs=performance.now()-t;return a.receipts;};
    const process=processToCanvas;processToCanvas=async(...args)=>{const t=performance.now();try{return await process(...args);}finally{__fullRow.processMs=performance.now()-t;}};
    const toBlob=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(cb,type,q){const a=__fullRow,t=performance.now();if(type==='image/jpeg'&&this.width*this.height>1e6){
      const done=b=>{a.encodeMs=performance.now()-t;a.bytes=b.size;cb(b);};
      if(a.method.startsWith('worker')){__methods.workerJPEG(this).then(done,e=>{a.error=String(e);cb(null);});return;}
      return toBlob.call(this,done,type,q);
    }return toBlob.call(this,cb,type,q);};return true;
  })()`);
  const rows=[];
  for(let run=0;run<4;run++)for(const method of run%2?[...methods].reverse():methods){
    if(!adbText('shell','dumpsys','activity','activities').match(/topResumedActivity=.*com.tareq.chromasmith/))throw Error('not foreground');
    await c.ev(`(()=>{window.chromasmithMobileExportDestination='photos';document.getElementById('sel-exp-fmt').value='jpg';document.getElementById('sl-exp-q').value=99;document.getElementById('sel-exp-size').value='full';
      __fullRow={method:${JSON.stringify(method)},run:${run},warmup:${run===0},width:6000,height:4000,quality:99,adjust:getFXParams().adjust};__methods.configure(${JSON.stringify(method.startsWith('combined')?'combined':'current')});return true;})()`);
    const row=await job(`(async()=>{const t=performance.now();await exportFX();__fullRow.totalMs=performance.now()-t;return __fullRow;})()`);
    if(row.error||row.receipts?.length!==1||!row.receipts[0].ok)throw Error('failed export '+JSON.stringify(row));
    let remote=row.receipts[0].path;
    if(remote.startsWith('Photos')){
      const query=adbText('shell','content','query','--uri','content://media/external/images/media','--projection','_id:_data:_display_name');
      const fname=row.receipts[0].fname;
      const hits=query.split('\n').filter(l=>l.endsWith('_display_name='+fname)).map(l=>({id:Number(l.match(/_id=(\d+)/)?.[1]),path:l.match(/_data=(.*?), _display_name=/)?.[1]})).sort((a,b)=>b.id-a.id);
      remote=hits[0]?.path;if(!remote)throw Error('missing saved Photos row');row.mediaStoreFile=remote;
    }else remote=decodeURIComponent(new URL(remote).pathname);
    row.savedFile=`complete-${method}-${run}.jpg`;adb('pull',remote,path.join(OUT,row.savedFile));rows.push(row);console.log(JSON.stringify(row));fs.writeFileSync(path.join(OUT,'complete-methods-'+methods.join('_')+'.json'),JSON.stringify(rows,null,2));await pause(1000);
  }
}finally{c.close();}
