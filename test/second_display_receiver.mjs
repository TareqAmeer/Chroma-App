import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const handlers=new Map(),emitted=[];
const nodes={
  photo:{hidden:true,src:'',alt:''},
  empty:{hidden:false,textContent:''},
  name:{textContent:''},
  size:{textContent:''},
  grid:{hidden:true,replaceChildren(){this.children=[];},append(child){this.children.push(child);},children:[]},
  mode:{textContent:'',attrs:{},addEventListener(name,fn){this.click=fn;},setAttribute(name,value){this.attrs[name]=value;}},
};
const created=[];
const context={
  window:{__TAURI__:{event:{
    listen:async(name,fn)=>{handlers.set(name,fn);return()=>handlers.delete(name);},
    emit:async (name,payload)=>emitted.push({name,payload}),
  }}},
  document:{getElementById:id=>nodes[id],createElement:tag=>{const node={tag,dataset:{},append(...children){this.children=children;}};created.push(node);return node;}},
};
vm.runInNewContext(await readFile(new URL('../desktop/second-display.js',import.meta.url),'utf8'),context);
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(emitted.map(item=>`${item.name}:${item.payload?.mode||''}`),[
  'chromasmith-second-display-ready:',
  'chromasmith-second-display-mode:photo',
]);
const receive=handlers.get('chromasmith-second-display-frame');
assert.equal(typeof receive,'function');
receive({payload:{mode:'photo',dataUrl:'data:image/jpeg;base64,ZmFrZQ==',name:'sample.tif',width:6000,height:4000}});
assert.equal(nodes.photo.src,'data:image/jpeg;base64,ZmFrZQ==');
assert.equal(nodes.photo.hidden,false);
assert.equal(nodes.empty.hidden,true);
assert.equal(nodes.name.textContent,'sample.tif');
assert.equal(nodes.size.textContent,'6000 × 4000');
receive({payload:{mode:'photo',dataUrl:'file:///private/photo.jpg',name:'invalid'}});
assert.equal(nodes.name.textContent,'sample.tif');
nodes.mode.click();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(nodes.mode.textContent,'Show photo');
assert.equal(nodes.mode.attrs['aria-pressed'],'true');
assert.equal(emitted.at(-1).name,'chromasmith-second-display-mode');
assert.equal(emitted.at(-1).payload.mode,'grid');
receive({payload:{mode:'grid',total:2,tiles:[
  {id:'a',name:'first.tif',dataUrl:'data:image/jpeg;base64,YQ=='},
  {id:'b',name:'second.tif',dataUrl:'data:image/jpeg;base64,Yg=='}
]}});
assert.equal(nodes.photo.hidden,true);
assert.equal(nodes.grid.hidden,false);
assert.equal(nodes.grid.children.length,2);
assert.equal(nodes.grid.children[0].dataset.photoId,'a');
assert.equal(nodes.grid.children[0].children[0].alt,'first.tif');
assert.equal(nodes.name.textContent,'2 selected photos');
receive({payload:{mode:'grid',total:20,tiles:[{id:'a',name:'first.tif',dataUrl:'data:image/jpeg;base64,YQ=='}]}});
assert.equal(nodes.name.textContent,'1 of 20 selected photos');
const prior=nodes.grid.children.length;
receive({payload:{mode:'grid',tiles:Array(17).fill({id:'x',name:'too-many',dataUrl:'data:image/jpeg;base64,eA=='})}});
assert.equal(nodes.grid.children.length,prior,'oversized grid frames are rejected');
receive({payload:{mode:'grid',tiles:[]}});
assert.equal(nodes.name.textContent,'No photos selected');
assert.equal(nodes.grid.children.length,0,'empty grid selection clears stale tiles');
console.log('second-display receiver tests passed');
