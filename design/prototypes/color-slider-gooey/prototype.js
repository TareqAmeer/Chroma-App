/* Decorative SVG silhouette only. Native <input type=range> owns value, keyboard, focus and hit testing. */
const rows = [
  { label: 'Luminance', value: 0, min: -100, max: 100, suffix: '', type: 'plain' },
  { label: 'Hue', value: 0, min: -180, max: 180, suffix: '°', type: 'functional' },
  { label: 'Saturation', value: 0, min: -100, max: 100, suffix: '', type: 'plain', disabled: true }
];
const svg = `<svg class="liquid" aria-hidden="true" focusable="false"><defs><filter id="goo-filter" x="-40%" y="-120%" width="180%" height="340%" color-interpolation-filters="sRGB"><feGaussianBlur class="goo-blur" in="SourceGraphic" stdDeviation="3" result="blur"/><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 19 -8"/></filter></defs><g class="surface"><circle class="tail" r="0"/><circle class="body" r="8"/></g></svg>`;
const featureOK = 'SVGFEColorMatrixElement' in window && CSS.supports('filter','url(#goo-filter)');
if (!featureOK) { document.body.classList.add('fallback-mode'); document.querySelector('#fallback').hidden = false; }
function fmt(row, v) { return v > 0 ? `+${v}${row.suffix}` : `${v}${row.suffix}`; }
function makeRow(row, kind) {
  const e = document.createElement('div'); e.className = `slider-row ${row.type} ${row.disabled ? 'disabled' : ''}`;
  e.innerHTML = `<span class="label">${row.label}</span><output class="value">${fmt(row,row.value)}</output><div class="range-box"><span class="track"></span><span class="fill"></span>${kind === 'gooey' ? svg : ''}<input aria-label="${row.label}" type="range" min="${row.min}" max="${row.max}" value="${row.value}" ${row.disabled ? 'disabled' : ''}></div>`;
  const input=e.querySelector('input'), value=e.querySelector('.value'), fill=e.querySelector('.fill'), liquid=e.querySelector('.liquid');
  if (liquid && !featureOK) liquid.hidden=true;
  const state={shown: +input.value, target:+input.value, raf:0, last:performance.now(), tail:+input.value};
  const draw = (v, withTail) => {
    const p=(v-row.min)/(row.max-row.min); fill.style.width=`${p*100}%`;
    if (!liquid || liquid.hidden) return;
    const width=input.getBoundingClientRect().width, x=22+p*(width-44), body=liquid.querySelector('.body'), tail=liquid.querySelector('.tail');
    const tP=(state.tail-row.min)/(row.max-row.min), tx=22+tP*(width-44), strength=+document.querySelector('#trail').value;
    body.setAttribute('cx',x); body.setAttribute('cy',28); tail.setAttribute('cx',withTail ? tx : x); tail.setAttribute('cy',28); tail.setAttribute('r',withTail ? 8*strength : 0);
    liquid.querySelector('.goo-blur').setAttribute('stdDeviation',document.querySelector('#softness').value);
  };
  const settle = now => { const dt=Math.min(32,now-state.last)/16.67; state.last=now; const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(reduce){state.shown=state.target;state.tail=state.target;} else {state.shown+=(state.target-state.shown)*Math.min(1,.34*dt);state.tail+=(state.shown-state.tail)*Math.min(1,.18*dt);}
    draw(state.shown,Math.abs(state.shown-state.tail)>.08); if(Math.abs(state.target-state.shown)>.08||Math.abs(state.shown-state.tail)>.08)state.raf=requestAnimationFrame(settle);else{state.shown=state.target;state.tail=state.target;draw(state.shown,false);state.raf=0;}
  };
  const change=()=>{state.target=+input.value;value.textContent=fmt(row,state.target);if(!state.raf){state.last=performance.now();state.raf=requestAnimationFrame(settle);}};
  input.addEventListener('input',change); input.addEventListener('change',change); draw(state.shown,false);
  return {e,input,row,reset(v){input.value=v;state.target=+v;change();}};
}
const all=[]; document.querySelectorAll('.rows').forEach(host=>rows.forEach(row=>{const x=makeRow(row,host.dataset.kind);host.append(x.e);all.push(x)}));
const $=s=>document.querySelector(s); $('#theme').onclick=()=>{document.body.classList.toggle('light');$('#theme').textContent=document.body.classList.contains('light')?'Dark theme':'Light theme'};
$('#motion').onclick=()=>{const on=$('#motion').getAttribute('aria-pressed')==='true';$('#motion').setAttribute('aria-pressed',String(!on));$('#motion').textContent=on?'Effect off':'Effect on';document.querySelectorAll('.liquid').forEach(x=>x.hidden=on)};
['trail','softness'].forEach(id=>$( '#'+id).addEventListener('input',e=>{e.target.nextElementSibling.value=id==='softness'?`${e.target.value}px`:e.target.value;all.forEach(x=>x.input.dispatchEvent(new Event('input')))}));
document.querySelectorAll('[data-state]').forEach(b=>b.onclick=()=>{const s=b.dataset.state;all.forEach((x,i)=>{if(x.input.disabled)return;x.reset(s==='default'?0:(s==='changed'?(i%2?72:35):0));});if(s==='focus')all.find(x=>!x.input.disabled&&x.e.closest('.proposal'))?.input.focus();});
