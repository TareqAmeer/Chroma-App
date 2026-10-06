import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile('chromasmith-22.html','utf8');
const start=html.indexOf('// CHR-222 first slice: collect stable colour correspondences');
const end=html.indexOf('async function cpPreviewBuild()',start);
assert(start>=0&&end>start,'CHR-222 point-pair helpers are present');

function element(){
  const attrs={};
  return{style:{},children:[],append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);return node;},
    setAttribute(k,v){attrs[k]=v;},getAttribute(k){return attrs[k];},click(){this.onclick?.();},
    set innerHTML(_v){this.children=[];},get innerHTML(){return'';},querySelector(selector){
      const label=selector.match(/aria-label="([^"]+)"/)?.[1];
      const find=nodes=>{for(const node of nodes){if(node.getAttribute?.('aria-label')===label)return node;const nested=find(node.children||[]);if(nested)return nested;}return null;};
      return find(this.children);
    }};
}
const els={
  'cp-prev-before':element(),'cp-prev-ref':element(),'cp-pairs':element(),
  'cp-pairs-list':element(),'cp-pairs-hint':element(),
};
for(const id of ['cp-prev-before','cp-prev-ref'])els[id].getBoundingClientRect=()=>({left:0,top:0,width:40,height:40});
const context=vm.createContext({
  ST:{cpSrcFile:{name:'source',size:1,lastModified:2},cpRefFile:{name:'reference',size:2,lastModified:3}},
  document:{getElementById:id=>els[id],createElement:()=>element(),createTextNode:text=>({textContent:text})},
});
vm.runInContext(html.slice(start,end),context);
const data=rgb=>{const px=new Uint8ClampedArray(4*4*4);for(let i=0;i<16;i++){px.set([...rgb,255],i*4);}return{px,w:4,h:4};};
vm.runInContext(`_cpPrev={s:(${data.toString()})([20,40,60]),r:(${data.toString()})([130,150,170]),base:new Float32Array([.25,.5,.75])}`,context);
const read=expr=>JSON.parse(JSON.stringify(vm.runInContext(expr,context)));
const untouched=read('Array.from(_cpPrev.base)');
context.cpPairPick('source',{clientX:15,clientY:15});
assert.deepEqual(read('Array.from(_cpPending.rgb)'),[20,40,60]);
assert.equal(vm.runInContext('_cpPoints.length',context),0,'source pick waits for a reference pick');
context.cpPairPick('reference',{clientX:25,clientY:15});
const pair=vm.runInContext('_cpPoints[0]',context);
assert.deepEqual(read('_cpPoints[0].source.rgb'),[20,40,60]);
assert.deepEqual(read('_cpPoints[0].reference.rgb'),[130,150,170]);
assert.equal(pair.source.x,.375);assert.equal(pair.source.y,.375);assert.equal(pair.reference.x,.625);
assert.equal(els['cp-pairs-list'].children.length,1);
assert.equal(els['cp-pairs'].style.display,'block');
assert.deepEqual(read('Array.from(_cpPrev.base)'),untouched,'adding a pair must not change the automatic LUT in this slice');
els['cp-pairs-list'].querySelector('button[aria-label="Remove pair 1"]').click();
assert.equal(vm.runInContext('_cpPoints.length',context),0);assert.equal(els['cp-pairs'].style.display,'none');
context.cpPairPick('source',{clientX:15,clientY:15});context.cpPairsClear();
assert.equal(vm.runInContext('_cpPending',context),null);assert.equal(vm.runInContext('_cpPoints.length',context),0);assert.equal(els['cp-pairs'].style.display,'none');
console.log('PASS: paired color sampling, normalized coordinates, remove/clear, and unchanged automatic LUT');
