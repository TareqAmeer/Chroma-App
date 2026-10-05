// CHR-170: hover previews restore temporarily; exit restores the committed step and click commits.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../chromasmith-22.html',import.meta.url),'utf8');
const start=html.indexOf('let _fxTimelinePreviewBase=-1');
const end=html.indexOf('// 2026-09-09:',start);
assert(start>=0&&end>start,'history preview handlers exist');
const calls=[];
const context={fxHistIdx:2,fxSyncTopbarDisabled(){},async _fxHistoryRestore(i){calls.push(i);}};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);

await context._fxTimelinePreview(0);
assert.equal(context.fxHistIdx,2,'preview leaves the undo/redo cursor unchanged');
assert.deepEqual(calls,[0],'hover restores the selected historical edit');
await context._fxTimelinePreviewEnd();
assert.deepEqual(calls,[0,2],'pointer exit restores the committed edit');
assert.equal(context.fxHistIdx,2);

await context._fxTimelinePreview(1);
await context._fxTimelinePreviewEnd(1);
assert.deepEqual(calls,[0,2,1,1],'click commits its previewed edit');
assert.equal(context.fxHistIdx,1,'click moves the undo/redo cursor');

const gate=Promise.withResolvers();
context._fxHistoryRestore=async i=>{calls.push(`begin:${i}`);if(i===0)await gate.promise;calls.push(`end:${i}`);};
const stale=context._fxTimelinePreview(0);
await Promise.resolve();
const restore=context._fxTimelinePreviewEnd();
gate.resolve();
await Promise.all([stale,restore]);
assert.deepEqual(calls.slice(-4),['begin:0','end:0','begin:1','end:1'],'rapid exit serializes preview and restores latest committed state');
console.log('HISTORY HOVER PREVIEW: PASS');
