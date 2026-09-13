# Chroma reference analysis workflow

## Scope and evidence

Analyze one component family or one bounded screen per invocation. First confirm the reference file, provenance, intended component or screen, and each visible state/view. Keep the original unchanged. Record full-image dimensions, then name crops for complex references; orient with low detail and inspect small components as crops at original detail.

Every finding must be one of: a directly visible reference observation, deterministic measurement, repository-validated fact, user decision, proposed interpretation, or unresolved question. In the existing JSON format, direct observations and deterministic measurements are separate `generated.visibleObservations` records: measurements include `measurement.value` and `measurement.unit`; cite the named view in `sourceRef`, state sampling/crop method and confidence in `fact`, and never turn a sampled color into a semantic token. Put repository facts in `generated.repositoryEvidence`, design rules in `authored.applicableDesignRules`, decisions in `authored.userDecisions`, proposals in `authored.proposedInterpretations` or implementation proposal lists, and uncertainties in `authored.unresolvedQuestions`.

Use deterministic pixel/color evidence before model estimates. Treat shadows, blur, alpha, and antialiasing as ranges unless exact deterministic evidence supports a value. `npm run reference:measure -- <png> <output-dir> [x,y ...]` provides PNG dimensions and RGBA pixel samples only; WebP and semantic interpretation remain unsupported. Keep fixed screenshot geometry separate from inferred responsive rules.

## Repository evidence

Query the registry narrowly with `node scripts/query-components.mjs --family <family>` to identify affected production families and declarations. Do not read complete registry JSON or production HTML. Read only the contract files for affected families, using `docs/ui-workflow/component-contracts/README.md` for routing. Map observations to roles and tokens in `chromasmith-design/project/design.md` before proposing values. Identify repeated registered elements so one spec governs all occurrences.

Compare against `docs/ui-workflow/reference-to-spec/README.md`, `schema.json`, and `template.json`. Start the draft from the template and save it as `docs/ui-workflow/reference-to-spec/specifications/<name>.json`. A reference conflict with `design.md`, or conflicting references, is an unresolved user decision—not a correction or redesign.

## Coverage, review, and stop

Explicitly record shown and missing states/views. Consider hover, focus, pressed, disabled, changed, error, mobile, light/dark, keyboard, reduced motion, and forced colors when relevant. Never infer invisible interaction states, responsive behavior, typography identity, accessibility behavior, or production structure from pixels alone; do not identify a font by appearance.

Validate the draft with `npm run reference:spec:validate -- docs/ui-workflow/reference-to-spec/specifications/<name>.json`. Then write a concise human review: certain evidence, proposals, smallest user decisions, affected component scope, and evidence still needed. Stop after the draft and review. Keep `approval.status` as `draft` or `proposed`; approval requires explicit user approval and no unresolved questions.

If a required input, family, evidence source, or validation is unavailable or fails, stop and report it. Do not substitute guesses for unavailable deterministic measurements. Do not claim pixel-perfect extraction.
