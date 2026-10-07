/* CHR-246 local erase: immutable sources, reviewed candidates, portable hash refs. */
(() => {
  const invoke=(cmd,args)=>window.__TAURI__.core.invoke(cmd,args);
  const native=()=>!!window.__TAURI__?.core;
  const sourcePath=it=>it.path||(window.chromasmithGetOpenedPaths?.()||[])[fxImages.indexOf(it)];
  let drawing=false,strokes=[],activeStroke=null,owner=null,currentJob=null;
  const imageFromPath=async path=>{const image=new Image();image.crossOrigin='anonymous';image.src=window.__TAURI__.core.convertFileSrc(path);await image.decode();return image;};
  window.chromasmithInpaintHydrate=async it=>{
    const refs=(it.inpaint||[]).filter(p=>p.enabled!==false);if(!refs.length){it._inpaintError=null;return;}
    if(!native())throw Error('Accepted local erase repairs require the desktop app and their source assets');
    const path=sourcePath(it);if(!path)throw Error('Reopen the source photo from Library to restore its accepted repairs');
    const cache=it._inpaintImages||(it._inpaintImages=new Map());it._inpaintLoading=true;it._inpaintError=null;
    try{for(const ref of refs){const assetPath=await invoke('inpaint_resolve',{sourcePath:path,patch:ref});if(!cache.has(ref.asset))cache.set(ref.asset,await imageFromPath(assetPath));}}
    catch(e){it._inpaintError=String(e.message||e);throw e;}
    finally{it._inpaintLoading=false;}
  };
  window.chromasmithInpaintApply=(img,it)=>{
    const refs=(it.inpaint||[]).filter(p=>p.enabled!==false);if(!refs.length)return img;
    if(it._inpaintError)throw Error(it._inpaintError);
    const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    for(const ref of refs){const patch=it._inpaintImages?.get(ref.asset);if(!patch)throw Error('Accepted repair asset not loaded; restore this photo’s .chroma-assets folder');if(Math.abs(ref.width/ref.height-w/h)>.01)throw Error('Accepted repair source dimensions changed');ctx.drawImage(patch,0,0,w,h);}
    return c;
  };
  const refresh=()=>{window.chromasmithInpaintSync?.();if(typeof updateWork==='function'){updateWork();renderPreview();}};
  window.chromasmithInpaintRestore=it=>{
    const promise=window.chromasmithInpaintHydrate(it);it._inpaintPromise=promise;
    promise.then(()=>{if(curItem()===it)refresh();}).catch(e=>{log('Accepted erase repair cannot be restored: '+String(e.message||e),'err');toast('Accepted repair unavailable: '+String(e.message||e));}).finally(()=>{if(it._inpaintPromise===promise)it._inpaintPromise=null;});return promise;
  };
  const overlay=()=>{
    let svg=document.getElementById('fx-inpaint-overlay');if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='fx-inpaint-overlay';svg.setAttribute('viewBox','0 0 1 1');svg.setAttribute('preserveAspectRatio','none');svg.style.cssText='position:absolute;pointer-events:none;z-index:5;overflow:visible';document.getElementById('fx-zoom-wrap')?.append(svg);}
    svg.style.display=drawing&&curItem()===owner?'block':'none';if(!drawing)return;
    const box=mskOverlayBox();if(!box)return;Object.assign(svg.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
    svg.innerHTML=strokes.map(s=>`<polyline points="${s.pts.map(q=>{const p=_healFwd(q[0],q[1]);return p.join(',');}).join(' ')}" fill="none" stroke="rgba(255,80,80,.65)" stroke-linecap="round" stroke-linejoin="round" stroke-width="${s.r*2}"/>`).join('');
  };
  window.chromasmithInpaintDraw=async()=>{
    try{if(!native())throw Error('Local AI erase is available in the desktop app');const it=curItem();if(!it)throw Error('Open a source photo first');if(!sourcePath(it)||it.offlinePreview)throw Error('Open an online full-quality source photo from Library');await window.chromasmithEnsureFullQuality?.();if(it._rawHalf)await fxPromoteWebRaw(it);if(curItem()!==it)return;owner=it;drawing=!drawing;activeStroke=null;strokes=[];if(healMode)healToggle();if(cropMode)cropExit();if(fxLoupe)toggleLoupe();window.chromasmithInpaintSync();overlay();toast(drawing?'Brush the object to erase, then Generate candidates':'Erase mask cancelled');}catch(e){toast(String(e.message||e));}
  };
  document.getElementById('fx-wrap')?.addEventListener('pointerdown',e=>{
    if(!drawing||curItem()!==owner||!['fx-canvas','fx-canvas-bd'].includes(e.target.id))return;
    const p=_healPointToSource(e);if(!p)return;e.preventDefault();e.stopImmediatePropagation();
    activeStroke={r:Number(document.getElementById('sl-inpaint-size').value)/100,pts:[[p.nx,p.ny]]};strokes.push(activeStroke);e.target.setPointerCapture(e.pointerId);overlay();
  },true);
  document.getElementById('fx-wrap')?.addEventListener('pointermove',e=>{if(!activeStroke||!drawing)return;const p=_healPointToSource(e);if(p){activeStroke.pts.push([p.nx,p.ny]);overlay();}},true);
  document.getElementById('fx-wrap')?.addEventListener('pointerup',()=>{activeStroke=null;window.chromasmithInpaintSync();},true);
  const maskFor=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.strokeStyle=x.fillStyle='#000';x.lineCap=x.lineJoin='round';for(const s of strokes){x.lineWidth=s.r*Math.max(w,h)*2;x.beginPath();x.moveTo(s.pts[0][0]*w,s.pts[0][1]*h);for(const q of s.pts)x.lineTo(q[0]*w,q[1]*h);x.stroke();x.beginPath();x.arc(s.pts[0][0]*w,s.pts[0][1]*h,x.lineWidth/2,0,Math.PI*2);x.fill();}const data=x.getImageData(0,0,w,h).data;return Uint8Array.from({length:w*h},(_,i)=>data[i*4]<128?0:255);};
  window.chromasmithInpaintGenerate=async()=>{
    if(!drawing||!strokes.length||curItem()!==owner)return;const it=owner;
    try{
      if(!await invoke('inpaint_model_status')){
        if(!await confirmModal('Install the MIT-licensed MI-GAN local erase model (28 MB)? Only model weights download; your photos stay on this computer.','Install model'))return;
        const button=document.getElementById('btn-inpaint-generate');button.disabled=true;button.textContent='Installing model…';await invoke('inpaint_model_install');button.textContent='Generate candidates';
      }
      const full=it.fullImg||it.img;if(it._rawHalf||it.offlinePreview)throw Error('A full-resolution source is required');await window.chromasmithInpaintHydrate(it);
      const src=window.chromasmithInpaintApply(healApply(full,it.heal),it),w=src.naturalWidth||src.width,h=src.naturalHeight||src.height;
      const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(src,0,0);const rgba=c.getContext('2d').getImageData(0,0,w,h).data,mask=maskFor(w,h);
      const json=new TextEncoder().encode(JSON.stringify({width:w,height:h,sourcePath:sourcePath(it)}));const body=new Uint8Array(4+json.length+rgba.length+mask.length);new DataView(body.buffer).setUint32(0,json.length,true);body.set(json,4);body.set(rgba,4+json.length);body.set(mask,4+json.length+rgba.length);
      let job=await invoke('inpaint_start',body);currentJob=job.id;drawing=false;overlay();window.chromasmithInpaintSync();
      const d=document.createElement('dialog');d.id='inpaint-candidate-review';d.setAttribute('aria-labelledby','inpaint-review-title');d.style.cssText='background:var(--bg);color:var(--txt);border:1px solid var(--bdr);padding:18px;width:900px;max-width:94vw;max-height:90vh;overflow:auto';d.innerHTML='<h3 id="inpaint-review-title">Review local erase candidates</h3><p data-progress></p><div data-candidates style="display:flex;gap:12px;flex-wrap:wrap"></div><p>Different mask context creates alternatives. Check each repair at 100%; Keep stores the reviewed pixels. Export reuses that asset without inference.</p><button class="btn bgh" data-cancel>Cancel after current inference</button><button class="btn bgh" data-discard>Discard</button>';
      d.querySelector('[data-cancel]').onclick=()=>invoke('inpaint_cancel',{id:job.id});d.querySelector('[data-discard]').onclick=()=>{invoke('inpaint_cancel',{id:job.id}).catch(()=>{});d.close();};d.addEventListener('close',()=>{currentJob=null;d.remove();window.chromasmithInpaintSync();});document.body.append(d);d.showModal();
      const shown=new Set();while(d.open){job=await invoke('inpaint_job',{id:job.id});d.querySelector('[data-progress]').textContent=`${job.done}/${job.total} candidates · ${job.phase}${job.error?' · '+job.error:''}`;
        for(const candidate of job.candidates){if(shown.has(candidate.index))continue;shown.add(candidate.index);const card=document.createElement('div');card.style.cssText='flex:1;min-width:220px';const img=await imageFromPath(candidate.path);const composite=document.createElement('canvas');composite.width=w;composite.height=h;composite.getContext('2d').drawImage(src,0,0);composite.getContext('2d').drawImage(img,0,0);const preview=new Image();preview.src=composite.toDataURL('image/png');preview.style.cssText='max-width:100%;cursor:zoom-in';preview.alt='Local erase candidate '+(candidate.index+1);preview.onclick=()=>{const zoom=document.createElement('dialog');zoom.style.cssText='max-width:95vw;max-height:90vh;overflow:auto;background:var(--bg);color:var(--txt)';zoom.innerHTML='<button class="btn bgh">Close 100% view</button>';const detail=new Image();detail.src=preview.src;detail.style.cssText='max-width:none;width:'+w+'px;height:'+h+'px';zoom.append(detail);zoom.querySelector('button').onclick=()=>zoom.close();zoom.addEventListener('close',()=>zoom.remove());document.body.append(zoom);zoom.showModal();};card.append(preview);const keep=document.createElement('button');keep.className='btn bgh';keep.textContent='Keep candidate '+(candidate.index+1);keep.disabled=job.phase!=='review';keep.dataset.candidate=candidate.index;keep.onclick=async()=>{try{if(curItem()!==it)throw Error('Source photo changed; reopen review on its original photo');const patch=await invoke('inpaint_accept',{id:job.id,index:candidate.index});it.inpaint=[...(it.inpaint||[]),patch];await window.chromasmithInpaintHydrate(it);refresh();fxHistoryPush();d.close();}catch(e){toast(String(e.message||e));}};card.append(keep);d.querySelector('[data-candidates]').append(card);composite.width=composite.height=0;}
        d.querySelectorAll('[data-candidate]').forEach(b=>b.disabled=job.phase!=='review');if(job.phase!=='working'){d.querySelector('[data-cancel]').disabled=true;if(job.phase==='review'&&job.candidates.length<3)d.querySelector('[data-progress]').textContent+=' · duplicate outputs omitted';break;}await new Promise(r=>setTimeout(r,200));
      }
    }catch(e){toast('Local erase failed: '+String(e.message||e));}finally{const button=document.getElementById('btn-inpaint-generate');if(button)button.textContent='Generate candidates';window.chromasmithInpaintSync();}
  };
  window.chromasmithInpaintSync=()=>{
    const panel=document.getElementById('inpaint-accepted');if(!panel)return;const it=curItem(),refs=it?.inpaint||[];if(drawing&&owner!==it){drawing=false;strokes=[];activeStroke=null;overlay();}panel.replaceChildren();
    refs.forEach((p,index)=>{const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;margin:6px 0';const toggle=document.createElement('button');toggle.className='btn bgh';toggle.textContent=(p.enabled===false?'Show':'Hide')+' repair '+(index+1);toggle.onclick=()=>{p.enabled=p.enabled===false;window.chromasmithInpaintRestore(it).then(()=>{refresh();fxHistoryPush();}).catch(()=>{});};const remove=document.createElement('button');remove.className='btn bgh';remove.textContent='Remove';remove.onclick=()=>{it.inpaint.splice(index,1);it._inpaintError=null;refresh();fxHistoryPush();};row.append(toggle,remove);panel.append(row);});
    if(refs.length){const exportButton=document.createElement('button');exportButton.className='btn bgh';exportButton.textContent='Export portable repaired photo…';exportButton.onclick=async()=>{try{const destination=await invoke('plugin:dialog|open',{options:{directory:true,multiple:false,title:'Choose destination for source, recipe and repair assets'}});if(!destination)return;const result=await invoke('inpaint_export_bundle',{sourcePath:sourcePath(it),patches:it.inpaint,destination,recipe:snapshotToB64(getUISnapshot())});toast('Portable photo, sidecar and accepted assets saved to '+result);}catch(e){toast(String(e.message||e));}};panel.append(exportButton);}
    const draw=document.getElementById('btn-inpaint-draw'),gen=document.getElementById('btn-inpaint-generate');if(draw){draw.textContent=drawing?'Cancel erase mask':'Brush object to erase';draw.disabled=!!currentJob;}if(gen)gen.disabled=!!currentJob||!drawing||!strokes.length;
  };
  window.chromasmithInpaintSync();
})();
