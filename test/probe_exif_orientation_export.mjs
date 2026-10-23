#!/usr/bin/env node
// Regression probe: a JPEG whose pixels are stored landscape (300x200) with EXIF Orientation=6
// displays as a 200x300 portrait. The export must ALSO be 200x300 portrait pixels AND carry
// Orientation=1 (or none) — otherwise viewers show it sideways. Drives the real exportFX path
// and catches the browser download.
import { chromium, webkit } from 'playwright';
const ENGINE=process.argv.includes('--webkit')?'webkit':'chromium';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.json':'application/json'};
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.setHeader('Cross-Origin-Opener-Policy','same-origin');rs.setHeader('Cross-Origin-Embedder-Policy','require-corp');rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const br=ENGINE==='webkit'?await webkit.launch():await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await br.newPage({viewport:{width:1200,height:900},acceptDownloads:true});
pg.on('pageerror',e=>console.error('[pageerror]',e.message));
pg.on('console',m=>{if(m.type()==='error')console.error('[console.error]',m.text());});
await pg.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.loadFXImages==='function',null,{timeout:30000});
const ROT=+(process.env.ROT||0);const SW=+(process.env.W||300),SH=+(process.env.H||200);
const pre=await pg.evaluate(async([SW,SH,ROT])=>{
  const c=document.createElement('canvas');c.width=SW;c.height=SH;const x=c.getContext('2d');
  x.fillStyle='#204080';x.fillRect(0,0,SW,SH);x.fillStyle='#e0e0e0';x.fillRect(0,0,SW/5,SH); // bright LEFT band in stored pixels
  const j=new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/jpeg',0.95))).arrayBuffer());
  // APP1 Exif, big-endian, IFD0 with one entry: Orientation(0x0112) SHORT 1 = 6
  const tiff=[0x4D,0x4D,0,42,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1,0,6,0,0, 0,0,0,0];
  const body=[0x45,0x78,0x69,0x66,0,0,...tiff],len=body.length+2;
  const app1=[0xFF,0xE1,len>>8,len&255,...body];
  const out=new Uint8Array(j.length+app1.length);out.set(j.subarray(0,2));out.set(app1,2);out.set(j.subarray(2),2+app1.length);
  const f=new File([out],'portrait6.jpg',{type:'image/jpeg'});
  await window.loadFXImages([f]);
  const it=fxImages[0];
  if(ROT){it.geom={...defGeom(),rot:ROT};updateWork();}
  return{workW:fxWork.naturalWidth||fxWork.width,workH:fxWork.naturalHeight||fxWork.height,imgW:it.img.naturalWidth||it.img.width,imgH:it.img.naturalHeight||it.img.height};
},[SW,SH,ROT]);
// Non-JPEG source (HEIC 'ftyp' box sprinkled with FF Ex/FF FE bytes) must NOT be spliced into a JPEG
// export as APPn segments — that produced unreadable files from real iPhone HEIC exports.
const heicSplice=await pg.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=16;c.height=16;
  const out=new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/jpeg',0.9))).arrayBuffer());
  const fake=new Uint8Array(4096);fake.set([0,0,0,24,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63]);
  for(let i=40;i<4000;i+=97){fake[i]=0xFF;fake[i+1]=0xE0+(i%15);fake[i+2]=0;fake[i+3]=20;}
  const res=injectMetadata(out,fake,'jpg');return{same:res.length===out.length,grew:res.length-out.length};});
console.log('heic-source splice',JSON.stringify(heicSplice));
const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.evaluate(()=>{fxExportScope='all';return exportFX();})]);
const buf=await readFile(await dl.path());
// parse JPEG SOF dims + EXIF orientation
let w=0,h=0,orient=null;
for(let i=2;i<buf.length-4;){if(buf[i]!==0xFF){i++;continue;}const m=buf[i+1],L=buf.readUInt16BE(i+2);
  if(m>=0xC0&&m<=0xC3){h=buf.readUInt16BE(i+5);w=buf.readUInt16BE(i+7);break;}
  if(m===0xE1&&buf.toString('latin1',i+4,i+8)==='Exif'){const t=i+10,le=buf[t]===0x49,u16=o=>le?buf.readUInt16LE(o):buf.readUInt16BE(o),u32=o=>le?buf.readUInt32LE(o):buf.readUInt32BE(o);
    const ifd=t+u32(t+4),n=u16(ifd);for(let e=0;e<n;e++){const o=ifd+2+e*12;if(u16(o)===0x0112)orient=u16(o+8);}}
  i+=2+L;}
// Content check: stored LEFT bright band must land at the TOP after Orientation=6 (90deg CW).
const band=await pg.evaluate(async b64=>{const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  const bm=await createImageBitmap(new Blob([u],{type:'image/jpeg'}),{imageOrientation:'none'});
  const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;const x=c.getContext('2d');x.drawImage(bm,0,0);
  const L=(px,py)=>{const d=x.getImageData(px,py,1,1).data;return d[0]+d[1]+d[2];};
  return{top:L(bm.width>>1,(bm.height*0.08)|0),bottom:L(bm.width>>1,(bm.height*0.92)|0),left:L(15,bm.height>>1),right:L(bm.width-15,bm.height>>1)};},buf.toString('base64'));
console.log(JSON.stringify({engine:ENGINE,file:dl.suggestedFilename(),loaded:pre,export:{w,h,orient},band}));
await br.close();server.close();
const ok=heicSplice.same&&pre.imgW===SH&&pre.imgH===SW&&w===SH&&h===SW&&(orient===null||orient===1)&&band.top>band.bottom+150;
console.log(ok?'PASS':'FAIL');process.exit(ok?0:1);
