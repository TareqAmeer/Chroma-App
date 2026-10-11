// Exercise the production path-backed file helper through its source extraction seams.
// Small byte arrays keep the test independent of large RAW fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('desktop/library-ui.js', 'utf8');
const editor = await readFile('chromasmith-22.html', 'utf8');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `production seam ${start}`);
  return text.slice(a, b);
}
const paths = {
  raw: 'C:/photos/a.NEF', missing: 'C:/photos/missing.NEF', jpeg: 'C:/photos/a.jpg',
  badHead: 'C:/photos/bad-header.RW2', genericRaw: 'C:/photos/generic.DNG',
};
const full = new Map([
  [paths.missing, null], [paths.jpeg, Uint8Array.from([9, 8, 7])],
  [paths.raw, Uint8Array.from({ length: 1000 }, (_, i) => i & 255)],
  [paths.badHead, Uint8Array.from([1, 2, 3, 4, 5])],
  [paths.genericRaw, Uint8Array.from([6, 7, 8, 9])],
]);
const headReads = [], fullReads = [], errors = [], notices = [];
function makeHead(size, payload) {
  const out = new ArrayBuffer(8 + payload.length);
  new DataView(out).setBigUint64(0, BigInt(size), true);
  new Uint8Array(out, 8).set(payload);
  return out;
}
const windowMock = { __TAURI__: {} };
const context = vm.createContext({
  window: windowMock, File, ArrayBuffer, Uint8Array, DataView,
  RAW_EXT_RE: /\.(nef|rw2|dng)$/i,
  baseName: path => path.split('/').at(-1), mimeFromName: path => /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'application/octet-stream',
  toast: message => notices.push(message),
  console: { ...console, error: (...args) => errors.push(args) },
  invoke: async (command, args) => {
    if (command === 'read_file_head') {
      headReads.push(args.path);
      if (args.path === paths.missing) throw Error('missing head');
      if (args.path === paths.badHead) return new ArrayBuffer(4);
      const bytes = full.get(args.path);
      return makeHead(bytes.length, bytes.slice(0, Math.min(12, bytes.length)));
    }
    if (command === 'read_file_bytes') {
      fullReads.push(args.path);
      const bytes = full.get(args.path);
      if (!bytes) throw Error('missing source');
      return bytes;
    }
    throw Error(`unexpected IPC ${command}`);
  },
});
vm.runInContext([
  between(source, '  function makePathRawFile(', '  function framedInvoke('),
  between(source, '  async function readPathsAsFiles(', '  // ── ROADMAP R13'),
  'globalThis.readPathsAsFiles = readPathsAsFiles;',
].join('\n'), context);

// Generic callers retain true Blob bytes and do not issue a header read.
const ordinary = await context.readPathsAsFiles([paths.jpeg]);
assert.equal(await ordinary[0].arrayBuffer().then(b => new Uint8Array(b).length), 3);
assert.deepEqual(headReads, []);
assert.deepEqual(fullReads, [paths.jpeg]);

// The opt-in path-backed RAW keeps the declared source size and header, with no eager full read.
fullReads.length = 0;
const adapted = await context.readPathsAsFiles([paths.raw], { pathBackedRaw: true });
assert.equal(adapted[0].__csSourcePath, paths.raw);
assert.equal(adapted[0].size, 1000);
assert.equal(adapted[0].__csHead.length, 12);
assert.deepEqual(fullReads, []);
assert.equal((await adapted[0].arrayBuffer()).byteLength, 1000);
assert.deepEqual(fullReads, [paths.raw], 'full source is fetched only when arrayBuffer is explicitly requested');

// A head failure uses the original full-source File; a source read failure keeps okPaths aligned.
fullReads.length = 0;
const fallback = await context.readPathsAsFiles([paths.raw, paths.missing, paths.jpeg, paths.badHead], { pathBackedRaw: true });
assert.deepEqual(Array.from(fallback.okPaths), [paths.raw, paths.jpeg, paths.badHead]);
assert.equal(fallback[0].__csSourcePath, paths.raw);
assert.equal(fallback[1].__csSourcePath, undefined);
assert.equal(fallback[2].__csSourcePath, undefined);
assert.equal(await fallback[2].arrayBuffer().then(b => new Uint8Array(b).length), 5);
assert.deepEqual(fullReads, [paths.missing, paths.jpeg, paths.badHead]);
assert.equal(notices.length, 1);
assert.equal(errors.length, 1);

// The option remains opt-in even for desktop RAW paths.
headReads.length = 0; fullReads.length = 0;
const generic = await context.readPathsAsFiles([paths.genericRaw], { pathBackedRaw: false });
assert.equal(generic[0].__csSourcePath, undefined);
assert.equal(await generic[0].arrayBuffer().then(b => new Uint8Array(b).length), 4);
assert.deepEqual(headReads, []);
assert.deepEqual(fullReads, [paths.genericRaw]);
vm.runInContext(between(editor, 'function fxFileLoadKey(', 'async function loadFXImages('), context);
const sameName = new File([new Uint8Array(12)], 'a.NEF', { lastModified: 0 });
Object.defineProperty(sameName, 'size', { value: adapted[0].size });
sameName.__csSourcePath = 'C:/photos/other/a.NEF';
assert.notEqual(context.fxFileLoadKey(adapted[0]), context.fxFileLoadKey(sameName), 'same basename/size/zero timestamp must not share Editor identity across folders');
assert.equal(context.fxFileLoadKey(generic[0]), `${generic[0].name}:${generic[0].size}:${generic[0].lastModified}`);
console.log('PASS: opt-in RAW path-backed file, full-Blob default, validated-head fallback, source identity and failure alignment.');
