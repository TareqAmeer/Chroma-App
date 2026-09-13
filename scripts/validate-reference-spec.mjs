#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(repoRoot, 'docs/ui-workflow/reference-to-spec');
const schemaPath = path.join(workflowDir, 'schema.json');
const contractsDir = path.join(repoRoot, 'docs/ui-workflow/component-contracts/contracts');
const specsDir = path.join(workflowDir, 'specifications');

function fail(message) {
  console.error(`reference-spec: ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(repoRoot, file)}: invalid JSON (${error.message})`);
  }
}

const schema = readJson(schemaPath);
function resolveRef(ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported schema reference: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], schema);
}

function validateNode(value, rule, at, errors) {
  if (rule.$ref) {
    validateNode(value, resolveRef(rule.$ref), at, errors);
    return;
  }
  if (rule.type) {
    const valid = Array.isArray(rule.type)
      ? rule.type.some((type) => matchesType(value, type))
      : matchesType(value, rule.type);
    if (!valid) {
      errors.push(`${at}: expected ${Array.isArray(rule.type) ? rule.type.join(' or ') : rule.type}`);
      return;
    }
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) errors.push(`${at}: must equal ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${at}: must be one of ${rule.enum.join(', ')}`);
  if (typeof value === 'string' && rule.minLength && value.length < rule.minLength) errors.push(`${at}: must not be empty`);
  if (Array.isArray(value) && rule.items) value.forEach((item, index) => validateNode(item, rule.items, `${at}[${index}]`, errors));
  if (value && typeof value === 'object' && !Array.isArray(value) && rule.properties) {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required field is missing`);
    for (const [key, child] of Object.entries(value)) {
      if (rule.properties[key]) validateNode(child, rule.properties[key], `${at}.${key}`, errors);
      else if (rule.additionalProperties === false) errors.push(`${at}.${key}: unsupported field`);
    }
  }
}

function matchesType(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function collectJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJsonFiles(full);
    return entry.isFile() && entry.name.endsWith('.json') ? [full] : [];
  });
}

function semanticErrors(spec, file) {
  const errors = [];
  const at = path.relative(repoRoot, file);
  const add = (message) => errors.push(`${at}: ${message}`);
  if (spec.template === true) {
    const provenance = spec.reference.provenance;
    const registryScope = spec.scope.registryScope;
    const hasContent = spec.reference.views.length || Object.values(provenance).some(Boolean) ||
      registryScope.includedSubfamilies.length || registryScope.excludedFamilies.length || registryScope.notes ||
      spec.generated.visibleObservations.length || spec.generated.repositoryEvidence.length ||
      spec.generated.stateCoverage.shown.length || spec.generated.stateCoverage.missing.length ||
      spec.generated.variantCoverage.shown.length || spec.generated.variantCoverage.missing.length ||
      spec.authored.applicableDesignRules.length || spec.authored.proposedInterpretations.length ||
      spec.authored.userDecisions.length || spec.authored.unresolvedQuestions.length ||
      Object.entries(spec.implementation).some(([key, value]) => key === 'acceptanceCriteria' ? value.length : value.length) ||
      spec.validation.requiredScreenshots.length || spec.validation.evidence.length ||
      spec.approval.status !== 'draft' || spec.scope.componentFamily !== '';
    if (spec.id !== 'template-only' || hasContent) add('template marker is reserved for the blank template scaffold');
    return errors;
  }
  if (typeof spec.scope.componentFamily !== 'string' || !/^[a-z][a-z0-9-]*$/.test(spec.scope.componentFamily)) {
    add('scope.componentFamily must be a supported family slug (lowercase letters, digits, hyphens)');
  } else {
    const contractFile = path.join(contractsDir, `${spec.scope.componentFamily}.json`);
    if (!fs.existsSync(contractFile)) add(`unsupported component family '${spec.scope.componentFamily}'; no matching family contract exists`);
    else {
      try {
        const contract = readJson(contractFile);
        if (contract.family !== spec.scope.componentFamily) add(`family contract ${path.relative(repoRoot, contractFile)} declares '${contract.family}'`);
      } catch (error) {
        add(error.message);
      }
    }
  }

  const viewIds = new Set(spec.reference.views.map((view) => view.id));
  for (const view of spec.reference.views) {
    if (/^data:image\//i.test(view.assetRef)) add(`reference view '${view.id}' must use a path or URL, not embedded image data`);
  }
  const observedIds = new Set();
  for (const item of spec.generated.visibleObservations) {
    observedIds.add(item.id);
    if (!viewIds.has(item.viewId) || item.sourceRef !== item.viewId) add(`visible observation '${item.id}' must cite its existing reference view as sourceRef`);
    if (item.certainty !== 'directly-visible') add(`visible observation '${item.id}' is uncertain; move it to a proposal or unresolved question`);
  }
  const repositoryIds = new Set(spec.generated.repositoryEvidence.map((item) => item.id));
  const ruleIds = new Set();
  for (const rule of spec.authored.applicableDesignRules) {
    ruleIds.add(rule.id);
    if (!rule.sourceRef.includes('design.md')) add(`design rule '${rule.id}' must cite design.md in sourceRef`);
  }
  for (const list of [
    spec.generated.stateCoverage.shown, spec.generated.stateCoverage.missing,
    spec.generated.variantCoverage.shown, spec.generated.variantCoverage.missing
  ]) {
    for (const item of list) {
      const exists = item.sourceClass === 'reference' ? viewIds.has(item.sourceRef) : repositoryIds.has(item.sourceRef);
      if (!exists) add(`state '${item.state}' has an unresolved ${item.sourceClass} sourceRef '${item.sourceRef}'`);
    }
  }
  const evidenceIds = new Set([...observedIds, ...repositoryIds, ...ruleIds]);
  const proposalLists = [spec.authored.proposedInterpretations, ...[
    'geometrySpacing', 'typography', 'colorsContrastRoles', 'icons', 'motionInteraction',
    'responsiveBehavior', 'accessibility', 'targets'
  ].map((key) => spec.implementation[key]), spec.validation.evidence];
  for (const list of proposalLists) {
    for (const proposal of list) {
      for (const id of proposal.basedOn) if (!evidenceIds.has(id)) add(`proposal '${proposal.id}' cites unknown evidence ID '${id}'`);
    }
  }
  const decisionIds = new Set(spec.authored.userDecisions.map((decision) => decision.id));
  if (spec.approval.status === 'approved') {
    if (spec.authored.unresolvedQuestions.length) add('approval.status cannot be approved while unresolvedQuestions remain');
    if (!spec.approval.approvedBy.trim() || !spec.approval.approvedAt.trim()) add('approved status requires approvedBy and approvedAt');
    if (!spec.approval.userDecisionRefs.length) add('approved status requires at least one explicit user decision reference');
    for (const id of spec.approval.userDecisionRefs) if (!decisionIds.has(id)) add(`approval cites unknown user decision '${id}'`);
    if (!spec.implementation.acceptanceCriteria.length) add('approved status requires at least one acceptance criterion');
  } else if (spec.approval.approvedBy || spec.approval.approvedAt || spec.approval.userDecisionRefs.length) {
    add('approval evidence is only allowed when approval.status is approved');
  }
  return errors;
}

function validateFile(file) {
  try {
    const spec = readJson(file);
    const errors = [];
    validateNode(spec, schema, '$', errors);
    if (matchesType(spec, 'object') && ['generated', 'authored', 'implementation', 'validation', 'approval', 'scope', 'reference'].every((key) => spec[key])) {
      errors.push(...semanticErrors(spec, file));
    }
    if (errors.length) return errors;
    console.log(`${path.relative(repoRoot, file)}: valid`);
    return [];
  } catch (error) {
    return [error.message];
  }
}

const args = process.argv.slice(2);
let files;
if (args.length === 1 && args[0] === '--all') {
  files = [path.join(workflowDir, 'template.json'), ...collectJsonFiles(specsDir)].sort();
} else if (args.length === 1 && !args[0].startsWith('-')) {
  files = [path.resolve(process.cwd(), args[0])];
} else {
  console.error('Usage: node scripts/validate-reference-spec.mjs <spec.json> | --all');
  process.exit(2);
}

let totalErrors = 0;
for (const file of files) {
  const errors = validateFile(file);
  for (const error of errors) fail(error);
  totalErrors += errors.length;
}
if (args[0] === '--all' && totalErrors === 0) console.log(`reference specifications: ${files.length} valid`);
if (totalErrors) process.exitCode = 1;
