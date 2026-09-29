// Create and check mechanically generated component-contract drafts from the checked-in
// component registry and runtime registry. This script never makes design decisions.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_DIR = path.join(ROOT, 'docs/ui-workflow/component-contracts/contracts');
const args = process.argv.slice(2);
const valueAfter = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
const wanted = valueAfter('--family');
const outputDir = valueAfter('--output-dir');
const check = args.includes('--check');
const refresh = args.includes('--refresh-observations');
const knownFlags = new Set(['--family', '--output-dir']);
const booleanFlags = new Set(['--check', '--refresh-observations']);

function fail(message) { console.error(message); process.exit(1); }
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (booleanFlags.has(arg)) continue;
  if (knownFlags.has(arg)) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail(`missing value for ${arg}`);
    i++;
    continue;
  }
  fail(`unknown argument: ${arg}`);
}
if (check && refresh) fail('--check and --refresh-observations cannot be combined');
if (wanted && !/^[a-z0-9-]+$/.test(wanted)) fail(`invalid family name: ${wanted}`);

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const query = (queryArgs) => JSON.parse(execFileSync(process.execPath, ['scripts/query-components.mjs', ...queryArgs], {
  cwd: ROOT,
  encoding: 'utf8',
}));
function registrySummary() { return query(['--summary']); }
function familyQuery(family) { return query(['--family', family]); }
function sortedUnique(values) { return [...new Set(values)].sort(); }
function declarationId(entry) { return `${entry.source}:${entry.line}`; }

function authoredDraft(family) {
  return {
    identity: { family, subfamilies: [], designSystemComponent: null, designSystemEvidence: 'unreviewed' },
    purpose: 'unreviewed',
    semantics: { uses: [], mismatch: 'unreviewed' },
    anatomy: { parts: [], evidenceLimit: 'unreviewed' },
    variants: [],
    themes: { current: 'unreviewed', proposed: null },
    states: { current: [], evidenceLimit: 'unreviewed' },
    responsiveDimensions: {},
    tokens: { references: [], rawLiterals: [], proposed: [], exception: null },
    typography: { current: 'unreviewed', proposed: null },
    motion: { current: 'unreviewed', proposed: null },
    keyboardPointer: { pointer: 'unreviewed', keyboard: 'unreviewed' },
    accessibility: { current: 'unreviewed', evidenceLimit: 'unreviewed' },
    systemDesignRules: [],
    proposedTargets: {},
    decisions: [],
    exceptions: [],
    currentVsProposed: { current: 'unreviewed', proposed: null },
    userDecisions: [],
    references: [],
    questions: [],
  };
}

function makeContract(family, registry, runtime, overlapMap, timestamp) {
  const matches = registry.matches.map((entry) => ({
    key: entry.key,
    source: entry.source,
    line: entry.line,
    tag: entry.tag ?? null,
    selector: entry.selector ?? null,
    id: entry.id ?? null,
    classes: entry.classes ?? [],
    label: entry.label ?? null,
    dynamic: Boolean(entry.dynamic),
    familyMembership: overlapMap.get(declarationId(entry)) ?? [family],
  }));
  const familyDeclarations = new Set(registry.matches.map(declarationId));
  const appearances = runtime.instances.filter((entry) => entry.family === family);
  const appearanceDeclarations = new Set(appearances.flatMap((entry) => entry.sourceDeclarations ?? []));
  const unmatchedRegistrations = registry.matches.filter((entry) => !appearanceDeclarations.has(entry.key));
  const unresolvedAppearances = appearances.filter((entry) => entry.unresolved === true);
  const runtimeUnresolved = (runtime.unresolved ?? []).filter((entry) => entry.family === family);
  const dynamicRegistrations = matches.filter((entry) => entry.dynamic);
  const noStableSelector = matches.filter((entry) => !entry.selector);
  const evidenceGaps = [];
  if (!appearances.length) evidenceGaps.push('no saved runtime appearances for this family');
  if (unmatchedRegistrations.length) evidenceGaps.push(`${unmatchedRegistrations.length} source registrations have no linked runtime appearance`);
  if (unresolvedAppearances.length || runtimeUnresolved.length) evidenceGaps.push(`${unresolvedAppearances.length + runtimeUnresolved.length} runtime records are unresolved`);
  if (dynamicRegistrations.length) evidenceGaps.push(`${dynamicRegistrations.length} source registrations are marked dynamic`);
  if (noStableSelector.length) evidenceGaps.push(`${noStableSelector.length} source registrations have no stable selector`);

  const authored = authoredDraft(family);
  return {
    schemaVersion: 1,
    family,
    purpose: 'Unreviewed; purpose requires human review.',
    status: 'draft',
    observations: {
      generatedBy: 'scripts/scaffold-component-contracts.mjs',
      generatedAt: timestamp,
      registry: {
        query: `node scripts/query-components.mjs --family ${family}`,
        sourceRegistrationCount: registry.count,
        expectedCount: registry.count,
        locations: matches,
        overlappingFamilyMembership: [...overlapMap.entries()]
          .filter(([declaration, families]) => familyDeclarations.has(declaration) && families.length > 1)
          .map(([declaration, families]) => ({ declaration, families }))
          .sort((a, b) => a.declaration.localeCompare(b.declaration)),
        coverageGaps: {
          sourceRegistrationsWithoutRuntimeAppearance: unmatchedRegistrations.map((entry) => entry.key),
          dynamicRegistrations: dynamicRegistrations.map((entry) => entry.key),
          registrationsWithoutStableSelector: noStableSelector.map((entry) => entry.key),
        },
      },
      runtime: {
        evidenceSource: 'design/components-runtime.json',
        appearanceCount: appearances.length,
        runtimeAppearanceCount: appearances.length,
        distinctSemantics: sortedUnique(appearances.map((entry) => entry.semantic).filter(Boolean)),
        states: sortedUnique(appearances.map((entry) => entry.state).filter(Boolean)),
        variants: (runtime.variants ?? []).filter((variant) => variant.startsWith(`${family}|`)).sort(),
        instances: appearances,
        unresolvedAppearances: runtimeUnresolved,
        coverageComplete: evidenceGaps.length === 0,
        evidenceGaps,
      },
    },
    authored,
    validation: {
      commands: [
        `node scripts/query-components.mjs --family ${family}`,
        `node scripts/validate-component-contracts.mjs --family ${family}`,
      ],
      scope: 'Unreviewed generated draft; observations only, not a design or production gate.',
    },
    approval: null,
    authoredDigest: sha(authored),
  };
}

function comparableObservations(value) {
  const copy = structuredClone(value);
  delete copy.generatedAt;
  return copy;
}
function toggleObservationsCurrent(contract, registry, runtime) {
  const appearances = runtime.instances.filter((entry) => entry.family === 'toggle');
  const expectedLocations = registry.matches.map(({ key, source, line, selector, id, classes, dynamic }) => ({ key, source, line, selector, id, classes, dynamic }));
  const observed = contract.observations ?? {};
  const observedRegistry = observed.registry ?? {};
  const observedRuntime = observed.runtime ?? {};
  return observedRegistry.expectedCount === registry.count
    && JSON.stringify(observedRegistry.locations) === JSON.stringify(expectedLocations)
    && observedRuntime.appearanceCount === appearances.length
    && JSON.stringify(observedRuntime.distinctSemantics) === JSON.stringify(sortedUnique(appearances.map((entry) => entry.semantic)))
    && JSON.stringify(observedRuntime.states) === JSON.stringify(sortedUnique(appearances.map((entry) => entry.state)))
    && JSON.stringify(observedRuntime.instances) === JSON.stringify(appearances);
}

try {
  const summary = registrySummary();
  const families = Object.keys(summary.families).sort();
  if (!families.includes('toggle')) fail('generated registry does not include required toggle family');
  if (wanted && !families.includes(wanted)) fail(`family not present in generated registry: ${wanted}`);

  const selected = (wanted ? [wanted] : families).filter((family) => family !== 'toggle');
  const allQueries = new Map();
  for (const family of families) allQueries.set(family, familyQuery(family));
  const membership = new Map();
  for (const [family, result] of allQueries) {
    for (const entry of result.matches) {
      const id = declarationId(entry);
      membership.set(id, [...(membership.get(id) ?? []), family]);
    }
  }
  for (const [id, list] of membership) membership.set(id, sortedUnique(list));

  const runtime = JSON.parse(readFileSync(path.join(ROOT, 'design/components-runtime.json'), 'utf8'));
  const directory = outputDir ? path.resolve(ROOT, outputDir) : DEFAULT_DIR;
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  let created = 0; let current = 0; let refreshed = 0; let missing = 0; let stale = 0; let errors = 0; let toggleSkipped = 0;

  if (wanted === 'toggle' || !wanted) {
    const toggleFile = path.join(directory, 'toggle.json');
    if (existsSync(toggleFile)) {
      toggleSkipped++;
      if (check) {
        try {
          const toggle = JSON.parse(readFileSync(toggleFile, 'utf8'));
          if (toggleObservationsCurrent(toggle, allQueries.get('toggle'), runtime)) current++;
          else stale++;
        } catch (error) { errors++; console.error(`toggle.json: invalid JSON (${error.message})`); }
      }
    } else if (!outputDir && check) missing++;
    else if (!outputDir) { errors++; console.error('toggle.json: required existing contract is missing; refusing to recreate it'); }
  }

  for (const family of selected) {
    const contractFile = path.join(directory, `${family}.json`);
    const expected = makeContract(family, allQueries.get(family), runtime, membership, timestamp);
    if (!existsSync(contractFile)) {
      if (check) { missing++; continue; }
      writeFileSync(contractFile, `${JSON.stringify(expected, null, 2)}\n`, { flag: 'wx' });
      created++;
      continue;
    }

    let existing;
    try { existing = JSON.parse(readFileSync(contractFile, 'utf8')); }
    catch (error) { errors++; console.error(`${family}.json: invalid JSON (${error.message})`); continue; }
    const matches = JSON.stringify(comparableObservations(existing.observations ?? {}))
      === JSON.stringify(comparableObservations(expected.observations));
    if (matches) { current++; continue; }
    if (check) { stale++; continue; }
    if (!refresh) {
      errors++;
      console.error(`${family}.json: observations are stale; use --refresh-observations to update observations only`);
      continue;
    }

    if (existing.authoredDigest !== sha(existing.authored)) {
      errors++;
      console.error(`${family}.json: authoredDigest mismatch; refusing observation refresh`);
      continue;
    }
    const authoredBefore = JSON.stringify(existing.authored);
    const digestBefore = existing.authoredDigest;
    existing.observations = expected.observations;
    if (JSON.stringify(existing.authored) !== authoredBefore || existing.authoredDigest !== digestBefore) {
      errors++;
      console.error(`${family}.json: refresh attempted to alter authored content; refusing write`);
      continue;
    }
    writeFileSync(contractFile, `${JSON.stringify(existing, null, 2)}\n`);
    refreshed++;
  }

  if (check) {
    console.log(`contracts: current ${current}, missing ${missing}, stale ${stale}, toggle preserved ${toggleSkipped}`);
    if (missing || stale || errors) process.exitCode = 1;
  } else {
    console.log(`contracts: created ${created}, current ${current}, refreshed ${refreshed}, toggle preserved ${toggleSkipped}`);
    if (errors) process.exitCode = 1;
  }
} catch (error) {
  console.error(`scaffold failed: ${error.message}`);
  process.exitCode = 1;
}
