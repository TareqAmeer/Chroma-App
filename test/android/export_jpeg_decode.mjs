import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {connect} from './cdp.mjs';
const out=path.join(import.meta.dirname,'out');let c;const records=[];
for(let i=0;i<60;i++){try{c=await connect();break;}catch(error){if(i===59)throw error;await new Promise(r=>setTimeout(r,500));}}
try{
  for(let i=0;i<60&&await c.ev('typeof loadImg!=="function"');i++)await new Promise(r=>setTimeout(r,500));
  assert.equal(await c.ev('typeof loadImg'),'function','Editor JavaScript must finish loading');
  assert.equal(await c.ev('typeof ChromaJpegDecode'),'object','Binary decoder bridge is required for this test');
  for(const mode of ['binary','legacy'])for(let orientation=1;orientation<=8;orientation++){
    const data=fs.readFileSync(path.join(out,'jpeg-orientation',orientation+'.jpg')).toString('base64');
    const result=await c.ev(`(async()=>{
      const bytes=Uint8Array.from(atob('${data}'),x=>x.charCodeAt(0)),bridge=window.ChromaJpegDecode;
      window.ChromaJpegDecode=${JSON.stringify(mode)}==='legacy'?null:bridge;
      let decoded,reference;try{
        const image=await loadImg(new File([bytes],'orientation.jpg',{type:'image/jpeg'}));
        decoded=await fxDecodeFullAndroidJpeg({bytes});reference=document.createElement('canvas');reference.width=image.naturalWidth;reference.height=image.naturalHeight;
        reference.getContext('2d').drawImage(image,0,0);const a=reference.getContext('2d').getImageData(0,0,reference.width,reference.height).data,b=decoded.getContext('2d').getImageData(0,0,decoded.width,decoded.height).data;
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
        let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;}
        return {orientation:${orientation},mode:${JSON.stringify(mode)},width:decoded.width,height:decoded.height,reference:[reference.width,reference.height],max,mean:sum/a.length,digest};
      }finally{window.ChromaJpegDecode=bridge;if(decoded)decoded.width=decoded.height=0;if(reference)reference.width=reference.height=0;}
    })()`);
    // Android/Chromium sRGB ICC conversion differs by one 8-bit rounding level in this fixture.
    assert.deepEqual([result.width,result.height],result.reference);assert(result.max<=1&&result.mean<.04,JSON.stringify(result));records.push(result);console.log(JSON.stringify(result));
  }
  for(let i=0;i<8;i++)assert.equal(records[i].digest,records[i+8].digest,'binary/legacy pixel parity');
  const data=fs.readFileSync(path.join(out,'jpeg-orientation/1.jpg')).toString('base64');
  const safeguards=await c.ev(`(async()=>{
    const p=Capacitor.Plugins.JpegDecode;let rejected=0;const expect=async fn=>{try{await fn();}catch(_){rejected++;return;}throw Error('Invalid request accepted');};
    await expect(()=>p.begin({data:'bm90LWpwZWc='}));const a=await p.begin({data:'${data}'});
    try{await expect(()=>p.begin({data:'${data}'}));await expect(()=>p.rows({token:'wrong',y:0,height:1}));await expect(()=>p.rows({token:a.token,y:-1,height:1}));await expect(()=>p.rows({token:a.token,y:0,height:129}));}
    finally{await p.end({token:a.token});}await expect(()=>p.rows({token:a.token,y:0,height:1}));
    fxExportCancel=true;try{await expect(()=>fxDecodeFullAndroidJpeg({bytes:Uint8Array.from(atob('${data}'),x=>x.charCodeAt(0))}));}finally{fxExportCancel=false;}
    const b=await p.begin({data:'${data}'});await p.end({token:b.token});return {rejected,reopened:true,guard:Capacitor._csJpegLogGuard};
  })()`);
  assert.equal(safeguards.rejected,7);assert(safeguards.reopened&&safeguards.guard);
  fs.writeFileSync(path.join(out,'jpeg-decode-checks.json'),JSON.stringify({records,safeguards},null,2));console.log('PASS orientation, ICC, odd rows, both transports, invalid/concurrent/expired requests and cancellation',JSON.stringify(safeguards));
}finally{c.close();}
