import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
function declaration(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const context = vm.createContext({ Date, Math, Set, Map, CR_MAX_SAMPLES: 8,
  _pxToB64: () => '', _pxFromB64: () => new Uint8ClampedArray(0) });
vm.runInContext([
  '_mskNewId', '_mskEnsureIds', '_mskSkinDefaults', '_mskMigrate', '_mskToSnap', '_mskFromSnap',
].map(declaration).join('\n'), context);
const ensure = context._mskEnsureIds;

const legacy = [{ type: 'radial' }, { type: 'brush', subtract: true }];
ensure(legacy);
assert.equal(legacy[1].composeOp, 'subtract', 'legacy subtract flag migrates');
assert.equal(legacy[1].operandId, legacy[0].id, 'legacy operand binds to previous mask ID');
const legacyOperand = legacy[1].operandId;
[legacy[0], legacy[1]] = [legacy[1], legacy[0]];
ensure(legacy);
assert.equal(legacy[0].operandId, legacyOperand, 'reorder preserves operand identity');

const linked = [{ id: 'a' }, { id: 'b', composeOp: 'intersect', operandId: 'a' }];
[linked[0], linked[1]] = [linked[1], linked[0]];
ensure(linked);
assert.equal(linked[0].operandId, 'a', 'forward operand references survive reorder');
assert.equal(linked[0].composeOp, 'intersect');
const roundTrip = context._mskFromSnap(JSON.parse(JSON.stringify(context._mskToSnap({
  id: 'saved-id', composeOp: 'intersect', operandId: 'a', crSamples: [],
}))));
assert.equal(roundTrip.id, 'saved-id', 'snapshot reload keeps stable mask ID');
assert.equal(roundTrip.operandId, 'a', 'snapshot reload keeps composition operand ID');

const broken = [{ id: 'x', composeOp: 'subtract', operandId: 'missing' }];
ensure(broken);
assert.equal(broken[0].composeOp, '', 'missing operands are disabled safely');
assert.equal(broken[0].subtract, false, 'dangling explicit operation clears its legacy mirror');
const reservedId = [{}, { id: 'legacy-mask-0' }];
ensure(reservedId);
assert.equal(reservedId[1].id, 'legacy-mask-0', 'legacy allocation preserves later persisted IDs');
assert.notEqual(reservedId[0].id, reservedId[1].id, 'legacy allocation avoids collisions');
const deleted = [{ id: 'keep' }, { id: 'ref', composeOp: 'intersect', operandId: 'keep' }];
deleted.splice(0, 1); ensure(deleted);
assert.equal(deleted[0].composeOp, '', 'deleting an operand disables its reference');
const corrupt = [{ id: 'c0' }, { id: 'c1', composeOp: 'subtract', subtract: true }];
ensure(corrupt);
assert.equal(corrupt[1].composeOp, '', 'explicit operation with no ID does not silently retarget');
const cyclic = [
  { id: 'cycle-a', composeOp: 'subtract', operandId: 'cycle-b', subtract: true },
  { id: 'cycle-b', composeOp: 'intersect', operandId: 'cycle-a', intersect: true },
];
ensure(cyclic);
assert.equal(cyclic.filter(m => m.composeOp).length, 1, 'the edge that closes a cycle is disabled');
const active = cyclic.find(m => m.composeOp);
assert.equal(cyclic.find(m => m.id === active.operandId).composeOp, '', 'remaining link terminates safely');
assert.notEqual(context._mskNewId(), context._mskNewId(), 'new masks receive distinct stable IDs');

assert.match(html, /int operand=int\(mskO\[i\]\.x\)/, 'pixel evaluation resolves the packed operand ID');
assert.equal((html.match(/int operand=int\(mskO\[i\]\.x\)/g) || []).length, 2,
  'filled and edge-outline selection paths resolve the same operand');
console.log('mask composition identity: 18 checks PASS');
