// native:contract — the three-way scan behind docs/test-everything-plan.md Layer 1.
//
//   registered  every command in desktop/src-tauri/src/main.rs's generate_handler![...]
//   called      every command name the frontend passes to invoke(...) / _samFramedInvoke(...)
//               in chromasmith-22.html, desktop/library-ui.js, desktop/desktop-native.js
//   mocked      every command the ?libtest=1 browser stand-in (libtestInvoke in library-ui.js) answers
//
// Hard fail: a command the frontend calls that Rust does not register (a guaranteed runtime
// error in the real app that no Chromium gate can see).
// Ratchet: called-but-unmocked commands are the browser test blind spot. The current list lives in
// test/native_contract_accepted.json; a NEW unmocked call fails, and a mocked one must be removed
// from the list (--update rewrites it). The list may only shrink.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const ACCEPTED = 'test/native_contract_accepted.json';

const main = read('desktop/src-tauri/src/main.rs');
const h = main.indexOf('generate_handler![');
const handlerBody = main.slice(h, main.indexOf('])', h));
const registered = new Set(
  handlerBody.replace(/#\[[^\]]*\]/g, '').replace(/\/\/.*$/gm, '')
    .slice('generate_handler!['.length).split(',').map((s) => s.trim().split('::').pop()).filter(Boolean),
);

const FRONTEND = ['chromasmith-22.html', 'desktop/library-ui.js', 'desktop/desktop-native.js'];
// A call's first argument may be a literal or a ternary of literals (invoke(a?'x':'y', ...)).
const callRe = /\b(?:invoke|_samFramedInvoke|framedInvoke|invokeNative|tauriInvoke)\(([^,)]*)/g;
const called = new Map();
const note = (c, f) => { if (!called.has(c)) called.set(c, new Set()); called.get(c).add(f); };
const stripMock = (f, src) => {
  if (f !== 'desktop/library-ui.js') return src;
  const a = src.indexOf('function libtestInvoke('), b = src.indexOf('libtest: no mock for', a);
  return src.slice(0, a) + src.slice(b);
};
for (const f of FRONTEND) {
  const src = stripMock(f, read(f));
  for (const m of src.matchAll(callRe)) for (const q of m[1].matchAll(/['"`]([a-z_0-9]+)['"`]/g)) note(q[1], f);
}
// A registered command named as a string literal anywhere outside the mock (e.g. assigned to a
// variable, then invoked) counts as called: indirect, but not dead.
for (const f of FRONTEND) {
  const src = stripMock(f, read(f));
  for (const c of registered) if (!called.has(c) && new RegExp(`['"\`]${c}['"\`]`).test(src)) note(c, f);
}

const lib = read('desktop/library-ui.js');
const ms = lib.indexOf('function libtestInvoke(');
const mockBody = lib.slice(ms, lib.indexOf("libtest: no mock for", ms));
const mocked = new Set([...mockBody.matchAll(/case '([a-z_0-9]+)'|cmd === '([a-z_0-9]+)'/g)].map((m) => m[1] || m[2]));

const unregistered = [...called.keys()].filter((c) => !registered.has(c)).sort();
const unmocked = [...called.keys()].filter((c) => !mocked.has(c)).sort();
const neverCalled = [...registered].filter((c) => !called.has(c)).sort();

if (process.argv.includes('--update')) {
  writeFileSync(ACCEPTED, JSON.stringify({ note: 'Called by the frontend but not yet answered by the ?libtest=1 stand-in. May only shrink.', unmocked }, null, 2) + '\n');
  console.log(`native:contract — wrote ${ACCEPTED} (${unmocked.length} unmocked)`);
  process.exit(0);
}

const accepted = new Set(existsSync(ACCEPTED) ? JSON.parse(read(ACCEPTED)).unmocked : []);
const newUnmocked = unmocked.filter((c) => !accepted.has(c));
const nowMocked = [...accepted].filter((c) => !unmocked.includes(c));

console.log(`native:contract — registered ${registered.size}, called ${called.size}, mocked ${mocked.size}`);
console.log(`  browser coverage: ${called.size - unmocked.length}/${called.size} called commands have a stand-in`);
console.log(`  registered but never called by name: ${neverCalled.length} (dynamic names or dead commands)`);
if (process.argv.includes('--json')) console.log(JSON.stringify({ unregistered, unmocked, neverCalled }, null, 2));

let fail = false;
if (unregistered.length) {
  fail = true;
  console.log(`  FAIL: frontend calls ${unregistered.length} command(s) Rust does not register:`);
  for (const c of unregistered) console.log(`    ${c}  (${[...called.get(c)].join(', ')})`);
}
if (newUnmocked.length) {
  fail = true;
  console.log(`  FAIL: new native call(s) with no browser stand-in — add a case to libtestInvoke:`);
  for (const c of newUnmocked) console.log(`    ${c}  (${[...called.get(c)].join(', ')})`);
}
if (nowMocked.length) {
  fail = true;
  console.log(`  FAIL: now mocked, remove from ${ACCEPTED} (run with --update): ${nowMocked.join(', ')}`);
}
console.log(fail ? 'native:contract — FAIL' : 'native:contract — PASS');
process.exit(fail ? 1 : 0);
