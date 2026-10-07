import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {execFileSync} from 'node:child_process';import {createServer} from 'node:http';import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..'),old=execFileSync('git',['show','243991b0:chromasmith-22.html'],{encoding:'utf8',maxBuffer:64*1024*1024});
const start=old.indexOf('async function renderTiled('),legacy=old.slice(start,old.indexOf('// Export scope:',start));
// Check the rectangle and vertical flip independently of a GPU driver.
const sourceText=fs.readFileSync(path.join(root,'chromasmith-22.html'),'utf8');let region;
const fakeGL={RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,format,type,bytes){region=[x,y,w,h];for(let i=0;i<bytes.length;i++)bytes[i]=i%251;}};
const unit={Uint8Array,Uint8ClampedArray,ImageData:class{constructor(data,w,h){this.data=data;this.width=w;this.height=h;}}};vm.createContext(unit);
vm.runInContext(sourceText.slice(sourceText.indexOf('function fxReadExportTile('),sourceText.indexOf('async function renderTiled(')),unit);
for(const [w,h]of [[1,1],[3,5],[5,4]]){const out=unit.fxReadExportTile({gl:fakeGL,h:19},2,3,w,h);assert.deepEqual(region,[2,19-3-h,w,h]);assert.equal(out.data.length,w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w*4;x++)assert.equal(out.data[y*w*4+x],((h-1-y)*w*4+x)%251);}
const server=createServer((req,res)=>{try{const p=path.resolve(root,'.'+req.url.split('?')[0]);if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});const page=await browser.newPage({userAgent:'Android'});
 await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);await page.waitForFunction(()=>typeof fxReadExportTile==='function');
 const skin=JSON.parse(fs.readFileSync(path.join(root,'test/recipes/skin_uniformity.json'),'utf8')).masks;
 const result=await page.evaluate(async({legacy,skin})=>{
  const old=eval('('+legacy+')'),current=renderTiled,source=document.createElement('canvas');source.width=2571;source.height=1317;
  const x=source.getContext('2d'),g=x.createLinearGradient(0,0,source.width,source.height);g.addColorStop(0,'#0d3547');g.addColorStop(.5,'#bc9778');g.addColorStop(1,'#fff2d9');x.fillStyle=g;x.fillRect(0,0,source.width,source.height);
  x.clearRect(0,0,31,53);x.clearRect(2000,1000,310,90);x.globalAlpha=.37;x.fillStyle='#d63851';x.fillRect(980,980,150,100);x.globalAlpha=1;
  const renderer=fxPrepareExportRenderer(),base=structuredClone(getFXParams());base.halation.enabled=base.bloom.enabled=base.grain.enabled=false;base.redEyeOps=[];base.adjust.enabled=true;base.adjust.exposure=.25;
  const tile=shouldTile,random=Math.random;shouldTile=()=>true;Math.random=()=>.375;const rows=[];
  const read=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  try{for(const [kind,memory]of [['basic',2],['transparent-low',1],['unknown',undefined],['grain',2],['glow',4],['skin',4],['detail',2],['lens',2],['nr',2],['tonemap',2],['red-eye',2]]){
   Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:memory});const p=structuredClone(base);
   if(kind==='grain')p.grain.enabled=true;if(kind==='glow')p.halation.enabled=p.bloom.enabled=true;if(kind==='skin')p.masks=structuredClone(skin);
   if(kind==='detail'){p.adjust.sharpness=.06;p.adjust.clarity=.04;p.adjust.texture=.03;}if(kind==='lens')p.lens.dist=.03;if(kind==='nr')p.nr.luma=10;if(kind==='tonemap')p.tonemap=true;
   if(kind==='red-eye')p.redEyeOps=[{x:.4,y:.75,rx:.03,ry:.04,enabled:true}];
   renderTiled=old;const a=await processToCanvas(p,source,source.width,source.height,null,renderer),before=read(a);
   renderTiled=current;const b=await processToCanvas(p,source,source.width,source.height,null,renderer),after=read(b);let max=0;for(let i=0;i<before.length;i++)max=Math.max(max,Math.abs(before[i]-after[i]));
   rows.push({kind,memory:memory??null,max});a.width=a.height=b.width=b.height=0;
  }
  Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone'});const ios=fxCanReadExportTile(renderer);Object.defineProperty(navigator,'userAgent',{value:'Android'});
  const unavailable=fxCanReadExportTile({gl:{}});return {rows,ios,unavailable};
  }finally{renderTiled=current;shouldTile=tile;Math.random=random;}
 },{legacy,skin});
 assert(result.rows.every(r=>r.max===0),JSON.stringify(result));assert.equal(result.ios,false);assert.equal(result.unavailable,false);
 fs.mkdirSync(path.join(root,'test/android/out'),{recursive:true});fs.writeFileSync(path.join(root,'test/android/out/center-pixel-checks.json'),JSON.stringify(result,null,2));console.log('PASS: exact RGBA, odd edges, transparency, effects, constrained/unknown memory, platform/API fallback',JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
