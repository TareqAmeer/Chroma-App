// Raw pixel checks for experimental render methods, including transparency/spatial effects.
import fs from 'node:fs';import path from 'node:path';import {createServer} from 'node:http';import {chromium} from 'playwright';
const ROOT=path.resolve(import.meta.dirname,'..');
const server=createServer((req,res)=>{try{const file=path.resolve(ROOT,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(ROOT+path.sep))throw Error('outside root');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const page=await browser.newPage({userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36'});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);await page.waitForFunction(()=>typeof processToCanvas==='function');
  await page.evaluate(fs.readFileSync(path.join(ROOT,'test/android/export_methods_page.js'),'utf8'));
  const skin=JSON.parse(fs.readFileSync(path.join(ROOT,'test/recipes/skin_uniformity.json'),'utf8')).masks;
  const rows=await page.evaluate(async skin=>{
    const m=window.__methods,src=document.createElement('canvas');src.width=2305;src.height=1537;
    const x=src.getContext('2d'),g=x.createLinearGradient(0,0,2305,1537);g.addColorStop(0,'#092546');g.addColorStop(.5,'#b77552');g.addColorStop(1,'#fffade');x.fillStyle=g;x.fillRect(0,0,2305,1537);
    for(let i=0;i<12;i++){x.fillStyle=i%2?'white':'black';x.fillRect(990+i*90,180+i*57,7,600);}x.clearRect(0,0,43,43);
    m.source=src;m.w=src.width;m.h=src.height;m.renderer=fxPrepareExportRenderer();
    const oldTile=shouldTile;shouldTile=()=>true;const rows=[];
    try{for(const kind of ['basic','grain','glow','skin','detail']){
      m.P=structuredClone(getFXParams());m.P.halation.enabled=m.P.bloom.enabled=m.P.grain.enabled=false;m.P.redEyeOps=[];
      m.P.adjust.enabled=true;m.P.adjust.exposure=.25;
      if(kind==='grain')m.P.grain.enabled=true;
      if(kind==='glow')m.P.halation.enabled=m.P.bloom.enabled=true;
      if(kind==='skin')m.P.masks=structuredClone(skin);
      if(kind==='detail'){m.P.adjust.sharpness=.06;m.P.adjust.clarity=.04;m.P.adjust.texture=.03;}
      const ref=await m.render('current'),a=ref.getContext('2d').getImageData(0,0,m.w,m.h).data;
      for(const method of ['texture','halo','direct','combined']){
        const c=await m.render(method),b=c.getContext('2d').getImageData(0,0,m.w,m.h).data;let sum=0,max=0,alphaMax=0;
        for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(i%4===3)alphaMax=Math.max(alphaMax,d);else{sum+=d;max=Math.max(max,d);}}
        rows.push({kind,method,mean:sum/(m.w*m.h*3),max,alphaMax});c.width=c.height=0;
      }ref.width=ref.height=0;
    }}finally{shouldTile=oldTile;}return rows;
  },skin);
  console.log(JSON.stringify(rows,null,2));fs.mkdirSync(path.join(ROOT,'test/android/out'),{recursive:true});fs.writeFileSync(path.join(ROOT,'test/android/out/method-pixels.json'),JSON.stringify(rows,null,2));
  // An experiment is not automatically a production gate: expose exact differences.
  if(rows.some(r=>r.method==='texture'&&(r.max!==0||r.alphaMax!==0)))throw Error('Texture reuse changed pixels');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
