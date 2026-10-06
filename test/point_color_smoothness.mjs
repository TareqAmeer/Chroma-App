import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('chromasmith-22.html', 'utf8');
const pointStart = html.indexOf('// POINT COLOR — unlike the 8 fixed Color Mixer bands above');
const pointEnd = html.indexOf('// Color Grading (3-way)', pointStart);
assert(pointStart >= 0 && pointEnd > pointStart, 'existing Point Color kernel is present');
const context = vm.createContext({
  r2hsv: (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360 / 360, max ? d / max : 0, max];
  },
  hsv2r: (h, s, v) => {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  },
});
vm.runInContext(html.slice(pointStart, pointEnd), context);
const weight = (h, s, point) => vm.runInContext(`pcWeight(${h},${s},${JSON.stringify(point)})`, context);
const point = { h: 0.42, s: 0.63, range: 35 };
const df = (0.03 + point.range / 100 * 0.22) * 0.8;
const sample = { h: point.h + df, s: point.s };
const legacy = weight(sample.h, sample.s, point);
assert.equal(weight(sample.h, sample.s, { ...point, smoothness: 50 }), legacy, 'smoothness 50 preserves existing quadratic behavior');
assert(weight(sample.h, sample.s, { ...point, smoothness: 0 }) < legacy, 'lower smoothness tightens the selected range transition');
assert(weight(sample.h, sample.s, { ...point, smoothness: 100 }) > legacy, 'higher smoothness softens the selected range transition');
assert.equal(weight(point.h, point.s, { ...point, smoothness: 0 }), weight(point.h, point.s, { ...point, smoothness: 100 }), 'the picked color remains fully selected at every smoothness');
assert.equal(weight(point.h + 0.2, point.s, { ...point, smoothness: 100 }), 0, 'smoothness does not expand the selected range footprint');
assert(weight(0.995, point.s, { ...point, h: 0.005, smoothness: 100 }) > 0, 'hue wrap remains continuous');

const ids = ['sl-pc-h','vl-pc-h','sl-pc-s','vl-pc-s','sl-pc-l','vl-pc-l','sl-pc-r','vl-pc-r','sl-pc-sm','vl-pc-sm','pc-ctl','pc-empty-hint'];
const elements = Object.fromEntries(ids.map(id => [id, { style: {}, value: '', textContent: '' }]));
let bakeCount = 0, updateCount = 0;
const ui = vm.createContext({
  fxState: { pointColors: [{ hue: 0, sat: 0, lum: 0, range: 35 }] }, pcSel: 0,
  document: { getElementById: id => elements[id] || null },
  bakeHsl: () => bakeCount++, fxUpdate: () => updateCount++,
});
const uiStart = html.indexOf('function pcSyncUI()');
const uiEnd = html.indexOf('function pcDelete()', uiStart);
assert(uiStart >= 0 && uiEnd > uiStart, 'Point Color controls exist');
vm.runInContext(html.slice(uiStart, uiEnd), ui);
ui.pcSyncUI();
assert.equal(elements['sl-pc-sm'].value, 50, 'pre-feature saved picks display the legacy-neutral smoothness default');
ui.pcSlider('smoothness', '75');
assert.equal(ui.fxState.pointColors[0].smoothness, 75, 'smoothness is stored on the selected color range');
assert.equal(elements['vl-pc-sm'].textContent, 75, 'numeric readout follows slider input');
assert.equal(bakeCount, 1); assert.equal(updateCount, 1);
const sliderTag = html.match(/<input[^>]*id="sl-pc-sm"[^>]*>/)?.[0] || '';
assert.match(sliderTag, /min="0" max="100" value="50"/, 'the editor exposes a 0–100 Smoothness slider');
assert.match(sliderTag, /pcSlider\('smoothness'/, 'slider input updates the selected range');
console.log('PASS: legacy parity, smoothness falloff, fixed selection footprint, hue wrap, and slider binding');
