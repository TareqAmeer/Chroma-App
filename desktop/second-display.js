/* Read-only receiver for the Editor's second-display window. */
(() => {
  const api=window.__TAURI__;
  const photo=document.getElementById('photo'),empty=document.getElementById('empty'),grid=document.getElementById('grid');
  if(!api?.event?.listen){empty.textContent='Second display requires the Chromasmith desktop app.';return;}
  let mode='photo';
  const button=document.getElementById('mode');
  const setMode=next=>{mode=next==='grid'?'grid':'photo';button.textContent=mode==='grid'?'Show photo':'Show grid';button.setAttribute('aria-pressed',String(mode==='grid'));api.event.emit('chromasmith-second-display-mode',{mode});};
  button.addEventListener('click',()=>setMode(mode==='grid'?'photo':'grid'));
  (async()=>{
    await api.event.listen('chromasmith-second-display-frame',event=>{
      const frame=event?.payload;
      if(!frame||!['photo','grid','empty'].includes(frame.mode))return;
      if(frame.mode==='empty'){photo.hidden=true;grid.hidden=true;empty.hidden=false;empty.textContent=frame.message||'No still photo selected.';document.getElementById('name').textContent='Second display';document.getElementById('size').textContent='';return;}
      if(frame.mode==='photo'){
        if(typeof frame.dataUrl!=='string'||!frame.dataUrl.startsWith('data:image/jpeg;base64,'))return;
        empty.hidden=true;photo.src=frame.dataUrl;photo.hidden=false;grid.hidden=true;
        document.getElementById('name').textContent=frame.name||'Current photo';
        document.getElementById('size').textContent=frame.width&&frame.height?`${frame.width} × ${frame.height}`:'';
        return;
      }
      if(!Array.isArray(frame.tiles)||frame.tiles.length>16||frame.tiles.some(t=>!t||typeof t.id!=='string'||typeof t.name!=='string'||typeof t.dataUrl!=='string'||!t.dataUrl.startsWith('data:image/jpeg;base64,')))return;
      photo.hidden=true;grid.replaceChildren();
      for(const tile of frame.tiles){const card=document.createElement('article'),img=document.createElement('img'),label=document.createElement('span');card.className='tile';img.src=tile.dataUrl;img.alt=tile.name;label.textContent=tile.name;card.dataset.photoId=tile.id;card.append(img,label);grid.append(card);}
      const total=Math.max(frame.tiles.length,Number.isFinite(frame.total)?frame.total:frame.tiles.length);
      document.getElementById('name').textContent=frame.tiles.length?(total>frame.tiles.length?`${frame.tiles.length} of ${total} selected photos`:`${frame.tiles.length} selected photos`):'No photos selected';
      empty.hidden=frame.tiles.length>0;empty.textContent='No photos selected for grid display.';grid.hidden=frame.tiles.length===0;
      document.getElementById('size').textContent='';
    });
    await api.event.emit('chromasmith-second-display-ready');
    await api.event.emit('chromasmith-second-display-mode',{mode});
  })().catch(error=>{empty.textContent=`Could not connect to the editor: ${String(error)}`;});
})();
