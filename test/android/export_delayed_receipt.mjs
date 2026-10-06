// Deliberately drop the binary acknowledgement; confirm the completed write by ID.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {connect,adb} from './cdp.mjs';
const out=path.join(import.meta.dirname,'out'),c=await connect(),input=fs.readFileSync(path.join(out,'bench-6000x4000.jpg'));
try{
  const row=await c.ev(`(async()=>{const bridge=ChromaPhotoExport,post=bridge.postMessage;let dropped=false;
    const wrapper=function(data){if(data instanceof ArrayBuffer){const handler=bridge.onmessage;bridge.onmessage=e=>{if(JSON.parse(e.data).status==='saved'){dropped=true;return;}handler(e);};}return post.call(bridge,data);};
    bridge.postMessage=wrapper;if(bridge.postMessage!==wrapper)throw Error('Cannot wrap test bridge');
    try{window.chromasmithMobileExportDestination='photos';const bytes=Uint8Array.from(atob('${input.toString('base64')}'),c=>c.charCodeAt(0));
      const t=performance.now(),receipts=await capShareFiles([{content:new Blob([bytes],{type:'image/jpeg'}),fname:'delayed-receipt-'+Date.now()+'.jpg'}]);return {receipts,dropped,totalMs:performance.now()-t};
    }finally{bridge.postMessage=post;}})()`);
  assert(row.dropped,'Native acknowledgement was not dropped');assert(row.receipts[0].ok&&row.receipts[0].uri,JSON.stringify(row));
  const target=path.join(out,'delayed-receipt.jpg');adb('pull',decodeURIComponent(new URL(row.receipts[0].uri).pathname),target);assert.deepEqual(fs.readFileSync(target),input);
  row.byteExact=true;fs.writeFileSync(path.join(out,'delayed-receipt-check.json'),JSON.stringify(row,null,2));console.log('PASS: dropped acknowledgement recovered by native status',JSON.stringify(row));
}finally{c.close();}
