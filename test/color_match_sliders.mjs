// CHR-219: the slider fit must measurably reduce the distance to a reference that was itself
// produced by the same slider model (so a recoverable answer exists), and stay inside the bounds.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile('chromasmith-22.html','utf8');
const a=html.indexOf('function cpSliderModel('),b=html.indexOf('async function cpUseSliders()');
assert(a>0&&b>a,'slider fit helpers present');
const ctx=vm.createContext({Math,Float32Array,Uint8ClampedArray,Object});
vm.runInContext(html.slice(a,b),ctx);
const N=2000,src=new Uint8ClampedArray(N*4);
for(let i=0;i<N;i++){src.set([(i*37)%256,(i*91)%256,(i*53)%256,255],i*4);}
const target={exp:10,con:30,temp:40,tint:-20,sat:25};
ctx.src=src;ctx.target=target;
const refVals=vm.runInContext('cpSliderModel(src,2000,target)',ctx);
const ref=new Uint8ClampedArray(N*4);for(let i=0;i<N;i++)ref.set([refVals[i*3],refVals[i*3+1],refVals[i*3+2],255],i*4);
ctx.ref=ref;
const fit=JSON.parse(JSON.stringify(vm.runInContext('cpFitSliders(src,2000,ref,2000)',ctx)));
assert(fit.before>10,'unmatched distance is large: '+fit.before);
assert(fit.after<fit.before*0.25,`fit reduces distance >75%: ${fit.before} -> ${fit.after}`);
for(const [k,[lo,hi]] of Object.entries({exp:[-60,60],con:[-60,60],temp:[-100,100],tint:[-100,100],sat:[-100,100]}))assert(fit.values[k]>=lo&&fit.values[k]<=hi,k+' within bounds');
const same=JSON.parse(JSON.stringify(vm.runInContext('cpFitSliders(src,2000,src,2000)',ctx)));
assert(Object.values(same.values).every(v=>Math.abs(v)<=2),'identical photos fit to ~zero sliders: '+JSON.stringify(same.values));
console.log(`PASS: slider fit ${fit.before.toFixed(1)} -> ${fit.after.toFixed(1)}, identity stays neutral`);
