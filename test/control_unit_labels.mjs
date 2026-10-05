// CHR-56: verify unit semantics, endpoint formatting, and coverage of static Editor sliders.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const start = html.indexOf('const CS_CONTROL_UNIT_SPECS=');
const end = html.indexOf('function csSyncControlUnit(input)', start);
assert(start >= 0 && end > start, 'control-unit registry exists');
const sandbox = {};
vm.runInNewContext(`${html.slice(start,end)}\nglobalThis.specs=CS_CONTROL_UNIT_SPECS;globalThis.format=csFormatControlUnit;`, sandbox);
const { specs, format } = sandbox;
assert.equal(format('sl-adj-exp',-100,'-100'),'-5.00 EV');
assert.equal(format('sl-adj-exp',100,'100'),'+5.00 EV');
assert.equal(format('sl-lens-rot',-100,'-100'),'-10.0°');
assert.equal(format('sl-lens-rot',100,'100'),'+10.0°');
assert.equal(format('sl-deconv-rad',0,'0'),'1.5 px');
assert.equal(format('sl-deconv-rad',100,'100'),'8.0 px');
assert.equal(format('sl-straighten',0,'1.25°'),'1.25°');
assert.equal(format('sl-heal-size',4,'4%'),'4%');
const staticRanges=[...html.matchAll(/<input\b[^>]*type="range"[^>]*>/g)].map(m=>m[0]).map(tag=>tag.match(/\bid="([^"]+)"/)?.[1]).filter(Boolean);
const covered=staticRanges.filter(id=>Object.prototype.hasOwnProperty.call(specs,id));
for(const id of covered){
  const match=html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`));
  const value=match?.[0].match(/\bvalue="([^"]+)"/)?.[1]||'0';
  const unit=typeof specs[id]==='string'?specs[id]:specs[id].unit;
  assert(format(id,value,value).endsWith(unit.trim()),`${id} formats with ${unit.trim()}`);
}
assert(covered.length >= 60,`static adjustment unit coverage is broad (${covered.length})`);
console.log(`CONTROL UNIT CHECK: PASS (${covered.length}/${staticRanges.length} static ranges have unit metadata)`);
