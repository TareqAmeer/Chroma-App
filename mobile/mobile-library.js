// Chromasmith phone gallery (iOS/Android Capacitor shells only — loaded by chromasmith-22.html
// when capNative() or ?mlib=1). The desktop Library (desktop/library-ui.js) is Rust-backed; this
// is its phone counterpart, built on the SAME editor hooks so the editor needs no new code paths:
//   window.chromasmithOnEdit(snap)            — per-photo recipe auto-save
//   window.chromasmithRecordExport(v,snap)    — export history (feeds the editor's version menu)
//   window.chromasmithGetExportHistory()      — read back by the editor's split/history menus
//   window.chromasmithToggleLibrary()         — the gallery toggle (#db-lib-btn, Back on home)
// Originals are stored untouched in IndexedDB ('chromasmith-mlib'); edits are recipes only, so
// "original" and "edited" are always both recoverable.
(function(){
'use strict';
const DBN='chromasmith-mlib';
let _db=null,openedId=null,openedIds=[],saveT=null,thumbT=null;

function db(){
  if(_db)return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const rq=indexedDB.open(DBN,1);
    rq.onupgradeneeded=()=>{const d=rq.result;
      if(!d.objectStoreNames.contains('photos'))d.createObjectStore('photos',{keyPath:'id'});
      if(!d.objectStoreNames.contains('blobs'))d.createObjectStore('blobs',{keyPath:'id'});};
    rq.onsuccess=()=>{_db=rq.result;res(_db)};rq.onerror=()=>rej(rq.error);
  });
}
async function tx(store,mode,fn){const d=await db();return new Promise((res,rej)=>{
  const t=d.transaction(store,mode),s=t.objectStore(store),r=fn(s);
  t.oncomplete=()=>res(r&&'result'in r?r.result:undefined);t.onerror=()=>rej(t.error);});}
const getPhoto=id=>tx('photos','readonly',s=>s.get(id));
const putPhoto=p=>tx('photos','readwrite',s=>s.put(p));
const allPhotos=()=>tx('photos','readonly',s=>s.getAll());
const getBlob=id=>tx('blobs','readonly',s=>s.get(id)).then(r=>r&&r.blob);
const b64=snap=>btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
const unb64=s=>JSON.parse(decodeURIComponent(escape(atob(s))));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ── thumbnails ────────────────────────────────────────────────────────────────────────────────
function thumbFrom(src,w,h){
  const S=360,k=Math.min(1,S/Math.max(w,h)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
  c.getContext('2d').drawImage(src,0,0,c.width,c.height);
  return new Promise(r=>c.toBlob(r,'image/jpeg',0.8));
}
async function thumbFromFile(f){try{const bm=await createImageBitmap(f);const t=await thumbFrom(bm,bm.width,bm.height);bm.close&&bm.close();return t}catch(e){return null}}
async function thumbFromEditor(){ // preserveDrawingBuffer is on, so the live preview reads back
  const cv=document.getElementById('fx-canvas');
  if(!cv||!cv.width)return null;
  try{return await thumbFrom(cv,cv.width,cv.height)}catch(e){return null}
}

// ── import: every photo opened in the shell is kept in the gallery ─────────────────────────────
async function importFiles(files){
  const ids=[];
  for(const f of files){
    if(!(f.type.startsWith('image/')||/\.(rw2|dng|tiff?|heic|heif|jpe?g|png|webp|avif)$/i.test(f.name)))continue;
    const id='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const blob=new Blob([await f.arrayBuffer()],{type:f.type});
    await tx('blobs','readwrite',s=>s.put({id,blob,name:f.name,type:f.type}));
    await putPhoto({id,name:f.name,type:f.type,size:f.size,added:Date.now(),edited:0,
      recipe:null,versions:[],exports:[],thumb:await thumbFromFile(f),thumbEdited:null});
    ids.push(id);
  }
  return ids;
}
const origLoad=window.loadFXImages;
window.loadFXImages=async function(fileList){
  if(window.__mlibOpening)return origLoad.apply(this,arguments);
  const files=[...fileList];
  let ids=[];try{ids=await importFiles(files)}catch(e){console.error('gallery import',e)}
  openedId=ids.length===1?ids[0]:null;openedIds=ids;
  close(); // opening photos always lands in the editor
  const r=await origLoad.call(this,files);
  if(openedId)setTimeout(refreshEditedThumb,1500); // RAW has no browser thumbnail — take the decoded one
  return r;
};

// ── open a gallery photo in the editor ─────────────────────────────────────────────────────────
async function openPhoto(id,{original=false,recipe=null}={}){
  const p=await getPhoto(id);const blob=await getBlob(id);
  if(!p||!blob){toast('Photo not found');return}
  const file=new File([blob],p.name,{type:p.type,lastModified:p.added});
  close();
  window.__mlibOpening=true;window.__csLibOpen=true;
  try{await origLoad([file])}finally{window.__mlibOpening=false;window.__csLibOpen=false}
  openedId=id;openedIds=[id];
  const r=recipe||(!original&&p.recipe);
  try{
    if(r){applyUISnapshot(unb64(r));if(typeof applyRawDefaults==='function')applyRawDefaults();}
    else if(typeof window.chromasmithApplyPristineDefault==='function')window.chromasmithApplyPristineDefault();
    if(typeof fxUpdate==='function')fxUpdate();
  }catch(e){console.error('restore recipe',e)}
  if(original)toast('Opened original — editing saves over the current edit');
}

// ── auto-save edits ────────────────────────────────────────────────────────────────────────────
window.chromasmithOnEdit=function(snap){
  const ids=openedId?[openedId]:openedIds;if(!ids.length)return;
  const rec=b64(snap);
  clearTimeout(saveT);
  saveT=setTimeout(async()=>{
    for(const id of ids){const p=await getPhoto(id);if(!p)continue;
      p.recipe=rec;p.edited=Date.now();await putPhoto(p);}
  },400);
  clearTimeout(thumbT);thumbT=setTimeout(refreshEditedThumb,1500);
};
async function refreshEditedThumb(){
  if(!openedId)return;const t=await thumbFromEditor();if(!t)return;
  const p=await getPhoto(openedId);if(!p)return;
  if(p.recipe)p.thumbEdited=t;else if(!p.thumb)p.thumb=t;
  await putPhoto(p);
}

// ── export history ─────────────────────────────────────────────────────────────────────────────
window.chromasmithRecordExport=async function(version,snap){
  const ids=openedId?[openedId]:openedIds;
  for(const id of ids){const p=await getPhoto(id);if(!p)continue;
    p.exports.push({version,recipe:b64(snap),ts:Date.now()});await putPhoto(p);}
};
window.chromasmithGetExportHistory=async function(){
  if(!openedId)return[];const p=await getPhoto(openedId);return p?p.exports:[];
};
if(typeof fxUpdateHistoryBtn==='function')fxUpdateHistoryBtn();

// ── gallery UI ─────────────────────────────────────────────────────────────────────────────────
const css=`
#mlib{position:fixed;inset:0;z-index:9000;background:var(--bg,#0e0e0e);color:var(--tx,#eee);display:none;flex-direction:column;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);font-family:var(--sans,system-ui)}
#mlib.open{display:flex}
#mlib .mh{display:flex;align-items:center;gap:8px;padding:10px 14px}
#mlib .mh h1{flex:1;margin:0;font-size:22px;font-weight:600;letter-spacing:-.01em}
#mlib .mh button{border:0;border-radius:999px;padding:9px 16px;font:600 14px inherit;background:var(--sur,#1d1d1d);color:inherit}
#mlib .mh .pri{background:var(--primary,#e8e2d0);color:#111}
#mlib .tabs{display:flex;gap:6px;padding:0 14px 8px}
#mlib .tabs button{border:0;border-radius:999px;padding:6px 12px;background:none;color:var(--tx2,#999);font:13px inherit}
#mlib .tabs button.on{background:var(--sur,#1d1d1d);color:inherit}
#mlib .grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:2px;
  padding:0 2px calc(16px + env(safe-area-inset-bottom));align-content:start;-webkit-overflow-scrolling:touch}
#mlib .cell{position:relative;aspect-ratio:1;background:#1a1a1a;overflow:hidden;border:0;padding:0}
#mlib .cell img{width:100%;height:100%;object-fit:cover;display:block}
#mlib .cell .nm{position:absolute;inset:auto 4px 4px 4px;font-size:10px;color:#ccc;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#mlib .cell .b{position:absolute;top:5px;right:5px;font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff}
#mlib .empty{grid-column:1/-1;text-align:center;color:var(--tx2,#999);padding:80px 24px;font-size:15px;line-height:1.5}
#mlib-sheet{position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.5);display:none;align-items:flex-end}
#mlib-sheet.open{display:flex}
#mlib-sheet .s{background:var(--sur,#1d1d1d);color:var(--tx,#eee);width:100%;border-radius:14px 14px 0 0;
  padding:14px 14px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:6px;max-height:80vh;overflow-y:auto}
#mlib-sheet .t{font-size:13px;color:var(--tx2,#999);padding:2px 4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mlib-sheet .s>button{border:0;border-radius:10px;padding:13px;font:15px var(--sans,system-ui);background:var(--bg,#111);color:inherit;text-align:left}
#mlib-sheet .s>button.dz{color:#ff6b6b}
#mlib-sheet .h{font-size:12px;color:var(--tx2,#999);padding:8px 4px 0;text-transform:uppercase;letter-spacing:.06em}`;
let root,grid,filter='all',urls=[];
function build(){
  if(root)return;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  root=document.createElement('div');root.id='mlib';
  root.innerHTML=`<div class="mh"><h1>Gallery</h1><button class="pri" data-a="import">Import</button><button data-a="close" aria-label="Close gallery">Editor</button></div>
<div class="tabs"><button data-f="all" class="on">All</button><button data-f="edited">Edited</button><button data-f="exported">Exported</button></div>
<div class="grid"></div>
<input type="file" accept="image/*,.rw2,.dng" multiple hidden>`;
  document.body.appendChild(root);
  grid=root.querySelector('.grid');
  const inp=root.querySelector('input');
  inp.onchange=async()=>{const fl=[...inp.files];inp.value='';if(!fl.length)return;
    const ids=await importFiles(fl);if(!ids.length)return;
    if(ids.length===1){openPhoto(ids[0]);return}
    // several photos: open them all in the editor's filmstrip, edits saved to each
    close();window.__mlibOpening=true;window.__csLibOpen=true;
    try{await origLoad(fl)}finally{window.__mlibOpening=false;window.__csLibOpen=false}
    openedId=null;openedIds=ids;};
  root.addEventListener('click',e=>{
    const a=e.target.closest('[data-a]'),f=e.target.closest('[data-f]'),c=e.target.closest('.cell');
    if(a&&a.dataset.a==='import')inp.click();
    else if(a&&a.dataset.a==='close')close();
    else if(f){filter=f.dataset.f;root.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b===f));render();}
    else if(c)openPhoto(c.dataset.id);
  });
  // long-press a photo → actions sheet (original / versions / revert / delete)
  let lp=null;
  grid.addEventListener('pointerdown',e=>{const c=e.target.closest('.cell');if(!c)return;
    lp=setTimeout(()=>{lp='fired';if(typeof hapt==='function')hapt('MEDIUM');sheet(c.dataset.id)},500);});
  const cancel=()=>{if(lp&&lp!=='fired')clearTimeout(lp)};
  grid.addEventListener('pointerup',cancel);grid.addEventListener('pointercancel',cancel);grid.addEventListener('pointermove',cancel);
  grid.addEventListener('click',e=>{if(lp==='fired'){e.stopPropagation();e.preventDefault();lp=null}},true);
  grid.addEventListener('contextmenu',e=>e.preventDefault());
}
async function render(){
  build();
  urls.forEach(u=>URL.revokeObjectURL(u));urls=[];
  let ps=(await allPhotos()).sort((a,b)=>(b.edited||b.added)-(a.edited||a.added));
  if(filter==='edited')ps=ps.filter(p=>p.recipe);
  if(filter==='exported')ps=ps.filter(p=>p.exports.length);
  if(!ps.length){grid.innerHTML=`<div class="empty">${filter==='all'?'No photos yet.<br>Tap <b>Import</b> to add photos — originals stay safe here and every edit is saved automatically.':'Nothing here yet.'}</div>`;return}
  grid.innerHTML=ps.map(p=>{const t=p.thumbEdited||p.thumb;let u='';if(t){u=URL.createObjectURL(t);urls.push(u)}
    const badge=p.exports.length?'Exported':p.recipe?'Edited':'';
    return `<button class="cell" data-id="${p.id}">${u?`<img src="${u}" alt="">`:`<span class="nm">${esc(p.name)}</span>`}${badge?`<span class="b">${badge}</span>`:''}</button>`}).join('');
}
async function sheet(id){
  const p=await getPhoto(id);if(!p)return;
  let sh=document.getElementById('mlib-sheet');
  if(!sh){sh=document.createElement('div');sh.id='mlib-sheet';document.body.appendChild(sh);
    sh.addEventListener('click',e=>{if(e.target===sh)sh.classList.remove('open')});}
  const when=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  sh.innerHTML=`<div class="s"><div class="t">${esc(p.name)}</div>
<button data-k="open">Open${p.recipe?' edited version':''}</button>
<button data-k="orig">Open original (no edits)</button>
${p.recipe?`<button data-k="snap">Save this edit as a version</button>`:''}
${p.versions.length?`<div class="h">Saved versions</div>`+p.versions.map((v,i)=>`<button data-k="ver" data-i="${i}">${esc(v.name)} · ${when(v.ts)}</button>`).join(''):''}
${p.exports.length?`<div class="h">Exports</div>`+p.exports.map((v,i)=>`<button data-k="exp" data-i="${i}">Export v${esc(v.version)} · ${when(v.ts)}</button>`).join(''):''}
${p.recipe?`<button data-k="revert">Revert to original</button>`:''}
<button data-k="del" class="dz">Remove from gallery</button></div>`;
  sh.querySelector('.s').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const k=b.dataset.k,i=+b.dataset.i;
    sh.classList.remove('open');
    if(k==='open')openPhoto(id);
    else if(k==='orig')openPhoto(id,{original:true});
    else if(k==='ver')openPhoto(id,{recipe:p.versions[i].recipe});
    else if(k==='exp')openPhoto(id,{recipe:p.exports[i].recipe});
    else if(k==='snap'){p.versions.push({name:'Version '+(p.versions.length+1),recipe:p.recipe,ts:Date.now()});await putPhoto(p);toast('Version saved')}
    else if(k==='revert'){if(!confirm('Revert to the original? Saved versions and exports are kept.'))return;
      p.recipe=null;p.thumbEdited=null;await putPhoto(p);render();toast('Reverted to original')}
    else if(k==='del'){if(!confirm('Remove this photo and its edits from the gallery? Exported files in your photo library are not affected.'))return;
      await tx('photos','readwrite',s=>s.delete(id));await tx('blobs','readwrite',s=>s.delete(id));
      if(openedId===id)openedId=null;render();}
  };
  sh.classList.add('open');
}
const isOpen=()=>!!(root&&root.classList.contains('open'));
function open(){build();root.classList.add('open');render();}
function close(){if(root)root.classList.remove('open');}
window.chromasmithToggleLibrary=()=>isOpen()?close():open();
window.chromasmithOpenGallery=open;

// Back on the editor's home state opens the gallery (it is the app's home screen).
const origBack=window.fxMobileBack;
if(typeof origBack==='function')window.fxMobileBack=function(){
  const b=document.body.classList;
  if(!b.contains('tools-open')&&!b.contains('sheet-open')){open();return}
  return origBack.apply(this,arguments);
};
const lb=document.getElementById('db-lib-btn');if(lb)lb.style.display='';
// Ask the OS not to evict stored originals under storage pressure.
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
// Launch into the gallery.
if(document.readyState==='complete')open();else window.addEventListener('load',open);
})();
