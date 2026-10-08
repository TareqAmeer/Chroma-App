// CHR-266 unit coverage for the source-defined shortcut registry without launching a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const start = html.indexOf("const CS_SHORTCUTS_KEY='chromasmith-shortcuts-v1'");
const end = html.indexOf('function shortcutsHtml(){', start);
assert(start >= 0 && end > start, 'registry source section exists');
const values = new Map(), listeners = {};
const localStorage = { getItem:k=>values.has(k)?values.get(k):null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k) };
const windowListeners={};
const window = { chromasmithLibraryIsOpen:()=>false, addEventListener:(name,fn)=>{(windowListeners[name] ||= []).push(fn);} };
const document = { addEventListener:(name,fn,capture)=>{(listeners[name] ||= []).push({fn,capture});}, getElementById:()=>null };
vm.runInNewContext(html.slice(start,end), { window, document, localStorage, navigator:{platform:'Win32'}, console });
const api = window.chromasmithShortcutRegistry;
let editorCalls=0, libraryCalls=0;
window.chromasmithRegisterShortcut('editor.undo',()=>{editorCalls++;});
window.chromasmithRegisterShortcut('library.reject',()=>{libraryCalls++;});
function key(key, target={closest:()=>null}, mods={}) {
  const event={key,target,isComposing:false,repeat:false,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...mods,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  for(const l of listeners.keydown||[])l.fn(event);
  return event;
}
function keyUp(key, mods={}) {
  const event={key,target:{closest:()=>null},isComposing:false,repeat:false,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...mods,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  for(const l of listeners.keyup||[])l.fn(event);
  return event;
}
api.set('editor.undo','F2');
let e=key('F2'); assert.equal(editorCalls,1); assert(e.defaultPrevented&&e.stopped,'remapped action is consumed');
key('F2',{closest:s=>s.includes('input')?{}:null}); assert.equal(editorCalls,1,'typing target bypasses shortcut dispatch');
assert.throws(()=>api.set('editor.redo','F2'),/Already assigned/,'same-context duplicate rejected');
assert.throws(()=>api.set('library.reject','F2'),/Already assigned/,'overlapping docked contexts cannot collide');
assert.throws(()=>api.set('editor.undo','Ctrl+R'),/reserved/,'browser-reserved chord rejected');
api.set('editor.undo','CmdOrCtrl+F2');
e=key('F2',undefined,{ctrlKey:true}); assert.equal(editorCalls,2); assert(e.defaultPrevented,'CmdOrCtrl resolves to Ctrl on Windows');
let zoomCalls=0; window.chromasmithRegisterShortcut('editor.zoom-in',()=>{zoomCalls++;});
e=key('+',undefined,{ctrlKey:true,shiftKey:true}); assert.equal(zoomCalls,1); assert(e.defaultPrevented,'plus-key aliases retain their shifted key semantics');
window.chromasmithLibraryIsOpen=()=>true;
e=key('x'); assert.equal(libraryCalls,1); assert(e.defaultPrevented,'Library-only binding dispatches in its context');
window.chromasmithLibraryIsOpen=()=>false;
e=key('x'); assert.equal(libraryCalls,1); assert(!e.defaultPrevented,'Library-only action does not dispatch in Editor context');
const exported=api.export(); api.set('editor.undo','F3'); api.import(exported);
assert.equal(api.actions().find(a=>a.id==='editor.undo').binding,'CmdOrCtrl+F2','import/export round trip');
api.set('editor.undo',null); assert.equal(api.actions().find(a=>a.id==='editor.undo').binding,'CmdOrCtrl+Z','reset-one restores the default');
api.set('editor.undo','CmdOrCtrl+F2');
api.disableSingles(true); key('F2',undefined,{ctrlKey:true}); assert.equal(editorCalls,3,'modified shortcuts remain enabled');
api.set('editor.undo','F2'); key('F2'); assert.equal(editorCalls,3,'single-key preference disables single-key shortcuts');
api.disableSingles(false);
assert.throws(()=>api.import(JSON.stringify({version:1,bindings:{'no.such.action':'F4'}})),/Unknown shortcut action/);
const afterRejectedImport=api.export();
assert.throws(()=>api.import(JSON.stringify({version:1,bindings:{'editor.undo':'Ctrl+Unknown+F4'}})),/Invalid shortcut/);
assert.equal(api.export(),afterRejectedImport,'invalid imports leave the prior keymap intact');
let erasePhases=[];
window.chromasmithRegisterShortcut('editor.mask-erase',e=>{erasePhases.push(e.phase);});
assert.equal(api.actions().find(a=>a.id==='editor.mask-erase').binding,'Alt','held brush erase is listed in the editable shortcut registry');
key('Alt',undefined,{altKey:true});
keyUp('Alt',{target:{closest:s=>s.includes('input')?{}:null}});
assert.deepEqual(erasePhases,['start','end'],'modifier press and release dispatch distinct phases');
erasePhases=[];
key('Alt',undefined,{altKey:true});
for(const fn of windowListeners.blur||[])fn();
keyUp('Alt');
assert.deepEqual(erasePhases,['start','end'],'focus loss releases a held modifier even before its keyup');
api.set('editor.mask-erase','Shift');
key('Shift',undefined,{shiftKey:true}); keyUp('Shift');
assert.deepEqual(erasePhases,['start','end','start','end'],'held modifier can be rebound and released');
assert.throws(()=>api.set('editor.undo','Shift'),/Invalid shortcut/,'ordinary actions cannot take modifier-only bindings');
assert.throws(()=>api.set('editor.mask-erase','Ctrl+F2'),/Invalid shortcut/,'held actions require a modifier-only binding');
api.set('editor.mask-erase',null);
values.delete('chromasmith-shortcuts-v1');
const exercised=new Set(), all=api.actions();
for(let i=0;i<all.length;i++){
  const a=all[i],binding=a.held?'Alt':`F${13+i}`;
  window.chromasmithRegisterShortcut(a.id,()=>{exercised.add(a.id);});
  api.set(a.id,binding);
  window.chromasmithLibraryIsOpen=()=>a.contexts.includes('library')&&!a.contexts.includes('editor');
  const event=a.held?key('Alt',undefined,{altKey:true}):key(binding);
  assert(event.defaultPrevented,`${a.id} binding is dispatched`);
  assert(exercised.has(a.id),`${a.id} callback fired`);
}
assert.equal(exercised.size,all.length,'test exercised every bindable action');
console.log(`SHORTCUT REGISTRY CHECK: PASS (${api.actions().length} registered actions)`);
