// Binary Photos protocol and existing destination fallback regression tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../mobile/mobile-export.js',import.meta.url),'utf8');
function app(bridge,timers={},platform="android"){
  const calls=[];
  const context={window:null,Blob,ArrayBuffer,Uint8Array,crypto:{randomUUID:()=> 'test-id'},setTimeout,clearTimeout,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),unescape,encodeURIComponent,
    _u8b64:b=>Buffer.from(b).toString('base64'),getUISnapshot:()=>({}),fxVersion:1,
    capNative:()=>true,capAlbumId:async()=> 'album',MobileUI:{},
    Capacitor:{getPlatform:()=>platform,Plugins:{PhotoExport:{prepare:async()=>({persistent:true,migrated:0,failed:0}),savePhoto:async o=>{calls.push({photo:o});return {path:'content://media/external_primary/images/media/1',persistent:true};}},Filesystem:{writeFile:async o=>{calls.push(o);return {uri:'file:///cache/export.jpg'};},deleteFile:async o=>calls.push({delete:o})},Media:{savePhoto:async o=>calls.push({media:o})}}}};
  Object.assign(context,timers);context.window=context;context.ChromaPhotoExport=bridge;vm.createContext(context);vm.runInContext(source,context);
  return {context,calls,save:(content,name='test.jpg')=>context.capShareFiles([{content,fname:name}])};
}
const jpeg=new Uint8Array([255,216,1,2,255,217]);
const posts=[];const bridge={postMessage(data){posts.push(data);if(typeof data==='string'){const h=JSON.parse(data);queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:h.id,status:'ready'})}));}
  else queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:'test-id',status:'saved',path:'file:///photos/test.jpg'})}));}};
const a=app(bridge);assert((await a.save(jpeg))[0].ok);assert.equal(a.calls.length,0);assert.deepEqual([...new Uint8Array(posts[1])],[...jpeg]);assert.equal(bridge.onmessage,null);
const offset=new Uint8Array([9,...jpeg,9]).subarray(1,7);assert((await a.save(offset))[0].ok);assert.deepEqual([...new Uint8Array(posts[3])],[...jpeg]);
for(const [content,name]of [[jpeg,'test.jpg'],[new Uint8Array([1,2,3,4]),'test.png']]){const f=app(undefined);assert((await f.save(content,name))[0].ok);assert.equal(f.calls.length,3);assert(f.calls[1].photo);assert(f.calls[2].delete);assert.equal(f.calls.filter(x=>x.media).length,0);}
const f=app(bridge);f.context.chromasmithMobileExportDestination='share';f.context.Capacitor.Plugins.Share={share:async()=>{}};assert.equal((await f.save(jpeg))[0].status,'shared');assert.equal(f.calls.length,1);
const rejecting={postMessage(){queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:'test-id',status:'error',error:'disk full'})}));}};
const e=app(rejecting);assert.equal((await e.save(jpeg))[0].err,'disk full');assert.equal(e.calls.length,0);assert.equal(rejecting.onmessage,null);
const held={postMessage(){}};const concurrent=app(held);const first=concurrent.save(jpeg);const second=await concurrent.save(jpeg);assert.match(second[0].err,/already running/);held.onmessage({data:JSON.stringify({id:'test-id',status:'saved',path:'file:///photos/test.jpg'})});assert((await first)[0].ok);
assert.equal(concurrent.calls.length,0);console.log('PASS: binary JPEG, byte offsets, unsupported/PNG/share fallback, errors, concurrent saves, cleanup');
const timerCallbacks=new Map();let timerId=0;
const delayed=app({postMessage(){}},{setTimeout:fn=>{timerCallbacks.set(++timerId,fn);return timerId;},clearTimeout:id=>timerCallbacks.delete(id)});
delayed.context.Capacitor.Plugins.PhotoExport={...delayed.context.Capacitor.Plugins.PhotoExport,status:async({id})=>{assert.equal(id,'test-id');return {status:'saved',path:'file:///photos/completed.jpg'};}};
const delayedSave=delayed.save(jpeg);await new Promise(r=>setImmediate(r));await timerCallbacks.get(1)();assert.equal((await delayedSave)[0].uri,'file:///photos/completed.jpg');assert.equal(timerCallbacks.size,0);assert.equal(delayed.calls.length,0);
console.log('PASS: delayed acknowledgement confirmed through native status, no duplicate write');

const ios=app(undefined,{},'ios');assert((await ios.save(jpeg))[0].ok);assert(ios.calls[1].media);assert(ios.calls[2].delete);
for(const broken of [undefined,{prepare:async()=>({persistent:false})},{prepare:async()=>({persistent:true,failed:1})}]){
 const x=app(undefined);x.context.Capacitor.Plugins.PhotoExport=broken;assert(!(await x.save(jpeg))[0].ok);assert.equal(x.calls.length,0);
}
const failed=app(undefined);failed.context.Capacitor.Plugins.PhotoExport.savePhoto=async()=>{throw Error('disk full');};assert(!(await failed.save(jpeg))[0].ok);assert(failed.calls.at(-1).delete);assert(!failed.calls.some(x=>x.media));
console.log('PASS Android permanent fallback/cache cleanup, iOS behavior, unsafe old APK/migration failure blocked');
