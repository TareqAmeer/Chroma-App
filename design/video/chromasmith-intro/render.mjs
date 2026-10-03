import { chromium } from 'playwright';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const dir=dirname(fileURLToPath(import.meta.url));
const fps=24,duration=8.8,rate=48000,frameCount=Math.round(duration*fps);
const frames=join(dir,'.frames');
const wav=join(dir,'soundtrack.wav');
const output=join(dir,'chromasmith-intro.mp4');
const preview=process.argv.includes('--preview');
const sub=(process.argv.find(a=>a.startsWith('--sub='))||'--sub=10').slice(6);
const ffmpeg=process.env.FFMPEG||'ffmpeg';
// ES modules will not load from file://, so serve the repo root (the page reaches ../../../vendor/fonts).
const root=resolve(dir,'../../..'),types={'.html':'text/html','.js':'text/javascript','.otf':'font/otf','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root))throw 0;
 res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream'});res.end(await readFile(p))}catch{res.writeHead(404);res.end()}}).listen(0);
const port=server.address().port;

function envelope(a,b,t){const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x)}
function hit(t,at,freq,decay){const d=t-at;return d<0?0:Math.exp(-d*decay)*(Math.sin(2*Math.PI*freq*d)+.34*Math.sin(2*Math.PI*freq*2.41*d))}
function audio(){
 const n=Math.round(duration*rate), left=new Float32Array(n),right=new Float32Array(n);
 let seed=20260928,noiseLP=0,peak=0;
 const chord=[130.81,155.56,196,261.63];
 for(let i=0;i<n;i++){
  const t=i/rate;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const noise=(seed/4294967295)*2-1;
  noiseLP=noiseLP*.94+noise*.06;
  const drone=(Math.sin(2*Math.PI*65.406*t)+.42*Math.sin(2*Math.PI*98.0*t+.1*Math.sin(t*1.3)))*.075*envelope(.25,1.6,t)*(1-envelope(7.95,8.8,t));
  const air=noiseLP*.10*envelope(.55,1.8,t)*(1-envelope(7.6,8.8,t));
  const whoosh=(noise-noiseLP)*(
   .095*Math.exp(-Math.pow((t-2.15)/.42,2))+
   .12*Math.exp(-Math.pow((t-2.95)/.40,2))+
   .05*Math.exp(-Math.pow((t-4.25)/.5,2)));
  const thud=(at,a)=>{const d=t-at;return d<0?0:a*Math.exp(-d*9)*Math.sin(2*Math.PI*(48+30*Math.exp(-d*20))*d)};
  const strikes=.10*hit(t,2.60,401,4.2)+.20*hit(t,3.30,512,3.2)+.07*hit(t,4.40,630,4.8)+thud(2.60,.22)+thud(3.30,.38);
  const swell=envelope(3.4,5.0,t)*(1-envelope(7.70,8.8,t));
  let harmony=0;
  for(let j=0;j<chord.length;j++){
   const f=chord[j],p=2*Math.PI*f*t;
   harmony+=(Math.sin(p)+.19*Math.sin(2*p+.2)+.09*Math.sin(3*p))*(j===3?.023:.029);
  }
  harmony*=swell;
  const shimmer=.023*Math.sin(2*Math.PI*783.99*t)*Math.exp(-Math.max(0,t-5.33)*1.55)*envelope(5.25,5.42,t);
  const base=drone+air+strikes+harmony+shimmer;
  const l=base+whoosh*(.92+.08*Math.sin(t*2.6));
  const r=base+whoosh*(.92-.08*Math.sin(t*2.6));
  left[i]=l;right[i]=r;peak=Math.max(peak,Math.abs(l),Math.abs(r));
 }
 const scale=.88/Math.max(.88,peak);
 const buf=Buffer.alloc(44+n*4);buf.write('RIFF',0);buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);
 buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*4,40);
 for(let i=0;i<n;i++){buf.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(left[i]*scale*32767))),44+i*4);buf.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(right[i]*scale*32767))),46+i*4)}
 return buf;
}
async function command(exe,args){await new Promise((resolve,reject)=>{const p=spawn(exe,args,{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`${exe} exited ${code}`)))});}
await mkdir(frames,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11']});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 page.on('console',m=>{if(m.type()==='error')console.error(m.text())});page.on('pageerror',e=>console.error(e));
 await page.goto(`http://127.0.0.1:${port}/design/video/chromasmith-intro/intro.html?sub=${sub}`);
 await page.waitForFunction(()=>window.ready===true,null,{timeout:60000});
 if(preview){
  for(const t of [1.2,2.0,2.6,3.0,3.4,4.0,4.75,5.6,7.0,8.4]){
   await page.evaluate(time=>window.renderAt(time),t);
   await page.screenshot({path:join(frames,`preview-${t.toFixed(2)}.png`),animations:'disabled'});
  }
 }else{
  for(let i=0;i<frameCount;i++){
   await page.evaluate(t=>window.renderAt(t),i/fps);
   await page.screenshot({path:join(frames,`${String(i).padStart(4,'0')}.png`),animations:'disabled'});
   if(i%24===0)process.stdout.write(`Rendered ${i}/${frameCount} frames\n`);
  }
 }
}finally{await browser.close();server.close()}
if(preview){console.log(frames);process.exit(0)}
await writeFile(wav,audio());
await command(ffmpeg,['-hide_banner','-loglevel','warning','-y','-framerate',String(fps),'-i',join(frames,'%04d.png'),'-i',wav,'-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',output]);
await rm(frames,{recursive:true,force:true});
console.log(output);
