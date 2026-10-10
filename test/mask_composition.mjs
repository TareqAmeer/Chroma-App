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
  '_mskNewId', '_mskEnsureIds', '_mskCompositionPlan', '_mskCompositionCandidateCheck',
  'mskSetComposition', 'mskClearComposition', '_mskSkinDefaults', '_mskMigrate', '_mskToSnap', '_mskFromSnap',
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
assert.equal(legacy[0].compositionMigrated, true, 'one-time legacy migration state survives snapshots');
const legacySnap = context._mskFromSnap(JSON.parse(JSON.stringify(context._mskToSnap(legacy[0]))));
assert.equal(legacySnap.compositionMigrated, true, 'one-time migration state is persisted with mask snapshots');

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
const brokenPlan = context._mskCompositionPlan(broken);
assert.equal(broken[0].composeOp, 'subtract', 'missing operand operation remains repairable');
assert.equal(brokenPlan.valid[0], false, 'missing operand fails closed');
ensure(broken);
assert.equal(broken[0].operandId, 'missing', 'later migrations never retarget a deleted operand');
const reservedId = [{}, { id: 'legacy-mask-0' }];
ensure(reservedId);
assert.equal(reservedId[1].id, 'legacy-mask-0', 'legacy allocation preserves later persisted IDs');
assert.notEqual(reservedId[0].id, reservedId[1].id, 'legacy allocation avoids collisions');
const deleted = [{ id: 'keep' }, { id: 'ref', composeOp: 'intersect', operandId: 'keep' }];
const deletedId = deleted[1].operandId;
deleted.splice(0, 1); ensure(deleted);
assert.equal(deleted[0].composeOp, 'intersect', 'deleting an operand preserves repairable operation');
assert.equal(deleted[0].operandId, deletedId, 'deleting an operand never retargets it');
assert.equal(context._mskCompositionPlan(deleted).valid[0], false, 'deleted operand evaluates as zero');
const corrupt = [{ id: 'c0' }, { id: 'c1', composeOp: 'subtract', subtract: true }];
ensure(corrupt);
assert.equal(corrupt[1].composeOp, 'subtract', 'explicit operation without an ID remains repairable');
assert.equal(context._mskCompositionPlan(corrupt).valid[1], false, 'missing explicit ID fails closed');
const cyclic = [
  { id: 'cycle-a', composeOp: 'subtract', operandId: 'cycle-b', subtract: true },
  { id: 'cycle-b', composeOp: 'intersect', operandId: 'cycle-a', intersect: true },
];
ensure(cyclic);
assert.equal(cyclic.filter(m => m.composeOp).length, 2, 'cycle links remain available for repair');
const cyclicPlan = context._mskCompositionPlan(cyclic);
assert.equal(cyclicPlan.valid.every(v => v === false), true, 'every node in a cycle fails closed');
assert.deepEqual(Array.from(cyclicPlan.order), [1, 0], 'cyclic graph still produces a bounded slot order');
const nested = [
  { id: 'leaf', baseWeight: 0.75 },
  { id: 'mid', composeOp: 'add', operandId: 'leaf', baseWeight: 0.25 },
  { id: 'root', composeOp: 'intersect', operandId: 'mid', baseWeight: 0.5 },
];
const nestedPlan = context._mskCompositionPlan(nested);
assert.equal(nestedPlan.valid.every(Boolean), true, 'nested operations are valid');
assert.deepEqual(Array.from(nestedPlan.order), [0, 1, 2], 'nested graph packs dependencies before consumers');
assert.deepEqual(Array.from(context._mskCompositionPlan([{id:'a'},{id:'b',composeOp:'subtract',operandId:'a'}]).order),[0,1],
  'CPU packing keeps a stable, dependency-first sequence for the GPU');
assert.notEqual(context._mskNewId(), context._mskNewId(), 'new masks receive distinct stable IDs');

const candidateCycle=[
  {id:'ca',composeOp:'subtract',operandId:'cc',compositionMigrated:true},
  {id:'cb',compositionMigrated:true},
  {id:'cc',compositionMigrated:true},
];
const cycleChoice=context._mskCompositionCandidateCheck(candidateCycle,'cc','add','ca');
assert.equal(cycleChoice.valid,false,'candidate that points back to the active mask is rejected');
assert.equal(cycleChoice.reason,'cycle','cycle refusal has a distinct diagnostic');
assert.equal(candidateCycle[2].composeOp,undefined,'candidate validation does not mutate the live graph');
const brokenTarget=[
  {id:'ba',composeOp:'intersect',operandId:'deleted',compositionMigrated:true},
  {id:'bb',compositionMigrated:true},
];
const dependencyChoice=context._mskCompositionCandidateCheck(brokenTarget,'bb','subtract','ba');
assert.equal(dependencyChoice.valid,false,'a disabled operand chain cannot be used as a new operand');
assert.equal(dependencyChoice.reason,'dependency','invalid operand chain is distinguished from a cycle');
assert.equal(context._mskCompositionCandidateCheck([{id:'self'}],'self','add','self').reason,'self',
  'active mask cannot compose with itself');

const committed=[];let rebuilds=0,updates=0;
Object.assign(context,{fxState:{masks:[{id:'ui-a',name:'Sky',compositionMigrated:true},
  {id:'ui-b',name:'Brush',compositionMigrated:true},{id:'ui-c',name:'Subject',compositionMigrated:true}]},mskSel:2,
  fxHistoryPush:()=>committed.push(JSON.stringify(context.fxState.masks.map(context._mskToSnap))),
  mskRebuild:()=>rebuilds++,fxUpdate:()=>updates++,toast:message=>{context.lastToast=message;}});
assert.equal(context.mskSetComposition('add','ui-a'),true,'Add accepts an arbitrary stable-ID operand');
assert.equal(context.fxState.masks[2].operandId,'ui-a','Add stores the selected operand ID');
assert.equal(committed.length,1,'one history entry is pushed for a successful composition change');
const saveRoundTrip=context.fxState.masks.map(m=>context._mskFromSnap(JSON.parse(JSON.stringify(context._mskToSnap(m)))));
assert.equal(saveRoundTrip[2].operandId,'ui-a','save/snapshot retains a selected non-previous operand');
const beforeReject=JSON.stringify(context.fxState.masks.map(m=>[m.composeOp,m.operandId]));
context.fxState.masks[0].composeOp='subtract';context.fxState.masks[0].operandId='ui-c';context.fxState.masks[0].compositionMigrated=true;
const withCycle=JSON.stringify(context.fxState.masks.map(m=>[m.composeOp,m.operandId]));
assert.equal(context.mskSetComposition('intersect','ui-a'),false,'cycle-producing operation is rejected before mutation');
assert.equal(JSON.stringify(context.fxState.masks.map(m=>[m.composeOp,m.operandId])),withCycle,'rejected edit preserves all operand references');
assert.equal(committed.length,1,'rejected composition does not create an undo entry');
assert.match(context.lastToast,/cycle/i,'cycle refusal explains why the operation was rejected');
context.fxState.masks[0].composeOp='';context.fxState.masks[0].operandId='deleted';context.fxState.masks[0].compositionMigrated=true;
assert.equal(context.mskSetComposition('intersect','deleted'),false,'missing target cannot be applied');
assert.equal(context.fxState.masks[2].operandId,'ui-a','failed repair leaves the prior broken ID intact');
assert.equal(context.mskSetComposition('intersect','ui-b'),true,'a broken operation can be explicitly repaired with a valid target');
assert.equal(context.fxState.masks[2].operandId,'ui-b','repair stores exactly the selected replacement ID');
assert.equal(committed.length,2,'repair creates one history entry');
// Reorder is ID-stable: moving the operand does not retarget the consumer.
const rows=context.fxState.masks;[rows[0],rows[1]]=[rows[1],rows[0]];ensure(rows);
assert.equal(rows.find(m=>m.id==='ui-c').operandId,'ui-b','reordering preserves the chosen operand identity');
context.mskSel=rows.findIndex(m=>m.id==='ui-c');
context.mskClearComposition();
assert.equal(rows.find(m=>m.id==='ui-c').composeOp,'','clear composition is undoable as a single committed state');
assert.equal(committed.length,3,'clear pushes exactly one history snapshot');
assert.equal(rebuilds,3);assert.equal(updates,3);

assert.match(html, /void mskSelectionWeights\(/, 'one shared effective-selection evaluator serves render and outline');
assert.match(html, /'mskTopo\[0\]':mTopo/, 'renderer uploads the dependency-first order');
assert.match(html, /k==='mskTopo\[0\]'\)gl\.uniform1fv\(loc,v\)/, 'scalar dependency-order uniforms use uniform1fv');
assert.match(html, /if\(mskE\[i\]\.x>2\.5\)w=max\(w,weights\[operand\]\)/, 'Add composes soft effective weights by union');
assert.match(html, /float w=coverage\*mskE\[i\]\.w/, 'Amount applies only to the current adjustment');
assert.match(html, /if\(depthUnavailable\)w=0\.0/, 'missing depth remains fail-closed even for inverted shapeless masks');
assert.match(html, /sourceForMask=texture\(img,uv\)\.rgb/, 'main selection gates use the same source as outline samples');
assert.match(html, /texture\(img,uv2\)\.rgb/, 'outline selection gates sample the canonical incoming image');
assert.match(html, /Selection is disabled because its composition operand is missing or cyclic/, 'broken selections retain a visible repair hint');
console.log('mask composition identity and graph: PASS');
