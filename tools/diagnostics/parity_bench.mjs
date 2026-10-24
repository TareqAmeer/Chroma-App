#!/usr/bin/env node
// Real-app (WKWebView) preview-vs-export parity bench. Usage:
//   python3 tools/diagnostics/app_control.py start --automation   (and open the Editor, see docs)
//   node tools/diagnostics/parity_bench.mjs <photo.jpg> [--fr=1|0] [--grain] [--pcts=0,100,200,500]
// For each zoom it screenshots the live window (screencapture -l), crops a window out of the photo, and compares it
// (best +-4px alignment) with the EXPORT render (processToCanvas) of the same region resampled to device pixels.
// Reports mean abs luma diff and the high-frequency energy ratio preview/export (1.0 = same sharpness).
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const photo = args.find(a => !a.startsWith('--'));
const opt = k => (args.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const FR = opt('fr') !== '0', GRAIN = args.includes('--grain'), PCTS = (opt('pcts') || '0,100,200,500').split(',').map(Number);
const SCR = process.env.SCRATCH || '/tmp';
const ev = (code, timeout = 240) => { const f = SCR + '/_parity_code.js'; writeFileSync(f, code);
  const out = execFileSync('python3', [path.join(here, 'app_control.py'), 'run', '--timeout', String(timeout), '--code', code], { maxBuffer: 1 << 28 }).toString();
  const j = JSON.parse(out); if (!j.ok) throw new Error(out); return typeof j.result === 'string' && /^[\[{]/.test(j.result) ? JSON.parse(j.result) : j.result; };
const winId = () => execFileSync('swift', [path.join(here, 'native_helpers/find_window.swift'), '--', 'Chromasmith']).toString().trim().split('\n').pop();
console.log('setup', JSON.stringify(ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
 document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e=>e.remove());
 document.body.classList.remove('lib-full');document.body.classList.add('lib-docked');const o=document.getElementById('lib-overlay');if(o)o.classList.remove('full');
 const u=window.__TAURI__.core.convertFileSrc(${JSON.stringify(path.resolve(photo))});const b=await (await fetch(u)).blob();
 await loadFXImages([new File([b],'p.jpg',{type:'image/jpeg'})]);await s(3000);document.body.classList.remove('lib-full');document.body.classList.add('lib-docked');{const o=document.getElementById('lib-overlay');if(o)o.classList.remove('full');}await s(1000);
 if(${FR}!==!!fxFullResPreview)fxFullResPreviewToggle();
 if(!allFxIsOn())enableAll();await s(2000);
 const g=document.getElementById('tg-grain');if(g&&g.classList.contains('on')!==${GRAIN})g.click();await s(1500);
 const work=fxWork||fxImg,iw=work.naturalWidth||work.width,ih=work.naturalHeight||work.height;
 const P=getFXParams();const t0=performance.now();const cv=await processToCanvas(P,work,iw,ih);
 const t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;t.getContext('2d').drawImage(cv,0,0);window.__EXP=t;{const sm=document.createElement('canvas');sm.width=624;sm.height=416;sm.getContext('2d').drawImage(t,0,0,624,416);const d=sm.getContext('2d').getImageData(0,0,624,416).data,G=new Float32Array(624*416);for(let y=1;y<415;y++)for(let x=1;x<623;x++){const i=(y*624+x)*4;G[y*624+x]=Math.abs(d[i+1]-d[i-3])+Math.abs(d[i+1]-d[i+1+624*4]);}window.__HF=G;}
 return {iw,ih,ex:[t.width,t.height],exportMs:Math.round(performance.now()-t0),fr:fxFullResPreview,grain:!!P.grain.enabled,borders:!!P.bordersEnabled,dpr:devicePixelRatio}})()`)));
const rows = [];
for (const pct of PCTS) {
  const geo = ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
   document.body.classList.remove('lib-full');document.body.classList.add('lib-docked');{const o=document.getElementById('lib-overlay');if(o)o.classList.remove('full');}await s(800);window.dispatchEvent(new Event('resize'));_resetZoom(false);renderPreview();await s(1500);if(${pct}){fxZoom=_fxPctToZoom(${pct});_applyZoom(false);renderPreview();await s(5000);}
   ${process.env.HACK_FILE?readFileSync(process.env.HACK_FILE,'utf8'):(process.env.HACK||'')}
   await s(300);const bd=document.getElementById('fx-canvas-bd'),onBd=bd&&bd.style.display!=='none';const el=onBd?bd:FX.cv,b=el.getBoundingClientRect(),M=(typeof _fxDisplayMap!=='undefined')?_fxDisplayMap:null;
   const wr=document.getElementById('fx-wrap').getBoundingClientRect();let ph={x:b.x,y:b.y,w:b.width,h:b.height};
   if(onBd&&M){const k=b.width/el.width;ph={x:b.x+M.offX*k,y:b.y+M.offY*k,w:M.w*k,h:M.h*k};}
   const vx0=Math.max(ph.x,wr.x),vy0=Math.max(ph.y,wr.y),vx1=Math.min(ph.x+ph.w,wr.x+wr.width),vy1=Math.min(ph.y+ph.h,wr.y+wr.height);
   const cw=Math.floor(Math.min(300,vx1-vx0)),ch=Math.floor(Math.min(200,vy1-vy0));let cx=Math.round((vx0+vx1)/2-cw/2),cy=Math.round((vy0+vy1)/2-ch/2);
   {const G=window.__HF;let bestE=-1;const uw=cw/ph.w*624,uh=ch/ph.h*416;for(let sy=vy0;sy+ch<=vy1;sy+=Math.max(8,ch/4))for(let sx=vx0;sx+cw<=vx1;sx+=Math.max(8,cw/4)){
     const u0=Math.max(1,Math.round((sx-ph.x)/ph.w*624)),v0=Math.max(1,Math.round((sy-ph.y)/ph.h*416));let e=0,n=0;for(let v=v0;v<Math.min(415,v0+uh);v++)for(let u=u0;u<Math.min(623,u0+uw);u++){e+=G[v*624+u];n++}
     if(n&&e/n>bestE){bestE=e/n;cx=Math.round(sx);cy=Math.round(sy)}}}
   {const W=${JSON.stringify(process.env.WIN||'')};if(W){const q=W.split(',').map(Number);cx=q[0];cy=q[1];}}
   return {ph,cx,cy,cw,ch,bw:el.width,bcss:b.width,info:document.getElementById('fx-info').textContent,zoom:fxZoom,crop:typeof _fxCropShown!=='undefined'&&_fxCropShown}})()`);
  console.log("geo", JSON.stringify(geo)); const S = 2, full = SCR + '/_parity_full.png', crop = SCR + '/_parity_crop.png';
  execFileSync('screencapture', ['-l', winId(), '-o', full]);
  execFileSync('sips', ['-c', String(geo.ch * S), String(geo.cw * S), '--cropOffset', String(geo.cy * S), String(geo.cx * S), full, '--out', crop], { stdio: 'ignore' });
  const b64 = readFileSync(crop).toString('base64');
  const m = ev(`(async()=>{const geo=${JSON.stringify(geo)},S=${S},b64=${JSON.stringify(b64)};
   const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
   const WA=geo.cw*S,HA=geo.ch*S;const sc=document.createElement('canvas');sc.width=WA;sc.height=HA;sc.getContext('2d').drawImage(img,0,0,WA,HA);
   const A=sc.getContext('2d').getImageData(0,0,WA,HA).data;const E=window.__EXP,ph=geo.ph,PAD=6,k=E.width/ph.w/S;
   const ec=document.createElement('canvas');ec.width=WA+2*PAD;ec.height=HA+2*PAD;const g=ec.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality=k>1?'high':'low';
   g.drawImage(E,((geo.cx-ph.x)*S-PAD)*k*1,((geo.cy-ph.y)*S-PAD)*k*1,(WA+2*PAD)*k,(HA+2*PAD)*k,0,0,ec.width,ec.height);
   const B=g.getImageData(0,0,ec.width,ec.height).data,WB=ec.width;const L=(D,i)=>0.3*D[i]+0.59*D[i+1]+0.11*D[i+2];
   let best=1e9,bx=0,by=0;for(let dy=-PAD;dy<=PAD;dy++)for(let dx=-PAD;dx<=PAD;dx++){let d=0,n=0;for(let y=PAD;y<HA-PAD;y+=3)for(let x=PAD;x<WA-PAD;x+=3){d+=Math.abs(L(A,(y*WA+x)*4)-L(B,((y+PAD+dy)*WB+x+PAD+dx)*4));n++}if(d/n<best){best=d/n;bx=dx;by=dy}}
   let hA=0,hB=0,n2=0;for(let y=PAD;y<HA-PAD;y++)for(let x=PAD;x<WA-PAD;x++){const i=(y*WA+x)*4,j=((y+PAD+by)*WB+x+PAD+bx)*4;
    hA+=Math.abs(4*L(A,i)-L(A,i-4)-L(A,i+4)-L(A,i-WA*4)-L(A,i+WA*4));hB+=Math.abs(4*L(B,j)-L(B,j-4)-L(B,j+4)-L(B,j-WB*4)-L(B,j+WB*4));n2++}
   const oc=document.createElement('canvas');oc.width=WA;oc.height=HA;oc.getContext('2d').drawImage(ec,PAD+bx,PAD+by,WA,HA,0,0,WA,HA);
   return {exportCrop:oc.toDataURL('image/png').slice(22),meanAbsDiff:+best.toFixed(2),shift:[bx,by],hfPreview:+(hA/n2).toFixed(2),hfExport:+(hB/n2).toFixed(2),hfRatio:+(hA/hB).toFixed(3)}})()`, 300);
  if (m.exportCrop) { writeFileSync(SCR + '/parity_export_' + (pct || 'fit') + '.png', Buffer.from(m.exportCrop, 'base64')); execFileSync('cp', [crop, SCR + '/parity_preview_' + (pct || 'fit') + '.png']); delete m.exportCrop; }
  const row = { win:[geo.cx,geo.cy], pct: pct || 'fit', ...m, bw: geo.bw, bcss: Math.round(geo.bcss), crop: geo.crop, info: geo.info };
  rows.push(row); console.log(JSON.stringify(row));
}
