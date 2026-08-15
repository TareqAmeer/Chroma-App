// Auto-horizon accuracy. Synthetic frames with a KNOWN tilt give ground truth a real photo can't,
// and the negative cases (foliage, a portrait-like blob) are as important as the positive ones:
// a detector that confidently levels a photo with no horizon is worse than one that declines.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT=process.cwd();
const server=createServer(async(req,res)=>{try{const u=req.url.split('?')[0];const d=await readFile(path.join(ROOT,decodeURIComponent(u).slice(1)));
  res.writeHead(200,{'Content-Type':u.endsWith('.html')?'text/html':u.endsWith('.jpg')?'image/jpeg':'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
p.on('pageerror',e=>console.log('[pageerror]',e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
await p.waitForFunction(()=>typeof _autoHorizonAngle==='function');
const r=await p.evaluate(async()=>{
  const mk=(draw)=>{const c=document.createElement('canvas');c.width=640;c.height=440;
    const x=c.getContext('2d');draw(x,640,440);return c;};
  // A sea horizon tilted by `deg`: sky above, water below, one strong straight boundary.
  const horizon=(deg)=>mk((x,w,h)=>{
    x.fillStyle='#8fb6d8';x.fillRect(0,0,w,h);
    x.save();x.translate(w/2,h/2);x.rotate(deg*Math.PI/180);
    x.fillStyle='#2b4f66';x.fillRect(-w,0,w*2,h);x.restore();
  });
  // Building verticals, no horizontal at all.
  const verticals=(deg)=>mk((x,w,h)=>{
    x.fillStyle='#d8d4cc';x.fillRect(0,0,w,h);
    x.save();x.translate(w/2,h/2);x.rotate(deg*Math.PI/180);
    x.fillStyle='#3a3a42';for(let i=-6;i<=6;i++)x.fillRect(i*46-6,-h,12,h*2);x.restore();
  });
  // Negative cases: random foliage-like noise, and a soft blob (a portrait's bokeh).
  const foliage=()=>mk((x,w,h)=>{for(let i=0;i<9000;i++){
    x.fillStyle=`hsl(${90+Math.random()*40},${30+Math.random()*40}%,${15+Math.random()*45}%)`;
    x.fillRect(Math.random()*w,Math.random()*h,3+Math.random()*7,3+Math.random()*7);}});
  const blob=()=>mk((x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,10,w/2,h/2,h);
    g.addColorStop(0,'#e8c9ae');g.addColorStop(1,'#4a3a30');x.fillStyle=g;x.fillRect(0,0,w,h);});

  const out={horizon:[],verticals:[],negatives:{}};
  for(const t of [-8,-5,-2,-0.7,0,1.5,4,7]){
    const got=_autoHorizonAngle(horizon(t));
    out.horizon.push({tilt:t,expect:-t,got,err:got===null?null:+(got-(-t)).toFixed(2)});
  }
  for(const t of [-6,-2,0,3,6]){
    const got=_autoHorizonAngle(verticals(t));
    out.verticals.push({tilt:t,expect:-t,got,err:got===null?null:+(got-(-t)).toFixed(2)});
  }
  out.negatives.foliage=_autoHorizonAngle(foliage());
  out.negatives.blob=_autoHorizonAngle(blob());
  return out;
});
// Real photos: synthetics prove the maths, real frames prove it survives texture, haze and a
// horizon that is a mountain ridge rather than a ruled line. No ground truth, so this reports
// rather than asserts — a plausible small angle on a lake shot and a decline on a close-up.
const real=await p.evaluate(async(names)=>{
  const out=[];
  for(const n of names){
    try{
      const blob=await (await fetch('geneva/'+n)).blob();
      const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(blob);});
      out.push({name:n,angle:_autoHorizonAngle(img)});
    }catch(e){out.push({name:n,angle:'(not present)'});}
  }
  return out;
},['__TM5132.jpg','__TM4202.jpg','__TM5199.jpg','__TM4933.jpg']);
console.log('REAL PHOTOS');
real.forEach(r=>console.log(`  ${r.name.padEnd(16)} ${r.angle===null?'declined':r.angle+'°'}`));
const fmt=(rows)=>rows.map(x=>`  tilt ${String(x.tilt).padStart(5)}°  expect ${String(x.expect).padStart(5)}°  got ${x.got===null?'  null':String(x.got).padStart(6)}  err ${x.err===null?'—':x.err}`).join('\n');
console.log('HORIZON (sea/sky boundary)');console.log(fmt(r.horizon));
console.log('VERTICALS (building edges)');console.log(fmt(r.verticals));
console.log('NEGATIVES (must be null):', JSON.stringify(r.negatives));
const errs=[...r.horizon,...r.verticals].filter(x=>x.err!==null).map(x=>Math.abs(x.err));
const worst=errs.length?Math.max(...errs):99;
const nulls=[...r.horizon,...r.verticals].filter(x=>x.got===null).length;
const negOk=r.negatives.foliage===null&&r.negatives.blob===null;
console.log(`\nworst error ${worst.toFixed(2)}°, ${nulls} missed detection(s), negatives ${negOk?'declined correctly':'FALSE POSITIVE'}`);
await b.close();server.close();
process.exit(worst<=0.6&&nulls===0&&negOk?0:1);
