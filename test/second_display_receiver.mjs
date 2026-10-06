import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const handlers=new Map(),emitted=[];
const nodes={
  photo:{hidden:true,src:'',alt:''},
  empty:{hidden:false,textContent:''},
  name:{textContent:''},
  size:{textContent:''},
};
const context={
  window:{__TAURI__:{event:{
    listen:async(name,fn)=>{handlers.set(name,fn);return()=>handlers.delete(name);},
    emit:async name=>emitted.push(name),
  }}},
  document:{getElementById:id=>nodes[id]},
};
vm.runInNewContext(await readFile(new URL('../desktop/second-display.js',import.meta.url),'utf8'),context);
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(emitted,['chromasmith-second-display-ready']);
const receive=handlers.get('chromasmith-second-display-frame');
assert.equal(typeof receive,'function');
receive({payload:{dataUrl:'data:image/jpeg;base64,ZmFrZQ==',name:'sample.tif',width:6000,height:4000}});
assert.equal(nodes.photo.src,'data:image/jpeg;base64,ZmFrZQ==');
assert.equal(nodes.photo.hidden,false);
assert.equal(nodes.empty.hidden,true);
assert.equal(nodes.name.textContent,'sample.tif');
assert.equal(nodes.size.textContent,'6000 × 4000');
receive({payload:{dataUrl:'file:///private/photo.jpg',name:'invalid'}});
assert.equal(nodes.name.textContent,'sample.tif');
console.log('second-display receiver tests passed');
