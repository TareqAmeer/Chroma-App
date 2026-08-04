# mediabunny (vendored)

- **Version:** 1.52.3
- **Source:** `https://registry.npmjs.org/mediabunny/-/mediabunny-1.52.3.tgz`
- **Verified:** tarball sha1 `073e817a015d7b9227618df8aa343771ae7a5ee9` matches the npm registry's
  published `dist.shasum` for this version.
- **File:** `mediabunny.min.mjs` is the package's own `dist/bundles/mediabunny.min.mjs` — a
  self-contained ESM bundle with zero external imports (verified: no `import` statements from
  anything outside the file). Loaded lazily via `import()`, same pattern as `vendor/libraw/index.js`
  (see `getLibRaw()` in `chromasmith-22.html`).
- **Licence:** MPL-2.0 (`LICENSE` in this directory, copied verbatim from the package). The MPL-2.0
  header is also baked into the top of `mediabunny.min.mjs` itself.

⚠️ Unlike `pako`/`utif2`, this file is **kept out of `chromasmith-22.html`'s inline `<script>`
blocks on purpose** — MPL-2.0 is file-level copyleft, so it must stay in its own identifiable file
with its licence notice intact, not pasted into the single-file bundle. See CLAUDE.md §12.

To update: re-download the tarball for the new version, verify its sha against
`npm view mediabunny@<version> dist.shasum`, replace `mediabunny.min.mjs`, bump the version in
this file.
