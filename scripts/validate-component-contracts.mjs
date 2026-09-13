// Offline validator for vendor-neutral component contracts. It deliberately has no package
// dependency and never creates approvals, baselines, or production gates.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'docs/ui-workflow/component-contracts/contracts');
const args = process.argv.slice(2);
const wanted = args.includes('--family') ? args[args.indexOf('--family') + 1] : null;
const refresh = args.includes('--refresh-observations');
const allowedStatus = new Set(['draft', 'proposed', 'approved', 'retired']);
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function tokenNames() {
  const root = JSON.parse(readFileSync(path.join(ROOT, 'design/tokens.json'), 'utf8'));
  const names = new Set();
  const walk = (value, trail = []) => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, '$value')) { names.add(trail.join('.')); return; }
    for (const [key, child] of Object.entries(value)) if (!key.startsWith('$')) walk(child, [...trail, key]);
  };
  walk(root); return names;
}
function queryFamily(family) {
  return JSON.parse(execFileSync(process.execPath, ['scripts/query-components.mjs', '--family', family], { cwd: ROOT, encoding: 'utf8' }));
}
function runtimeFamily(family) {
  const runtime = JSON.parse(readFileSync(path.join(ROOT, 'design/components-runtime.json'), 'utf8'));
  return runtime.instances.filter((entry) => entry.family === family);
}
function refreshObservation(contract) {
  const before = sha(contract.authored);
  const registry = queryFamily(contract.family);
  const runtime = runtimeFamily(contract.family);
  contract.observations.generatedAt = new Date().toISOString();
  contract.observations.registry.expectedCount = registry.count;
  contract.observations.registry.locations = registry.matches.map(({ key, source, line, selector, id, classes, dynamic }) => ({ key, source, line, selector, id, classes, dynamic }));
  contract.observations.runtime.appearanceCount = runtime.length;
  contract.observations.runtime.distinctSemantics = [...new Set(runtime.map((x) => x.semantic))].sort();
  contract.observations.runtime.states = [...new Set(runtime.map((x) => x.state))].sort();
  contract.observations.runtime.instances = runtime;
  if (before !== sha(contract.authored)) throw new Error('generated refresh attempted to overwrite authored targets or approval metadata');
}
const files = readdirSync(DIR).filter((name) => name.endsWith('.json')).sort();
const selected = wanted ? files.filter((name) => name === `${wanted}.json`) : files;
if (wanted && !selected.length) { console.error(`component contract not found: ${wanted}`); process.exit(1); }
const tokens = tokenNames();
let failures = 0;
for (const name of selected) {
  const file = path.join(DIR, name);
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  try { if (refresh) { refreshObservation(contract); writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`); } }
  catch (error) { console.error(`${name}: ${error.message}`); failures++; continue; }
  const problems = [];
  const missing = (field) => problems.push(`missing required field: ${field}`);
  for (const key of ['schemaVersion', 'family', 'purpose', 'status', 'observations', 'authored', 'validation', 'approval', 'authoredDigest']) if (!(key in contract)) missing(key);
  if (contract.schemaVersion !== 1) problems.push('unsupported schemaVersion');
  if (!allowedStatus.has(contract.status)) problems.push(`invalid status: ${contract.status}`);
  if (contract.status === 'approved' && (!contract.approval || !contract.approval.approvedBy || !contract.approval.approvedAt)) problems.push('approved contract requires approval.approvedBy and approval.approvedAt');
  if (contract.status !== 'approved' && contract.approval !== null) problems.push('unapproved contract must not carry approval metadata');
  if (contract.authoredDigest !== sha(contract.authored)) problems.push('authoredDigest mismatch: generated observations must not overwrite authored targets or approval data');
  let query;
  try { query = queryFamily(contract.family); } catch (error) { problems.push(`unresolvable registry query: ${error.message}`); }
  if (query && query.count !== contract.observations.registry.expectedCount) problems.push(`registry count mismatch: contract=${contract.observations.registry.expectedCount}, query=${query.count}`);
  for (const token of contract.authored.tokens?.references || []) if (!tokens.has(token)) problems.push(`unknown token: ${token}`);
  for (const ref of contract.authored.references || []) {
    const physical = ref.split(':')[0];
    if (!existsSync(path.join(ROOT, physical))) problems.push(`missing reference file: ${physical}`);
  }
  for (const command of contract.validation?.commands || []) {
    const script = command.match(/(?:node\s+)?([\w./-]+\.mjs)/)?.[1];
    if (script && !existsSync(path.join(ROOT, script))) problems.push(`missing validation command file: ${script}`);
  }
  if (problems.length) { failures++; console.error(`${name}:\n- ${problems.join('\n- ')}`); }
  else console.log(`${name}: valid (${query.count} registry instances, ${contract.observations.runtime.appearanceCount} runtime appearances)`);
}
process.exitCode = failures ? 1 : 0;
