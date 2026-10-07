// Real native saves, verified migration and uninstall survival. Only emulator test data.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {adb,adbText,connect,PKG} from './cdp.mjs';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(import.meta.dirname,'out');
const fixture=path.join(out,'photo-persistence'),apk=path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk');
const api=Number(adbText('shell','getprop','ro.build.version.sdk').trim()),prefix=`persistence-${api}-${Date.now()}`;
const legacy=`/sdcard/Android/media/${PKG}/Chromasmith/`,pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const exists=file=>{try{adb('shell','test','-f',file);return true;}catch{return false;}};
const rows=()=>['images','video'].flatMap(collection=>adbText('shell','content','query','--uri',`content://media/external/${collection}/media`,'--projection','_id:_data:_display_name:relative_path:is_pending')
  .split('\n').filter(line=>line.includes(prefix)&&(line.includes('relative_path=Pictures/Chromasmith/')||line.includes('relative_path=Movies/Chromasmith/'))).map(line=>({
    id:Number(line.match(/_id=(\d+)/)?.[1]),file:line.match(/_data=(.*?), _display_name=/)?.[1],
    name:line.match(/_display_name=(.*?), relative_path=/)?.[1],relative:line.match(/relative_path=(.*?), is_pending=/)?.[1],pending:Number(line.match(/is_pending=(\d+)/)?.[1])})));
const publicDirectory=row=>row.name.endsWith('.mp4')?'Movies/Chromasmith/':'Pictures/Chromasmith/';
async function ready(){for(let i=0;i<90;i++){let c;try{c=await connect();if(await c.ev('typeof capShareFiles==="function"&&typeof MobileLibrary==="object"&&!!Capacitor.Plugins.PhotoExport'))return c;c.close();
  }catch{c?.close();}await pause(500);}throw Error('app not ready');}
adb('shell','input','keyevent','224');adb('shell','input','keyevent','82');adb('shell','svc','power','stayon','true');
for(let i=0;i<120;i++){try{adb('shell','test','-d','/sdcard/');break;}catch(error){if(i===119)throw error;await pause(500);}}
adb('shell','am','force-stop',PKG);adb('shell','mkdir','-p',legacy);
for(const [file,name]of [['gps.jpg','legacy.jpg'],['photo.png','legacy.png'],['movie.mp4','legacy.mp4'],['broken.jpg','broken.jpg']])adb('push',path.join(fixture,file),legacy+prefix+'-'+name);
adb('install','-r',apk);
// Saving new own media and migrating own app files must not require broad library access on Q+.
for(const permission of ['READ_MEDIA_IMAGES','READ_MEDIA_VISUAL_USER_SELECTED','READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE'])try{adb('shell','pm','revoke',PKG,'android.permission.'+permission);}catch{}
if(api<29)adb('shell','pm','grant',PKG,'android.permission.WRITE_EXTERNAL_STORAGE');
adb('shell','am','start','-n',PKG+'/.MainActivity');let c=await ready();const result={api,prefix,serial:process.env.ANDROID_SERIAL,receipts:[],checks:[]};
try{
  console.log('stage migration',prefix);
  const migrate=await c.ev('Capacitor.Plugins.PhotoExport.prepare()');assert(migrate.persistent);assert.equal(migrate.failed,1);
  assert(exists(legacy+prefix+'-broken.jpg'),'failed migration must retain original');
  assert.equal(hash(adb('exec-out','cat',legacy+prefix+'-broken.jpg')),hash(fs.readFileSync(path.join(fixture,'broken.jpg'))));
  assert(!exists(legacy+prefix+'-legacy.jpg'));assert(!exists(legacy+prefix+'-legacy.png'));assert(!exists(legacy+prefix+'-legacy.mp4'));
  const migrated=rows();assert.equal(migrated.length,3);for(const row of migrated){assert.equal(row.relative,publicDirectory(row));assert.equal(row.pending,0);const source=row.name.endsWith('.mp4')?'movie.mp4':row.name.endsWith('.png')?'photo.png':'gps.jpg';assert.equal(hash(adb('exec-out','cat',row.file)),hash(fs.readFileSync(path.join(fixture,source))));}
  // Only remove the deliberately invalid fixture, retaining every real migrated photo.
  adb('shell','rm',legacy+prefix+'-broken.jpg');const before=rows().length;
  for(let i=0;i<2;i++){const r=await c.ev('Capacitor.Plugins.PhotoExport.prepare()');assert.equal(r.failed,0);assert.equal(r.migrated,0);}
  assert.equal(rows().length,before);result.checks.push('migration verification, failure retention and idempotence');
  console.log('stage saves',prefix);
  const expected=new Map(migrated.map(row=>[row.id,hash(adb('exec-out','cat',row.file))]));
  for(const [file,name,mode]of [['gps.jpg','duplicate.jpg','binary'],['different.jpg','duplicate.jpg','binary'],['gps.jpg','fallback.jpg','legacy'],['photo.png','photo.png','png'],['movie.mp4','movie.mp4','video']]){
    const bytes=fs.readFileSync(path.join(fixture,file)),b64=bytes.toString('base64');
    const receipt=await c.ev(`(async()=>{const bridge=window.ChromaPhotoExport;try{if('${mode}'==='legacy')window.ChromaPhotoExport=null;window.chromasmithMobileExportDestination='photos';return (await capShareFiles([{content:Uint8Array.from(atob('${b64}'),x=>x.charCodeAt(0)),fname:'${prefix}-${name}'}]))[0];}finally{window.ChromaPhotoExport=bridge;}})()`);
    assert(receipt.ok,JSON.stringify(receipt));assert(receipt.uri.startsWith('content://'));const id=Number(receipt.uri.split('/').pop());expected.set(id,hash(bytes));result.receipts.push(receipt);
  }
  const duplicate=result.receipts.slice(0,2);assert.notEqual(duplicate[0].uri,duplicate[1].uri);result.checks.push('binary JPEG, fallback JPEG, PNG, video, GPS metadata and duplicate names');
  console.log('stage errors',prefix);
  const denied=await c.ev(`(async()=>{try{await Capacitor.Plugins.PhotoExport.savePhoto({path:'file:///sdcard/Pictures/other.jpg',name:'${prefix}-escape.jpg'});return false;}catch(_){return true;}})()`);assert(denied);
  const jpeg=fs.readFileSync(path.join(fixture,'gps.jpg')).toString('base64');
  const invalid=await c.ev(`capShareFiles([{content:Uint8Array.from(atob('${jpeg}'),x=>x.charCodeAt(0)),fname:'${prefix}-invalid.png'}])`);assert(!invalid[0].ok);
  const cache=await c.ev(`Capacitor.Plugins.Filesystem.readdir({path:'export',directory:'CACHE'}).then(r=>r.files.filter(f=>f.name.includes('${prefix}')).length)`);assert.equal(cache,0);result.checks.push('cache cleanup, invalid MIME and cache path containment');
  const saved=rows();assert.equal(saved.length,8);for(const row of saved){assert.equal(row.relative,publicDirectory(row));assert.equal(row.pending,0);assert.equal(hash(adb('exec-out','cat',row.file)),expected.get(row.id));}
  result.before=saved.map(row=>({...row,sha256:expected.get(row.id)}));c.close();c=null;
  console.log('stage uninstall',prefix);
  adb('uninstall',PKG);result.uninstalled=true;
  const after=rows();assert.deepEqual(after,saved);for(const row of after)assert.equal(hash(adb('exec-out','cat',row.file)),expected.get(row.id));result.checks.push('all eight files and gallery records survive actual uninstall');
  console.log('stage reinstall',prefix);
  adb('install',apk);adb('shell','am','start','-n',PKG+'/.MainActivity');c=await ready();
  const restored=await c.ev('Capacitor.Plugins.PhotoExport.prepare({checkOnly:true})');assert(restored.persistent||api<29);assert.deepEqual(rows(),saved);result.checks.push('reinstall preserves existing public photos without duplicates');
  result.pass=true;fs.writeFileSync(path.join(out,`photo-persistence-${api}.json`),JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result));
}finally{c?.close();}
