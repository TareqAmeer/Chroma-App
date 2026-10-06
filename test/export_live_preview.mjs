#!/usr/bin/env node
// Regression: a still export owns a frozen FXR while edits continue repainting the main preview.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png' };

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const server = startServer();
const runningServer = await server;
const browser = await chromium.launch({ args: [
  process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader',
  '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const shaderErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE|program.*link/i.test(msg.text())) shaderErrors.push(msg.text());
  });
  await page.goto(`http://127.0.0.1:${runningServer.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof processToCanvas === 'function' && typeof renderPreview === 'function');
  const fixture = await readFile(path.join(HERE, 'fixtures', 'chart.png'));
  await page.evaluate(async b64 => {
    const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const file = new File([bytes], 'chart.png', { type: 'image/png' });
    await loadFXImages([file]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, fixture.toString('base64'));
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

  const result = await page.evaluate(async () => {
    const S=33, makeLut=(mode)=>{
      const out=new Float32Array(S*S*S*3);let o=0;
      for(let b=0;b<S;b++)for(let g=0;g<S;g++)for(let r=0;r<S;r++){
        const R=r/32,G=g/32,B=b/32;
        if(mode==='a'){out[o++]=R*.72+.08;out[o++]=G*.9;out[o++]=B*.78+.06;}
        else{out[o++]=B*.65+.2;out[o++]=R*.55+.18;out[o++]=G*.7+.12;}
      }
      return out;
    };
    const gradeA=makeLut('a'),gradeB=makeLut('b');
    const cube=new Uint8Array(S*S*S*3);for(let i=0;i<cube.length;i+=3){cube[i]=8;cube[i+1]=245;cube[i+2]=24;}
    const curve=new Uint8Array(256*4);for(let i=0;i<256;i++){curve[i*4]=i;curve[i*4+1]=Math.round((255-i)*.85);curve[i*4+2]=Math.round(i*.72);curve[i*4+3]=255;}
    const depthA={data:new Uint8Array([20,70,130,240]),w:2,h:2};
    const depthB=new Uint8Array([230,180,90,10]);
    FX.setLUT(gradeA);FX.setPrintLUT(gradeA);FX.setHslLUT(cube);FX.setCurveTex(curve);FX.setDepthTex(depthA.data,depthA.w,depthA.h);
    fxState.lut=gradeA;fxState.print='test-print';
    const it=fxImages[fxCurIdx||0],src=document.createElement('canvas');src.width=1280;src.height=1024;
    src.getContext('2d').drawImage(geomCanvas(it),0,0,src.width,src.height);
    const P=getFXParams();P.lut=gradeA;P.print='test-print';P.hsl=true;P.curves=true;
    P._exportDepthMap={data:new Uint8Array(depthA.data),w:depthA.w,h:depthA.h};P.redEyeOps=[];
    const saved={_lutSnapshot:new Float32Array(FX._lutSnapshot),_printLutSnapshot:new Float32Array(FX._printLutSnapshot),
      _hslSnapshot:new Uint8Array(FX._hslSnapshot),_curveSnapshot:new Uint8Array(FX._curveSnapshot),
      _stockShoulderSnapshot:FX._stockShoulderSnapshot&&new Uint8Array(FX._stockShoulderSnapshot)};
    const renderer=fxPrepareExportRenderer();
    shouldTile=()=>true;Math.random=()=>0.375;
    const hash=canvas=>{
      const d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
      let h=2166136261;for(let i=0;i<d.length;i++){h^=d[i];h=Math.imul(h,16777619);}return h>>>0;
    };
    const baseline=await processToCanvas(P,src,src.width,src.height,()=>{},renderer);
    const baselineHash=hash(baseline);
    const previewBefore=hash((()=>{const c=document.createElement('canvas');c.width=FX.cv.width;c.height=FX.cv.height;c.getContext('2d').drawImage(FX.cv,0,0);return c;})());
    renderer.resetTextureSnapshotFrom(saved);
    let changed=false;
    const raced=await processToCanvas(P,src,src.width,src.height,()=>{
      if(changed)return;changed=true;
      FX.setLUT(gradeB);FX.setPrintLUT(gradeB);FX.setDepthTex(depthB,2,2);
      fxState.lut=gradeB;fxState.print='changed-print';
      renderPreview();
    },renderer);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const previewAfter=hash((()=>{const c=document.createElement('canvas');c.width=FX.cv.width;c.height=FX.cv.height;c.getContext('2d').drawImage(FX.cv,0,0);return c;})());
    const racedHash=hash(raced);
    const snapshotMatches=renderer._lutSnapshot[0]===saved._lutSnapshot[0]
      &&renderer._printLutSnapshot[0]===saved._printLutSnapshot[0]
      &&renderer._hslSnapshot[1]===saved._hslSnapshot[1]
      &&renderer._curveSnapshot[1]===saved._curveSnapshot[1]
      &&renderer._depthSnapshot.data[0]===depthA.data[0];
    FX.setDepthTex(depthA.data,depthA.w,depthA.h); // leave the page in a coherent state
    return { baselineHash,racedHash,previewBefore,previewAfter,changed,snapshotMatches,exportingFlag:window.__csExporting };
  });

  if (!result.changed) throw new Error('The tiled export did not yield to the mid-export edit');
  if (result.baselineHash !== result.racedHash) throw new Error(`Export pixels changed during the preview edit (${result.baselineHash} vs ${result.racedHash})`);
  if (result.previewBefore === result.previewAfter) throw new Error('The main preview did not repaint after the mid-export edit');
  if (!result.snapshotMatches) throw new Error('The export renderer did not retain its captured texture snapshot');
  if (shaderErrors.length) throw new Error(`GLSL compile/link errors: ${shaderErrors.join(' | ')}`);
  console.log(`PASS live preview during tiled export: stable export ${result.racedHash}; preview repainted ${result.previewBefore} → ${result.previewAfter}`);
} finally {
  await browser.close();
  runningServer.close();
}
