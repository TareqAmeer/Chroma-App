// Remaining-method experiments. Results distinguish stage tests and conditional shortcuts.
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {connect,adb,adbText,PKG} from './cdp.mjs';
const OUT=path.join(import.meta.dirname,'out');const pause=ms=>new Promise(r=>setTimeout(r,ms));
const methods=process.argv.slice(2);
const suffix=process.env.METHOD_EXPOSURE?'-edited':'';
const list=methods.length?methods:['current','direct','halo','texture','combined','small-after','small-before','encode-main','encode-worker','encode-native','save-base64-files','save-binary-files','save-base64-photos','save-base64-direct','save-binary-photos','cached','original'];
for(const permission of ['POST_NOTIFICATIONS','READ_MEDIA_IMAGES'])adb('shell','pm','grant',PKG,'android.permission.'+permission);
adb('shell','am','force-stop',PKG);adb('shell','am','start','-n',PKG+'/.MainActivity');
let c;for(let i=0;i<60;i++){try{c=await connect();if(await c.ev('typeof MobileLibrary==="object"&&typeof processToCanvas==="function"'))break;c.close();c=null;}catch{}await pause(1000);}
if(!c)throw Error('App not ready');
async function job(expr){await c.ev(`window.__methodJob={};Promise.resolve().then(()=>(${expr})).then(value=>window.__methodJob={done:true,value},error=>window.__methodJob={done:true,error:String(error)});true`);
  for(let i=0;i<180;i++){await pause(500);const r=await c.ev('window.__methodJob');if(r.done){if(r.error)throw Error(r.error);return r.value;}}throw Error('Job timed out');}
try{
  await pause(2500);const b64=fs.readFileSync(path.join(OUT,'bench-6000x4000.jpg')).toString('base64');
  await job(`(async()=>{const bytes=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));window.__originalFixture=new Blob([bytes],{type:'image/jpeg'});const ids=await MobileLibrary.importFiles([new File([bytes],'methods-6000x4000.jpg',{type:'image/jpeg'})]);await new Promise(r=>setTimeout(r,2500));if(!await MobileLibrary.openPhoto(ids[0],{original:true}))throw Error('Open photo failed');return true;})()`);
  await pause(2500);await c.ev(`window.__methodExposure=${Number(process.env.METHOD_EXPOSURE)||0};true`);await c.ev(fs.readFileSync(path.join(import.meta.dirname,'export_methods_page.js'),'utf8'));
  await c.ev(execFileSync('git',['show','5b45190286a584549b3443b7fc7a49e08622b275:mobile/mobile-export.js'],{encoding:'utf8'}));
  console.log('setup',JSON.stringify(await job('window.__methods.setup()')));await c.ev('__methods.originalJPEG=__originalFixture;true');
  const rows=[];
  // Four passes rotate method order to limit time/thermal/order bias.
  for(let run=0;run<4;run++)for(const method of run%2?[...list].reverse():list){
    if(!adbText('shell','dumpsys','activity','activities').includes('com.tareq.chromasmith/.MainActivity'))throw Error('Chroma not foreground');
    let row;try{row=await job(`window.__methods.run(${JSON.stringify(method)},${run})`);}catch(error){row={method,run,error:String(error)};}
    let remote=row.native?.path||row.receipts?.[0]?.path;
    if(remote?.startsWith('Photos')){
      const name=row.receipts[0].fname;
      const query=adbText('shell','content','query','--uri','content://media/external/images/media','--projection','_data:_display_name');
      const match=query.split('\n').find(line=>line.includes(name.replace(/\.jpg$/,'')));
      if(!match)throw Error('Saved Photos output missing in MediaStore: '+name);
      remote=match.match(/_data=(.*?), _display_name=/)?.[1];row.mediaStoreFile=remote;
    }
    if(remote&&!remote.startsWith('Photos')){const p=remote.startsWith('file:')?decodeURIComponent(new URL(remote).pathname):remote;const target=path.join(OUT,`methods-${method}${suffix}-${run}.jpg`);adb('pull',p,target);row.savedFile=path.basename(target);}
    console.log(JSON.stringify(row));rows.push(row);fs.writeFileSync(path.join(OUT,'methods-'+list.join('_')+suffix+'.json'),JSON.stringify(rows,null,2));await pause(500);
  }
}finally{c.close();}
