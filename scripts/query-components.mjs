// Small, offline queries over design/components.json so agents never need to read the full file.
import { readFile } from 'node:fs/promises';

const registry = JSON.parse(await readFile('design/components.json', 'utf8'));
const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const family = value('--family');
const icon = value('--icon');
const text = value('--text');

if (args.includes('--summary') || (!family && !icon && !text)) {
  console.log(JSON.stringify({
    families: Object.fromEntries(Object.entries(registry.families).map(([k, v]) => [k, v.instanceCount])),
    coverage: registry.coverage,
  }, null, 2));
  process.exit(0);
}

let matches = registry.instances;
if (family) matches = matches.filter((x) => x.family === family);
if (icon) matches = matches.filter((x) => x.icon === icon);
if (text) {
  const q = text.toLowerCase();
  matches = matches.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
}
console.log(JSON.stringify({ count: matches.length, matches }, null, 2));
