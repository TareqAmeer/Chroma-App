/* The SVG is decorative only. Native range inputs own values, focus, keyboard and hit testing. */
const rows = [
  { label: 'Luminance', value: 0, min: -100, max: 100, suffix: '', type: 'plain' },
  { label: 'Hue', value: 0, min: -180, max: 180, suffix: '°', type: 'functional' },
  { label: 'Saturation', value: 0, min: -100, max: 100, suffix: '', type: 'plain', disabled: true }
];
const svg = `<svg class="liquid" aria-hidden="true" focusable="false"><defs><filter id="goo-filter" x="-60%" y="-100%" width="220%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur class="goo-blur" in="SourceGraphic" stdDeviation="1.5" result="blur"/><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 19 -8"/></filter></defs><g class="surface"><circle class="body" cx="0" cy="0" r="8"/></g></svg>`;
const featureOK = 'SVGFEColorMatrixElement' in window && CSS.supports('filter', 'url(#goo-filter)');
if (!featureOK) { document.body.classList.add('gooey-off'); document.querySelector('#fallback').hidden = false; }
const $ = selector => document.querySelector(selector);
const fmt = (row, value) => value > 0 ? `+${value}${row.suffix}` : `${value}${row.suffix}`;
function makeRow(row, kind) {
  const e = document.createElement('div'); e.className = `slider-row ${row.type} ${row.disabled ? 'disabled' : ''}`;
  e.innerHTML = `<span class="label">${row.label}</span><output class="value">${fmt(row, row.value)}</output><div class="range-box"><span class="track"></span><span class="fill"></span>${kind === 'gooey' ? svg : ''}<input aria-label="${row.label}" type="range" min="${row.min}" max="${row.max}" value="${row.value}" ${row.disabled ? 'disabled' : ''}></div>`;
  const input = e.querySelector('input'), value = e.querySelector('.value'), fill = e.querySelector('.fill'), liquid = e.querySelector('.liquid');
  if (liquid && !featureOK) liquid.hidden = true;
  const draw = () => {
    const v = +input.value, p = (v - row.min) / (row.max - row.min); fill.style.width = `${p * 100}%`;
    if (!liquid || liquid.hidden) return;
    const width = input.getBoundingClientRect().width, x = 22 + p * (width - 44);
    const atEnd = p === 0 || p === 1, amount = atEnd ? +$('#squish').value : 0;
    liquid.querySelector('.surface').style.transform = `translate(${x}px, 28px) scale(${1 - amount}, ${1 + amount * .72})`;
    liquid.querySelector('.goo-blur').setAttribute('stdDeviation', $('#softness').value);
  };
  const change = () => { value.textContent = fmt(row, +input.value); draw(); };
  input.addEventListener('input', change); input.addEventListener('change', change); draw();
  return { e, input, redraw: draw, reset(v) { input.value = v; change(); } };
}
const all = []; document.querySelectorAll('.rows').forEach(host => rows.forEach(row => { const item = makeRow(row, host.dataset.kind); host.append(item.e); all.push(item); })); all.forEach(item => item.redraw());
$('#theme').onclick = () => { document.body.classList.toggle('light'); $('#theme').textContent = document.body.classList.contains('light') ? 'Dark theme' : 'Light theme'; };
$('#motion').onclick = () => { const on = $('#motion').getAttribute('aria-pressed') === 'true'; $('#motion').setAttribute('aria-pressed', String(!on)); $('#motion').textContent = on ? 'Effect off' : 'Effect on'; document.body.classList.toggle('gooey-off', on); document.querySelectorAll('.liquid').forEach(x => x.hidden = on); };
['squish', 'softness'].forEach(id => $(`#${id}`).addEventListener('input', event => { event.target.nextElementSibling.value = id === 'softness' ? `${event.target.value}px` : event.target.value; all.forEach(x => x.input.dispatchEvent(new Event('input'))); }));
document.querySelectorAll('[data-state]').forEach(button => button.onclick = () => { const state = button.dataset.state; all.forEach((item, i) => { if (!item.input.disabled) item.reset(state === 'default' ? 0 : state === 'changed' ? (i % 2 ? 72 : 35) : 0); }); if (state === 'focus') all.find(x => !x.input.disabled && x.e.closest('.proposal'))?.input.focus(); });
