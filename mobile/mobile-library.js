/* Native phone/tablet gallery. Existing v1 IndexedDB originals and recipes remain compatible.
 * A selection is an editing queue, not shared global FX: each photo loads its own recipe. */
(function(){
'use strict';
const UI=()=>window.MobileUI,$=s=>document.querySelector(s),esc=s=>UI().esc(s);
const DBN='chromasmith-mlib',LAST='cs-mlib-last',JOURNAL='cs-mlib-pending-v2';
const b64=s=>btoa(unescape(encodeURIComponent(JSON.stringify(s)))),unb64=s=>MobileProject.validateRecipe(s);
const id=()=>('p'+Date.now().toString(36)+Math.random().toString(36).slice(2,9));
let database,root,grid,openedId=null,queue=[],restoring=false,opening=false,selecting=false,filter='all',search='',collection='',urls=[];
const selected=new Set(),pending=new Map(),known=new Map();let saveTimer,inputTimer,writing=Promise.resolve(),renderKey=0,saveFailed=false;
const origLoad=window.loadFXImages;
function db(){return database||(database=new Promise((res,rej)=>{
  const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>{for(const name of ['photos','blobs'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});};
  r.onsuccess=()=>res(r.result);r.onerror=()=>{database=null;rej(r.error);};
}));}
async function tx(stores,mode,fn){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(stores,mode);let result;try{result=fn(t);}catch(e){t.abort();rej(e);return;}t.oncomplete=()=>res(result&&'result'in result?result.result:result);t.onerror=()=>rej(t.error||new Error('Storage write failed'));t.onabort=()=>rej(t.error||new Error('Storage write cancelled'));});}
// Binary buffers avoid WebKit's IndexedDB Blob-cloning failures. Older Blob-backed
// originals and thumbnails are still readable without a destructive database migration.
const readThumb=v=>v?.bytes?new Blob([v.bytes],{type:v.type||'image/jpeg'}):v;
const writeThumb=async v=>v instanceof Blob?{bytes:await v.arrayBuffer(),type:v.type}:v;
const readPhoto=p=>p?{...p,thumb:readThumb(p.thumb),thumbEdited:readThumb(p.thumbEdited),versions:(p.versions||[]).map(v=>({...v,thumb:readThumb(v.thumb)})),exports:p.exports||[]}:p;
const getPhoto=i=>tx('photos','readonly',t=>t.objectStore('photos').get(i)).then(readPhoto);
const allPhotos=()=>tx('photos','readonly',t=>t.objectStore('photos').getAll()).then(ps=>ps.map(readPhoto));
async function patchPhoto(i,patch={},versions=[],exports=[]){
  const changes={...patch};for(const k of ['thumb','thumbEdited'])if(k in changes)changes[k]=await writeThumb(changes[k]);
  const additions=await Promise.all(versions.map(async v=>({...v,thumb:await writeThumb(v.thumb)})));
  // Read and merge inside ONE readwrite transaction. A thumbnail, flag, export receipt or
  // version must never write a stale copy of the recipe or erase a concurrently saved version.
  return tx('photos','readwrite',t=>{const store=t.objectStore('photos'),r=store.get(i);r.onsuccess=()=>{
    try{if(!r.result)return;const record={...r.result,...changes};
    if(additions.length)record.versions=[...(r.result.versions||[]),...additions];
    if(exports.length)record.exports=[...(r.result.exports||[]),...exports];store.put(record);
    }catch(_){t.abort();}
  };});
}
const getBlob=i=>tx('blobs','readonly',t=>t.objectStore('blobs').get(i)).then(p=>p?.bytes?new Blob([p.bytes],{type:p.type}):p?.blob);
const safe=fn=>Promise.resolve().then(fn).catch(e=>{status(e.message,true);if(window.toast)toast(e.message);});
function status(text,error=false){build();const e=root.querySelector('.status');e.textContent=text;e.classList.toggle('phone-error',error);}
function saveStatus(text,error=false){if(saveFailed&&text==='Saving…'){text='Save failed · Retry';error=true;}const e=$('#phone-save-status');if(e){e.textContent=text;e.classList.toggle('phone-error',error);e.disabled=!error;e.setAttribute('aria-label',error?'Save failed. Retry saving':text);}}
function journal(){try{if(pending.size)localStorage.setItem(JOURNAL,JSON.stringify([...pending]));else localStorage.removeItem(JOURNAL);}catch(e){/* IndexedDB holds full masks; the small emergency journal is best effort. */}}
function capture(snap){
  if(!openedId||restoring||opening)return;const recipe=b64(snap);if(known.get(openedId)===recipe&&!pending.has(openedId))return;
  pending.set(openedId,{recipe,edited:Date.now()});journal();saveStatus('Saving…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>safe(()=>flush(false)),200);
}
async function flush(captureLive=true){
  clearTimeout(saveTimer);clearTimeout(inputTimer);
  // Capture before changing the photo: the editor history debounce has not necessarily fired.
  if(captureLive&&openedId&&!restoring&&!opening&&typeof getUISnapshot==='function')capture(getUISnapshot());
  clearTimeout(saveTimer);const batch=[...pending];
  const task=async()=>{
    for(const [i,value]of batch){const p=await getPhoto(i);if(!p)continue;await patchPhoto(i,{recipe:value.recipe,edited:value.edited});known.set(i,value.recipe);if(pending.get(i)===value)pending.delete(i);}
    journal();saveFailed=false;saveStatus(pending.size?'Saving…':'Saved');
  };
  const next=writing.catch(()=>{}).then(task);writing=next;
  try{await next;}catch(e){saveFailed=true;saveStatus('Save failed · Retry',true);throw new Error('Edits could not be saved. Free up storage, then tap Retry.');}
}
window.chromasmithOnEdit=capture;
async function thumb(src,w,h){const k=Math.min(1,360/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));c.getContext('2d').drawImage(src,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,'image/jpeg',.8));}
// RAW files (RW2 etc.) can't be decoded by createImageBitmap, but each embeds full JPEG previews:
// find the JPEG start markers, try the largest segments first and use the first that decodes.
async function rawEmbeddedThumb(file){
  try{const u=new Uint8Array(await file.arrayBuffer()),starts=[];
    for(let i=0;i<u.length-3;i++)if(u[i]===0xFF&&u[i+1]===0xD8&&u[i+2]===0xFF)starts.push(i);
    const segs=starts.map((a,k)=>({a,b:k+1<starts.length?starts[k+1]:u.length})).sort((x,y)=>(y.b-y.a)-(x.b-x.a)).slice(0,4);
    for(const g of segs){let e=g.b;while(e>g.a+2&&!(u[e-2]===0xFF&&u[e-1]===0xD9))e--;
      if(e<=g.a+2)continue;
      try{const bm=await createImageBitmap(new Blob([u.subarray(g.a,e)],{type:'image/jpeg'})),t=await thumb(bm,bm.width,bm.height);bm.close();if(t)return t;}catch(_){}}
  }catch(_){}
  return null;}
async function fileThumb(file){try{const bm=await createImageBitmap(file),t=await thumb(bm,bm.width,bm.height);bm.close();return t;}catch(_){return rawEmbeddedThumb(file);}}
async function editorThumb(){renderPreview();const bd=$('#fx-canvas-bd'),c=bd&&bd.style.display!=='none'?bd:$('#fx-canvas');return c?.width?thumb(c,c.width,c.height):null;}
async function refreshThumb(){if(!openedId||restoring)return;const i=openedId,t=await editorThumb();if(!t)return;await flush();const p=await getPhoto(i);if(!p)return;if(p.recipe)await patchPhoto(i,{thumbEdited:t});else if(!p.thumb)await patchPhoto(i,{thumb:t});}
async function fingerprint(f){const bytes=await f.arrayBuffer();if(window.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}let hash=2166136261;for(const b of new Uint8Array(bytes))hash=Math.imul(hash^b,16777619);return 'fnv:'+bytes.byteLength+':'+(hash>>>0).toString(16);}
async function identical(a,b){if(a.size!==b.size)return false;const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());return x.every((v,i)=>v===y[i]);}
async function importFiles(files){
  await flush();const ids=[],issues=[],ps=await allPhotos();let duplicates=0;
  for(let n=0;n<files.length;n++){
    const f=files[n];status('Importing '+(n+1)+' of '+files.length+' · '+f.name);
    if(!(f.type.startsWith('image/')||/\.(rw2|raw|dng|cr2|cr3|nef|arw|orf|raf|tiff?|heic|heif|jpe?g|png|webp|avif)$/i.test(f.name))){issues.push({name:f.name,message:'Unsupported file type'});continue;}
    try{
      const hash=await fingerprint(f);let existing=ps.find(p=>p.hash===hash);if(existing&&hash.startsWith('fnv:')&&!await identical(f,await getBlob(existing.id)))existing=null;
      // Legacy imports and origins without Web Crypto use a byte-verified fallback hash.
      if(!existing)for(const p of ps.filter(p=>p.size===f.size&&p.hash!==hash)){
        const original=await getBlob(p.id);if(original&&await fingerprint(original)===hash&&(!hash.startsWith('fnv:')||await identical(f,original))){p.hash=hash;await patchPhoto(p.id,{hash});existing=p;break;}}
      if(existing){if(existing.trashed){delete existing.trashed;await patchPhoto(existing.id,{trashed:undefined});}ids.push(existing.id);duplicates++;continue;}
      const i=id(),p={id:i,name:f.name,type:f.type,size:f.size,hash,added:Date.now(),edited:0,recipe:null,versions:[],exports:[],thumb:null,thumbEdited:null,flag:null,collection:''};
      // Safari can reject a disk-backed File when IndexedDB clones it. Store its exact
      // bytes instead; getBlob also continues reading originals from the older Blob records.
      const bytes=await f.arrayBuffer();
      await tx(['photos','blobs'],'readwrite',t=>{t.objectStore('photos').put(p);t.objectStore('blobs').put({id:i,bytes,name:f.name,type:f.type});});
      ps.push(p);ids.push(i);status('Building thumbnail '+(n+1)+' of '+files.length);await patchPhoto(i,{thumb:await fileThumb(f)});
    }catch(e){issues.push({name:f.name,message:e.message});}
  }
  status(ids.length+' photo'+(ids.length===1?'':'s')+' ready'+(duplicates?' · '+duplicates+' duplicate'+(duplicates===1?'':'s')+' reused':''));
  if(issues.length)showImportIssues(issues,files);
  return [...new Set(ids)];
}
function showImportIssues(issues,files){UI().sheet('Import results',issues.map(i=>'<p><b>'+esc(i.name)+'</b><br>'+esc(i.message)+'</p>').join('')+'<button data-retry>Retry failed files</button>',(el,close)=>el.querySelector('[data-retry]').onclick=()=>{close();safe(()=>importAndOpen(files.filter(f=>issues.some(i=>i.name===f.name))));});}
// iOS: the native picker returns every original of each picked photo, so a RAW+JPEG shot
// arrives as both files (the web file picker only hands over the JPEG). False = not available.
async function importFromPhotos(){
  const cap=window.Capacitor,pp=cap?.Plugins?.PhotoPair;if(!pp||cap.getPlatform?.()!=='ios')return false;
  let res;try{res=await pp.pick();}catch(e){status(e?.message||'Could not open Photos',true);return true;}
  const list=res?.files||[];if(!list.length)return true;status('Importing '+list.length+' file'+(list.length>1?'s':'')+'…');
  const files=[];for(const f of list){try{const blob=await (await fetch(cap.convertFileSrc(f.path))).blob();files.push(new File([blob],f.name,{type:blob.type||''}));}catch(e){}}
  if(files.length)await importAndOpen(files);else status('');return true;
}
// Photos shared to the app from the system share sheet (iOS Share Extension via the app group,
// Android SEND intents): the native side parks the copied files; pull and import them like picked photos.
let sharedBusy=false;
async function checkShared(){
  const cap=window.Capacitor,pp=cap?.Plugins?.PhotoPair;if(!pp||!pp.takeShared||sharedBusy)return;
  sharedBusy=true;
  try{const res=await pp.takeShared(),list=res?.files||[];if(!list.length)return;
    status('Importing '+list.length+' shared file'+(list.length>1?'s':'')+'…');
    const files=[];for(const f of list){try{const blob=await (await fetch(cap.convertFileSrc(f.path))).blob();files.push(new File([blob],f.name,{type:blob.type||''}));}catch(e){}}
    if(files.length)await importAndOpen(files);else status('Could not read the shared photos',true);}
  catch(e){status(e?.message||'Could not import shared photos',true);}finally{sharedBusy=false;}
}
window.csCheckShared=()=>safe(checkShared);
setTimeout(()=>window.csCheckShared(),1200);
async function importAndOpen(files){const ids=await importFiles([...files]);if(!ids.length){await open();return;}queue=ids;await openPhoto(ids[0]);}
window.loadFXImages=async function(files){if(window.__mlibOpening)return origLoad.apply(this,arguments);await importAndOpen([...files]);return curItem();};
async function openPhoto(i,{recipe,original=false}={}){
  if(opening||document.body.classList.contains('fx-exporting'))return false;
  const previous={id:openedId,images:[...fxImages],snap:getUISnapshot(),history:fxHistory,index:fxHistIdx,loadKey:_fxLoadKey,version:fxVersion};
  if(openedId)capture(previous.snap);opening=true;restoring=true;status('Opening photo…');
  try{
    await flush(false);
    const p=await getPhoto(i),blob=await getBlob(i);if(!p||!blob||p.trashed)throw new Error('Photo is unavailable. Restore it from Trash first.');
    window.__mlibOpening=true;window.__csLibOpen=true;
    let entry;
    try{entry=await origLoad([new File([blob],p.name,{type:p.type,lastModified:p.added})]);}finally{window.__mlibOpening=false;window.__csLibOpen=false;}
    if(!entry)throw new Error('Could not decode '+p.name+'. Try another format or retry importing.');
    openedId=i;if(!queue.includes(i))queue=[i];
    const r=recipe??(!original&&p.recipe);
    if(r)await applyUISnapshot(unb64(r));else await window.chromasmithApplyPristineDefault?.();
    if(!r&&RAW_FILE_EXT_RE.test('.'+entry.ext)&&typeof applyRawDefaults==='function')applyRawDefaults();fxUpdate();clearTimeout(_fxHistPushTimer);
    const snap=getUISnapshot();known.set(i,b64(snap));
    // An explicit version/original fork must replace the working recipe AFTER the outgoing
    // editor has flushed. Otherwise that last flush overwrites the version being opened.
    if(recipe!==undefined||original){await patchPhoto(i,{recipe:b64(snap),edited:Date.now(),thumbEdited:null});}
    fxHistory=[{j:JSON.stringify(snap),snap,rasters:fxState.masks.map(m=>m.px||null),label:'Opened',ts:Date.now()}];fxHistIdx=0;fxSyncTopbarDisabled();
    if(p.importError){await patchPhoto(i,{importError:undefined});}
    localStorage.setItem(LAST,JSON.stringify({id:i,inEditor:true}));close();status('');saveStatus('Saved');syncQueue();return true;
  }catch(e){
    // The shared decoder resets controls before attempting a new image. Roll back both
    // pixels and recipe on failure, so a later autosave cannot persist those reset controls
    // over the outgoing photo. Keep its undo history and pending writes available too.
    openedId=previous.id;
    if(previous.images.length){if(fxImages[0]!==previous.images[0])installFXImages(previous.images,previous.loadKey);await applyUISnapshot(previous.snap);fxVersion=previous.version;fxUpdate();}
    else{fxImages=[];fxImg=null;fxWork=null;applyUISnapshot(previous.snap);}
    clearTimeout(_fxHistPushTimer);fxHistory=previous.history;fxHistIdx=previous.index;fxSyncTopbarDisabled();
    await open(false);status(e.message,true);UI().sheet('Photo could not open','<p>'+esc(e.message)+'</p><button data-retry>Retry</button>',(el,close)=>el.querySelector('[data-retry]').onclick=()=>{close();safe(()=>openPhoto(i));});
  }
  finally{opening=false;restoring=false;}
}
async function setFlag(ids,flag){await flush();for(const i of ids){const p=await getPhoto(i);if(p){await patchPhoto(i,{flag});}}await render();hapt();}
const CK='cs-mlib-copied',copied=()=>localStorage.getItem(CK);
async function pasteTo(ids,source=copied(),verb='Paste'){
  if(!source){toast('Copy edits from a photo first');return;}await flush();
  const normalize=r=>{const s=unb64(r);if(s.ver!==2&&s.sliders['adj-exp']!==undefined)s.sliders['adj-exp']=String(Math.max(-100,Math.min(100,+s.sliders['adj-exp']*(20/50))));s.ver=2;return s;},snap=normalize(source);
  // Geometry, retouch and masks are per-photo. Sharing masks needs its own explicit workflow.
  const cats=PASTE_CATEGORIES.filter(c=>c.key!=='masks');let keys=null;
  const s=UI().sheet(verb+' selected settings', '<p>'+ids.length+' photo'+(ids.length===1?'':'s')+'. Crop, retouch and masks stay individual.</p>'+cats.map(c=>'<label><input type="checkbox" value="'+c.key+'" checked>'+esc(c.label)+'</label>').join('')+'<button data-paste>'+verb+'</button>',(el,close)=>el.querySelector('[data-paste]').onclick=()=>{keys=[...el.querySelectorAll('input:checked')].map(i=>i.value);close();});
  await s.closed;if(!keys?.length)return;
  for(const i of ids){const p=await getPhoto(i);if(!p)continue;const own=p.recipe?normalize(p.recipe):structuredClone(_fxPristineDefault),out=pasteEditSelectiveApply(own,snap,keys);
    for(const key of ['nr','deconv'])if(keys.includes(key)&&snap.toggles[key]!==undefined)out.toggles[key]=snap.toggles[key];
    out.geom=own.geom;out.heal=own.heal;out.masks=own.masks;p.recipe=b64(out);await patchPhoto(i,{recipe:p.recipe,edited:Date.now(),thumbEdited:null});known.delete(i);
    if(i===openedId){restoring=true;try{await applyUISnapshot(out);fxUpdate();clearTimeout(_fxHistPushTimer);known.set(i,p.recipe);}finally{restoring=false;}}}
  await render();toast(verb+' applied to '+ids.length+' photo'+(ids.length===1?'':'s'));
}
async function saveVersion(i){await refreshThumb();await flush();const p=await getPhoto(i);if(!p)return;const n=await UI().name('Save named version','Version '+((p.versions||[]).length+1));if(!n)return;
  await patchPhoto(i,{},[{name:n,recipe:p.recipe||b64(_fxPristineDefault),thumb:p.thumbEdited||p.thumb,ts:Date.now()}]);toast('Version saved');}
async function forkVersion(i,recipe,label){await flush();const p=await getPhoto(i);if(!p)return;
  if(!await UI().ask('Create a new version?', 'Your current edit will be kept as a named version before opening '+label+'.','Create version'))return;
  const name=await UI().name('Name the new version',label);if(!name)return;
  const target=recipe||b64(_fxPristineDefault);
  await patchPhoto(i,{},[{name:'Before '+name,recipe:p.recipe||b64(_fxPristineDefault),thumb:p.thumbEdited||p.thumb,ts:Date.now()},{name,recipe:target,ts:Date.now()}]);
  await openPhoto(i,{recipe:target});
}
function compareVersion(p,v){
  const a=p.thumbEdited||p.thumb,b=v.thumb||p.thumb,ua=a?URL.createObjectURL(a):'',ub=b?URL.createObjectURL(b):'';
  const s=UI().sheet('Compare versions','<div class="phone-compare-pair"><div><p>Current edit</p>'+(ua?'<img src="'+ua+'" alt="Current edit">':'<p>Preview unavailable</p>')+'</div><div><p>'+esc(v.name)+'</p>'+(v.thumb?'<img src="'+ub+'" alt="'+esc(v.name)+'">':'<p>No saved preview for this older version. Open a copy to inspect it.</p>')+'</div></div><button data-open>Create version from this</button>',(el,close)=>el.querySelector('[data-open]').onclick=()=>{close();safe(()=>forkVersion(p.id,v.recipe,v.name));});
  s.closed.then(()=>{if(ua)URL.revokeObjectURL(ua);if(ub)URL.revokeObjectURL(ub);});
}
async function photoActions(i){await flush();const p=await getPhoto(i);if(!p)return;
  UI().sheet(p.name,'<button data-act="open">Open current edit</button><button data-act="original">Create version from original</button><button data-act="favourite">'+(p.flag==='fav'?'Unfavourite':'Favourite')+'</button><button data-act="reject">'+(p.flag==='rej'?'Un-reject':'Reject')+'</button><button data-act="collection">Move to collection</button>'+(p.recipe?'<button data-act="copy">Copy edits</button><button data-act="version">Save named version</button>':'')+(copied()?'<button data-act="paste">Paste selected settings</button>':'')+p.versions.map((v,n)=>'<button data-version="'+n+'">Compare '+esc(v.name)+'</button>').join('')+p.exports.map((v,n)=>'<button data-export="'+n+'">'+esc(v.status==='shared'?'Shared':'Exported')+' '+esc(v.version)+' · '+esc(new Date(v.ts).toLocaleString())+'</button>').join('')+'<button data-act="backup">Export project for desktop</button><button data-act="trash">Move to Trash</button>',(el,close)=>{
    el.querySelector('.phone-dialog-content').onclick=e=>{const b=e.target.closest('button');if(!b)return;close();safe(async()=>{
      if(b.dataset.version!==undefined){compareVersion(p,p.versions[+b.dataset.version]);return;}
      if(b.dataset.export!==undefined){const v=p.exports[+b.dataset.export];await forkVersion(i,v.recipe,'Export '+v.version);return;}
      switch(b.dataset.act){case 'open':queue=[i];await openPhoto(i);break;case 'original':await forkVersion(i,null,'Original');break;case 'favourite':await setFlag([i],p.flag==='fav'?null:'fav');break;case 'reject':await setFlag([i],p.flag==='rej'?null:'rej');break;case 'copy':localStorage.setItem(CK,p.recipe);toast('Edits copied');break;case 'paste':await pasteTo([i]);break;case 'version':if(openedId!==i)await openPhoto(i);await saveVersion(i);break;case 'collection':await moveCollection([i]);break;case 'backup':await backup([i]);break;case 'trash':await trash([i]);break;}
    });};
  });
}
async function moveCollection(ids){const n=await UI().name('Collection name');if(!n)return;for(const i of ids){const p=await getPhoto(i);if(p){await patchPhoto(i,{collection:n});}}await render();}
async function trash(ids){await flush();for(const i of ids){const p=await getPhoto(i);if(p){await patchPhoto(i,{trashed:Date.now()});}if(openedId===i){openedId=null;queue=[];localStorage.removeItem(LAST);}}setSelecting(false);await render();toast('Moved to Trash. Restore any time from Gallery → Trash.');}
async function restore(ids){for(const i of ids){const p=await getPhoto(i);if(p){await patchPhoto(i,{trashed:undefined});}}setSelecting(false);await render();toast('Photos restored');}
async function removePermanently(ids){if(!await UI().ask('Delete permanently?','These originals, edits and versions will be removed from this app. Exported files stay on your device.','Delete permanently'))return;
  await tx(['photos','blobs'],'readwrite',t=>ids.forEach(i=>{t.objectStore('photos').delete(i);t.objectStore('blobs').delete(i);}));setSelecting(false);await render();}
const BGS={dark:['#1c1c1c','#f2f0ea','#262626'],black:['#000','#f2f0ea','#161616'],grey:['#2c2c2c','#f2f0ea','#383838'],light:['#ededee','#141414','#dcdcdc']};
function prefs(){let p={};try{p=JSON.parse(localStorage.getItem('cs-mlib-prefs')||'{}');}catch(_){}return {...{bg:'dark',aspect:'square',sort:'edited',dates:false,names:false},...p};}
function setGalleryPref(k,v){const p=prefs();p[k]=v;localStorage.setItem('cs-mlib-prefs',JSON.stringify(p));applyPrefs();safe(render);}
function applyPrefs(){if(!root)return;const p=prefs(),c=BGS[p.bg]||BGS.dark;root.style.setProperty('--mbg',c[0]);root.style.setProperty('--mink',c[1]);root.style.setProperty('--mcell',c[2]);root.classList.toggle('orig',p.aspect==='original');root.classList.toggle('dates',p.dates);root.classList.toggle('names',p.names);}
function build(){
  if(root)return;root=document.createElement('div');root.id='mlib';root.setAttribute('aria-label','Photo gallery');
  root.innerHTML='<div class="top"><svg viewBox="18 18 64 62" aria-hidden="true"><rect x="21" y="21" width="48" height="44" fill="var(--k-color-ink,currentColor)"/><rect x="36" y="32" width="43" height="45" fill="var(--k-color-accent-a,var(--acc,#ff3b1f))"/><rect x="36" y="32" width="33" height="33" fill="#b0200e"/></svg><span class="wm">CHRO-MA-SMITH</span><div class="vtog" role="group" aria-label="View"><button type="button" class="on" aria-pressed="true" aria-label="Gallery">gallery</button><button type="button" data-a="editor" aria-pressed="false" aria-label="Studio">studio</button></div><button data-a="settings" aria-label="Gallery settings">'+(typeof icon==='function'?icon('settings',24):'⚙')+'</button></div><div class="mh"><button data-a="select">'+(typeof icon==='function'?icon('select',18):'')+'<span>Select</span></button><button class="pri" data-a="import">'+(typeof icon==='function'?icon('download',18):'')+'<span>Import</span></button></div><div class="filters"><div class="search-row"><input type="search" aria-label="Search photos by filename" placeholder="Search photos"></div><div class="search-row"><select aria-label="Sort photos"><option value="edited">Last edited</option><option value="added">Date added</option><option value="name">Name</option></select><select class="collections" aria-label="Filter by collection"><option value="">All collections</option></select></div></div><div class="tabs" aria-label="Photo filters">'+[['all','All'],['edited','Edited'],['exported','Exported'],['fav','Favourites'],['rej','Rejected'],['trash','Trash']].map(([key,label])=>'<button data-f="'+key+'" aria-pressed="'+(key==='all')+'">'+label+'</button>').join('')+'</div><div class="status" role="status" aria-live="polite"></div><div class="grid" aria-label="Photos"></div><div class="selbar"><span class="n" role="status">0 selected</span><button data-a="edit">Edit</button><button data-a="more">Actions</button><button data-a="remove" class="warn">Trash</button></div><input class="import-file" type="file" accept="image/*,.rw2,.dng" multiple hidden>';
  document.body.appendChild(root);grid=root.querySelector('.grid');applyPrefs();root.querySelector('[aria-label="Sort photos"]').value=prefs().sort;
  root.querySelector('input[type=search]').oninput=e=>{search=e.target.value;safe(render);};root.querySelector('[aria-label="Sort photos"]').onchange=e=>setGalleryPref('sort',e.target.value);
  root.querySelector('.collections').onchange=e=>{collection=e.target.value;safe(render);};
  // Search, sort and collections stay tucked away until the grid is pulled down from the top.
  {let y0=null;const active=()=>search||collection;grid.addEventListener('touchstart',e=>{y0=grid.scrollTop<=0?e.touches[0].clientY:null;},{passive:true});
   grid.addEventListener('touchmove',e=>{if(y0!==null&&e.touches[0].clientY-y0>48){root.classList.add('filters-open');y0=null;}},{passive:true});
   grid.addEventListener('wheel',e=>{if(grid.scrollTop<=0&&e.deltaY<-20)root.classList.add('filters-open');},{passive:true});
   grid.addEventListener('scroll',()=>{if(grid.scrollTop>80&&!active()&&!root.contains(document.activeElement?.closest('.filters')))root.classList.remove('filters-open');},{passive:true});}root.querySelector('.import-file').onchange=e=>{const files=[...e.target.files];e.target.value='';if(files.length)safe(()=>importAndOpen(files));};
  // Long-press a photo for its actions (the visible ⋯ button is gone; it stays for screen readers).
  {let t=0,fired=false;const menuFor=cell=>cell?.closest('.photo-tile')?.querySelector('.photo-menu');
   grid.addEventListener('pointerdown',e=>{const cell=e.target.closest('.cell');fired=false;clearTimeout(t);if(!cell||selecting)return;t=setTimeout(()=>{fired=true;window.hapt?.();menuFor(cell)?.click();},500);});
   ['pointerup','pointercancel','pointermove'].forEach(n=>grid.addEventListener(n,e=>{if(n!=='pointermove'||Math.abs(e.movementX)+Math.abs(e.movementY)>4)clearTimeout(t);}));
   grid.addEventListener('contextmenu',e=>{const cell=e.target.closest('.cell');if(cell&&!selecting){e.preventDefault();if(!fired)menuFor(cell)?.click();}});
   grid.addEventListener('click',e=>{if(fired&&e.target.closest('.cell')){e.stopPropagation();e.preventDefault();fired=false;}},true);}
  root.onclick=e=>{const b=e.target.closest('[data-a],[data-f]'),c=e.target.closest('.cell');
    if(b?.dataset.f){filter=b.dataset.f;setSelecting(false);safe(render);return;}
    const menu=e.target.closest('.photo-menu');if(menu){safe(()=>filter==='trash'?trashActions([menu.dataset.id]):photoActions(menu.dataset.id));return;}
    if(c){if(selecting){selected.has(c.dataset.id)?selected.delete(c.dataset.id):selected.add(c.dataset.id);c.classList.toggle('sel',selected.has(c.dataset.id));c.setAttribute('aria-pressed',String(selected.has(c.dataset.id)));selectionCount();}else if(filter==='trash')safe(()=>trashActions([c.dataset.id]));else safe(async()=>{queue=[c.dataset.id];await openPhoto(c.dataset.id);});return;}
    if(!b)return;safe(async()=>{switch(b.dataset.a){case 'select':setSelecting(!selecting);break;case 'import':if(!await importFromPhotos())root.querySelector('.import-file').click();break;case 'editor':if(openedId)close();else toast('Import or open a photo first');break;case 'settings':await settings();break;case 'edit':queue=[...selected];setSelecting(false);await openPhoto(queue[0]);break;case 'more':await selectionActions();break;case 'remove':filter==='trash'?await removePermanently([...selected]):await trash([...selected]);break;}});
  };
  ensureEditorChrome();
}
function ensureEditorChrome(){
  if(!$('#phone-save-status')){
    const save=document.createElement('button');save.id='phone-save-status';save.type='button';save.setAttribute('role','status');save.setAttribute('aria-live','polite');save.textContent='Saved';save.onclick=()=>safe(()=>flush());document.body.appendChild(save);
  }
  if($('#phone-queue'))return;
  const q=document.createElement('div');q.id='phone-queue';q.hidden=true;q.innerHTML='<button data-q="prev" aria-label="Previous photo">‹</button><span></span><button data-q="next" aria-label="Next photo">›</button><button data-q="actions" aria-label="Actions">⋯</button>';
  const ctx=$('#phone-context'),anchor=$('#fx-actionbar');if(ctx)ctx.appendChild(q);else if(anchor)anchor.after(q);else document.body.appendChild(q);
  const measure=()=>requestAnimationFrame(()=>{const height=q.hidden||q.parentElement?.id==='phone-context'?'0px':q.offsetHeight+'px';if(document.body.style.getPropertyValue('--phone-queue-height')!==height)document.body.style.setProperty('--phone-queue-height',height);});window.addEventListener('resize',measure);q._measure=measure;
  q.onclick=e=>{const b=e.target.closest('button');if(!b)return;safe(async()=>{const index=queue.indexOf(openedId);if(b.dataset.q==='prev'&&index>0)await openPhoto(queue[index-1]);if(b.dataset.q==='next'&&index<queue.length-1)await openPhoto(queue[index+1]);if(b.dataset.q==='actions')UI().sheet('Selected photos','<p>Each photo keeps its own edits.</p><button data-queue-sync>Sync selected settings</button><button data-queue-export>Export selected photos</button>',(el,close)=>{el.querySelector('[data-queue-sync]').onclick=()=>{close();safe(async()=>{await flush();await pasteTo(queue.filter(i=>i!==openedId),b64(getUISnapshot()),'Sync');});};el.querySelector('[data-queue-export]').onclick=()=>{close();safe(exportQueue);};});});};
}
function syncQueue(){ensureEditorChrome();const q=$('#phone-queue');q.hidden=queue.length<2;const n=queue.indexOf(openedId);q.querySelector('span').textContent=(n+1)+' / '+queue.length;q.querySelector('span').setAttribute('aria-label','Photo '+(n+1)+' of '+queue.length);q.querySelector('[data-q=prev]').disabled=n<=0;q.querySelector('[data-q=next]').disabled=n>=queue.length-1;q._measure?.();}
function setSelecting(on){selecting=on;selected.clear();root?.classList.toggle('selecting',on);if(root){root.querySelector('[data-a=select]').textContent=on?'Cancel':'Select';root.querySelectorAll('.cell').forEach(c=>{c.classList.remove('sel');c.setAttribute('aria-pressed','false');});selectionCount();}}
function selectionCount(){if(!root)return;root.querySelector('.n').textContent=selected.size+' selected';root.querySelectorAll('.selbar button').forEach(b=>b.disabled=!selected.size);root.querySelector('[data-a=remove]').textContent=filter==='trash'?'Delete':'Trash';root.querySelector('[data-a=edit]').hidden=filter==='trash';}
let backfilling=false;
// Photos imported before RAW previews were extracted have no thumbnail until edited: fill them in once.
async function backfillThumbs(ps){
  if(backfilling)return;backfilling=true;
  try{let did=false;for(const p of ps){if(p.thumb||p.thumbEdited||p.thumbTried)continue;
    const b=await getBlob(p.id);const t=b?await fileThumb(b):null;await patchPhoto(p.id,t?{thumb:t}:{thumbTried:1});did=did||!!t;}
    if(did)render();}catch(_){}finally{backfilling=false;}
}
async function render(){
  build();const generation=++renderKey,ps=await allPhotos();if(generation!==renderKey)return;
  setTimeout(()=>backfillThumbs(ps),0);
  urls.forEach(u=>URL.revokeObjectURL(u));urls=[];
  const collections=[...new Set(ps.filter(p=>!p.trashed).map(p=>p.collection).filter(Boolean))].sort();const select=root.querySelector('.collections');select.innerHTML='<option value="">All collections</option>'+collections.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');select.value=collection;
  root.querySelectorAll('[data-f]').forEach(b=>{const on=b.dataset.f===filter;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));if(on)window.phoneCentreTab?.(b.parentElement,b);});
  let list=ps.filter(p=>(filter==='trash'?!!p.trashed:!p.trashed)&&(!collection||p.collection===collection)&&p.name.toLowerCase().includes(search.toLowerCase()));
  if(filter==='edited')list=list.filter(p=>p.recipe);if(filter==='exported')list=list.filter(p=>p.exports?.some(e=>e.status!=='shared'));if(filter==='fav'||filter==='rej')list=list.filter(p=>p.flag===filter);
  const pr=prefs();list.sort(pr.sort==='name'?(a,b)=>a.name.localeCompare(b.name):pr.sort==='added'?(a,b)=>b.added-a.added:(a,b)=>(b.edited||b.added)-(a.edited||a.added));
  if(!list.length){grid.innerHTML='<div class="empty">'+(search?'No matching photos.':filter==='trash'?'Trash is empty. Removed photos stay here until you delete them.':filter==='all'?'Import photos to start. Originals stay untouched and edits save automatically.':'No photos in this view.')+'</div>';return;}
  grid.innerHTML=list.map(p=>{const t=p.thumbEdited||p.thumb,u=t?URL.createObjectURL(t):'';if(u)urls.push(u);const label=p.name+(p.recipe?', edited':'')+(p.flag==='fav'?', favourite':'')+(p.trashed?', in Trash':'');
    return '<div class="photo-tile"><button class="cell'+(selected.has(p.id)?' sel':'')+(p.flag==='rej'?' rej':'')+'" data-id="'+p.id+'" aria-label="'+esc(label)+'" aria-pressed="'+selected.has(p.id)+'">'+(u?'<img loading="lazy" src="'+u+'" alt="">':'')+'<span class="nm"><span class="fn">'+esc(p.name)+'</span>'+(pr.dates?'<span class="dt">'+esc(new Date(p.edited||p.added).toLocaleDateString())+'</span>':'')+'</span>'+(p.flag==='fav'?'<span class="fav" aria-hidden="true">♥</span>':'')+(p.recipe?'<span class="badge" aria-hidden="true">Edited</span>':'')+'</button><button class="photo-menu" data-id="'+p.id+'" aria-label="Actions for '+esc(p.name)+'">⋯</button></div>';}).join('');
}
async function selectionActions(){const ids=[...selected];if(filter==='trash'){await trashActions(ids);return;}
  UI().sheet(ids.length+' selected','<button data-k="paste">Paste selected settings</button><button data-k="fav">Favourite</button><button data-k="collection">Move to collection</button><button data-k="export">Export each photo with its own edits</button><button data-k="backup">Back up selected photos</button>',(el,close)=>el.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{close();safe(async()=>{switch(b.dataset.k){case 'paste':await pasteTo(ids);break;case 'fav':await setFlag(ids,'fav');break;case 'collection':await moveCollection(ids);break;case 'export':queue=ids;setSelecting(false);await openPhoto(ids[0]);await exportQueue();break;case 'backup':await backup(ids);break;}});}));}
function trashActions(ids){UI().sheet('Trash','<p>Originals, edits and versions are kept until you delete permanently.</p><button data-restore>Restore</button><button data-delete>Delete permanently</button>',(el,close)=>{el.querySelector('[data-restore]').onclick=()=>{close();safe(()=>restore(ids));};el.querySelector('[data-delete]').onclick=()=>{close();safe(()=>removePermanently(ids));};});}
async function backup(ids){await flush();const ps=(await allPhotos()).filter(p=>ids?ids.includes(p.id):true);if(!ps.length){toast('No photos to back up');return;}status('Preparing project…');const blob=await MobileProject.pack(ps,getBlob,(n,total)=>status('Backing up '+n+' of '+total));await MobileProject.download(blob,'Chromasmith-'+new Date().toISOString().slice(0,10)+'.chromasmith.zip');status('Project ready. Keep the ZIP to restore or continue on desktop.');}
async function restoreBackup(file){if(!file)file=await MobileProject.choose();if(!file)return;await flush();status('Checking project…');const records=await MobileProject.unpack(file);
  const additions=await Promise.all(records.map(async r=>{const i=id();return {p:{...r.photo,id:i},b:{id:i,bytes:await r.blob.arrayBuffer(),name:r.photo.name,type:r.photo.type}};}));
  await tx(['photos','blobs'],'readwrite',t=>additions.forEach(({p,b})=>{t.objectStore('photos').put(p);t.objectStore('blobs').put(b);}));
  for(const {p,b}of additions){status('Restoring thumbnails…');await patchPhoto(p.id,{thumb:await fileThumb(new Blob([b.bytes],{type:b.type}))});}filter='all';await open();status('Restored '+records.length+' photos. Existing photos were kept.');
}
async function settings(){
  const p=prefs(),ps=await allPhotos();let used='';try{const e=await navigator.storage.estimate();used=Math.round(e.usage/1048576)+' MB used';}catch(_){}
  UI().sheet('Gallery settings','<label>Text size<select data-pref="textSize"><option value="1">Standard</option><option value="1.15">Larger</option><option value="1.3">Largest</option></select></label><label><input data-haptics type="checkbox" '+(UI().pref('haptics',true)?'checked':'')+'>Haptic feedback</label><label>Gallery background<select data-pref="bg">'+Object.keys(BGS).map(k=>'<option>'+k+'</option>').join('')+'</select></label><label>Thumbnail shape<select data-pref="aspect"><option value="square">Square</option><option value="original">Original shape</option></select></label><label><input data-names type="checkbox" '+(p.names?'checked':'')+'>Show photo names</label><label><input data-dates type="checkbox" '+(p.dates?'checked':'')+'>Show dates</label><button data-k="theme">Switch '+(document.body.classList.contains('light')?'to dark':'to light')+' theme</button><button data-k="guide">Welcome guide</button><button data-k="backup">Back up gallery / continue on desktop</button><button data-k="restore">Restore project</button><button data-k="free">Move exported photos to Trash</button><button data-k="empty">Empty Trash permanently</button><p>'+ps.length+' photos · '+esc(used)+'<br>Build '+esc(BUILD)+'</p>',(el,close)=>{
    el.querySelector('[data-pref=bg]').value=p.bg;el.querySelector('[data-pref=aspect]').value=p.aspect;el.querySelector('[data-pref=textSize]').value=UI().pref('textSize',1);
    el.querySelectorAll('[data-pref]').forEach(e=>e.onchange=()=>{if(e.dataset.pref==='textSize'){UI().setPref('textSize',+e.value);document.body.style.setProperty('--phone-text-scale',e.value);}else setGalleryPref(e.dataset.pref,e.value);});
    el.querySelector('[data-haptics]').onchange=e=>UI().setPref('haptics',e.target.checked);el.querySelector('[data-dates]').onchange=e=>setGalleryPref('dates',e.target.checked);el.querySelector('[data-names]').onchange=e=>setGalleryPref('names',e.target.checked);
    el.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{close();safe(async()=>{switch(b.dataset.k){case 'theme':toggleTheme();break;case 'guide':closeGallery();chromasmithShowTour();break;case 'backup':await backup();break;case 'restore':await restoreBackup();break;case 'free':{const exported=ps.filter(p=>p.exports?.some(e=>e.status!=='shared')&&!p.trashed);if(await UI().ask('Free up space?',exported.length+' originals and their edits will move to recoverable Trash. Storage is freed only when you empty Trash.','Move to Trash'))await trash(exported.map(p=>p.id));break;}case 'empty':await removePermanently(ps.filter(p=>p.trashed).map(p=>p.id));break;}});});
  });
}
let lastReceipt=[];window.chromasmithMobileSaveReceipt=receipts=>{lastReceipt=receipts;};
window.chromasmithRecordExport=async function(version,snap,dest,context){const photoId=context?.id||openedId;if(!photoId)return;const p=await getPhoto(photoId);if(!p)return;const receipt=(context?.receipts||lastReceipt).find(r=>r.ok);if(!receipt&&typeof capNative==='function'&&capNative())return;
  await patchPhoto(photoId,{},[],[{version,recipe:b64(snap),ts:Date.now(),status:receipt?.status||'downloaded',path:receipt?.path||dest||''}]);};
window.chromasmithGetExportHistory=async()=>openedId?(await getPhoto(openedId))?.exports||[]:[];
async function exportQueue(){
  const destination=await window.chromasmithChooseExportDestination?.();if(!destination)return;await flush();
  const ids=[...queue],current=openedId;window.chromasmithMobileExportDestination=destination;
  const opts=UI().sheet('Export selected photos','<p>Each photo uses its own saved edits.</p><button data-go>Export '+ids.length+' photos</button>',(el,close)=>el.querySelector('[data-go]').onclick=()=>{close();safe(async()=>{
    window.MobileExport?.beginBatch();
    try{for(const i of ids){const p=await getPhoto(i);if(!await openPhoto(i)){window.MobileExport?.reportFailure(p?.name||'Photo','Could not open this photo. Reopen it in Gallery and try again.');continue;}lastReceipt=[];await exportFX();if(!lastReceipt.length)window.MobileExport?.reportFailure(p?.name||'Photo','Could not render this photo. Open it in Gallery and export again.');}}
    finally{await openPhoto(current);window.MobileExport?.endBatch();}
  });});return opts.closed;
}
async function open(doFlush=true){if(doFlush){await flush();await refreshThumb();}build();root.classList.add('open');document.querySelector('.fx-layout')?.setAttribute('inert','');await render();const last=openedId?{id:openedId,inEditor:false}:null;if(last)localStorage.setItem(LAST,JSON.stringify(last));}
function closeGallery(){if(!openedId){toast('Open a photo first');return;}close();}
function close(){root?.classList.remove('open');const layout=document.querySelector('.fx-layout');if(layout)layout.inert=!!UI().dialog;setSelecting(false);}
window.chromasmithOpenGallery=()=>safe(()=>open());window.chromasmithToggleLibrary=()=>root?.classList.contains('open')?closeGallery():safe(()=>open());
window.MobileLibrary={importPhotos:()=>safe(async()=>{if(!await importFromPhotos())root?.querySelector('.import-file')?.click();}),open,close,flush,isOpen:()=>!!root?.classList.contains('open'),cancelSelection:()=>{if(!selecting)return false;setSelecting(false);return true;},backup,restoreBackup,openPhoto,importFiles,getPhoto,allPhotos,getBlob,saveVersion,pasteTo,trash,restore,get isOpening(){return opening;},get currentId(){return openedId;},get queue(){return [...queue];}};
window.fxMobileBack=()=>safe(()=>UI().back());
function saveLeaving(){if(openedId&&!restoring&&!opening){capture(getUISnapshot());flush(false).catch(()=>{});}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveLeaving();});window.addEventListener('pagehide',saveLeaving);
document.addEventListener('input',e=>{if(e.target.closest?.('.fx-panel')&&!restoring&&!opening&&openedId){saveStatus('Saving…');clearTimeout(inputTimer);inputTimer=setTimeout(()=>capture(getUISnapshot()),180);}});
async function launch(){
  build();try{const j=JSON.parse(localStorage.getItem(JOURNAL)||'[]');for(const [i,v]of j){unb64(v.recipe);pending.set(i,v);}await flush(false);}catch(e){status('Pending edits need saving. Tap Retry in the editor.',true);}
  try{await navigator.storage?.persist?.();}catch(_){}
  let last;try{last=JSON.parse(localStorage.getItem(LAST)||'null');}catch(_){}
  if(last?.inEditor&&await getPhoto(last.id)){queue=[last.id];await openPhoto(last.id);}else await open(false);
}
if(document.readyState==='complete')safe(launch);else window.addEventListener('load',()=>safe(launch));
})();
