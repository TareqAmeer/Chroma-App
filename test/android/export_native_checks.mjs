import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {connect,adb} from './cdp.mjs';
const out=path.join(import.meta.dirname,'out'),c=await connect();
try{
  assert.equal(await c.ev('location.origin'),'https://localhost');
  assert.equal(await c.ev('typeof ChromaPhotoExport'),'object');
  const bytes=fs.readFileSync(path.join(out,'bench-6000x4000.jpg')),b64=bytes.toString('base64');
  const name='binary-check-'+Date.now()+'.jpg';
  const receipts=await c.ev(`(async()=>{document.querySelector('.phone-dialog .phone-close')?.click();window.chromasmithMobileExportDestination='photos';
    const bytes=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));const rows=[],uuid=crypto.randomUUID;window.__binaryCheckIds=[];
    crypto.randomUUID=()=>{const id=uuid.call(crypto);__binaryCheckIds.push(id);return id;};
    try{for(let i=0;i<2;i++)rows.push(...await capShareFiles([{content:new Blob([bytes],{type:'image/jpeg'}),fname:${JSON.stringify(name)}}]));return rows;}
    finally{crypto.randomUUID=uuid;}})()`);
  assert.equal(receipts.length,2);assert(receipts.every(r=>r.ok&&r.uri),JSON.stringify(receipts));assert.notEqual(receipts[0].uri,receipts[1].uri);
  assert(decodeURIComponent(receipts[1].uri).includes(' (2).jpg'));
  for(let i=0;i<2;i++){const target=path.join(out,`binary-native-check-${i}.jpg`);adb('pull',decodeURIComponent(new URL(receipts[i].uri).pathname),target);assert.deepEqual(fs.readFileSync(target),bytes);}
  const invalid=await c.ev(`new Promise(resolve=>{const b=ChromaPhotoExport;b.onmessage=e=>{b.onmessage=null;resolve(JSON.parse(e.data));};b.postMessage(JSON.stringify({id:'invalid-test',name:'bad.jpg',size:3}));})`);
  assert.equal(invalid.status,'error');
  const statuses=await c.ev('Promise.all(__binaryCheckIds.map(id=>Capacitor.Plugins.PhotoExport.status({id})))');
  assert.equal(statuses.length,2);assert(statuses.every((s,i)=>s.status==='saved'&&s.path===receipts[i].uri));
  const result={receipts,invalid,statuses,duplicatePreserved:true,bytesExact:true,origin:'https://localhost'};
  fs.writeFileSync(path.join(out,'binary-native-checks.json'),JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result));
}finally{c.close();}
