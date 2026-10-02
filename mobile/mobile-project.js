/* Portable offline projects: original bytes + the editor's own versioned recipes.
 * ZIP entries are stored without recompression; no image is flattened or re-encoded. */
(function(){
'use strict';
const enc=new TextEncoder(),dec=new TextDecoder();
const MAX_BYTES=1024*1024*1024;
let zipReady;
function zip(){return zipReady||(zipReady=new Promise((resolve,reject)=>{
  if(window.fflate){resolve(window.fflate);return;}
  const s=document.createElement('script');s.src='vendor/fflate/fflate.js';
  s.onload=()=>resolve(window.fflate);s.onerror=()=>{zipReady=null;reject(new Error('Project tools could not load. Try again.'));};document.head.appendChild(s);
}));}
function validateRecipe(recipe){
  const r=typeof recipe==='string'?JSON.parse(decodeURIComponent(escape(atob(recipe)))):recipe;
  if(!r||typeof r!=='object'||Array.isArray(r)||!r.sliders||!r.selects||!r.toggles)throw new Error('Invalid photo recipe');
  return r;
}
async function pack(records,readOriginal,progress=()=>{}){
  const z=await zip(),files={},photos=[];let bytes=0;
  for(let i=0;i<records.length;i++){
    const p=records[i],blob=await readOriginal(p.id);if(!blob)throw new Error('Original missing: '+p.name);
    bytes+=blob.size;if(bytes>MAX_BYTES)throw new Error('Choose fewer photos for this backup (maximum 1 GB).');
    const entry='originals/'+i;files[entry]=new Uint8Array(await blob.arrayBuffer());
    const {thumb,thumbEdited,...meta}=p;
    photos.push({...meta,versions:(p.versions||[]).map(({thumb,...v})=>v),entry});progress(i+1,records.length);
  }
  files['manifest.json']=enc.encode(JSON.stringify({format:'chromasmith-project',version:1,created:Date.now(),photos}));
  return new Blob([z.zipSync(files,{level:0})],{type:'application/zip'});
}
async function unpack(file){
  if(file.size>MAX_BYTES)throw new Error('This project is larger than the 1 GB import limit.');
  const z=await zip();let total=0,count=0;
  const files=z.unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>{
    total+=e.originalSize;if(total>MAX_BYTES||++count>10001)throw new Error('Project exceeds the restore limit.');
    return e.name==='manifest.json'||/^originals\/\d+$/.test(e.name);
  }});
  if(!files['manifest.json'])throw new Error('This is not a Chromasmith project.');
  const m=JSON.parse(dec.decode(files['manifest.json']));
  if(m.format!=='chromasmith-project'||m.version!==1||!Array.isArray(m.photos)||m.photos.length>10000)throw new Error('Unsupported project version.');
  // Validate the entire archive before any writes. Restore always adds new IDs; never replaces.
  const seen=new Set();
  return m.photos.map(p=>{
    if(!p||typeof p.name!=='string'||!/^originals\/\d+$/.test(p.entry)||!files[p.entry]||seen.has(p.entry))throw new Error('Project contains an invalid original.');
    seen.add(p.entry);if(p.recipe)validateRecipe(p.recipe);
    if(!Array.isArray(p.versions)||!Array.isArray(p.exports))throw new Error('Invalid version history.');
    p.versions.forEach(v=>{if(typeof v.name!=='string')throw new Error('Invalid version name');validateRecipe(v.recipe);});
    p.exports.forEach(v=>{if(v.recipe)validateRecipe(v.recipe);});
    const blob=new Blob([files[p.entry]],{type:typeof p.type==='string'?p.type:''});
    return {photo:{name:p.name.slice(0,512),type:blob.type,size:blob.size,added:+p.added||Date.now(),edited:+p.edited||0,
      recipe:p.recipe||null,versions:p.versions.map(v=>({name:v.name.slice(0,128),recipe:v.recipe,ts:+v.ts||Date.now()})),
      exports:p.exports,flag:['fav','rej'].includes(p.flag)?p.flag:null,collection:typeof p.collection==='string'?p.collection.slice(0,128):'',
      trashed:p.trashed?Date.now():undefined,thumb:null,thumbEdited:null},blob};
  });
}
function choose(){return new Promise(resolve=>{
  const i=document.createElement('input');i.type='file';i.accept='.zip,.chromasmith';
  i.onchange=()=>{resolve(i.files[0]||null);i.remove();};i.oncancel=()=>{resolve(null);i.remove();};i.hidden=true;document.body.appendChild(i);i.click();
});}
async function download(blob,name){
  if(typeof capNative==='function'&&capNative()){
    const {Filesystem,Share}=window.Capacitor.Plugins;
    const uri=await Filesystem.writeFile({path:'projects/'+name,data:_u8b64(new Uint8Array(await blob.arrayBuffer())),directory:'CACHE',recursive:true});
    await Share.share({files:[uri.uri],title:'Chromasmith project'});return;
  }
  const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);
}
async function openDesktop(){
  try{
    const file=await choose();if(!file)return;const records=await unpack(file);
    if(!records.length)throw new Error('This project has no photos.');
    const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    MobileUI.sheet('Open mobile project',records.map((r,i)=>'<button data-project="'+i+'">'+esc(r.photo.name)+'</button>').join(''));
    document.querySelectorAll('[data-project]').forEach(b=>b.onclick=async()=>{
      try{
        const r=records[+b.dataset.project];MobileUI.dialog?.close();
        const entry=await loadFXImages([new File([r.blob],r.photo.name,{type:r.photo.type})]);
        if(!entry)throw new Error('This photo could not be decoded.');
        if(r.photo.recipe){await applyUISnapshot(validateRecipe(r.photo.recipe));fxUpdate();}
        desktopPhoto=curItem();desktopViewingVersion=false;desktopCurrent=r.photo.recipe||getUISnapshot();
        window.chromasmithProjectVersions=r.photo.versions;
        toast('Mobile edit opened. Saved versions are in More → Mobile project versions.');
      }catch(e){toast(e.message);}
    });
  }catch(e){toast(e.message);}
}
let desktopPhoto,desktopCurrent;
function showDesktopVersions(){
  if(curItem()!==desktopPhoto){toast('Open the mobile project photo again to view its versions.');return;}
  const versions=window.chromasmithProjectVersions||[],esc=MobileUI.esc;
  MobileUI.sheet('Mobile project versions','<p>Opening a saved version keeps your current edit available here.</p><button data-current>Return to current edit</button>'+versions.map((v,i)=>'<button data-version="'+i+'">'+esc(v.name)+'</button>').join(''),(el,close)=>{
    el.querySelector('[data-current]').onclick=async()=>{await applyUISnapshot(validateRecipe(desktopCurrent));fxUpdate();desktopViewingVersion=false;close();};
    el.querySelectorAll('[data-version]').forEach(b=>b.onclick=async()=>{
      if(!desktopViewingVersion)desktopCurrent=getUISnapshot();desktopViewingVersion=true;
      await applyUISnapshot(validateRecipe(versions[+b.dataset.version].recipe));fxUpdate();fxHistoryPush();close();
    });
  });
}
let desktopViewingVersion=false;
window.MobileProject={pack,unpack,choose,download,validateRecipe,openDesktop,showDesktopVersions};
})();
