import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill,renderMedia} from '@remotion/renderer';

const serveUrl=await bundle({entryPoint:path.resolve('src/index.ts')});
const browser=await openBrowser('chrome');
const composition=await selectComposition({serveUrl,id:'Promo',puppeteerInstance:browser});
const directory=path.resolve('out/redesign');
await mkdir(directory,{recursive:true});
const frames=[0,70,145,210,248,270,300,320,358,410,480,545,605,670,730,800,850,900,950,1040,1110,1140,1200,1260,1370,1460,1510,1550,1608,1640,1760,1799];
try {
 for(let i=0;!process.argv.includes('--skip-stills')&&i<frames.length;i+=2){
  await Promise.all(frames.slice(i,i+2).map(frame=>renderStill({serveUrl,composition,frame,
   output:path.join(directory,`frame-${String(frame).padStart(4,'0')}.png`),
   puppeteerInstance:browser,imageFormat:'png'})));
  console.log(`Reviewed ${Math.min(i+2,frames.length)}/${frames.length} frames`);
 }
 if(process.argv.includes('--full')){
  let last=-1;
  await renderMedia({serveUrl,composition,codec:'h264',crf:18,pixelFormat:'yuv420p',
   outputLocation:path.resolve('out/promo-16x9.mp4'),puppeteerInstance:browser,
   concurrency:3,onProgress:({progress})=>{
    const step=Math.floor(progress*10);if(step!==last){last=step;console.log(`Video ${step*10}%`);}
   }});
  console.log('Rendered out/promo-16x9.mp4');
 }else{
  await renderMedia({serveUrl,composition:{...composition,durationInFrames:510},
   codec:'h264',crf:20,pixelFormat:'yuv420p',outputLocation:path.resolve('out/redesign/motion-proof.mp4'),
   puppeteerInstance:browser,concurrency:3});
  console.log('Rendered 17-second motion proof.');
 }
}finally{await browser.close({silent:true});}
