// Execute production loading functions and native shim with controlled RAW IPC pixels.
// This checks settings/source transport and full-size canvas retention, not photographic quality.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [library, html, native] = await Promise.all([
  'desktop/library-ui.js', 'chromasmith-22.html', 'desktop/desktop-native.js',
].map(file => readFile(file, 'utf8')));
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `production seam ${start}`);
  return source.slice(a, b);
}
const paths = ['/shoot/A/same.NEF', '/shoot/missing.NEF', '/shoot/B/same.NEF', '/shoot/legacy.JPG'];
const recipes = new Map([
  [paths[0], { rawNr: 'off', demosaicAlgo: 'ahd' }],
  [paths[2], { rawNr: 'fast', demosaicAlgo: 'markesteijn3' }],
]);
const globals = {
  chromasmithRawNr: 'high', chromasmithDemosaicAlgo: 'global', chromasmithNativeNr: true,
  chromasmithRawFullCleanup: false, chromasmithAutoLens: true,
  chromasmithLensOverride: 'manual lens', chromasmithLensOverrideFocal: 35,
};
const pmEvents = [];
const windowMock = { ...globals, __TAURI__: {}, __pm: event => pmEvents.push(event) };
const requests = [], profiles = [], notices = [], expectedErrors = [];
let profile = 'saved-profile', unsupported = false, privateRawTest = false;
function frame(request, width = 2, height = 1) {
  const linear = request.mode === 'linear16';
  const pixels = width * height;
  const bytes = new ArrayBuffer(24 + (linear ? pixels * 6 : pixels * 4));
  new Uint32Array(bytes, 0, 6).set([width, height, 100, request.mode === 'lut' ? 1 : 0, 1, 0]);
  if (linear) new Uint16Array(bytes, 24).fill(1000);
  else new Uint8Array(bytes, 24).fill(96);
  return bytes;
}
const context = vm.createContext({
  window: windowMock, self: {}, File, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array,
  Uint8ClampedArray, Float32Array, console: { ...console, error: (...args) => expectedErrors.push(args) }, performance,
  RAW_EXT_RE: /\.(nef|rw2|dng)$/i,
  localStorage: { getItem: () => null },
  getSidecar: async path => ({ recipe: recipes.has(path) ? Buffer.from(JSON.stringify(recipes.get(path))).toString('base64') : '' }),
  snapshotFromB64: text => JSON.parse(Buffer.from(text, 'base64').toString()),
  rawRecipeKey: () => 'unused-settings-key', rawProfile: () => profile,
  baseName: path => path.split('/').at(-1), mimeFromName: () => 'application/octet-stream',
  toast: message => notices.push(message), log() {},
  invoke: async (command, args) => {
    if (command === 'read_file_bytes') {
      if (args.path === paths[1]) throw Error('missing source');
      return new Uint8Array([1, 2, 3, 4]);
    }
    if (command === 'hdr_headroom_clear') return true;
    if (command === 'get_cached_raw_decode') throw Error('cache miss');
    if (command.startsWith('peek_raw_camera')) return { make: 'Test', model: 'Camera', photoStyle: 17 };
    if (command === 'touch_recent') return null;
    throw Error(`unexpected IPC ${command}`);
  },
  framedInvoke: async (command, args, bytes) => {
    assert.equal(command, 'decode_raw_v2');
    requests.push({ ...args, payloadBytes: bytes.length });
    return frame(args, privateRawTest && args.fast === false ? 3 : 2, privateRawTest && args.fast === false ? 2 : 1);
  },
  resolveRawLut: async (identity, selected, source) => {
    profiles.push({ selected, source });
    return unsupported ? { mode: 'linear16', lutKey: '' } : { mode: 'lut', lutKey: 'test-lut' };
  },
});
vm.runInContext([
  between(library, 'async function readPathsAsFiles(', '  // ── ROADMAP R13'),
  between(library, 'async function prepareBatchRawFiles(', '  // Resolve per-photo native settings'),
  between(library, 'async function rawCacheSettings(', '  // Review stores only'),
  between(native, '  function parseCachedRawFrame(', '  const _rustLuts ='),
  between(native, 'class NativeLibRawShim {', '  window.getLibRaw ='),
  'globalThis.Shim = NativeLibRawShim;',
].join('\n'), context);
const files = await context.readPathsAsFiles(paths);
assert.deepEqual(Array.from(files.okPaths), [paths[0], paths[2], paths[3]]);
assert.equal(notices.length, 1, 'failed source remains visible');
assert.equal(expectedErrors.length, 1, 'failed source is logged');
await context.prepareBatchRawFiles(files, files.okPaths);
assert.equal(files[0].name, files[1].name, 'same basename cannot identify source');
assert.equal(files[0].__csSourcePath, paths[0]);
assert.equal(files[1].__csSourcePath, paths[2]);
assert.equal(files[2].__csRawDecodeSettings, undefined, 'JPEG behavior retained');
assert.equal(files[0].__csRawDecodeSettings.rawNr, 'off');
assert.equal(files[1].__csRawDecodeSettings.demosaicAlgo, 'markesteijn3');
assert.ok(Object.isFrozen(files[0].__csRawDecodeSettings));
assert.equal(files[0].size, 4, 'source data is retained for fallback');
assert.deepEqual(Object.fromEntries(Object.keys(globals).map(key => [key, windowMock[key]])), globals);

// Exercise the actual loadRw2 -> native shim path without a real RAW or GPU allocation.
context.getLibRaw = async () => context.Shim;
context.rawSharedMemoryOk = () => true;
context.withRawDecodeTimeout = async (raw, operation) => operation();
context.rawProfileFor = (metadata, selected) => selected;
context.cameraDcpPrefix = () => unsupported ? null : 'test-camera';
context.parseDngEmbeddedProfile = () => null;
context.errStr = error => error.message;
context.fxImages = [];
context.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
context.document = {
  getElementById: id => id === 'sel-input' ? context.inputSelect : null,
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData(image) { (context.paintCalls ||= []).push([image.width, image.height]); } }) }),
};
context.inputSelect = { value: 'standard' };
vm.runInContext(between(html, 'async function loadRw2(', '// Installs already-decoded entries'), context);
context.state = { openedPath: '', openedPaths: [], source: 'folder' };
context.applyUISnapshot = () => assert.equal(requests.length, 2, 'shared creative recipe is applied after per-photo decoding');
context.libLoadFX = async loadedFiles => {
  for (const file of loadedFiles.filter(file => file.__csRawDecodeSettings)) {
    const result = await context.loadRw2(file, { half: true });
    assert.equal(result.canvas.width, 2, 'native full dimensions retained despite browser half option');
    assert.equal(result.canvas.height, 1);
  }
};
vm.runInContext(between(library, 'async function openPathsInEditor(', '  // Preserve each surviving'), context);
await context.openPathsInEditor(paths);
assert.deepEqual(Array.from(context.state.openedPaths), [paths[0], paths[2], paths[3]]);
assert.equal(requests[0].sourcePath, paths[0]);
assert.equal(requests[0].rawNr, 'off');
assert.equal(requests[0].demosaicAlgo, 'ahd');
assert.equal(requests[1].sourcePath, paths[2]);
assert.equal(requests[1].rawNr, 'chroma');
assert.equal(requests[1].demosaicAlgo, 'markesteijn3');
assert.equal(requests[1].fast, false, 'single-pass chroma retains developed quality');
assert.ok(requests.every(request => request.payloadBytes === 0), 'by-path sources avoid RAW upload');
assert.deepEqual(profiles.map(item => item.source.path), [paths[0], paths[2]]);
assert.deepEqual(Object.fromEntries(Object.keys(globals).map(key => [key, windowMock[key]])), globals);

// Unsupported DCP must retain the photo's decode settings through the sRGB retry.
unsupported = true;
const start = requests.length;
await context.loadRw2(files[0], {});
const retry = requests.slice(start);
assert.equal(retry.length, 2);
assert.equal(retry[1].mode, 'srgb');
assert.equal(retry[1].rawNr, 'off');
assert.equal(retry[1].demosaicAlgo, 'ahd');
assert.equal(retry[1].sourcePath, paths[0]);
assert.equal(retry[1].payloadBytes, 0);

// Existing callers continue using globals, and refinement retains explicit per-call settings.
const legacy = new context.Shim();
await legacy.open(new Uint8Array([1, 2]), { outputBps: 8 });
assert.equal(requests.at(-1).demosaicAlgo, 'global');
assert.equal(requests.at(-1).rawNr, 'chroma');
const explicit = new context.Shim();
await explicit.open(new Uint8Array(0), { outputBps: 8, rawNr: 'off', demosaicAlgo: '', autoLens: false, lensOverride: '', lensOverrideFocal: 0 });
assert.equal(requests.at(-1).autoLens, false);
assert.equal(requests.at(-1).lensOverride, '');
assert.equal(requests.at(-1).lensOverrideFocal, 0);
assert.equal(requests.at(-1).demosaicAlgo, '');
windowMock.__chromasmithPersistTarget = { path: paths[0], size: 4, recipeKey: 'photo-a-key' };
const wrongTarget = new context.Shim();
await wrongTarget.open(new Uint8Array(0), { ...files[0].__csRawDecodeSettings, sourcePath: paths[2], outputBps: 8 });
assert.equal(requests.at(-1).cachePath, undefined, 'same basename/size cannot borrow another source persistence target');
windowMock.__chromasmithPersistTarget = { path: paths[0], size: 4, recipeKey: 'photo-a-key' };
const matchedTarget = new context.Shim();
await matchedTarget.open(new Uint8Array(0), { ...files[0].__csRawDecodeSettings, sourcePath: paths[0], outputBps: 8 });
assert.equal(requests.at(-1).cachePath, paths[0]);
assert.equal(requests.at(-1).recipeKey, 'unused-settings-key', 'batch file uses its own resolved recipe target');
const refining = new context.Shim();
await refining.open(new Uint8Array(0), { ...files[1].__csRawDecodeSettings, sourcePath: paths[2], outputBps: 8, fullCleanup: true });
assert.equal(requests.at(-1).rawNr, 'fast');
await refining.refine();
assert.equal(requests.at(-1).rawNr, 'fast');
assert.equal(requests.at(-1).demosaicAlgo, 'markesteijn3');
assert.equal(requests.at(-1).sourcePath, paths[2]);
assert.equal(requests.at(-1).fast, false);

// Compare's private decode uses the same exact per-file settings and sRGB fallback, but cannot
// consume Editor-owned globals, install a frame, persist another RAW cache, or return before NR.
const privateSettings = Object.freeze({ ...files[0].__csRawDecodeSettings,
  rawNr: 'fast', fullCleanup: true,
  cacheTarget: Object.freeze({ path: paths[0], recipeKey: 'private-target-key' }) });
const privateFile = new File([new Uint8Array([1, 2, 3, 4])], 'same.NEF', { type: 'application/octet-stream' });
privateFile.__csSourcePath = paths[0]; privateFile.__csRawDecodeSettings = privateSettings;
privateFile.arrayBuffer = () => context.invoke('read_file_bytes', { path: paths[0] });
const persistTarget = { path: paths[0], size: 4, recipeKey: 'editor-owned-target' };
windowMock.__chromasmithPersistTarget = persistTarget;
windowMock.chromasmithLensApplied = 'editor-lens-status';
windowMock.chromasmithHdrPreview = true;
context.inputSelect.value = 'standard';
const editorEntries = context.fxImages;
let editorHooks = 0, releaseCalls = 0;
context.updateWork = context.renderPreview = context.fxPhotoActivityInvalidate = context.chromasmithForgetOpened = context.csFirstEditPhotoOpened = () => { editorHooks++; };
const releaseBuffers = context.Shim.prototype.releaseDecodeBuffers;
context.Shim.prototype.releaseDecodeBuffers = function () { releaseCalls++; return releaseBuffers.call(this); };
const privateStart = requests.length, pmStart = pmEvents.length;
windowMock.chromasmithHdrPreview = true; // Private fit/detail stays RGBA even with Editor HDR enabled.
privateRawTest = true;
const privateResult = await context.loadRw2(privateFile, { privateEntry: true });
privateRawTest = false;
const privateRequests = requests.slice(privateStart);
assert.equal(profiles.at(-1).selected, 'saved-profile');
assert.deepEqual(privateRequests.map(request => request.mode), ['linear16', 'srgb', 'linear16'], 'DCP decline retains the per-file sRGB retry and awaits final NR refinement');
assert.deepEqual(privateRequests.map(request => request.fast), [true, true, false]);
assert.ok(privateRequests.every(request => request.sourcePath === paths[0] && request.rawNr === 'fast' && request.demosaicAlgo === 'ahd'), 'initial decode, fallback, and refinement share exact file settings');
assert.ok(privateRequests.every(request => request.autoLens === true && request.lensOverride === 'manual lens' && request.lensOverrideFocal === 35), 'lens settings remain per-file');
assert.ok(privateRequests.every(request => request.wantExt !== true && request.cachePath === undefined && request.recipeKey === undefined), 'private decode omits HDR and persistent cache writes');
assert.deepEqual([privateResult.canvas.width, privateResult.canvas.height], [3, 2], 'private result waits for refined final dimensions');
assert.deepEqual(context.paintCalls.slice(-2), [[2, 1], [3, 2]], 'fast pixels are refined in place before returning');
assert.equal(releaseCalls, 1, 'private frame decode buffers are released after render pixels are finalized');
assert.equal(windowMock.__chromasmithPersistTarget, persistTarget, 'private decode does not consume Editor persistence target');
assert.equal(windowMock.chromasmithLensApplied, 'editor-lens-status', 'private decode does not mutate Editor lens status');
assert.equal(context.inputSelect.value, 'standard', 'PhotoStyle V-Log metadata does not change the Editor input selector');
assert.equal(editorHooks, 0, 'private decode skips Editor install, update, and invalidation hooks');
assert.equal(context.fxImages, editorEntries, 'private decode leaves the Editor image collection intact');
assert.deepEqual(pmEvents.slice(pmStart), [], 'private decode emits no Editor performance hooks');
console.log('PASS: batch RAW source/settings alignment, native transport, sRGB fallback, full dimensions and refinement/global isolation.');
