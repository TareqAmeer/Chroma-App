// Injected into the debug WebView by export_methods.mjs. No production changes.
(()=>{
  const original={process:processToCanvas,tiled:renderTiled,setImage:FXR.prototype.setImage};
  const replace=(s,a,b)=>{if(!s.includes(a))throw Error('Benchmark source anchor missing: '+a);return s.replace(a,b);};
  let direct=replace(original.tiled.toString(),'const{px}=renderer.getPixels();','/* Copy preserved WebGL canvas directly. */');
  direct=replace(direct,'rcCtx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer),rw,rh),0,0);','rcCtx.clearRect(0,0,rw,rh);rcCtx.drawImage(renderer.cv,0,0);');
  const trimmed=s=>replace(s,'const halo=Math.ceil(maxSig*3)+16;',"const halo=(!P.halation.enabled&&!P.bloom.enabled&&!(P.masks||[]).some(m=>m.crOn)&&!P.depthBlur?.enabled&&!P.tiltShift?.enabled)?16:Math.ceil(maxSig*3)+16;");
  const variants={current:original.tiled,direct:eval('('+direct+')'),halo:eval('('+trimmed(original.tiled.toString())+')'),combined:eval('('+trimmed(direct)+')')};
  const imageReuse=function(src){if(src._sceneLinearPresent)return original.setImage.call(this,src);this.usingSceneLinear=false;this.setVideoFrame(src,src.naturalWidth||src.width,src.naturalHeight||src.height);};
  const toJPEG=c=>new Promise((r,j)=>c.toBlob(b=>b?r(b):j(Error('JPEG encode failed')),'image/jpeg',.99));
  const resize=(c,w,h)=>{const o=document.createElement('canvas');o.width=w;o.height=h;const x=o.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(c,0,0,w,h);return o;};
  window.__methods={rows:[],configure(method){renderTiled=variants[method]||variants.current;FXR.prototype.setImage=(method==='texture'||method==='combined')?imageReuse:original.setImage;},async setup(){
    this.endpoint=(await Capacitor.Plugins.ExportExperiment.start()).url;
    this.source=geomCanvas(fxImages[fxCurIdx]);this.P=structuredClone(getFXParams());
    this.P.halation.enabled=this.P.bloom.enabled=this.P.grain.enabled=false;this.P.redEyeOps=[];
    this.P.adjust.enabled=true;this.P.adjust.exposure=window.__methodExposure||0;
    this.renderer=fxPrepareExportRenderer();this.w=this.source.naturalWidth||this.source.width;this.h=this.source.naturalHeight||this.source.height;
    this.reference=await this.render('current');this.jpeg=await toJPEG(this.reference);
    return {w:this.w,h:this.h,params:this.P,endpoint:this.endpoint,bytes:this.jpeg.size};
  },async render(method){
    renderTiled=variants[method]||variants.current;FXR.prototype.setImage=(method==='texture'||method==='combined')?imageReuse:original.setImage;
    const random=Math.random;Math.random=()=>.375;
    try{return await original.process(this.P,this.source,this.w,this.h,null,this.renderer);}
    finally{Math.random=random;renderTiled=original.tiled;FXR.prototype.setImage=original.setImage;}
  },async binary(body,destination='files',mode='jpeg',w=0,h=0){
    const response=await fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Mode':mode,'X-Width':String(w),'X-Height':String(h),'X-Destination':destination},body});
    if(!response.ok)throw Error('Native HTTP '+response.status);return response.json();
  },async workerJPEG(canvas){
    const t=performance.now(),bm=await createImageBitmap(canvas);
    const url=URL.createObjectURL(new Blob([`onmessage=async e=>{try{const bm=e.data,c=new OffscreenCanvas(bm.width,bm.height);c.getContext('2d').drawImage(bm,0,0);bm.close();postMessage({blob:await c.convertToBlob({type:'image/jpeg',quality:.99})});}catch(error){postMessage({error:String(error)});}}`],{type:'application/javascript'}));
    const worker=new Worker(url);
    try{return await new Promise((r,j)=>{worker.onmessage=e=>e.data.error?j(Error(e.data.error)):r(e.data.blob);worker.onerror=e=>j(Error(e.message));worker.postMessage(bm,[bm]);});}
    finally{worker.terminate();URL.revokeObjectURL(url);}
  },async run(method,run){
    const row={method,run,warmup:run===0,width:this.w,height:this.h,quality:99,exposure:this.P.adjust.exposure};let canvas,blob=this.jpeg;
    const start=performance.now();
    if(['current','direct','halo','texture','combined'].includes(method)){
      let t=performance.now();canvas=await this.render(method);row.processMs=performance.now()-t;
      t=performance.now();blob=await toJPEG(canvas);row.encodeMs=performance.now()-t;
    }else if(method==='small-after'||method==='small-before'){
      let t=performance.now();const w=2400,h=Math.round(this.h*2400/this.w);row.width=w;row.height=h;
      if(method==='small-after'){const full=await this.render('current');canvas=resize(full,w,h);full.width=full.height=0;}
      else {const small=resize(this.source,w,h);canvas=await original.process(this.P,small,w,h,null,this.renderer);small.width=small.height=0;}
      row.processMs=performance.now()-t;t=performance.now();blob=await toJPEG(canvas);row.encodeMs=performance.now()-t;
    }else if(method==='encode-main'||method==='encode-worker'){
      const t=performance.now();blob=method==='encode-worker'?await this.workerJPEG(this.reference):await toJPEG(this.reference);row.encodeMs=performance.now()-t;
    }else if(method==='encode-native'){
      const t=performance.now();const data=this.reference.getContext('2d').getImageData(0,0,this.w,this.h).data;
      row.rgbaReadMs=performance.now()-t;const transfer=performance.now();row.native=await this.binary(data,'files','rgba',this.w,this.h);row.nativeTransferEncodeSaveMs=performance.now()-transfer;
    }else if(method==='original'){blob=this.originalJPEG;row.quality=92;row.condition='No edits; preserve original JPEG bytes and original quality';}
    if(method==='cached')row.condition='An identical rendered/encoded export is already cached';
    if(method!=='encode-native'){
      const t=performance.now();
      if(method==='save-base64-files'||method==='save-base64-photos'){
        window.chromasmithMobileExportDestination=method.endsWith('photos')?'photos':'files';
        row.receipts=await capShareFiles([{content:blob,fname:'methods-'+Date.now()+'.jpg'}]);
        if(!row.receipts[0]?.ok)throw Error(JSON.stringify(row.receipts));
      }else if(method==='save-base64-direct'||method==='save-base64-native-files'){
        const bytes=new Uint8Array(await blob.arrayBuffer());let str='';for(let i=0;i<bytes.length;i+=32768)str+=String.fromCharCode(...bytes.subarray(i,i+32768));
        row.native=await Capacitor.Plugins.ExportExperiment.base64Save({data:btoa(str),destination:method==='save-base64-direct'?'photos':'files'});
      }else row.native=await this.binary(blob,method==='save-binary-photos'?'photos':'files');
      row.saveMs=performance.now()-t;row.bytes=blob.size;
    }
    row.totalMs=performance.now()-start;
    // Comparison deliberately outside timed work. No lossy JPEG hides renderer errors.
    if(canvas&&run===1&&canvas.width===this.w){
      const a=this.reference.getContext('2d',{willReadFrequently:true}).getImageData(0,0,this.w,this.h).data;
      const b=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,this.w,this.h).data;
      let sum=0,max=0,seamSum=0,seamN=0;
      for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++)for(let k=0;k<3;k++){
        const d=Math.abs(a[(y*this.w+x)*4+k]-b[(y*this.w+x)*4+k]);sum+=d;if(d>max)max=d;
        if(Math.abs(x-2048)<3||Math.abs(x-4096)<3||Math.abs(y-2048)<3){seamSum+=d;seamN++;}
      }row.pixels={mean:sum/(this.w*this.h*3),max,seamMean:seamSum/seamN};
    }
    if(canvas)canvas.width=canvas.height=0;this.rows.push(row);return row;
  }};
})();
