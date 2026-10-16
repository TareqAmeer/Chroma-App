// Pulls named top-level functions/consts out of chromasmith-22.html into a vm sandbox so pure logic can be
// unit-tested in milliseconds, with no browser. Naive brace matching: fine for the pure helpers we extract;
// it throws if a name is missing or a block does not close, so a rename shows up as a test failure.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = fs.readFileSync(path.join(root, 'chromasmith-22.html'), 'utf8').split('\n');

function grab(name) {
  const re = new RegExp('^(?:async\\s+)?(?:function\\s+' + name + '\\b|(?:const|let|var)\\s+' + name + '\\b)');
  const start = lines.findIndex(l => re.test(l));
  if (start < 0) throw new Error('extract: top-level "' + name + '" not found in chromasmith-22.html');
  let depth = 0, out = [], seen = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]; out.push(l);
    for (const ch of l.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '')) {
      if (ch === '{' || ch === '[' || ch === '(') { depth++; seen = true; }
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
    const isFn = /^(?:async\s+)?function/.test(lines[start]);
    if (depth <= 0 && (isFn ? seen : /[;,]\s*(\/\/.*)?$|\}\s*$/.test(l))) return out.join('\n');
  }
  throw new Error('extract: "' + name + '" does not close');
}

// load(['s2l', 'rgb2oklab', ...], {extra globals}) -> sandbox object holding those names
export function load(names, globals = {}) {
  const ctx = vm.createContext({ Math, Float32Array, Array, console, window: {}, ...globals });
  for (const n of names) {
    const src = grab(n).replace(/^(const|let)\s/, 'var ');
    vm.runInContext(src, ctx, { filename: n });
  }
  return ctx;
}
