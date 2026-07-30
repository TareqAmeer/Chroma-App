// Renders before/after of __TM3390.jpg with the Skin Tone tool configured the documented way:
// a dog-exclusion radial FIRST, then the skin mask with "subtract prev" so the animal is removed
// from the selection by SHAPE (colour alone cannot separate brown fur from shadowed skin).
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
await pg.waitForFunction(()=>typeof window.applyUISnapshot==='function'&&typeof window.processToCanvas==='function',null,{timeout:30000});
const jpg=(await readFile(path.join(ROOT,'__TM3390.jpg'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'__TM3390.jpg',{type:'image/jpeg'})]);},jpg);
await pg.waitForFunction(()=>typeof fxImages!=='undefined'&&fxImages.length>0,null,{timeout:60000});

const out=await pg.evaluate(async()=>{
  const it=fxImages[0],src=it.img,W=src.naturalWidth,H=src.naturalHeight;
  const c0=document.createElement('canvas');c0.width=W;c0.height=H;
  c0.getContext('2d').drawImage(src,0,0);
  const full=c0.getContext('2d').getImageData(0,0,W,H).data;
  const at=(x,y)=>{const i=(y*W+x)*4;return [full[i],full[i+1],full[i+2]];};
  const hsvAt=(x,y)=>{const p=at(x,y);return rgb2oklch(p[0]/255,p[1]/255,p[2]/255);};
  const S=n=>{const[h,s,v]=hsvAt(n[0],n[1]);return{h,s,v};};
  // SIX samples covering the tonal variety of a whole body — the three that used to be missed
  // (shadowed pec, bright far arm, armpit) each need their own pick.
  const picks=[S([1290,3990]),S([1440,4560]),S([1500,5600]),
               S([2000,5500]),S([130,5620]),S([2250,5350])];

  const BASE={invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,
    subtract:false,colHue:0,colAmt:0,colSat:0.65,crOn:false,crSamples:[],crRange:55,
    uH:0,uS:0,uL:0,preserve:70,tgtMode:'match',tgtHex:'#d7bd96',tanDepth:0,tanWarm:0,srcV:null,
    amount:100,name:'',muted:false,tex:0,rot:0,feather:0.3};
  // Mask 0: the dog. Nothing is applied through it — it exists purely to be subtracted.
  const dog={...BASE,type:'radial',name:'dog',cx:0.634,cy:0.3125,rx:0.17,ry:0.19,feather:0.35,isExclude:true};
  // Brush eraser over hair / beard / sunglasses. Stand-in for a stroke the user would paint: inside
  // the head box, take the dark low-chroma pixels. Wet hair (91,76,74) gates 1.0 on colour because
  // it is genuinely skin-coloured, so only a painted mask can separate it.
  // ⚠️ m.px is 0..255 and row 0 is the image TOP (verified in test/probe_exclude.mjs).
  const {w:mw,h:mh}=mskTexDims();
  const hairPx=new Array(mw*mh).fill(0);
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
    const ox=Math.min(W-1,Math.round(x/mw*W)), oy=Math.min(H-1,Math.round(y/mh*H));
    if(ox<550||ox>1980||oy<3050||oy>4850)continue;
    const i=(oy*W+ox)*4, r=full[i],g=full[i+1],b=full[i+2];
    const mx=Math.max(r,g,b)/255, mn=Math.min(r,g,b)/255;
    const sat=mx>0?(mx-mn)/mx:0, lum=(0.2126*r+0.7152*g+0.0722*b)/255;
    if(lum<0.42&&sat<0.32)hairPx[y*mw+x]=255;
  }
  const hair={...BASE,type:'brush',origin:'paint',px:hairPx,mtW:mw,mtH:mh,name:'hair',isExclude:true};
  // Mask 1: the skin. subtract:true removes mask 0's shape from it.
  // SHAPELESS: an ellipse cannot cover a body (it left the far arm at 0.35). The colour gate
  // identifies skin; the dog eraser below removes the one thing that shares its colour here.
  // Matches the shipped + Skin default: full width, lower ~80% of frame, near-hard edge.
  const skin={...BASE,type:'radial',origin:'skin',name:'skin',
    cx:0.5,cy:0.3,rx:0.65,ry:0.5,feather:0.05,
    crOn:true,crSamples:picks,crRange:55,
    uH:90,uS:80,uL:70,preserve:30,tgtMode:'match',tanDepth:35,tanWarm:45};

  const render=async(masks,w,h,opts)=>{
    window.__reseed&&window.__reseed();
    window.applyUISnapshot({sliders:{},toggles:{local:!!masks},selects:{'sel-lut':'','sel-print':''},colors:{},masks:masks||[]});
    window.fxUpdate&&window.fxUpdate();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    fxState.artSeed=7.7;
    FX.render(window.getFXParams(),w,h,Object.assign({glowScale:1,showSel:-1},opts||{}));
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    cv.getContext('2d').drawImage(FX.cv,0,0);
    return cv;
  };
  // Measure srcV the way the app does, so Preserve behaves as it would in the UI.
  let acc=0,wsum=0;
  for(let y=0;y<H;y+=16)for(let x=0;x<W;x+=16){
    const[h,s,v]=hsvAt(x,y);
    const w=crWeightJS(h,s,skin.crSamples,skin.crRange);
    if(w>0){acc+=w*v;wsum+=w;}
  }
  skin.srcV=wsum>1e-6?acc/wsum:null;

  const VW=900,VH=Math.round(VW*H/W);
  const before=await render(null,VW,VH);
  const after=await render([hair,dog,skin],VW,VH);
  const sel=await render([hair,dog,skin],VW,VH,{showSel:2});

  // 1:1 crop over the face/chest boundary — where the mismatch actually reads.
  const cw=1100,ch=1500,cx0=500,cy0=3700;
  const cropOf=async masks=>{
    window.__reseed&&window.__reseed();
    window.applyUISnapshot({sliders:{},toggles:{local:!!masks},selects:{'sel-lut':'','sel-print':''},colors:{},masks:masks||[]});
    window.fxUpdate&&window.fxUpdate();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    fxState.artSeed=7.7;
    FX.render(window.getFXParams(),cw,ch,{glowScale:1,showSel:-1,
      uvOff:[cx0/W,(H-(cy0+ch))/H],uvScale:[cw/W,ch/H]});
    const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;
    cv.getContext('2d').drawImage(FX.cv,0,0);
    return cv;
  };
  const cropB=await cropOf(null), cropA=await cropOf([hair,dog,skin]);

  // Side-by-side crop, before | after
  const sbs=document.createElement('canvas');sbs.width=cw*2+16;sbs.height=ch;
  const sx=sbs.getContext('2d');sx.fillStyle='#111';sx.fillRect(0,0,sbs.width,sbs.height);
  sx.drawImage(cropB,0,0);sx.drawImage(cropA,cw+16,0);
  sx.font='bold 36px -apple-system,sans-serif';sx.fillStyle='#fff';
  sx.fillText('BEFORE',24,52);sx.fillText('AFTER',cw+40,52);

  const png=c=>c.toDataURL('image/png').split(',')[1];
  return {before:png(before),after:png(after),sel:png(sel),sbs:png(sbs),srcV:skin.srcV,picks};
});

for(const [k,f] of [['before','tm3390_before.png'],['after','tm3390_after.png'],
                    ['sel','tm3390_selection.png'],['sbs','tm3390_crop_before_after.png']]){
  await writeFile(path.join(ROOT,'test/output',f),Buffer.from(out[k],'base64'));
  console.log('wrote test/output/'+f);
}
console.log('srcV',out.srcV.toFixed(3),'samples',JSON.stringify(out.picks.map(p=>({h:+p.h.toFixed(3),s:+p.s.toFixed(3),v:+p.v.toFixed(3)}))));
await br.close(); server.close();
