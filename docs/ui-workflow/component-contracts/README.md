# Component contracts

Component contracts are vendor-neutral, machine-readable review records for one real component
family. They are deliberately separate from the generated component registry:

- `schema.json` documents the common shape.
- `contracts/<family>.json` holds a reviewable contract. `observations` are generated facts;
  `authored` holds proposals, decisions, questions, and approval metadata.
- `scripts/validate-component-contracts.mjs` validates every contract or one requested family.
  Its optional `--refresh-observations` mode may refresh only registry locations and runtime
  observations. It refuses to alter authored targets or approval data.

These contracts do not approve a design, establish a baseline, or gate production changes. A
generated contract with `status: "draft"` is a mechanical scaffold of registry/runtime evidence;
it leaves purpose, targets, decisions, token choices, exceptions, and approval unset. A reviewed
contract records human decisions and evidence in `authored`. Generated drafts are not design
approval, and no status is promoted automatically.

Commands:

```bash
node scripts/validate-component-contracts.mjs --all
node scripts/validate-component-contracts.mjs --family toggle
node scripts/validate-component-contracts.mjs --family toggle --refresh-observations
npm run components:contracts:scaffold
npm run components:contracts:check
npm run components:contracts:scaffold -- --family slider
npm run components:contracts:scaffold -- --check --family slider
node scripts/scaffold-component-contracts.mjs --refresh-observations
```

The validator resolves the registry query itself, compares its count with the contract, validates
referenced DTCG tokens, checks references and validation commands exist, and verifies that the
authored digest has not changed incidentally during an observation refresh.

The scaffolder discovers families from the generated registry, excludes and preserves the existing
toggle contract, and records source registrations, runtime appearances, semantics, states, variants,
overlap, and coverage gaps. `--check` reports missing or stale scaffolds without writing. The
default command creates missing contracts only; `--refresh-observations` is the explicit safe mode
for refreshing observations while preserving authored content and its Phase 2A SHA-256 digest.
`--output-dir <path>` supports isolated generation checks.

For future AI design sessions, query and review only the family currently being designed, using
`--family <name>`, and do not treat generated draft evidence as a design decision or approval.
