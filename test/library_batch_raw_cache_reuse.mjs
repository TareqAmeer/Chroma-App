import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [library, native, html] = await Promise.all(['../desktop/library-ui.js', '../desktop/desktop-native.js', '../chromasmith-22.html'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `production seam ${start}`);
  return source.slice(a, b);
}
const PATH = '/batch/photo.NEF';
const batchContext = vm.createContext({
  window: { chromasmithRawNr: 'fast', chromasmithDemosaicAlgo: '', chromasmithAutoLens: false,
    chromasmithLensOverride: '', chromasmithLensOverrideFocal: 0, chromasmithRawFullCleanup: false },
  localStorage: { getItem: () => null }, RAW_EXT_RE: /\.(nef|rw2|dng)$/i,
  getSidecar: async () => ({ recipe: '' }), rawProfile: () => 'per-file-profile',
  rawRecipeKey: (full, path, settings) => `${path}|${full || settings?.fullCleanup ? 'full' : 'interactive'}`,
});
vm.runInContext([between(library, 'async function prepareBatchRawFiles(', '  // Resolve per-photo native settings'),
  between(library, 'async function rawCacheSettings(', '  // Review stores only')].join('\n'), batchContext);
const batchFile = { name: 'photo.NEF' }; const batchFiles = [batchFile]; batchFiles.okPaths = [PATH];
await batchContext.prepareBatchRawFiles(batchFiles, batchFiles.okPaths);
const batchSettings = batchFile.__csRawDecodeSettings;
assert.deepEqual(Array.from(batchSettings.cacheTargets, t => t.recipeKey), [`${PATH}|interactive`], 'only the resolved per-file tier can be read');
assert.equal(batchSettings.cacheTarget.path, PATH);
assert.equal(batchSettings.cacheTarget.recipeKey, `${PATH}|interactive`);
batchContext.window.chromasmithRawFullCleanup = true;
const fullPath = '/batch/full.NEF'; const fullFile = { name: 'full.NEF' }; const fullFiles = [fullFile]; fullFiles.okPaths = [fullPath];
await batchContext.prepareBatchRawFiles(fullFiles, fullFiles.okPaths);
assert.deepEqual(Array.from(fullFile.__csRawDecodeSettings.cacheTargets, t => t.recipeKey), [`${fullPath}|full`], 'full cleanup reads only the matching full recipe');
assert.equal(fullFile.__csRawDecodeSettings.cacheTarget.recipeKey, `${fullPath}|full`);
assert.ok(Object.isFrozen(batchSettings.cacheTargets) && Object.isFrozen(batchSettings.cacheTarget));
function cacheFrame(width = 2, height = 1, pixels = [11, 12, 13, 255, 21, 22, 23, 255]) {
  const out = new ArrayBuffer(8 + pixels.length);
  new DataView(out).setUint32(0, width, true); new DataView(out).setUint32(4, height, true);
  new Uint8Array(out, 8).set(pixels); return out;
}
function decodeFrame() {
  const out = new ArrayBuffer(24 + 8); new Uint32Array(out, 0, 6).set([2, 1, 321, 0, 1, 0]);
  new Uint8Array(out, 24).set([90, 91, 92, 255, 93, 94, 95, 255]); return out;
}
function harness({ cached = cacheFrame(), hdr = true, hdrPreview = false, meta = { iso: 200 } } = {}) {
  const calls = [], decodes = [];
  const windowMock = {
    __TAURI__: {}, __pm() {}, chromasmithRawNr: 'off', chromasmithNativeNr: true,
    chromasmithDemosaicAlgo: '', chromasmithAutoLens: false, chromasmithLensOverride: '',
    chromasmithLensOverrideFocal: 0, chromasmithRawFullCleanup: false, chromasmithHdrPreview: hdrPreview,
  };
  const context = vm.createContext({
    window: windowMock, ArrayBuffer, ArrayBufferView: undefined, DataView, Uint8Array, Uint8ClampedArray,
    Uint16Array, Uint32Array, Float32Array, TextEncoder, TextDecoder, performance, console,
    rawProfile: () => 'test-profile', rawProfileFor: (_id, value) => value,
    resolveDcpSource: async () => null, getDcpLUT: async () => ({ data: new Float32Array(0) }),
    _cpuRun: async () => null, parseDngEmbeddedProfile: () => null, dcpFit: () => null,
    dngGainInputMatrix: () => null, log() {},
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'peek_raw_camera_path' || command === 'peek_raw_camera') return { make: 'Panasonic', model: 'Mock', lens: 'Known lens', photoStyle: 17 };
      if (command === 'get_meta') { if (meta instanceof Error) throw meta; return meta; }
      if (command === 'hdr_headroom_clear') {
        if (hdr instanceof Error) throw hdr;
        return hdr;
      }
      if (command === 'get_cached_raw_decode') {
        if (cached instanceof Error) throw cached;
        return cached;
      }
      throw new Error(`unexpected IPC ${command}`);
    },
    framedInvoke: async (command, args, bytes) => {
      assert.equal(command, 'decode_raw_v2'); decodes.push({ args, bytes: bytes.byteLength }); return decodeFrame();
    },
  });
  vm.runInContext(between(native, '  function parseCachedRawFrame(', '  window.getLibRaw ='), context);
  return { context, calls, decodes, windowMock };
}
const settings = (overrides = {}) => ({
  sourcePath: PATH, outputBps: 8, rawNr: 'off', demosaicAlgo: 'ahd', autoLens: false,
  lensOverride: '', lensOverrideFocal: 0,
  cacheTargets: batchSettings.cacheTargets,
  cacheTarget: batchSettings.cacheTarget, ...overrides,
});
async function open(h, openSettings = settings()) {
  const raw = new h.context.Shim(); await raw.open(new Uint8Array(0), openSettings);
  return { raw, image: await raw.imageData(), metadata: await raw.metadata() };
}

// Full finished cache: source+recipe match, dimensions survive, returned pixels view the IPC buffer,
// and metadata only reports fields actually supplied by the independent camera peek/cache wire.
{
  const h = harness();
  vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  const { raw, image, metadata } = await open(h);
  assert.equal(h.decodes.length, 0, 'finished cache avoids decode');
  assert.deepEqual(h.calls.filter(x => x.command === 'get_cached_raw_decode').map(x => x.args.recipeKey), [`${PATH}|interactive`]);
  assert.equal(image.width, 2); assert.equal(image.height, 1);
  assert.deepEqual(Array.from(image.data), [11, 12, 13, 255, 21, 22, 23, 255]);
  assert.equal(image.data.buffer.byteLength, 16, 'view retains only the native cache response, with no extra copy');
  assert.equal(metadata.iso_speed, 200, 'source metadata supplies the real ISO independently of cached pixels');
  assert.equal(metadata.lensStatusUnknown, true, 'cached frame carries source-owned unknown lens outcome');
  assert.equal(metadata.lens, 'Known lens'); assert.equal(metadata.photoStyle, 17);
  assert.equal(h.windowMock.chromasmithLensApplied, undefined, 'cache wire does not claim lens correction was applied');
  assert.equal(await raw.refine(), null, 'final cache does not re-run refine');
  const hNoMeta = harness({ meta: new Error('metadata unavailable') }); vm.runInContext('globalThis.Shim = NativeLibRawShim', hNoMeta.context);
  const missingMeta = await open(hNoMeta);
  assert.equal(missingMeta.metadata.iso_speed, undefined, 'metadata failure leaves ISO unknown');
  assert.equal(missingMeta.metadata.photoStyle, 17, 'camera peek still supplies PhotoStyle');
}
// Miss decodes normally and only sends this file's exact explicit write target.
{
  const h = harness({ cached: new Error('cache miss') }); vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  h.context.invoke = async (command, args) => {
    h.calls.push({ command, args });
    if (command === 'peek_raw_camera_path' || command === 'peek_raw_camera') return { make: 'Panasonic', model: 'Mock', lens: 'Known lens', photoStyle: 17 };
      if (command === 'get_meta') { if (meta instanceof Error) throw meta; return meta; }
    if (command === 'get_cached_raw_decode') throw Error('miss');
    if (command === 'hdr_headroom_clear') return true;
    throw Error(`unexpected IPC ${command}`);
  };
  await open(h, settings({ cacheTargets: [{ path: PATH, recipeKey: `${PATH}|interactive` }] }));
  assert.equal(h.decodes.length, 1);
  assert.equal(h.decodes[0].args.cachePath, PATH); assert.equal(h.decodes[0].args.recipeKey, `${PATH}|interactive`);
}
// Wrong/stale source target cannot read or write, even if the legacy global points at this path.
{
  const h = harness(); vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  h.windowMock.__chromasmithPersistTarget = { path: PATH, size: 4, recipeKey: 'wrong-global' };
  const other = '/batch/other.NEF';
  await open(h, settings({ sourcePath: other, cacheTargets: [{ path: PATH, recipeKey: 'stale' }], cacheTarget: { path: PATH, recipeKey: 'stale' } }));
  assert.equal(h.calls.filter(x => x.command === 'get_cached_raw_decode').length, 0);
  assert.equal(h.decodes[0].args.cachePath, undefined);
}
// HDR cache reads require a positive headroom-clear marker; positive headroom and marker failures decode.
for (const [marker, expectedHit] of [[false, false], [new Error('marker unavailable'), false], [true, true]]) {
  const h = harness({ hdr: marker, hdrPreview: true }); vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  await open(h);
  assert.equal(h.calls.filter(x => x.command === 'get_cached_raw_decode').length, expectedHit ? 1 : 0);
  assert.equal(h.decodes.length, expectedHit ? 0 : 1);
}
// Cache reuse allows Auto Lens with either explicit per-file setting; cached correction outcome stays unknown.
{
  for (const [globalValue, explicitValue] of [[false, true], [true, false]]) {
    const h = harness(); h.windowMock.chromasmithAutoLens = globalValue; vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
    const { metadata } = await open(h, settings({ autoLens: explicitValue }));
    assert.equal(h.calls.filter(x => x.command === 'get_cached_raw_decode').length, 1);
    assert.equal(h.decodes.length, 0);
    assert.equal(metadata.lensStatusUnknown, true);
  }
  const status = { textContent: '', style: {} };
  const ui = vm.createContext({ window: { __TAURI__: {}, chromasmithAutoLens: true },
    document: { getElementById: () => status }, fxImages: [{ exif: { lensStatusUnknown: true, lens: 'Known lens' } }], fxCurIdx: 0 });
  vm.runInContext(between(html, 'function fxLensStatusRefresh(){', 'window.chromasmithLensStatusRefresh='), ui);
  ui.fxLensStatusRefresh();
  assert.match(status.textContent, /status is unavailable for this cached RAW photo/);
  ui.fxImages[0].exif.lensStatusUnknown = false; ui.window.chromasmithLensApplied = true;
  ui.fxLensStatusRefresh(); assert.match(status.textContent, /Applied on this photo/);
}
// Film source/negative development bypasses both cache reads and persistence.
{
  const h = harness(); vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  await open(h, settings({ filmSource: true }));
  assert.equal(h.calls.filter(x => x.command === 'get_cached_raw_decode').length, 0);
  assert.equal(h.decodes.length, 1); assert.equal(h.decodes[0].args.cachePath, undefined);
}
// Callers without source-backed per-file targets retain the historical size-matched global target.
{
  const h = harness(); vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  h.windowMock.__chromasmithPersistTarget = { path: '/legacy/photo.NEF', size: 2, recipeKey: 'legacy-key' };
  const raw = new h.context.Shim(); await raw.open(new Uint8Array([1, 2]), { outputBps: 8, rawNr: 'off' });
  assert.equal(h.decodes.length, 1); assert.equal(h.decodes[0].args.cachePath, '/legacy/photo.NEF');
  assert.equal(h.decodes[0].args.recipeKey, 'legacy-key');
}
// Malformed cached framing is rejected and falls through; matching full-cleanup settings are final.
{
  const h = harness({ cached: cacheFrame(2, 1, [1, 2, 3, 4]) }); vm.runInContext('globalThis.Shim = NativeLibRawShim', h.context);
  await open(h, settings({ cacheTargets: [{ path: PATH, recipeKey: `${PATH}|full` }], cacheTarget: { path: PATH, recipeKey: `${PATH}|full` }, rawNr: 'high', fullCleanup: true }));
  assert.equal(h.decodes.length, 1, 'malformed frame is a miss');
  assert.equal(h.decodes[0].args.rawNr, 'fast', 'High remains the existing explicit tier, never a cache/decode shortcut');
  const h2 = harness(); vm.runInContext('globalThis.Shim = NativeLibRawShim', h2.context);
  await open(h2, settings({ cacheTargets: [{ path: PATH, recipeKey: `${PATH}|full` }], cacheTarget: { path: PATH, recipeKey: `${PATH}|full` }, rawNr: 'high', fullCleanup: true }));
  assert.equal(h2.decodes.length, 0); assert.equal(h2.calls.find(x => x.command === 'get_cached_raw_decode').args.recipeKey, `${PATH}|full`);
}
console.log('PASS: per-source finished RAW cache reuse, exact target persistence, HDR/film safety and malformed fallback.');
