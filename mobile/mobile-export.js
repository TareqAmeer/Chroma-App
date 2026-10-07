/* Native save receipts. Sharing confirms handoff only, never a save to Photos. */
(function(){
'use strict';
let last=[],retryItems=[],lastDestination='photos',sheetPending=false,batch=false,batchReceipts=[],batchRetries=[];
const native=()=>typeof capNative==='function'&&capNative();
function choose(){return new Promise(resolve=>{
  let value=null;const s=MobileUI.sheet('Export destination','<button data-dest="photos">Save to Photos · Chromasmith album</button><button data-dest="files">Save to Files · Documents/Chromasmith</button><button data-dest="share">Share · choose another app</button><p>Sharing hands files to another app. It does not confirm they were saved.</p>',(el,close)=>el.querySelectorAll('[data-dest]').forEach(b=>b.onclick=()=>{value=b.dataset.dest;close();}));
  s.closed.then(()=>resolve(value));
});}
window.chromasmithChooseExportDestination=choose;
window.fxMobileExportSheet=function(){
  if(!fxImages.length){toast('Open a photo first');return;}
  const s=MobileUI.sheet('Export photo','<div class="mm-export"><label>Destination<select data-destination><option value="photos">Photos · Chromasmith album</option><option value="files">Files · Documents/Chromasmith</option><option value="share">Share</option></select></label><div data-presets></div><div data-options></div><button data-go>Export photo</button><p>Sharing hands the file to another app; a save is not confirmed.</p></div>',(el,close)=>{
    const root=el.querySelector('.mm-export'),selector=el.querySelector('[data-destination]');
    selector.value=MobileUI.pref('exportDestination','photos');window.chromasmithMobileExportDestination=selector.value;
    selector.onchange=()=>{window.chromasmithMobileExportDestination=selector.value;MobileUI.setPref('exportDestination',selector.value);};
    csExportPresets(el.querySelector('[data-presets]'));
    el.querySelectorAll('.mm-presets button').forEach(b=>{if(b.textContent==='Original')b.textContent='Full resolution';});
    for(const [label,id]of [['Size','sel-exp-size'],['Format','sel-exp-fmt']]){
      const src=document.getElementById(id),row=document.createElement('label');row.textContent=label;
      const select=document.createElement('select');select.innerHTML=src.innerHTML;select.value=src.value;
      select.setAttribute('aria-label',label);select.onchange=()=>{src.value=select.value;src.dispatchEvent(new Event('change',{bubbles:true}));};row.appendChild(select);el.querySelector('[data-options]').appendChild(row);
    }
    const q=document.getElementById('sl-exp-q'),row=document.createElement('label');row.textContent='Quality';
    const range=document.createElement('input');range.type='range';range.min=q.min;range.max=q.max;range.value=q.value;range.setAttribute('aria-label','Export quality');
    const out=document.createElement('output');out.textContent=q.value;range.oninput=()=>{q.value=range.value;q.dispatchEvent(new Event('input',{bubbles:true}));out.textContent=q.value;};row.append(range,out);el.querySelector('[data-options]').appendChild(row);csExportEstimate(root);
    el.querySelector('[data-go]').onclick=async()=>{try{await window.MobileLibrary?.flush();close();await exportFX();}catch(e){toast(e.message);}};
  });return s;
};
function androidPhotos(){return window.Capacitor?.getPlatform?.()==='android';}
async function prepareAndroidPhotos(checkOnly=false){
  const plugin=window.Capacitor?.Plugins?.PhotoExport;
  if(!plugin?.prepare)throw new Error('Update the Android app to save photos in permanent storage.');
  const result=await plugin.prepare({checkOnly});
  if(!result.persistent&&!checkOnly)throw new Error('Permanent Photos storage is unavailable.');
  if(result.failed>0&&!checkOnly)throw new Error('Some earlier exports could not be preserved. Check free storage and retry before uninstalling.');
  return result;
}
// Preserve old app-folder exports on upgrade without asking for unrelated media access.
if(androidPhotos())prepareAndroidPhotos(true).then(result=>{
  if(result.failed>0||result.needsPermission)window.toast?.('Earlier exports need storage access or free space to be preserved. Export again before uninstalling.');
  else if(result.migrated>0)window.toast?.('Earlier exports moved to permanent media storage.');
}).catch(error=>console.warn('Earlier export preservation:',error.message));
let binaryPhotoBusy=false;
async function binaryPhotoSave(content,fname){
  const bridge=window.ChromaPhotoExport;
  if(!bridge||typeof bridge.postMessage!=='function'||typeof content==='string')return null;
  const bytes=ArrayBuffer.isView(content)?new Uint8Array(content.buffer,content.byteOffset,content.byteLength):new Uint8Array(content);
  if(bytes.length<4||bytes.length>64*1024*1024||bytes[0]!==255||bytes[1]!==216||!(/\.jpe?g$/i.test(fname)))return null;
  if(binaryPhotoBusy)throw new Error("A photo save is already running");
  const buffer=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.slice().buffer;
  const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2);
  binaryPhotoBusy=true;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(async()=>{
      // A busy WebView can deliver its timer before an already completed native
      // acknowledgement. Confirm that write before showing a retryable failure.
      let checkTimer;
      try{
        const plugin=window.Capacitor?.Plugins?.PhotoExport;
        if(plugin?.status){
          const saved=await Promise.race([plugin.status({id}),new Promise((_,reject)=>{checkTimer=setTimeout(()=>reject(new Error('Save status unavailable')),2500);})]);
          if(saved.status==='saved'){finish(null,saved.path);return;}
          if(saved.status==='error'){finish(new Error(saved.error||'Photo save failed'));return;}
        }
      }catch(_){}finally{if(checkTimer)clearTimeout(checkTimer);}
      finish(new Error('Photo save did not finish. Check the album before retrying.'));
    },30000);
    let finished=false;
    const finish=(error,path)=>{if(finished)return;finished=true;clearTimeout(timer);binaryPhotoBusy=false;bridge.onmessage=null;error?reject(error):resolve({path});};
    bridge.onmessage=event=>{
      try{
        const message=JSON.parse(event.data);if(message.id!==id)return;
        if(message.status==='ready')bridge.postMessage(buffer);
        else if(message.status==='saved')finish(null,message.path);
        else if(message.status==='error')finish(new Error(message.error||'Photo save failed'));
      }catch(error){finish(error);}
    };
    try{bridge.postMessage(JSON.stringify({id,name:String(fname).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_'),size:bytes.length}));}
    catch(error){finish(error);}
  });
}
async function save(items,destination){
  const {Filesystem,Share,Media}=window.Capacitor.Plugins,receipts=[];
  for(const item of items){
    const receipt={ok:false,fname:item.fname,status:'failed',path:'',err:''};
    try{
      const content=item.content instanceof Blob?await item.content.arrayBuffer():item.content;
      if(destination==='photos'){
        if(androidPhotos())await prepareAndroidPhotos();
        const saved=await binaryPhotoSave(content,item.fname);
        if(saved){receipt.ok=true;receipt.status='saved';receipt.path='Photos › Chromasmith';receipt.uri=saved.path;receipts.push(receipt);continue;}
      }
      const data=typeof content==='string'?btoa(unescape(encodeURIComponent(content))):_u8b64(ArrayBuffer.isView(content)?new Uint8Array(content.buffer,content.byteOffset,content.byteLength):new Uint8Array(content));
      if(destination==='photos-adjustment'){
        const assetIdentifier=item.context?.photosAssetIdentifier,photoPair=window.Capacitor.Plugins.PhotoPair;
        if(!assetIdentifier||!photoPair?.saveAdjustment)throw new Error('The Photos asset could not be identified. Re-import it from Photos and try again.');
        const cachePath='export/'+String(item.fname).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');let tempUri='';
        try{
          const staged=await Filesystem.writeFile({path:cachePath,data,directory:'CACHE',recursive:true});tempUri=staged.uri;
          await photoPair.saveAdjustment({assetIdentifier,renderedPath:tempUri,recipeJSON:JSON.stringify(item.context.snap)});
          receipt.ok=true;receipt.status='updated-source';receipt.path='Photos · original preserved';
        }finally{if(tempUri)try{await Filesystem.deleteFile({path:cachePath,directory:'CACHE'});}catch(_){}}
      }else if(destination==='files'){
        const filename=String(item.fname).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_'),dot=filename.lastIndexOf('.'),base=dot>0?filename.slice(0,dot):filename,ext=dot>0?filename.slice(dot):'';
        let path;
        // Filesystem.writeFile replaces an existing file. Choose a free name first, so
        // repeated exports and different photos with the same name retain both outputs.
        for(let n=1;n<=10000;n++){
          path='Chromasmith/'+base+(n===1?'':' ('+n+')')+ext;
          try{await Filesystem.stat({path,directory:'DOCUMENTS'});}
          catch(e){if(e.code==='OS-PLUG-FILE-0008'||e.code==='ENOENT'||/not exist|not found|no such file/i.test(e.message||''))break;throw e;}
          if(n===10000)throw new Error('Too many exports use this filename. Choose another name.');
        }
        const r=await Filesystem.writeFile({path,data,directory:'DOCUMENTS',recursive:true});receipt.ok=true;receipt.status='saved';receipt.path=r.uri;
      }else{
        const cachePath='export/'+(typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2))+'-'+String(item.fname).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
        let staged=false;
        try{
          const r=await Filesystem.writeFile({path:cachePath,data,directory:'CACHE',recursive:true});staged=true;
          if(destination==='share'){
            await Share.share({files:[r.uri],title:'Chromasmith export'});receipt.ok=true;receipt.status='shared';receipt.path=r.uri;
          }else if(androidPhotos()){
            const saved=await window.Capacitor.Plugins.PhotoExport.savePhoto({path:r.uri,name:item.fname});
            if(!saved.persistent)throw new Error('Permanent Photos storage was not confirmed.');
            receipt.ok=true;receipt.status='saved';receipt.path='Photos › Chromasmith';receipt.uri=saved.path;
          }else{
            if(!Media)throw new Error('Photos plugin is unavailable. Choose Files or Share.');
            const album=await capAlbumId();await Media.savePhoto({path:r.uri,albumIdentifier:album,fileName:item.fname.replace(/\.[^.]+$/,'')});receipt.ok=true;receipt.status='saved';receipt.path='Photos › Chromasmith';
          }
        }finally{if(staged&&destination!=='share')try{await Filesystem.deleteFile({path:cachePath,directory:'CACHE'});}catch(_){}}

      }
    }catch(e){receipt.err=/cancel|dismiss|abort/i.test(e.message||'')?(destination==='share'?'Sharing cancelled':'Save cancelled'):/permission|denied|authoriz/i.test(e.message||'')?(destination==='photos'?'Photos access was denied. Allow access in device Settings, or choose Files.':'Files access was denied. Choose another destination.'):String(e.message||e);}
    receipts.push(receipt);
  }
  return receipts;
}
window.capShareFiles=async function(items){
  const destination=window.chromasmithMobileExportDestination||'photos';
  lastDestination=destination;
  const context={id:window.MobileLibrary?.currentId,snap:getUISnapshot(),version:fxVersion.toFixed(1),photosAssetIdentifier:window.chromasmithMobilePhotoAdjustmentAsset||null};
  const contextualItems=items.map(item=>({...item,context}));last=await save(contextualItems,destination);retryItems=contextualItems.filter((_,i)=>!last[i].ok);sheetPending=true;
  if(batch){batchReceipts.push(...last);batchRetries.push(...retryItems);}
  window.chromasmithMobileSaveReceipt?.(last);return last;
};
window.chromasmithShowMobileExportResult=function(){
  if(!native()||!sheetPending||batch)return;sheetPending=false;
  const results=[...last];const failed=results.filter(r=>!r.ok);
  const content=results.map(r=>'<p><b>'+MobileUI.esc(r.fname)+'</b><br>'+MobileUI.esc(r.ok?(r.status==='shared'?'Handed to share sheet — save not confirmed':'Saved to '+r.path):r.err)+'</p>').join('')+(retryItems.length?'<button data-retry>Retry failed files</button><button data-files>Save failed files to Files instead</button>':'');
  MobileUI.sheet('Export results',content,(el,close)=>{
    const retry=async destination=>{close();const items=[...retryItems];last=await save(items,destination);retryItems=items.filter((_,i)=>!last[i].ok);
      for(let i=0;i<items.length;i++){const c=items[i].context;if(last[i].ok&&c)await window.chromasmithRecordExport?.(c.version,c.snap,last[i].path,{id:c.id,receipts:[last[i]]});}
      window.chromasmithMobileSaveReceipt?.(last);sheetPending=true;window.chromasmithShowMobileExportResult();};
    el.querySelector('[data-retry]')?.addEventListener('click',()=>retry(lastDestination==='photos-adjustment'?lastDestination:(window.chromasmithMobileExportDestination||'photos')).catch(e=>toast(e.message)));
    el.querySelector('[data-files]')?.addEventListener('click',()=>retry('files').catch(e=>toast(e.message)));
  });
};
window.MobileExport={beginBatch(){batch=true;batchReceipts=[];batchRetries=[];},reportFailure(fname,err){batchReceipts.push({fname,err,ok:false,status:'failed'});},endBatch(){batch=false;last=batchReceipts;retryItems=batchRetries;sheetPending=last.length>0;window.chromasmithShowMobileExportResult();}};
})();
