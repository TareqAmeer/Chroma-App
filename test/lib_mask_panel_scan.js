// Live Masks-panel control scanner. Plain JS source (no imports) so the SAME text runs in Playwright
// (page.evaluate) and in the real desktop app (tools/diagnostics/app_control.py run --code).
// Usage: (<this file's text>)()  -> {types:{<type>:{default:[ctl..],expanded:[ctl..]}}, create:{...}}
// A control = {id: kind|label|key, ctx: group header or 'top', vis: visible without any click}.
// "expanded" = after clicking every aria-expanded="false" toggle inside #ff-local until none remain
// (this is what makes "reachable inside a collapsed group that expands on click" a measured fact).
(async function maskPanelScan(opts){
  opts=opts||{};
  const TYPES=opts.types||['radial','linear','brush','sky','skin','coat','ai','color','lum','depth','coatEye','manual-teeth'];
  const keepGroups=localStorage.getItem('chromasmith_msk_groups2');
  const keepStyle=localStorage.getItem('chromasmith_msk_expanded');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const vis=el=>{if(!el.isConnected)return false;const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
    for(let p=el;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return false;if(p.hidden)return false;}return true;};
  const txt=e=>{let t=e;const c=e.querySelector&&e.querySelector('.msk-group-count');if(c){t=e.cloneNode(true);t.querySelector('.msk-group-count').remove();}return (t.textContent||'').replace(/\s+/g,' ').trim();};
  const labelOf=el=>{
    const row=el.closest('.fx-row');const lb=row&&row.querySelector('.fx-label');
    if(lb&&!lb.contains(el)&&txt(lb))return txt(lb).replace(/\s*(Reset|Pick)$/,'');
    return el.getAttribute('aria-label')||txt(el)||el.title||el.id||el.getAttribute('data-k')||el.type||el.tagName.toLowerCase();};
  const keyOf=el=>el.getAttribute('data-k')||el.getAttribute('data-msk-brush-slider')||el.id||((el.getAttribute('onclick')||'').match(/^\s*([A-Za-z_$][\w$]*)/)||[])[1]||'';
  const SEL='input,select,button,[role=button],[role=switch],canvas[id=msk-crv]';
  const collect=()=>{
    const root=document.getElementById('ff-local');if(!root)return[];
    const out=new Map();
    root.querySelectorAll(SEL).forEach(el=>{
      if(el.closest('#local-list')&&!el.closest('#local-list').contains(el))return;
      const inList=!!el.closest('#local-list');
      const kind=(el.tagName==='INPUT'?'input:'+(el.type||'text'):el.tagName==='BUTTON'||el.getAttribute('role')==='button'?'button':el.tagName.toLowerCase());
      const label=labelOf(el).slice(0,60);
      const grp=el.closest('.msk-group');const gh=grp&&grp.querySelector('.msk-group-hd');
      const ctx=inList?'list-row':gh?txt(gh).replace(/\d+$/,'').trim().slice(0,30):'top';
      // identity excludes label for the create-tiles/chips, whose labels are data
      let key=keyOf(el);if(/^msk-ghd-/.test(key))key='mskGroupToggle';let id=kind+'|'+label+'|'+key;
      if(inList)id='list-row|'+kind+'|'+(el.className||'').toString().split(/\s+/).filter(c=>c.startsWith('msk-li-')).join('.')+'|'+(el.getAttribute('aria-label')||'').replace(/ .*$/,'');
      const v=vis(el);const o=out.get(id);
      if(!o)out.set(id,{id,ctx,vis:v,n:1});else{o.n++;o.vis=o.vis||v;}
    });
    return[...out.values()];
  };
  const expandAll=async()=>{
    for(let i=0;i<12;i++){
      const t=[...document.querySelectorAll('#ff-local [aria-expanded="false"]')].filter(b=>vis(b)&&!b.hasAttribute('aria-haspopup'));
      if(!t.length)break;t.forEach(b=>b.click());await sleep(30);
    }
  };
  const resetOpen=()=>{try{localStorage.removeItem('chromasmith_msk_groups');localStorage.removeItem('chromasmith_msk_groups2');if(typeof mskGroupsResetDefaults==='function')mskGroupsResetDefaults();else if(typeof _mskGroupOpen!=='undefined'){Object.assign(_mskGroupOpen,{selection:true,adjust:true,adjColor:true,adjEffects:false,adjDetail:false,skin:true,coattone:false,skinAdv:false,eyepos:false});}}catch(e){}};
  const res={types:{}};
  fxSection('local');document.getElementById('tg-local')&&document.getElementById('tg-local').classList.add('on');
  const make=t=>{
    fxState.masks.length=0;mskSel=-1;
    if(t==='coatEye'){mskAdd('radial');fxState.masks[0].origin='coatEye';}
    else if(t==='manual-teeth'){mskAddTeethWhitening();}
    else mskAdd(t);
    mskSel=fxState.masks.length-1;mskRebuild();
  };
  // Conditional-state scenarios (controls that only exist once a gate/sample/target mode is set).
  const CS=[{rgb:[200,150,120],h:0.6,s:0.05,v:0.7},{rgb:[180,130,100],h:0.62,s:0.06,v:0.6}];
  const SCEN={
    'radial+colorrange':()=>{make('radial');Object.assign(fxState.masks[0],{crOn:true,crSamples:CS.map(x=>Object.assign({},x))});},
    'skin+samples':()=>{make('skin');Object.assign(fxState.masks[0],{crOn:true,crSamples:CS.map(x=>Object.assign({},x)),uH:30,uS:30});},
    'skin+swatch':()=>{make('skin');Object.assign(fxState.masks[0],{crOn:true,crSamples:CS.map(x=>Object.assign({},x)),tgtMode:'swatch'});},
    'skin+custom':()=>{make('skin');Object.assign(fxState.masks[0],{crOn:true,crSamples:CS.map(x=>Object.assign({},x)),tgtMode:'custom'});},
    'skin+ref':()=>{make('skin');Object.assign(fxState.masks[0],{crOn:true,crSamples:CS.map(x=>Object.assign({},x)),tgtMode:'ref'});},
    'coat+match':()=>{make('coat');Object.assign(fxState.masks[0],{crOn:true,crSamples:CS.map(x=>Object.assign({},x))});},
    'lum+samples':()=>{make('lum');Object.assign(fxState.masks[0],{lumSamples:[0.3,0.6]});},
    'depth+on':()=>{make('depth');fxState.masks[0].depOn=true;},
    'brush+painting':()=>{make('brush');mskPaintStop();mskPaintToggle();},
    'brush+erase':()=>{make('brush');mskPaintStop();mskPaintErase=true;mskPaintToggle();},
    'ai+prompts':()=>{make('ai');fxState.masks[0].aiPoints=[{x:.5,y:.5,l:1}];},
    'multiple':()=>{make('radial');mskAdd('linear');mskAdd('brush');mskSel=1;},
    'muted+inverted':()=>{make('radial');mskAdd('linear');mskToggleMute();mskInvert();}
  };
  const types=['none'].concat(TYPES).concat(Object.keys(SCEN));
  for(const t of types){
    try{mskPaintStop();}catch(e){}
    if(t==='none'){fxState.masks.length=0;mskSel=-1;mskRebuild();}else if(SCEN[t]){SCEN[t]();mskRebuild();}else make(t);
    resetOpen();mskRebuild();await sleep(60);
    const d=collect();
    await expandAll();await sleep(60);
    const e=collect();
    res.types[t]={mask:fxState.masks[0]?{type:fxState.masks[0].type,origin:fxState.masks[0].origin||null}:null,default:d,expanded:e};
  }
  try{mskPaintStop();}catch(e){}
  fxState.masks.length=0;mskSel=-1;mskRebuild();
  if(keepGroups==null)localStorage.removeItem('chromasmith_msk_groups2');else localStorage.setItem('chromasmith_msk_groups2',keepGroups);
  return res;
})
