import { chromium } from 'playwright';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const dir=dirname(fileURLToPath(import.meta.url));
const fps=24,duration=8.8,rate=48000,frameCount=Math.round(duration*fps);
const frames=join(dir,'.frames');
const wav=join(dir,'soundtrack.wav');
const output=join(dir,'chromasmith-intro.mp4');
const preview=process.argv.includes('--preview');

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
   .095*Math.exp(-Math.pow((t-1.47)/.42,2))+
   .12*Math.exp(-Math.pow((t-2.35)/.52,2))+
   .06*Math.exp(-Math.pow((t-4.06)/.55,2)));
  const strikes=.13*hit(t,2.13,401,4.2)+.22*hit(t,2.91,512,3.2)+.095*hit(t,4.40,630,4.8);
  const swell=envelope(3.85,5.35,t)*(1-envelope(7.70,8.8,t));
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
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:preview?1:1.5});
 await page.goto(`file://${join(dir,'intro.html')}`);
 await page.evaluate(()=>document.fonts.ready);
 if(preview){
  for(const t of [.6,1.7,2.65,3.65,4.8,6.3,7.7]){
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
}finally{await browser.close()}
if(preview){console.log(frames);process.exit(0)}
await writeFile(wav,audio());
await command('ffmpeg',['-hide_banner','-loglevel','warning','-y','-framerate',String(fps),'-i',join(frames,'%04d.png'),'-i',wav,'-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',output]);
await rm(frames,{recursive:true,force:true});
console.log(output);
