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
contract with `status: "proposed"` remains a review artifact until a human records approval.

Commands:

```bash
node scripts/validate-component-contracts.mjs --all
node scripts/validate-component-contracts.mjs --family toggle
node scripts/validate-component-contracts.mjs --family toggle --refresh-observations
```

The validator resolves the registry query itself, compares its count with the contract, validates
referenced DTCG tokens, checks references and validation commands exist, and verifies that the
authored digest has not changed incidentally during an observation refresh.
