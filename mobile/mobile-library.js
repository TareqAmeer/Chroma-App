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
const day=t=>new Date(t).toLocaleDateString([], {day:'numeric',month:'short'});
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
#mlib{position:fixed;inset:0;z-index:9000;background:var(--mbg,#1c1c1c);color:var(--mink,#eee);display:none;flex-direction:column;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);font-family:var(--sans,system-ui)}
#mlib.open{display:flex}
#mlib .top{display:flex;align-items:center;gap:10px;padding:10px 8px 6px 14px}
#mlib .top svg{width:26px;height:26px;flex:0 0 auto}
#mlib .top .wm{flex:1;font-size:15px;letter-spacing:.02em;white-space:nowrap}
#mlib .top .set{border:0;background:none;color:inherit;width:40px;height:40px;display:flex;align-items:center;justify-content:center}
#mlib .top .set svg{width:22px;height:22px}
#mlib .mh{display:flex;align-items:center;gap:8px;padding:6px 14px 10px}
#mlib .mh h1{flex:1;margin:0;font-size:22px;font-weight:600;letter-spacing:-.01em}
#mlib .mh button{border:0;border-radius:999px;padding:9px 16px;font:600 14px inherit;background:color-mix(in srgb,var(--mink,#eee) 10%,transparent);color:inherit}
#mlib .mh .pri{background:var(--primary,#e8e2d0);color:#111}
#mlib .tabs{display:flex;gap:6px;padding:0 14px 8px}
#mlib .tabs button{border:0;border-radius:999px;padding:6px 12px;background:none;color:var(--tx2,#999);font:13px inherit}
#mlib .tabs button.on{background:color-mix(in srgb,var(--mink,#eee) 10%,transparent);color:inherit}
#mlib .grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:2px;
  padding:0 2px calc(16px + env(safe-area-inset-bottom));align-content:start;-webkit-overflow-scrolling:touch}
#mlib .cell{position:relative;aspect-ratio:1;background:var(--mcell,#262626);overflow:hidden;border:0;padding:0}
#mlib .cell img{width:100%;height:100%;object-fit:cover;display:block}
#mlib .cell .nm{position:absolute;inset:auto 4px 4px 4px;font-size:10px;color:#ccc;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#mlib .cell .b{position:absolute;top:5px;right:5px;font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff}
#mlib.orig .grid{display:block;column-count:3;column-gap:2px}
#mlib.orig .cell{display:block;width:100%;aspect-ratio:auto;margin:0 0 2px;break-inside:avoid}
#mlib.orig .cell img{height:auto}
#mlib.dates .cell{overflow:visible;margin-bottom:18px}
#mlib.orig.dates .cell{margin-bottom:20px}
#mlib .cell .dt{position:absolute;left:2px;top:100%;margin-top:2px;font-size:10px;opacity:.6;white-space:nowrap;display:none}
#mlib.dates .cell .dt{display:block}
#mlib .cell.sel::after{content:'✓';position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;background:var(--k-color-accent-a,#ff3b1f);color:#fff;font-size:13px;line-height:22px;text-align:center}
#mlib .cell.sel img{opacity:.75}
#mlib.selecting .cell:not(.sel)::after{content:'';position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;border:1.5px solid #fff;background:rgba(0,0,0,.25)}
#mlib .selbar{display:none;align-items:center;gap:6px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid color-mix(in srgb,var(--mink,#eee) 14%,transparent)}
#mlib.selecting .selbar{display:flex}
#mlib .selbar .n{flex:1;font-size:14px}
#mlib .selbar button{border:0;border-radius:999px;padding:9px 14px;font:600 14px inherit;background:color-mix(in srgb,var(--mink,#eee) 10%,transparent);color:inherit}
#mlib .selbar button.warn{color:#ff6b6b}
#mlib .selbar button:disabled{opacity:.35}
#mlib .empty{grid-column:1/-1;text-align:center;color:var(--tx2,#999);padding:80px 24px;font-size:15px;line-height:1.5}
#mlib-sheet{position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.5);display:none;align-items:flex-end}
#mlib-sheet.open{display:flex}
#mlib-sheet .s{background:var(--sur,#1d1d1d);color:var(--tx,#eee);width:100%;border-radius:14px 14px 0 0;
  padding:14px 14px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:6px;max-height:80vh;overflow-y:auto}
#mlib-sheet .t{font-size:13px;color:var(--tx2,#999);padding:2px 4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mlib-sheet .s>button{border:0;border-radius:10px;padding:13px;font:15px var(--sans,system-ui);background:var(--bg,#111);color:inherit;text-align:left}
#mlib-sheet .s>button.dz{color:#ff6b6b}
#mlib-sheet .seg{display:flex;gap:6px;flex-wrap:wrap}
#mlib-sheet .seg button{flex:1;border:1px solid var(--bdr,#333);border-radius:10px;padding:10px 6px;font:13px var(--sans,system-ui);background:none;color:inherit;display:flex;align-items:center;justify-content:center;gap:6px}
#mlib-sheet .seg button.on{border-color:var(--k-color-accent-a,#ff3b1f)}
#mlib-sheet .seg i{width:12px;height:12px;border:1px solid #666;display:inline-block}
#mlib-sheet .h{font-size:12px;color:var(--tx2,#999);padding:8px 4px 0;text-transform:uppercase;letter-spacing:.06em}`;
let root,grid,filter='all',urls=[];
// Gallery display preferences (per device).
const PREF_KEY='cs-mlib-prefs';
const BGS={dark:['#1c1c1c','#f2f0ea','#262626'],black:['#000','#f2f0ea','#161616'],grey:['#2c2c2c','#f2f0ea','#383838'],light:['#edeeee','#141414','#dcdcdc']};
function prefs(){let p={};try{p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}')}catch(e){}
  return Object.assign({bg:'dark',aspect:'square',sort:'edited',dates:false},p);}
function setPref(k,v){const p=prefs();p[k]=v;try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch(e){}applyPrefs();render();}
function applyPrefs(){if(!root)return;const p=prefs(),c=BGS[p.bg]||BGS.dark;
  root.style.setProperty('--mbg',c[0]);root.style.setProperty('--mink',c[1]);root.style.setProperty('--mcell',c[2]);
  root.classList.toggle('orig',p.aspect==='original');root.classList.toggle('dates',!!p.dates);}
function build(){
  if(root)return;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  root=document.createElement('div');root.id='mlib';
  root.innerHTML=`<div class="top"><svg viewBox="18 18 64 62" aria-hidden="true"><rect x="21" y="21" width="48" height="44" fill="var(--mink,#f2f0ea)"/><rect x="36" y="32" width="43" height="45" fill="var(--k-color-accent-a,#ff3b1f)"/><rect x="36" y="32" width="33" height="33" fill="#b0200e"/></svg><span class="wm">CHRO-MA-SMITH</span><button class="set" data-a="settings" aria-label="Settings">${typeof icon==='function'?icon('more',22):'⋯'}</button></div>
<div class="mh"><h1>Gallery</h1><button data-a="select">Select</button><button class="pri" data-a="import">Import</button><button data-a="close" aria-label="Close gallery">Editor</button></div>
<div class="tabs"><button data-f="all" class="on">All</button><button data-f="edited">Edited</button><button data-f="exported">Exported</button></div>
<div class="grid"></div>
<div class="selbar"><span class="n">0 selected</span><button data-a="sel-open">Edit</button><button data-a="sel-paste">Paste edits</button><button data-a="sel-revert">Revert</button><button data-a="sel-del" class="warn">Remove</button></div>
<input type="file" accept="image/*,.rw2,.dng" multiple hidden>`;
  document.body.appendChild(root);
  grid=root.querySelector('.grid');applyPrefs();
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
    if(a&&a.dataset.a==='select')setSelecting(!selecting);
    else if(a&&a.dataset.a.startsWith('sel-'))selAction(a.dataset.a.slice(4));
    else if(c&&selecting){const id=c.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);c.classList.toggle('sel',sel.has(id));selCount();}
    else if(a&&a.dataset.a==='import')inp.click();
    else if(a&&a.dataset.a==='close')close();
    else if(a&&a.dataset.a==='settings')settings();
    else if(f){filter=f.dataset.f;root.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b===f));render();}
    else if(c)openPhoto(c.dataset.id);
  });
  // long-press a photo → actions sheet (original / versions / revert / delete)
  let lp=null;
  grid.addEventListener('pointerdown',e=>{lp=null; // a long-press whose release landed on the sheet must not swallow the next tap
    const c=e.target.closest('.cell');if(!c)return;
    if(selecting)return;
    lp=setTimeout(()=>{lp='fired';if(typeof hapt==='function')hapt('MEDIUM');sheet(c.dataset.id)},500);});
  const cancel=()=>{if(lp&&lp!=='fired')clearTimeout(lp)};
  grid.addEventListener('pointerup',cancel);grid.addEventListener('pointercancel',cancel);grid.addEventListener('pointermove',cancel);
  grid.addEventListener('click',e=>{if(lp==='fired'){e.stopPropagation();e.preventDefault();lp=null}},true);
  grid.addEventListener('contextmenu',e=>e.preventDefault());
}
async function render(){
  build();
  urls.forEach(u=>URL.revokeObjectURL(u));urls=[];
  const pr=prefs();
  let ps=(await allPhotos()).sort(pr.sort==='added'?(a,b)=>b.added-a.added:(a,b)=>(b.edited||b.added)-(a.edited||a.added));
  if(filter==='edited')ps=ps.filter(p=>p.recipe);
  if(filter==='exported')ps=ps.filter(p=>p.exports.length);
  if(!ps.length){grid.innerHTML=`<div class="empty">${filter==='all'?'No photos yet.<br>Tap <b>Import</b> to add photos — originals stay safe here and every edit is saved automatically.':'Nothing here yet.'}</div>`;return}
  grid.innerHTML=ps.map(p=>{const t=p.thumbEdited||p.thumb;let u='';if(t){u=URL.createObjectURL(t);urls.push(u)}
    const badge=p.exports.length?'Exported':p.recipe?'Edited':'';
    return `<button class="cell${sel.has(p.id)?' sel':''}" data-id="${p.id}">${u?`<img src="${u}" alt="">`:`<span class="nm">${esc(p.name)}</span>`}${badge?`<span class="b">${badge}</span>`:''}<span class="dt">${p.edited?'Edited '+day(p.edited):'Added '+day(p.added)}</span></button>`}).join('');
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
${p.recipe?`<button data-k="copy">Copy edits</button>`:''}
${copied()?`<button data-k="paste">Paste edits</button>`:''}
${p.recipe?`<button data-k="snap">Save this edit as a version</button>`:''}
${p.versions.length?`<div class="h">Saved versions</div>`+p.versions.map((v,i)=>`<button data-k="ver" data-i="${i}">${esc(v.name)} · ${when(v.ts)}</button>`).join(''):''}
${p.exports.length?`<div class="h">Exports</div>`+p.exports.map((v,i)=>`<button data-k="exp" data-i="${i}">Export v${esc(v.version)} · ${when(v.ts)}</button>`).join(''):''}
${p.recipe?`<button data-k="revert">Revert to original</button>`:''}
<button data-k="del" class="dz">Remove from gallery</button></div>`;
  sh.querySelector('.s').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const k=b.dataset.k,i=+b.dataset.i;
    sh.classList.remove('open');
    if(k==='open')openPhoto(id);
    else if(k==='orig')openPhoto(id,{original:true});
    else if(k==='copy'){setCopied(p.recipe);toast('Edits copied');}
    else if(k==='paste'){await pasteTo([id]);}
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
// Gallery settings: app-level only (editor actions stay in the editor's ⋯ menu).
async function settings(){
  let sh=document.getElementById('mlib-sheet');
  if(!sh){sh=document.createElement('div');sh.id='mlib-sheet';document.body.appendChild(sh);
    sh.addEventListener('click',e=>{if(e.target===sh)sh.classList.remove('open')});}
  const ps=await allPhotos();let used='';
  try{const e=await navigator.storage.estimate();used=(e.usage/1048576).toFixed(0)+' MB used';}catch(e){}
  const light=document.body.classList.contains('light'),pr=prefs();
  sh.innerHTML=`<div class="s"><div class="t">Settings</div>
<button data-k="theme">${light?'Dark':'Light'} theme</button>
<button data-k="tour">Show welcome guide</button>
<div class="h">Gallery background</div>
<div class="seg">${Object.keys(BGS).map(k=>`<button data-k="bg" data-v="${k}" class="${pr.bg===k?'on':''}"><i style="background:${BGS[k][0]}"></i>${k[0].toUpperCase()+k.slice(1)}</button>`).join('')}</div>
<div class="h">Thumbnails</div>
<div class="seg"><button data-k="aspect" data-v="square" class="${pr.aspect==='square'?'on':''}">Square</button><button data-k="aspect" data-v="original" class="${pr.aspect==='original'?'on':''}">Original shape</button></div>
<div class="h">Order by</div>
<div class="seg"><button data-k="sort" data-v="edited" class="${pr.sort==='edited'?'on':''}">Last edited</button><button data-k="sort" data-v="added" class="${pr.sort==='added'?'on':''}">Date added</button></div>
<button data-k="dates">${pr.dates?'✓ ':''}Show date under each photo</button>
<div class="h">Gallery</div>
<div class="t">${ps.length} photo${ps.length===1?'':'s'}${used?' · '+used:''}</div>
<button data-k="clear" class="dz">Remove all photos from gallery</button>
<div class="t" style="padding-top:10px">CHRO-MA-SMITH · build ${typeof BUILD!=='undefined'?BUILD:''}</div></div>`;
  sh.querySelector('.s').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const k=b.dataset.k;
    if(k==='bg'||k==='aspect'||k==='sort'){setPref(k,b.dataset.v);settings();return}
    if(k==='dates'){setPref('dates',!prefs().dates);settings();return}
    sh.classList.remove('open');
    if(k==='theme'&&typeof toggleTheme==='function')toggleTheme();
    else if(k==='tour'&&window.chromasmithShowTour){close();window.chromasmithShowTour();}
    else if(k==='clear'){if(!confirm('Remove every photo and its edits from the gallery? Exported files in your photo library are not affected.'))return;
      await tx('photos','readwrite',s=>s.clear());await tx('blobs','readwrite',s=>s.clear());openedId=null;openedIds=[];render();}
  };
  sh.classList.add('open');
}
// ── multi-select ───────────────────────────────────────────────────────────────────────────────
let selecting=false;const sel=new Set();
function setSelecting(on){selecting=on;sel.clear();if(!root)return;
  root.classList.toggle('selecting',on);root.querySelector('[data-a="select"]').textContent=on?'Cancel':'Select';
  root.querySelectorAll('.cell.sel').forEach(c=>c.classList.remove('sel'));selCount();}
function selCount(){if(!root)return;root.querySelector('.selbar .n').textContent=sel.size+' selected';
  root.querySelectorAll('.selbar button').forEach(b=>b.disabled=!sel.size||(b.dataset.a==='sel-paste'&&!copied()));}
// Copy / paste edits between gallery photos. Geometry (crop, rotate, straighten) is per-photo, so
// it is not pasted — every other setting is.
const CK='cs-mlib-copied';
const copied=()=>{try{return localStorage.getItem(CK)}catch(e){return null}};
function setCopied(rec){try{localStorage.setItem(CK,rec)}catch(e){}}
async function pasteTo(ids){
  const src=copied();if(!src)return;
  let snap;try{snap=unb64(src)}catch(e){return}
  for(const id of ids){const p=await getPhoto(id);if(!p)continue;
    let own=null;try{own=p.recipe?unb64(p.recipe):null}catch(e){}
    const s2=Object.assign({},snap,{geom:own?own.geom:null});
    p.recipe=b64(s2);p.edited=Date.now();p.thumbEdited=null;await putPhoto(p);}
  render();toast('Edits pasted to '+ids.length+' photo'+(ids.length>1?'s':''));
}
async function selAction(k){
  const ids=[...sel];if(!ids.length)return;
  if(k==='open'){
    if(ids.length===1){setSelecting(false);openPhoto(ids[0]);return}
    const files=[];let first=null;
    for(const id of ids){const p=await getPhoto(id),b=await getBlob(id);if(!p||!b)continue;
      if(!first)first=p;files.push(new File([b],p.name,{type:p.type,lastModified:p.added}));}
    setSelecting(false);close();
    window.__mlibOpening=true;window.__csLibOpen=true;
    try{await origLoad(files)}finally{window.__mlibOpening=false;window.__csLibOpen=false}
    openedId=null;openedIds=ids;
    try{if(first&&first.recipe){applyUISnapshot(unb64(first.recipe));if(typeof fxUpdate==='function')fxUpdate();}}catch(e){}
  }else if(k==='paste'){
    if(!copied()){toast('Copy edits from a photo first (press and hold it)');return}
    await pasteTo(ids);setSelecting(false);
  }else if(k==='revert'){
    if(!confirm('Revert '+ids.length+' photo'+(ids.length>1?'s':'')+' to the original? Saved versions and exports are kept.'))return;
    for(const id of ids){const p=await getPhoto(id);if(p){p.recipe=null;p.thumbEdited=null;await putPhoto(p);}}
    setSelecting(false);render();toast('Reverted '+ids.length);
  }else if(k==='del'){
    if(!confirm('Remove '+ids.length+' photo'+(ids.length>1?'s':'')+' and their edits from the gallery? Exported files in your photo library are not affected.'))return;
    for(const id of ids){await tx('photos','readwrite',s=>s.delete(id));await tx('blobs','readwrite',s=>s.delete(id));if(openedId===id)openedId=null;}
    setSelecting(false);render();
  }
}
const isOpen=()=>!!(root&&root.classList.contains('open'));
function open(){build();root.classList.add('open');render();}
function close(){if(root){root.classList.remove('open');if(selecting)setSelecting(false);}}
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
