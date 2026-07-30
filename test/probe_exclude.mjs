// Validates the user's workflow: a skin mask, plus a BRUSH over the lips and a shape over the dog,
// both flagged as erasers so BOTH are excluded at once (subtract-prev can only remove one).
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
  const hsvAt=(x,y)=>{const i=(y*W+x)*4;return r2hsv(full[i]/255,full[i+1]/255,full[i+2]/255);};
  const S=n=>{const[h,s,v]=hsvAt(n[0],n[1]);return{h,s,v};};
  const PT={cheek:[1150,3760],'chest upper':[1200,5250],'chest lower':[1500,5600],
            lips:[1330,3950],'dog head':[2370,3600],'dog body':[2550,4350],
            'grey rock':[300,3600],sky:[2700,300]};
  const BASE={invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,
    subtract:false,colHue:0,colAmt:0,colSat:0.65,crOn:false,crSamples:[],crRange:55,
    uH:0,uS:0,uL:0,preserve:35,tgtMode:'match',tgtHex:'#d7bd96',tanDepth:0,tanWarm:0,srcV:null,
    amount:100,name:'',muted:false,tex:0,isExclude:false,rot:0,feather:0.3};
  // Brush eraser over the lips, painted into the mask's own raster buffer.
  const {w:mw,h:mh}=mskTexDims();
  const lipPx=new Array(mw*mh).fill(0);
  // lips sit around x 1180-1500, y 4180-4360 in the 4000x6000 original
  // ⚠️ Two conventions, both verified empirically in this probe (see the "px rows 0..h/2" column,
  // which moves only the SKY): m.px holds 0..255 — mskPaintAt writes up to 255, not 1 — and buffer
  // row 0 is the image TOP, i.e. plain top-down, even though setMaskTex uploads with
  // UNPACK_FLIP_Y_WEBGL. Getting either wrong makes a painted mask silently do nothing.
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
    const ox=x/mw*W, oy=y/mh*H;
    if(ox>1230&&ox<1470&&oy>3880&&oy<3985)lipPx[y*mw+x]=255;   // mouth only
  }
  const lips={...BASE,type:'brush',origin:'paint',px:lipPx,mtW:mw,mtH:mh,name:'lips',isExclude:true};
  const dog={...BASE,type:'radial',name:'dog',cx:0.634,cy:0.3125,rx:0.16,ry:0.18,feather:0.35,isExclude:true};
  const skin={...BASE,type:'radial',origin:'skin',name:'skin',cx:0.319,cy:0.22,rx:0.42,ry:0.46,
    feather:0.3,crOn:true,crSamples:[S(PT.cheek),S([1440,4560]),S(PT['chest lower'])],crRange:55,
    uH:90,uS:80,uL:70,preserve:35,tgtMode:'match',tanDepth:35,tanWarm:45};
  let acc=0,wsum=0;
  for(let y=0;y<H;y+=16)for(let x=0;x<W;x+=16){
    const[h,s,v]=hsvAt(x,y);const w=crWeightJS(h,s,skin.crSamples,skin.crRange);
    if(w>0){acc+=w*v;wsum+=w;}
  }
  skin.srcV=wsum/wsum?acc/wsum:null;

  const VW=900,VH=Math.round(VW*H/W);
  const render=async(masks,opts)=>{
    window.__reseed&&window.__reseed();
    window.applyUISnapshot({sliders:{},toggles:{local:!!masks},selects:{'sel-lut':'','sel-print':''},colors:{},masks:masks||[]});
    window.fxUpdate&&window.fxUpdate();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    fxState.artSeed=7.7;
    FX.render(window.getFXParams(),VW,VH,Object.assign({glowScale:1,showSel:-1},opts||{}));
    const cv=document.createElement('canvas');cv.width=VW;cv.height=VH;
    cv.getContext('2d').drawImage(FX.cv,0,0);return cv;
  };
  const read=cv=>{const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data,o={};
    for(const[n,[x,y]]of Object.entries(PT)){
      const cx=Math.round(x*cv.width/W),cy=Math.round(y*cv.height/H);
      let r=0,g=0,b=0,c=0;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const xx=Math.min(cv.width-1,Math.max(0,cx+dx)),yy=Math.min(cv.height-1,Math.max(0,cy+dy));
        const i=(yy*cv.width+xx)*4;r+=d[i];g+=d[i+1];b+=d[i+2];c++;}
      o[n]=[Math.round(r/c),Math.round(g/c),Math.round(b/c)];
    }
    return o;};
  const before=read(await render(null));
  // Control: is the brush raster reaching the shader AT ALL? Same mask, not an eraser, big exposure.
  const brushOnly=read(await render([{...lips,isExclude:false,exp:0.8}]));
  // Orientation-independent control: a FULLY painted raster must affect the whole frame.
  const fullPx=new Array(mw*mh).fill(255);
  const brushFull=read(await render([{...lips,px:fullPx,isExclude:false,exp:0.8}]));
  // And the same raster used as an eraser against a full-frame skin mask.
  const eraseAll=read(await render([{...lips,px:fullPx,isExclude:true},{...skin}]));
  // Pin the row convention: paint only buffer rows < mh/2 and see which END of the photo moves.
  const topHalf=new Array(mw*mh).fill(0);
  for(let y=0;y<mh/2;y++)for(let x=0;x<mw;x++)topHalf[y*mw+x]=255;
  const brushRow0=read(await render([{...lips,px:topHalf,isExclude:false,exp:0.8}]));
  const afterNoEx=read(await render([{...skin}]));
  const afterEx=read(await render([lips,dog,skin]));
  const selCv=await render([lips,dog,skin],{showSel:2});
  const lipSel=await render([lips,dog,skin],{showSel:0});
  // Diagnostic: what does the shader actually sample for the lips eraser at each probe point?
  const diag={};
  for(const[n,[x,y]]of Object.entries(PT)){
    const gx=x/W, gy=1-y/H;                       // global uv, y up from the bottom
    const bx=Math.min(mw-1,Math.round(gx*mw)), by=Math.min(mh-1,Math.round(gy*mh));
    diag[n]={px:lipPx[by*mw+bx]};
  }
  const nz=lipPx.reduce((a,v)=>a+(v>0?1:0),0);
  return {before,brushOnly,brushFull,eraseAll,brushRow0,afterNoEx,afterEx,diag,nz,mw,mh,
    sel:selCv.toDataURL('image/png').split(',')[1],
    lipSel:lipSel.toDataURL('image/png').split(',')[1]};
});

const dE=(a,b)=>Math.round(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]));
console.log('point'.padEnd(14),'brush(rect)'.padEnd(12),'brush(FULL)'.padEnd(12),'skin'.padEnd(6),'skin+erase'.padEnd(11),'erase-ALL'.padEnd(10),'px rows 0..h/2');
for(const n of Object.keys(out.before)){
  console.log(n.padEnd(14),String(dE(out.before[n],out.brushOnly[n])).padEnd(12),
    String(dE(out.before[n],out.brushFull[n])).padEnd(12),
    String(dE(out.before[n],out.afterNoEx[n])).padEnd(6),
    String(dE(out.before[n],out.afterEx[n])).padEnd(11),
    String(dE(out.before[n],out.eraseAll[n])).padEnd(10),dE(out.before[n],out.brushRow0[n]));
}
console.log('\nlips raster: '+out.nz+' nonzero px of '+(out.mw*out.mh)+' ('+out.mw+'x'+out.mh+')');
console.log('shader would sample lipPx at each probe point:');
for(const[n,d] of Object.entries(out.diag)) console.log('  '+n.padEnd(14)+' px='+d.px);
await writeFile(path.join(ROOT,'test/output/tm3390_sel_lips.png'),Buffer.from(out.lipSel,'base64'));
await writeFile(path.join(ROOT,'test/output/tm3390_selection_excluded.png'),Buffer.from(out.sel,'base64'));
console.log('\nwrote test/output/tm3390_selection_excluded.png');
await br.close(); server.close();
