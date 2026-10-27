import fs from 'fs';
const src=fs.readFileSync('/Users/tareqameer/Documents/GitHub/Chroma-App/chromasmith-22.html','utf8');
const grab=n=>{const i=src.indexOf('function '+n+'(');let d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return src.slice(i,k+1);}}};
const f=new Function(['_boxFilterMean','_guidedFilter','_samDilateBinary','_samMatteCore'].map(grab).join('\n')+';return _samMatteCore;')();
const [dir,w,h]=[process.argv[2],+process.argv[3],+process.argv[4]];
const out=f(new Uint8Array(fs.readFileSync(dir+'/raw_mask.u8')),w,h,new Uint8ClampedArray(fs.readFileSync(dir+'/rgba.u8')));
fs.writeFileSync(dir+'/matted.u8',Buffer.from(out.buffer));
