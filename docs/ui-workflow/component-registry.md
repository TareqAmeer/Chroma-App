# Component registry

`design/components.json` is the generated, app-wide source map for repeated UI components and
semantic icons. The visual catalogue at `?catalog=1` shows representative components and states;
the source registry answers **where every source-locatable instance is declared**, while
`design/components-runtime.json` records what the running app actually exposes across Editor,
Library, Match, Copy, Collage, Guide, dynamic Masks, the catalogue, and mobile layout.

Generate and verify it offline:

```bash
npm run components:build
npm run components:check
```

Use focused queries instead of reading the 10,000-line JSON file:

```bash
node scripts/query-components.mjs --summary
node scripts/query-components.mjs --family toggle
node scripts/query-components.mjs --icon heart
node scripts/query-components.mjs --text favourite
node scripts/query-components.mjs --runtime
node scripts/query-components.mjs --state editor:masks-dynamic
```

Each instance has a source file and line. It also has a stable CSS selector when the production
markup provides one. `coverage.dynamicInstances` and `coverage.withoutStableSelector` are explicit
debt: they remain findable by source line, but a global automated edit must inspect them rather
than assuming a selector reaches them.

`npm run components:check` performs both checks. It fails when source declarations drift and
when a runtime family, variant, state appearance, or unresolved semantic identity changes. One
production declaration appearing in several states retains the same `sourceDeclarations` key;
state appearances are not misreported as separate declarations. Runtime records without a safe
selector/source mapping remain explicit in `unresolved` and require inspection rather than being
counted as covered.

The `appleComponent` field maps a family to the closest component defined by
`chromasmith-design/project/design.md`. `null` means the Apple-derived file does not define that
app-specific component. Create and approve a component contract for it before redesigning it.
