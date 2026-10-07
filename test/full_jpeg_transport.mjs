import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const text=fs.readFileSync(new URL('../chromasmith-22.html',import.meta.url),'utf8');
let timeout,cleared=0;
const c={navigator:{userAgent:'Android'},window:{},ArrayBuffer,Uint8Array,Uint8ClampedArray,DataView,TextDecoder,atob,
  setTimeout(fn){timeout=fn;return 1;},clearTimeout(){cleared++;}};
vm.createContext(c);vm.runInContext(text.slice(text.indexOf('function fxJpegSize('),text.indexOf('async function fxEncodeExportCanvas(')),c);
const jpeg=new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,8,8,15,160,23,112,0]);
assert.equal(JSON.stringify(c.fxJpegSize(jpeg)),JSON.stringify({width:6000,height:4000}));
for(const bad of [new Uint8Array(),jpeg.slice(0,12),new Uint8Array([255,216,255,224,0,1])])assert.equal(c.fxJpegSize(bad),null);
assert(c.fxNeedsFullAndroidJpeg({bytes:jpeg,img:{naturalWidth:1500,naturalHeight:1000}}));
assert(!c.fxNeedsFullAndroidJpeg({bytes:jpeg,img:{naturalWidth:4000,naturalHeight:6000}}));
c.navigator.userAgent='iPhone';assert(!c.fxNeedsFullAndroidJpeg({bytes:jpeg,img:{width:1,height:1}}));c.navigator.userAgent='Android';
let logs=0;c.window.Capacitor={logToNative(){logs++;},logFromNative(){logs++;}};
c.fxProtectJpegDecodeLogs();c.fxProtectJpegDecodeLogs();
for(const fn of ['logToNative','logFromNative']){c.window.Capacitor[fn]({pluginId:'JpegDecode'});c.window.Capacitor[fn]({pluginId:'Other'});}
assert.equal(logs,2);
const info={token:'12345678-1234-1234-1234-123456789012',width:2};
const packet=(token=info.token,y=3,height=1)=>{const a=new Uint8Array(52);a.set(new TextEncoder().encode(token));const v=new DataView(a.buffer);v.setUint32(36,y,true);v.setUint32(40,height,true);a.set([1,2,3,255,4,5,6,255],44);return a.buffer;};
const bridge={postMessage(){}};c.window.ChromaJpegDecode=bridge;
let p=c.fxFullJpegRows({},info,3,1);bridge.onmessage({data:packet('00000000-0000-0000-0000-000000000000')});assert(bridge.onmessage);bridge.onmessage({data:packet()});assert.deepEqual(Array.from(await p),[1,2,3,255,4,5,6,255]);assert.equal(bridge.onmessage,null);
for(const data of [new ArrayBuffer(3),packet(info.token,4),JSON.stringify({token:info.token,y:3,error:'native error'})]){p=c.fxFullJpegRows({},info,3,1);bridge.onmessage({data});await assert.rejects(p);assert.equal(bridge.onmessage,null);}
p=c.fxFullJpegRows({},info,3,1);timeout();await assert.rejects(p,/timed out/);assert.equal(bridge.onmessage,null);
bridge.postMessage=()=>{throw Error('bridge closed');};await assert.rejects(c.fxFullJpegRows({},info,3,1),/bridge closed/);assert.equal(bridge.onmessage,null);
c.window.ChromaJpegDecode=null;
assert.deepEqual(Array.from(await c.fxFullJpegRows({rows:async()=>({data:'AQIDBA=='})},info,0,1)),[1,2,3,4]);
await assert.rejects(c.fxFullJpegRows({rows:async()=>{throw Error('legacy error');}},info,0,1),/legacy error/);
assert.equal(cleared,6);
console.log('PASS JPEG size/platform gates, selective logs, binary headers/errors/timeouts/cleanup and legacy transfer');
