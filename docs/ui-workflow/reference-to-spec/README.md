# Reference-to-spec workflow

This vendor-neutral workflow turns a supplied visual reference into a reviewable component
specification. It does not infer a design when no reference is supplied. Specifications use
`schema.json`; start from `template.json`, then save completed records under
`docs/ui-workflow/reference-to-spec/specifications/`. Keep image files outside the JSON and record
their path or URL, provenance, and view-level scope. Never embed base64 images or copy application
source into a specification.

The `generated` section contains direct reference observations, repository evidence, and shown or
missing state and variant coverage. A visible observation must be directly measurable from a named view; if
uncertain, leave it out and record a question or proposal in `authored`. Every evidence item names
its source class and source reference. `authored` contains design rules, proposed interpretations,
user decisions, and unresolved questions. The implementation fields are authored proposals until
the user decides them. The validator is offline and read-only; it never promotes status or edits a
specification.

## Workflow

1. Register the reference and its provenance, then describe each full view, crop, state, or
   annotation separately. A view may show only part of a component; state the visible scope.
2. Identify the affected component family through the component registry. Set `scope.componentFamily`
   to its contract family name; the validator resolves `contracts/<family>.json` without copying
   registry locations into this format.
3. Record only directly visible observations. Mark each shown and missing state and variant explicitly; do not
   infer unseen states or turn uncertain visual readings into facts.
4. Compare observations with `chromasmith-design/project/design.md` and the one relevant family
   contract. Record applicable rules with exact source references and repository findings in their
   separate sections.
5. Write proposed interpretations and explicit questions for uncertainties, conflicts, and choices
   the reference cannot settle.
6. Obtain user decisions for unresolved design questions and record who decided what and when.
   Production implementation must wait until all approval-blocking questions are resolved.
7. Set `approval.status` to `approved` only after the user explicitly approves the implementation
   specification. Record the approving user, date, and decision IDs, then freeze that approved spec.
8. Implement against the frozen acceptance criteria and run its validation evidence plan, including
   required screenshots. Report results against each criterion.

`template.json` is intentionally blank and is accepted only as a template scaffold. Remove its
`template` marker when creating a real specification. A real specification must name a supported
component family. `approval.status` remains `draft` or `proposed` until a human records approval;
approved status is rejected while unresolved questions remain or approval evidence is incomplete.

## Commands

Validate one file:

```sh
npm run reference:spec:validate -- docs/ui-workflow/reference-to-spec/specifications/<name>.json
```

Validate the blank template and all specifications:

```sh
npm run reference:spec:validate:all
```

The validator checks required structure, source classes and references, family contract existence,
state coverage, acceptance criteria for approved specs, and approval boundaries. It does not inspect
production source or modify files.

## Reusable prompts

### Reference analysis prompt

```text
Analyze the supplied reference for a reviewable component specification only. Do not implement,
edit, or propose production UI changes. Use docs/ui-workflow/reference-to-spec/README.md,
schema.json, and template.json; read only chromasmith-design/project/design.md, the Phase 2 entries
of docs/ui-workflow/STATE.md, component-contracts/README.md, component-contracts/schema.json, and
the single relevant family contract. Read targeted registry evidence only if required to identify
the family. Do not read unrelated contracts or production source. Use no more than [N] percentage
points of the five-hour usage allowance; check usage before work and before optional work. Stop if
the family is unsupported, evidence conflicts, a required file is unavailable, a check fails, or a
design decision is needed to define the workflow format. Keep direct observations, repository facts,
design rules, proposals, user decisions, and questions separate. Do not fill gaps by guessing. Report
the spec path, unresolved decisions, focused checks, and ending usage concisely.
```

### Approved-spec implementation prompt

```text
Implement only the approved specification at [SPEC PATH]. First verify approval status and that no
unresolved questions remain. Read the specification, its referenced family contract, design.md, and
only the production files necessary for its named implementation targets. Use no more than [N]
percentage points of the five-hour usage allowance; check usage before work and before optional
work. Stop if approval evidence is incomplete, a target or acceptance criterion is ambiguous, the
spec conflicts with its family contract or design rules, a focused check fails, or the cap would be
exceeded. Do not broaden scope. Validate every acceptance criterion and required evidence, then
report changed files, checks, results, blockers, and ending usage concisely.
```
