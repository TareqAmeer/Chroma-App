/* Read-only receiver for the Editor's second-display window. */
(() => {
  const api=window.__TAURI__;
  const photo=document.getElementById('photo'),empty=document.getElementById('empty');
  if(!api?.event?.listen){empty.textContent='Second display requires the Chromasmith desktop app.';return;}
  (async()=>{
    await api.event.listen('chromasmith-second-display-frame',event=>{
      const frame=event?.payload;
      if(!frame||typeof frame.dataUrl!=='string'||!frame.dataUrl.startsWith('data:image/jpeg;base64,'))return;
      photo.src=frame.dataUrl;photo.hidden=false;empty.hidden=true;
      document.getElementById('name').textContent=frame.name||'Current photo';
      document.getElementById('size').textContent=frame.width&&frame.height?`${frame.width} × ${frame.height}`:'';
    });
    await api.event.emit('chromasmith-second-display-ready');
  })().catch(error=>{empty.textContent=`Could not connect to the editor: ${String(error)}`;});
})();
