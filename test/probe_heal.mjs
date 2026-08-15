import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.cwd();
const server = createServer(async (req,res)=>{
  try { const d = await readFile(path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).slice(1)));
    const u=req.url.split('?')[0];
    const ct=u.endsWith('.html')?'text/html':u.endsWith('.js')||u.endsWith('.mjs')?'text/javascript':u.endsWith('.png')?'image/png':'application/octet-stream';
    res.writeHead(200,{'Content-Type':ct}); res.end(d); } catch { res.writeHead(404); res.end(); }
}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('[pageerror]',e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
await p.waitForFunction(()=>typeof healApply==='function');
const out = await p.evaluate(()=>{
  // A textured field with a dark blemish — the real case. Texture matters: healing onto flat
  // colour proves nothing, since any donor works.
  const w=400,h=300,c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');
  for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){
    const n=((xx*7+y*13)%17)/17*18;
    x.fillStyle=`rgb(${190+n|0},${150+n|0},${125+n|0})`;x.fillRect(xx,y,1,1);
  }
  const BX=200,BY=150,BR=9;
  x.fillStyle='#3a1f18';x.beginPath();x.arc(BX,BY,BR,0,6.2832);x.fill();
  const read=(cv,cx,cy,r)=>{const g=cv.getContext('2d').getImageData(cx-r,cy-r,r*2,r*2).data;
    let s=0,n=0;for(let i=0;i<g.length;i+=4){s+=(g[i]+g[i+1]+g[i+2])/3;n++;}return s/n;};
  const before=read(c,BX,BY,BR);
  const surround=read(c,BX+40,BY,BR);
  const healed=healApply(c,[{x:BX/w,y:BY/h,r:(BR+3)/Math.max(w,h),feather:0.5,opacity:1,mode:'heal'}]);
  const after=read(healed,BX,BY,BR);
  // Clone mode on the same spot, for comparison.
  const cloned=healApply(c,[{x:BX/w,y:BY/h,r:(BR+3)/Math.max(w,h),feather:0.5,opacity:1,mode:'clone'}]);
  const afterClone=read(cloned,BX,BY,BR);
  // The case that actually separates heal from clone: a strong gradient, so every donor near the
  // blemish is a visibly different brightness. Clone must leave a patch; heal must not.
  const g2=document.createElement('canvas');g2.width=w;g2.height=h;
  const gx=g2.getContext('2d');
  const grd=gx.createLinearGradient(0,0,w,0);grd.addColorStop(0,'#3a3a3a');grd.addColorStop(1,'#e0e0e0');
  gx.fillStyle=grd;gx.fillRect(0,0,w,h);
  gx.fillStyle='#101010';gx.beginPath();gx.arc(BX,BY,BR,0,6.2832);gx.fill();
  const op=(mode)=>({x:BX/w,y:BY/h,r:(BR+6)/Math.max(w,h),feather:0.35,opacity:1,mode});
  // Read the CENTRE only: at the rim a feathered patch is deliberately semi-transparent.
  const ctr=(cv)=>read(cv,BX,BY,3);
  const gradTarget=ctr(( ()=>{const t=document.createElement('canvas');t.width=w;t.height=h;
    const tx2=t.getContext('2d');tx2.fillStyle=grd;tx2.fillRect(0,0,w,h);return t;})());
  const gradHeal=ctr(healApply(g2,[op('heal')]));
  const gradClone=ctr(healApply(g2,[op('clone')]));
  // Force a donor from a much BRIGHTER part of the gradient, the way shift-drag can. This is the
  // only case that actually exercises the heal colour match: clone must copy the wrong brightness
  // through, heal must correct it back toward the destination's surround.
  const forced=(mode)=>({x:BX/w,y:BY/h,sx:(BX+150)/w,sy:BY/h,
                         r:(BR+6)/Math.max(w,h),feather:0.35,opacity:1,mode});
  const forcedHeal=ctr(healApply(g2,[forced('heal')]));
  const forcedClone=ctr(healApply(g2,[forced('clone')]));
  // No ops must return the SAME object, not a copy — the identity fast path.
  const noop=healApply(c,[]);
  const sheet=document.createElement('canvas');sheet.width=w*2+30;sheet.height=h;
  const sx=sheet.getContext('2d');sx.fillStyle='#333';sx.fillRect(0,0,sheet.width,h);
  sx.drawImage(c,0,0);sx.drawImage(healed,w+30,0);
  sx.fillStyle='#fff';sx.font='13px monospace';sx.fillText('before',6,16);sx.fillText('healed',w+36,16);
  return {before:+before.toFixed(1),surround:+surround.toFixed(1),after:+after.toFixed(1),
          afterClone:+afterClone.toFixed(1), identityFastPath:noop===c,
          gradient:{shouldBe:+gradTarget.toFixed(1),heal:+gradHeal.toFixed(1),clone:+gradClone.toFixed(1),
                    healErr:+Math.abs(gradHeal-gradTarget).toFixed(1),cloneErr:+Math.abs(gradClone-gradTarget).toFixed(1)},
          forcedWrongDonor:{shouldBe:+gradTarget.toFixed(1),heal:+forcedHeal.toFixed(1),clone:+forcedClone.toFixed(1),
                    healErr:+Math.abs(forcedHeal-gradTarget).toFixed(1),cloneErr:+Math.abs(forcedClone-gradTarget).toFixed(1)},
          png:sheet.toDataURL('image/png').split(',')[1]};
});
const {png,...rest}=out;
console.log(JSON.stringify(rest,null,1));
await writeFile('test/output/heal_probe.png', Buffer.from(png,'base64'));
await b.close(); server.close();
