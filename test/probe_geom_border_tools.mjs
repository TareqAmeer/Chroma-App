// Regression probe: (1) rotate/flip must transform the crop, not clear it;
// (2) with Borders on (#fx-canvas-bd shown, #fx-canvas hidden) canvas tools must still get clicks.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __CSROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT=__CSROOT;
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.webp':'image/webp','.json':'application/json'};
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.setHeader('Cross-Origin-Opener-Policy','same-origin');rs.setHeader('Cross-Origin-Embedder-Policy','require-corp');rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const br=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
const pg=await br.newPage({viewport:{width:1400,height:900}});
pg.on('pageerror',e=>console.error('[pageerror]',e.message));
await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.loadFXImages==='function',null,{timeout:30000});
const b64=(await readFile(path.join(ROOT,'design/prototypes/swiss-kinetic/photos/canal.webp'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'canal.webp',{type:'image/webp'})]);},b64);
await pg.waitForFunction(()=>fxImages.length>0&&FX.cv.width>0,null,{timeout:90000});
let fail=0;const ck=(name,ok,got)=>{console.log((ok?'PASS ':'FAIL ')+name+' -> '+JSON.stringify(got));if(!ok)fail++;};
const near=(a,b)=>a&&b&&['x','y','w','h'].every(k=>Math.abs(a[k]-b[k])<1e-6);
let r=await pg.evaluate(()=>{const g=curGeom();g.crop={x:.1,y:.2,w:.3,h:.4};geomRotate(90);return curGeom().crop;});
ck('rotate +90 keeps crop',near(r,{x:.4,y:.1,w:.4,h:.3}),r);
r=await pg.evaluate(()=>{geomFlip('h');return curGeom().crop;});
ck('flipH at rot90 mirrors crop vertically',near(r,{x:.4,y:.6,w:.4,h:.3}),r);
r=await pg.evaluate(()=>{geomFlip('h');geomRotate(-90);return curGeom().crop;});
ck('flip back + rotate -90 restores crop',near(r,{x:.1,y:.2,w:.3,h:.4}),r);
r=await pg.evaluate(()=>{geomFlip('v');return curGeom().crop;});
ck('flipV at rot0 mirrors crop vertically',near(r,{x:.1,y:.4,w:.3,h:.4}),r);
await pg.evaluate(()=>{geomReset();});
// pixel check: the rotated+cropped output must equal the cropped output rotated 90 CW (and not CCW)
r=await pg.evaluate(()=>{const it=curItem(),g=curGeom();g.crop={x:.1,y:.2,w:.3,h:.4};
  const a=geomCanvas(it);geomRotate(90);const b=geomCanvas(it);geomReset();
  const rot=(cw)=>{const c=document.createElement('canvas');c.width=a.height;c.height=a.width;const x=c.getContext('2d');x.translate(c.width/2,c.height/2);x.rotate((cw?1:-1)*Math.PI/2);x.drawImage(a,-a.width/2,-a.height/2);return c;};
  const diff=(c)=>{const W=Math.min(b.width,c.width),H=Math.min(b.height,c.height);const d1=b.getContext('2d').getImageData(0,0,W,H).data,d2=c.getContext('2d').getImageData(0,0,W,H).data;let s=0;for(let i=0;i<d1.length;i+=4)s+=Math.abs(d1[i]-d2[i]);return s/(W*H);};
  return{cw:diff(rot(true)),ccw:diff(rot(false)),bw:b.width,bh:b.height,aw:a.width,ah:a.height};});
ck('rotated crop shows the same content, turned',r.cw<3&&r.ccw>r.cw*3,r);
r=await pg.evaluate(()=>{fxState.masks.push({type:'radial',cx:.2,cy:.3,rx:.1,ry:.2,rot:0,feather:.5});geomRotate(90);const m=fxState.masks[fxState.masks.length-1];const o={cx:m.cx,cy:m.cy,rx:m.rx,ry:m.ry};fxState.masks.pop();geomReset();return o;});
ck('radial mask follows rotate',Math.abs(r.cx-.7)<1e-9&&Math.abs(r.cy-.2)<1e-9&&r.rx===.2&&r.ry===.1,r);
r=await pg.evaluate(()=>{const g=curGeom();g.crop={x:.1,y:.2,w:.3,h:.4};geomStraighten(3);const c=g.crop;geomReset();return c;});
ck('straighten keeps crop',!!r,r);
// Borders on
await pg.evaluate(async()=>{document.getElementById('tg-borders').classList.add('on');document.getElementById('sl-b1-t').value=8;renderPreview();await new Promise(r=>setTimeout(r,500));});
const vis=await pg.evaluate(()=>{const bd=document.getElementById('fx-canvas-bd');return !!bd&&bd.style.display!=='none';});
ck('border overlay shown',vis,vis);
await pg.evaluate(()=>{if(!healMode)healToggle();});
await pg.waitForTimeout(3000); // let toasts / zoom transitions settle before hit-testing
const box=await pg.evaluate(()=>{const bd=document.getElementById('fx-canvas-bd');const q=bd.getBoundingClientRect();return{x:q.left+q.width*0.5,y:q.top+q.height*0.5};});
await pg.evaluate(()=>{const m=document.getElementById('cs-modal-ov');if(m)m.remove();}); // first-run modal would swallow the click
await pg.mouse.click(box.x,box.y);await pg.waitForTimeout(200);
r=await pg.evaluate(()=>(curItem().heal||[]).map(o=>[+o.x.toFixed(3),+o.y.toFixed(3)]));
ck('retouch click on bordered photo adds a spot near centre',r.length===1&&Math.abs(r[0][0]-.5)<.02&&Math.abs(r[0][1]-.5)<.02,r);
await pg.evaluate(()=>{healToggle();});
// mask overlay box must sit on the photo inside the frame, not at the frame's corner
r=await pg.evaluate(()=>{const b=mskOverlayBox(),bd=document.getElementById('fx-canvas-bd');const m=_fxDisplayMap;const s=bd.clientWidth/bd.width;return{b,exp:{left:m.offX*s,top:m.offY*s,width:m.w*s,height:m.h*s}};});
ck('mask overlay box aligned to photo inside border',r.b&&Math.abs(r.b.left-r.exp.left)<1.5&&Math.abs(r.b.top-r.exp.top)<1.5&&Math.abs(r.b.width-r.exp.width)<1.5,r);
await br.close();server.close();
console.log(fail?`${fail} FAILED`:'ALL PASS');process.exit(fail?1:0);
