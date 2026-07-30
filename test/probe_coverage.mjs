// Where is skin being MISSED? Reports gate vs shape separately for many body points, plus what a
// SHAPELESS gate would pick up elsewhere in the frame.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT='/Users/tareqameer/Documents/GitHub/Chroma-App';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.cube':'text/plain'};
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.setHeader('Cross-Origin-Opener-Policy','same-origin');rs.setHeader('Cross-Origin-Embedder-Policy','require-corp');rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const br=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
const pg=await br.newPage({viewport:{width:1400,height:1000}});
pg.on('pageerror',e=>console.error('[pageerror]',e.message));
pg.on('console',m=>{if(m.type()==='error')console.error('[console.error]',m.text());});
await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.applyUISnapshot==='function',null,{timeout:30000});
const jpg=(await readFile(path.join(ROOT,'__TM3390.jpg'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'__TM3390.jpg',{type:'image/jpeg'})]);},jpg);
await pg.waitForFunction(()=>typeof fxImages!=='undefined'&&fxImages.length>0,null,{timeout:60000});

const out=await pg.evaluate(async()=>{
  const it=fxImages[0],src=it.img,W=src.naturalWidth,H=src.naturalHeight;
  const c0=document.createElement('canvas');c0.width=W;c0.height=H;c0.getContext('2d').drawImage(src,0,0);
  const full=c0.getContext('2d').getImageData(0,0,W,H).data;
  const blk=(x,y)=>{let r=0,g=0,b=0,c=0;
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const xx=Math.min(W-1,Math.max(0,x+dx)),yy=Math.min(H-1,Math.max(0,y+dy));
      const i=(yy*W+xx)*4;r+=full[i];g+=full[i+1];b+=full[i+2];c++;}
    return [r/c,g/c,b/c];};
  const hsvOf=(x,y)=>{const p=blk(x,y);return r2hsv(p[0]/255,p[1]/255,p[2]/255);};

  const SKIN={
    'cheek':[1290,3990],'neck':[1440,4560],
    'shoulder R(top)':[750,4950],'shoulder R(out)':[300,5400],'arm far L':[130,5620],
    'chest upper':[1200,5250],'chest mid':[1500,5600],'chest lower':[1750,5750],
    'belly':[1500,5900],'chest side R':[600,5750],'pec L':[2000,5500],'armpit L':[2250,5350],
  };
  const OTHER={'sunglass lens':[1230,3560],'pupil/socket':[1300,3575],'dog head':[2370,3600],'dog body':[2550,4350],'beach sand':[2340,2970],
    'fg rock dark':[300,3600],'lake':[3300,3150],'sky':[2700,300],'green trees':[900,2400],
    'wet hair':[1000,3400],
    // The sunlit mountain face — the thing that actually lit up red in the render, and which the
    // earlier probe never sampled (its "snow" point was sky and its "rock" point the dark
    // foreground). Warm-grey limestone is the hardest non-skin case for a colour gate.
    'mtn face lit':[1500,750],'mtn face mid':[2100,1200],'scree':[900,1500],
    'mtn shadow':[1700,1500],'snow patch':[900,300]};
  const ALL={...SKIN,...OTHER};

  // 6 samples now: add the shadowed pec (34deg round the wheel), the bright arm and the armpit —
  // the three that a 3-sample gate missed or barely held.
  const setOf=names=>names.map(n=>{const[h,s,v]=hsvOf(...SKIN[n]);return{h,s,v};});
  const SETS={
    '3 lit':['cheek','neck','chest mid'],
    '4 lit (+arm)':['cheek','neck','chest mid','arm far L'],
    '5 lit (+armpit)':['cheek','neck','chest mid','arm far L','armpit L'],
    '6 incl shadow pec':['cheek','neck','chest mid','arm far L','armpit L','pec L'],
  };
  const samples=setOf(SETS['4 lit (+arm)']);
  const RANGE=55;
  const shape=(m,x,y)=>{const u=x/W,v=1-y/H;
    const t=Math.hypot((u-m.cx)/m.rx,(v-m.cy)/m.ry);
    const f=Math.min(Math.max(m.feather,0.01),0.5),e0=Math.max(1-2*f,0);
    let ss=Math.min(1,Math.max(0,(t-e0)/(1-e0)));return 1-ss*ss*(3-2*ss);};
  const M={cx:0.319,cy:0.22,rx:0.42,ry:0.46,feather:0.3};
  const SHAPELESS=true;   // + Skin is shapeless now: shape weight is 1 everywhere
  const rows={};
  for(const[n,[x,y]]of Object.entries(ALL)){
    const[h,s,v]=hsvOf(x,y);
    rows[n]={rgb:blk(x,y).map(Math.round),h:+h.toFixed(4),s:+s.toFixed(3),v:+v.toFixed(3),
      gate:+crWeightJS(h,s,samples,RANGE,hsvOf(x,y)[2]).toFixed(3),shape:SHAPELESS?1:+shape(M,x,y).toFixed(3)};
  }
  // Sweep the sample sets: how much skin is covered vs how much non-skin leaks?
  const sweep={};
  for(const[label,names]of Object.entries(SETS)){
    const sm=setOf(names);
    let minSkin=1,nMissed=0,maxLeak=0,leaks=[];
    for(const n of Object.keys(SKIN)){
      const[h,s,v]=hsvOf(...SKIN[n]);
      const g=crWeightJS(h,s,sm,RANGE,v);
      if(g<minSkin)minSkin=g;
      if(g<0.6)nMissed++;
    }
    for(const n of Object.keys(OTHER)){
      const[h,s,v]=hsvOf(...OTHER[n]);
      const g=crWeightJS(h,s,sm,RANGE,v);
      if(g>0.15){leaks.push(n+' '+g.toFixed(2));}
      if(g>maxLeak)maxLeak=g;
    }
    sweep[label]={minSkin:+minSkin.toFixed(3),nMissed,leaks};
  }
  return {rows,samples,sweep,skinNames:Object.keys(SKIN),otherNames:Object.keys(OTHER)};
});

console.log('samples used:',JSON.stringify(out.samples.map(p=>({h:+p.h.toFixed(3),s:+p.s.toFixed(3)}))));
const show=(names,title)=>{
  console.log('\n'+title);
  console.log('  '+'point'.padEnd(17)+'rgb'.padEnd(17)+'h'.padEnd(8)+'s'.padEnd(7)+'gate'.padEnd(7)+'shape'.padEnd(7)+'eff');
  for(const n of names){const r=out.rows[n];
    const eff=+(r.gate*r.shape).toFixed(3);
    const flag=names===out.skinNames?(eff<0.6?'  <-- MISSED':''):(eff>0.08?'  <-- LEAK':'');
    console.log('  '+n.padEnd(17)+String(r.rgb).padEnd(17)+String(r.h).padEnd(8)+String(r.s).padEnd(7)
      +String(r.gate).padEnd(7)+String(r.shape).padEnd(7)+eff+flag);}
};
show(out.skinNames,'SKIN — want gate AND shape near 1');
show(out.otherNames,'NOT SKIN — want effective near 0');
console.log('\nSAMPLE-SET SWEEP (shapeless; 12 real skin points)');
for(const[k,v]of Object.entries(out.sweep)){
  console.log('  '+k.padEnd(20)+'weakest skin '+String(v.minSkin).padEnd(7)+'missed '+String(v.nMissed).padEnd(3)+'leaks: '+(v.leaks.join(', ')||'none'));
}
await br.close(); server.close();
