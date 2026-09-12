# Component registry

`design/components.json` is the generated, app-wide source map for repeated UI components and
semantic icons. The visual catalogue at `?catalog=1` shows representative components and states;
the registry answers **where every source-locatable instance is declared**.

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
```

Each instance has a source file and line. It also has a stable CSS selector when the production
markup provides one. `coverage.dynamicInstances` and `coverage.withoutStableSelector` are explicit
debt: they remain findable by source line, but a global automated edit must inspect them rather
than assuming a selector reaches them.

The `appleComponent` field maps a family to the closest component defined by
`chromasmith-design/project/design.md`. `null` means the Apple-derived file does not define that
app-specific component. Create and approve a component contract for it before redesigning it.
