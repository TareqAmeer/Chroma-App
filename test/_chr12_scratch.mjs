import { PNG } from 'pngjs';import fs from 'node:fs';
function scan(f){
 const png=PNG.sync.read(fs.readFileSync(f));
 const W=png.width,H=png.height,lum=(x,y)=>{const i=(y*W+x)*4;return (png.data[i]+png.data[i+1]+png.data[i+2])/3};
 // thin-spike detector: a pixel that's a local peak vs both neighbors 3px away, brightness jump>40, isolated (1-2px wide)
 let spikes=0;
 for(let y=150;y<H-3;y+=2){
  for(let x=280;x<W-3;x+=2){
   const c=lum(x,y), l=lum(x-3,y), r=lum(x+3,y);
   if(c-l>50 && c-r>50) spikes++;
  }
 }
 return spikes;
}
for (let i=1;i<=25;i++){
 const f=`/private/tmp/claude-501/-Users-tareqameer-Documents-GitHub-Chroma-App/b9e00339-8edc-4903-aad8-77173a52c95f/scratchpad/border${i}.png`;
 if(!fs.existsSync(f))continue;
 console.log(i, scan(f));
}
