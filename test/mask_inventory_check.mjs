import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const inventory = JSON.parse(await readFile('test/output/panel_inventory.json', 'utf8')).local;
const contract = JSON.parse(await readFile('test/baselines/mask_inventory_contract.json', 'utf8'));
const failures = [];
const types = (inventory.discoveredMaskTypes || []).map((x) => x.type);
if (JSON.stringify(types) !== JSON.stringify(contract.maskTypes)) failures.push(`mask types changed: expected ${contract.maskTypes.join(', ')}, found ${types.join(', ')}`);
for (const control of inventory.controls || []) {
  if (!control.identity || control.unresolvedIdentity) failures.push(`unresolved control identity: ${control.kind} ${control.label || '(unlabelled)'}`);
  if (!Array.isArray(control.contexts) || !control.contexts.length) failures.push(`control lost state context: ${control.identity}`);
}
for (const [state, expected] of Object.entries(contract.stateVisibleIdentityDigests)) {
  const ids = (inventory.controls || []).filter((c) => c.contexts.some((x) => x.name === state && x.visible)).map((c) => c.identity).sort();
  const actual = createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0, 16);
  if (actual !== expected) failures.push(`${state}: conditional control set changed (${expected} -> ${actual}, ${ids.length} visible controls)`);
}
if (failures.length) {
  console.error(`mask inventory regression: ${failures.length} failure(s)`);
  failures.forEach((x) => console.error(`  - ${x}`));
  process.exit(1);
}
console.log(`mask inventory: ${types.length} types, ${inventory.states.length} states, ${inventory.controls.length} merged controls; contract intact`);
