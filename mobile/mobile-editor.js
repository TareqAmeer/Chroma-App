/* Mobile interaction layer. Rendering, masks, recipes and export stay in the shared editor. */
(function(){
'use strict';
const $=s=>document.querySelector(s),mob=()=>document.body.classList.contains('mobile-fx');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pref=(k,d)=>{try{return JSON.parse(localStorage.getItem('cs-phone-'+k))??d;}catch(_){return d;}};
const setPref=(k,v)=>localStorage.setItem('cs-phone-'+k,JSON.stringify(v));
let activeDialog=null;
function sheet(title,html,setup){
  if(activeDialog)activeDialog.close();
  const focus=document.activeElement,ov=document.createElement('div');ov.className='phone-dialog';
  ov.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="phone-dialog-title"><header><h2 id="phone-dialog-title">'+esc(title)+'</h2><button class="phone-close" aria-label="Close">×</button></header><div class="phone-dialog-content">'+html+'</div></section>';
  document.body.appendChild(ov);
  const underneath=[...document.body.children].filter(e=>e!==ov&&!['SCRIPT','STYLE','LINK'].includes(e.tagName));
  const previous=underneath.map(e=>[e,e.inert]);underneath.forEach(e=>e.inert=true);
  let dismiss;
  const closed=new Promise(resolve=>dismiss=resolve);
  const close=()=>{if(!ov.isConnected)return;ov.remove();previous.forEach(([e,inert])=>e.inert=inert);if(window.MobileLibrary){const layout=$('.fx-layout');if(layout)layout.inert=MobileLibrary.isOpen();}if(activeDialog?.el===ov)activeDialog=null;focus?.focus?.();dismiss();};
  const key=e=>{
    // Inert backgrounds do not disable document-level editor shortcuts. Keep keyboard
    // events inside the dialog so Undo, tool shortcuts and Escape cannot edit behind it.
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.key!=='Tab')return;
    const a=[...ov.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(e=>!e.disabled&&e.offsetParent!==null);
    const first=a[0],last=a.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  };
  ov.onclick=e=>{if(e.target===ov||e.target.closest('.phone-close'))close();};ov.addEventListener('keydown',key);
  activeDialog={el:ov,close,closed};setup?.(ov,close);
  if(!ov.contains(document.activeElement))// Focus the close button, never a select: focusing one pops its picker open on phones.
  (ov.querySelector('.phone-close')||ov.querySelector('.phone-dialog-content button')||ov.querySelector('button'))?.focus();
  return {el:ov,close,closed};
}
async function ask(title,text,action='Continue'){
  let answer=false;const s=sheet(title,'<p>'+esc(text)+'</p><div class="phone-actions"><button data-answer="yes">'+esc(action)+'</button><button data-answer="no">Cancel</button></div>',(el,close)=>{
    el.querySelector('[data-answer=yes]').onclick=()=>{answer=true;close();};el.querySelector('[data-answer=no]').onclick=close;
  });await s.closed;return answer;
}
async function name(title,initial=''){
  let result=null;const s=sheet(title,'<label>Name<input id="phone-name" maxlength="128" value="'+esc(initial)+'" autocomplete="off"></label><button data-save>Save</button>',(el,close)=>{
    const i=el.querySelector('input');const save=()=>{if(i.value.trim()){result=i.value.trim();close();}};el.querySelector('[data-save]').onclick=save;i.onkeydown=e=>{if(e.key==='Enter')save();};i.focus();i.select();
  });await s.closed;return result;
}
async function back(){
  if(activeDialog){activeDialog.close();return true;}
  for(const id of ['fx-more-menu','cs-modal-ov']){const e=document.getElementById(id);if(e){e.remove();return true;}}
  if(window.MobileLibrary?.isOpen()){
    if(window.MobileLibrary.cancelSelection())return true;
    return false;
  }
  if(document.body.classList.contains('tools-open')){fxToolsClose();return true;}
  if(document.body.classList.contains('sheet-open')){fxSheetClose();return true;}
  if(window.MobileLibrary){await MobileLibrary.open();return true;}
  return false;
}
window.MobileUI={sheet,ask,name,esc,pref,setPref,back,get dialog(){return activeDialog;}};
const more0=window.fxMoreMenu;window.fxMoreMenu=function(){
  if(!mob())return more0.apply(this,arguments);
  if(activeDialog?.el.querySelector('h2')?.textContent==='More'){activeDialog.close();return;}
  more0.apply(this,arguments);const old=$('#fx-more-menu'),content=old?.querySelector('.mm-sheet');if(!content)return;
  const buttons=[...content.children];old.remove();const s=sheet('More','');
  const host=s.el.querySelector('.phone-dialog-content');host.append(...buttons);
  host.addEventListener('click',e=>{if(e.target.closest('button'))s.close();},true);
};
const hapt0=window.hapt;window.hapt=function(){if(!pref('haptics',true))return;return hapt0?.apply(this,arguments);};
// A labelled alternative to every photo gesture. Swipe editing is opt-in for this session.
window.csSwipeAdjust=false;
function compare(v){fxCompare=v;renderPreview();syncCompare();}
function syncCompare(){
  const b=$('#phone-compare'),lb=$('#phone-original');if(b){b.setAttribute('aria-label',fxCompare?'Show edit':'Compare with original');b.setAttribute('aria-pressed',String(fxCompare));}if(lb)lb.hidden=!fxCompare;
}
const render0=window.renderPreview;window.renderPreview=function(){const r=render0.apply(this,arguments);if(mob())syncCompare();return r;};
const GROUPS={all:{label:'All'},light:{label:'Light',keys:['adjust','curves']},colour:{label:'Colour',keys:['hsl','wheels','pointcolor']},film:{label:'Film',keys:['looks','inprint','grain','hal','bloom','vig','art']},local:{label:'Local',keys:['local','retouch']},geometry:{label:'Geometry',keys:['crop','rotate','straighten','lens','borders','canvas']},detail:{label:'Detail',keys:['nr','deconv']},saved:{label:'Saved',keys:['style']}};
let category='all',search='';
window.fxMobileFilter=function(cat){category=GROUPS[cat]?cat:'all';_fxMobileCat=category;filterTools();};
function filterTools(){
  const keys=GROUPS[category]?.keys;
  document.querySelectorAll('#fx-tool-cats button').forEach(b=>{b.classList.toggle('on',b.dataset.cat===category);b.setAttribute('aria-pressed',String(b.dataset.cat===category));});
  let n=0;document.querySelectorAll('#fx-tool-grid .fx-sec-btn').forEach(b=>{const show=(!keys||keys.includes(b.dataset.sec))&&b.textContent.toLowerCase().includes(search.toLowerCase());b.hidden=!show;if(show)n++;});
  const msg=$('#phone-tool-empty');if(msg)msg.hidden=!!n;
}
function toolBrowser(){
  const cats=$('#fx-tool-cats');if(!cats)return;
  cats.innerHTML=Object.entries(GROUPS).map(([key,g])=>'<button data-cat="'+key+'" aria-pressed="false">'+g.label+'</button>').join('');
  cats.onclick=e=>{const b=e.target.closest('button');if(b)fxMobileFilter(b.dataset.cat);};
  if(!$('#phone-tool-search')){
    const row=document.createElement('label');row.className='phone-tool-search';row.innerHTML='<span class="phone-sr">Search tools</span><input id="phone-tool-search" type="search" placeholder="Search tools" autocomplete="off">';cats.before(row);
    row.querySelector('input').oninput=e=>{search=e.target.value;filterTools();};
    // Search stays hidden until the magnifier left of the categories is tapped.
    const bar=document.createElement('div');bar.id='phone-tools-bar';cats.before(bar);const fb=document.createElement('button');fb.id='phone-tools-find';fb.type='button';fb.setAttribute('aria-label','Search tools');fb.setAttribute('aria-pressed','false');fb.innerHTML=typeof icon==='function'?icon('search',20):'⌕';bar.append(fb,cats);
    const inp=row.querySelector('input');fb.onclick=()=>{const on=!document.body.classList.contains('phone-tools-search')||!!inp.value;document.body.classList.toggle('phone-tools-search',on);fb.setAttribute('aria-pressed',String(on));if(on)inp.focus();};
    document.body.classList.remove('phone-tools-search');
    const msg=document.createElement('p');msg.id='phone-tool-empty';msg.textContent='No tools match. Try another category or search.';msg.hidden=true;bar.after(msg);
  }
  filterTools();
}
const build0=window.buildSecNav;window.buildSecNav=function(){const r=build0.apply(this,arguments);if(mob())toolBrowser();return r;};
function selectedLook(){return $('#fx-looks .look-cell.sel');}
function lookActions(){
  const cell=selectedLook(),val=cell?._lookJob?.val;
  const b=$('#phone-look-fav');if(b){b.disabled=!val;b.textContent=val&&csIsFav(val)?'Unfavourite':'Favourite';b.setAttribute('aria-pressed',String(!!val&&csIsFav(val)));}
  $('#phone-look-strength')?.toggleAttribute('disabled',!val);
}
function setupLooks(){
  const looks=$('#fx-looks');if(!looks||$('#phone-look-actions'))return;
  // Search stays hidden behind a magnifier at the start of the category chips.
  const cats=$('#fx-looks-cats'),search=$('#fx-looks-search');
  if(cats&&search&&!$('#phone-looks-bar')){const bar=document.createElement('div');bar.id='phone-looks-bar';cats.before(bar);
    const sb=document.createElement('button');sb.id='phone-looks-find';sb.type='button';sb.setAttribute('aria-label','Search looks');sb.setAttribute('aria-pressed','false');sb.innerHTML=typeof icon==='function'?icon('search',20):'⌕';
    bar.append(sb,cats);sb.onclick=()=>{const on=!document.body.classList.contains('phone-looks-search')||!!search.value;document.body.classList.toggle('phone-looks-search',on);sb.setAttribute('aria-pressed',String(on));if(on)search.focus();};
    search.addEventListener('blur',()=>{if(!search.value){document.body.classList.remove('phone-looks-search');sb.setAttribute('aria-pressed','false');}});}
  const row=document.createElement('div');row.id='phone-look-actions';row.className='phone-actions';
  row.innerHTML='<button id="phone-look-browse" aria-pressed="false">Browse all</button><button id="phone-look-strength">Strength</button><button id="phone-look-fav">Favourite</button>';
  looks.before(row);
  row.querySelector('#phone-look-browse').onclick=e=>{const on=!document.body.classList.contains('phone-looks-grid');document.body.classList.toggle('phone-looks-grid',on);document.body.classList.toggle('sheet-full',on);e.target.textContent=on?'Quick rail':'Browse all';e.target.setAttribute('aria-pressed',String(on));};
  row.querySelector('#phone-look-strength').onclick=()=>{document.body.classList.add('lk-strength');$('#row-lut-mix')?.scrollIntoView({block:'nearest'});$('#sl-lut-mix')?.focus();};
  row.querySelector('#phone-look-fav').onclick=()=>{
    const val=selectedLook()?._lookJob?.val;if(!val)return;const key=String(val).replace(/^p:/,'');let a=JSON.parse(localStorage.getItem('csFavLooks')||'[]'),on=a.includes(key);
    a=on?a.filter(v=>v!==key):[key,...a];localStorage.setItem('csFavLooks',JSON.stringify(a));buildLookCatChips();buildLookGallery();lookActions();
  };
  looks.addEventListener('click',()=>setTimeout(lookActions,0));
  new MutationObserver(()=>{lookActions();labelControls(looks);}).observe(looks,{childList:true});lookActions();
}
function labelControls(root=document){
  root.querySelectorAll('input.fx-slider').forEach(s=>{
    const row=s.closest('.fx-row'),lb=row?.querySelector('.fx-label');if(lb&&!s.getAttribute('aria-label')&&!s.getAttribute('aria-labelledby'))s.setAttribute('aria-label',lb.textContent.trim());
    const value=row?.querySelector('.fx-val');if(value){s.setAttribute('aria-valuetext',value.textContent.trim());if(mob()){value.setAttribute('role','button');value.tabIndex=0;value.setAttribute('aria-label','Enter '+(lb?.textContent.trim()||'value'));}}
    if(row&&s.id&&!row.querySelector('.phone-reset')){const b=document.createElement('button');b.className='phone-reset';b.type='button';b.textContent='Reset';b.setAttribute('aria-label','Reset '+(lb?.textContent.trim()||'value'));b.onclick=()=>{const base=_fxPristineDefault?.sliders?.[s.id.replace(/^sl-/,'')]??s.defaultValue;s.value=base;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));fxHistoryPush();};row.appendChild(b);}
  });
}
// Reset shows only on changed sliders; checked after any value change, including undo.
function syncResets(root=document){root.querySelectorAll('.fx-row>.phone-reset').forEach(b=>{const s=b.parentElement.querySelector('input.fx-slider');if(!s)return;const base=_fxPristineDefault?.sliders?.[s.id.replace(/^sl-/,'')]??s.defaultValue;b.parentElement.classList.toggle('phone-changed',Math.abs(+s.value-(+base))>1e-9);});}
function centreTab(strip,btn){if(!strip||!btn)return;const l=btn.offsetLeft-(strip.clientWidth-btn.offsetWidth)/2;strip.scrollTo({left:Math.max(0,l),behavior:'smooth'});}
window.phoneCentreTab=centreTab;
function precision(value){
  const row=value.closest('.fx-row'),sl=row?.querySelector('input.fx-slider');if(!sl)return;
  const title=row.querySelector('.fx-label')?.textContent.trim()||'Adjustment';
  // Values may be displayed in stops, percent or degrees. Preserve the editor's existing
  // conversion by editing its contenteditable value, rather than assuming the raw range units.
  const angle=sl.id==='sl-straighten',step=angle ? 0.05 :(+sl.step||1),display=angle?_stS2A(sl.value):+sl.value;
  sheet(title,'<label>'+esc(angle?'Angle in degrees':'Value')+'<input id="phone-number" type="number" inputmode="decimal" min="'+sl.min+'" max="'+sl.max+'" step="'+step+'" value="'+display+'"></label><p>Range '+sl.min+' to '+sl.max+(angle?' degrees':'')+'.</p><div class="phone-actions"><button data-step="-1" aria-label="Decrease one step">−</button><button data-step="1" aria-label="Increase one step">+</button><button data-reset>Reset</button><button data-apply>Apply</button></div>',(el,close)=>{
    const i=el.querySelector('input');const apply=()=>{if(!i.checkValidity()||!Number.isFinite(+i.value)||!i.value)return;sl.value=angle?_stA2S(+i.value):i.value;sl.dispatchEvent(new Event('input',{bubbles:true}));sl.dispatchEvent(new Event('change',{bubbles:true}));fxHistoryPush();close();};
    el.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{i.value=Math.max(+sl.min,Math.min(+sl.max,+i.value+(+b.dataset.step)*step));});
    el.querySelector('[data-reset]').onclick=()=>{const base=_fxPristineDefault?.sliders?.[sl.id.replace(/^sl-/,'')]??sl.defaultValue;i.value=angle?_stS2A(base):base;};el.querySelector('[data-apply]').onclick=apply;i.onkeydown=e=>{if(e.key==='Enter')apply();};i.focus();i.select();
  });
}
function maskWorkflow(){
  const card=$('.fx-ctrl[data-fxsec=local]');if(!card||$('#phone-mask-flow'))return;
  const flow=document.createElement('div');flow.id='phone-mask-flow';flow.innerHTML='<p>1. Choose an area · 2. Adjust it</p><div class="phone-actions"><button data-mask-add>Choose area</button><button data-mask-paint>Add paint</button><button data-mask-erase>Erase</button></div><p id="phone-mask-status" role="status"></p>';
  card.prepend(flow);
  flow.querySelector('[data-mask-add]').onclick=()=>sheet('Choose an area','<p>Use a brush or shape to target part of the photo.</p><div class="phone-actions"><button data-mask="brush">Brush</button><button data-mask="radial">Ellipse</button><button data-mask="linear">Gradient</button></div>',(el,close)=>el.querySelectorAll('[data-mask]').forEach(b=>b.onclick=()=>{mskAdd(b.dataset.mask);if(b.dataset.mask==='brush'&&!mskPaintMode)mskPaintToggle();close();maskStatus();}));
  flow.querySelector('[data-mask-paint]').onclick=()=>{if(mskSel<0)mskAdd('brush');if(mskPaintErase)mskPaintErase_toggle();if(!mskPaintMode)mskPaintToggle();maskStatus();};
  flow.querySelector('[data-mask-erase]').onclick=()=>{if(mskSel<0){toast('Choose an area first');return;}if(!mskPaintMode)mskPaintToggle();if(!mskPaintErase)mskPaintErase_toggle();maskStatus();};
}
function maskStatus(){const e=$('#phone-mask-status'),text=mskSel>=0?'Mask '+(mskSel+1)+' of '+fxState.masks.length+' · '+(mskPaintMode?(mskPaintErase?'Erasing':'Adding paint'):'Adjusting'):'No area selected yet';if(e&&e.textContent!==text)e.textContent=text;}
// Magnifier follows the actual painting point; it stays above the finger and never changes pixels.
function magnifier(){
  const wrap=$('#fx-wrap');if(!wrap)return;const c=document.createElement('canvas');c.id='phone-mask-loupe';c.width=160;c.height=160;document.body.appendChild(c);let on=false;
  const show=e=>{if(!on)return;const bd=$('#fx-canvas-bd'),cv=bd&&bd.style.display!=='none'?bd:$('#fx-canvas');if(!cv)return;const r=cv.getBoundingClientRect();if(!r.width||!r.height)return;const x=(e.clientX-r.left)*cv.width/r.width,y=(e.clientY-r.top)*cv.height/r.height,size=Math.min(cv.width,cv.height)*.12;
    c.getContext('2d').drawImage(cv,x-size/2,y-size/2,size,size,0,0,160,160);c.style.left=Math.max(8,Math.min(innerWidth-104,e.clientX-48))+'px';c.style.top=Math.max(8,e.clientY-140)+'px';c.hidden=false;};
  c.hidden=true;wrap.addEventListener('pointerdown',e=>{on=mob()&&mskPaintMode&&e.isPrimary;show(e);},true);wrap.addEventListener('pointermove',show,true);
  const stop=()=>{on=false;c.hidden=true;};window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);
}
let straightenGrid=null;
function syncNavigation(){
  if(!mob())return;const home=$('.fx-act-home');if(home){home.setAttribute('aria-label','Gallery');home.title='Gallery';if(!home.querySelector('.phone-home-label')){const t=document.createElement('span');t.className='phone-home-label';t.textContent='Gallery';home.appendChild(t);}home.onclick=()=>window.MobileLibrary?MobileLibrary.open().catch(e=>toast(e.message)):fxMobileBack();}
  const sec=document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec;
  // Straighten shows a levelling grid over the photo; leaving it restores the user's own grid choice.
  if(typeof cropGridOverlaySync==='function'){const st=sec==='straighten'&&document.body.classList.contains('sheet-open');
    if(st&&!straightenGrid){straightenGrid={shown:cropGridShown,grid:cropGrid};if(cropGrid==='off')cropGrid='3x3';cropGridShown=true;cropGridOverlaySync();}
    else if(!st&&straightenGrid){cropGridShown=straightenGrid.shown;cropGrid=straightenGrid.grid;straightenGrid=null;cropGridOverlaySync();}}
  document.querySelectorAll('#fx-mobile-nav [role=tab]').forEach(b=>b.setAttribute('aria-selected',String(b.classList.contains('on'))));
  document.querySelectorAll('#fx-sheet-strip button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sec===sec)));centreTab($('#fx-sheet-strip'),$('#fx-sheet-strip button.on'));syncResets();document.querySelectorAll('.fx-ctrl>.fx-ctrl-title').forEach(t=>{t.classList.remove('phone-bare');t.classList.toggle('phone-bare',![...t.children].some(c=>c.getClientRects().length));});
  maskStatus();
}
const section0=window.fxSection;window.fxSection=function(){const r=section0.apply(this,arguments);if(mob()){syncNavigation();setupLooks();labelControls($('.fx-panel'));lookActions();}return r;};
function boot(){
  const link=document.createElement('link');link.rel='stylesheet';link.href='mobile/mobile-ui.css';document.head.appendChild(link);
  const ctx=document.createElement('div');ctx.id='phone-context';ctx.innerHTML='<button id="phone-sheet-size">Expand</button><span id="phone-original" hidden>Original</span>';
  $('#fx-actionbar')?.after(ctx);
  const queue=$('#phone-queue');if(queue)ctx.appendChild(queue);
  // Compare is a faded eye in the photo's bottom-right corner.
  const eye=document.createElement('button');eye.id='phone-compare';eye.type='button';eye.setAttribute('aria-pressed','false');eye.setAttribute('aria-label','Compare with original');
  eye.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  ($('#fx-wrap')||document.body).appendChild(eye);eye.onclick=()=>compare(!fxCompare);
  ctx.querySelector('#phone-sheet-size').onclick=()=>{document.body.classList.remove('sheet-user','sheet-peek');document.body.classList.toggle('sheet-full');rememberSheet();};
  {let q=0;const pnl=$('.fx-panel');if(pnl)new MutationObserver(()=>{if(q||!mob())return;q=requestAnimationFrame(()=>{q=0;syncResets(pnl);});}).observe(pnl,{subtree:true,characterData:true,childList:true});}
  // Quick tool bar has two sizes: icons, or a thin text-only strip. Swipe down on it to thin it, up to restore.
  {const qn=$('#fx-quicknav');document.body.classList.toggle('phone-qn-thin',pref('qnThin',false));
   if(qn){let y0=null;qn.addEventListener('touchstart',e=>{y0=e.touches[0].clientY;},{passive:true});
    qn.addEventListener('touchend',e=>{if(y0===null)return;const dy=e.changedTouches[0].clientY-y0;y0=null;if(Math.abs(dy)<28)return;const thin=dy>0;document.body.classList.toggle('phone-qn-thin',thin);setPref('qnThin',thin);},{passive:true});}}
  // Double-tap a slider to reset it (the hidden per-row reset button does the work).
  {let last={t:0,s:null,x:0};document.addEventListener('pointerup',e=>{if(!mob())return;const sl=e.target.closest?.('.fx-panel input.fx-slider');if(!sl)return;const now=performance.now();
    if(last.s===sl&&now-last.t<350&&Math.abs(e.clientX-last.x)<24){last.s=null;sl.closest('.fx-row')?.querySelector('.phone-reset')?.click();window.hapt?.();}else last={t:now,s:sl,x:e.clientX};},true);}
  // Swipe-on-photo adjusts only a slider the user picked by tapping its name (underlined while
  // picked). Any other tap, including its name again, turns it off.
  {const pickOff=()=>{const p=window.csSwipeSlider;if(p)p.closest('.fx-row')?.classList.remove('phone-swipe-pick');window.csSwipeSlider=null;window.csSwipeAdjust=false;};
   document.addEventListener('click',e=>{if(!mob())return;const lb=e.target.closest?.('.fx-panel .fx-row>.fx-label');const sl=lb?.parentElement.querySelector('input.fx-slider');
     const was=window.csSwipeSlider;pickOff();if(sl&&sl!==was){window.csSwipeSlider=sl;window.csSwipeAdjust=true;sl.closest('.fx-row').classList.add('phone-swipe-pick');window.hapt?.();}},true);
   const sec0=window.fxSection;window.fxSection=function(){pickOff();return sec0.apply(this,arguments);};}
  toolBrowser();setupLooks();maskWorkflow();magnifier();if(mob())labelControls($('.fx-panel'));syncNavigation();
  document.body.style.setProperty('--phone-text-scale',String(pref('textSize',1)));
  new MutationObserver(()=>{if(mob()){syncNavigation();rememberSheet();}}).observe(document.body,{attributes:true,attributeFilter:['class']});
  const dynamic=$('#fx-mask-controls')||$('.fx-ctrl[data-fxsec=local]');if(dynamic)new MutationObserver(()=>{if(mob()){labelControls(dynamic);maskStatus();}}).observe(dynamic,{childList:true,subtree:true});
  document.addEventListener('click',e=>{if(!mob())return;const v=e.target.closest('.fx-val');if(v&&v.closest('.fx-panel')){e.preventDefault();e.stopImmediatePropagation();precision(v);}},true);
  document.addEventListener('keydown',e=>{if(!mob())return;if((e.key==='Enter'||e.key===' ')&&e.target.matches('.fx-val')){e.preventDefault();precision(e.target);}else if(e.key==='Escape'&&!activeDialog){e.preventDefault();back();}},true);
  document.addEventListener('input',e=>{if(mob()&&e.target.matches('input.fx-slider')){syncResets(e.target.closest('.fx-row')?.parentElement||document);const v=e.target.closest('.fx-row')?.querySelector('.fx-val');if(v)e.target.setAttribute('aria-valuetext',v.textContent.trim());}});
  const app=window.Capacitor?.Plugins?.App;
  if(typeof capNative==='function'&&capNative()&&app){
    app.addListener('backButton',async()=>{if(!await back()){await window.MobileLibrary?.flush();await app.minimizeApp();}});
    app.addListener('appStateChange',({isActive})=>{if(!isActive)window.MobileLibrary?.flush().catch(()=>{});});
  }
}
function rememberSheet(){if(!mob()||!document.body.classList.contains('sheet-open'))return;const size=document.body.classList.contains('sheet-full')?'full':document.body.classList.contains('sheet-peek')?'peek':'half';try{setPref('sheet',size);}catch(_){}const b=$('#phone-sheet-size');if(b)b.textContent=size==='full'?'Reduce':'Expand';}
const open0=window.fxSection;window.fxSection=function(){const opening=!document.body.classList.contains('sheet-open');const saved=pref('sheet','half'),r=open0.apply(this,arguments);if(mob()&&opening&&document.body.classList.contains('sheet-open')){document.body.classList.toggle('sheet-full',saved==='full');document.body.classList.toggle('sheet-peek',saved==='peek');}return r;};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
