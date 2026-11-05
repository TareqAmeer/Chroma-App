# libraw-wasm (vendored)

- **Version:** 1.6.0 (latest release on npm as of 2026-11-05; published 2026-07-02). Built
  upstream from LibRaw 0.22.1, Little-CMS 2.19.1 and Emscripten's libjpeg port, Emscripten 5.0.7
  (per upstream `compileLibraw.sh`).
- **Source:** `https://registry.npmjs.org/libraw-wasm/-/libraw-wasm-1.6.0.tgz`
  (repo `https://github.com/ybouane/LibRaw-Wasm`, tag `v1.6.0`).
- **Verified:** tarball `sha512-VfvWq2XGGkc07wexymRLn1H82j6smmC1LAbVl41vnW2Z5RrEPLN+YHi1Hmga2TbxxrY4rOjmTwHwSyTZmypE1g==`
  and sha1 `2e97e53979c8abbbb2230b7755f84bc296e28838` match the registry's published
  `dist.integrity` / `dist.shasum` for this version.
- **Files:** copied byte-for-byte from the package's `dist/`. SHA-256:
  - `index.js` `3eb710aa5473c58c3b9dec74457b2ad2095d15b9a6df0056c96a3a011b720ca6`
  - `worker.js` `af074781439ddf9c47fcbd3b3f115049ab884fdf61ec49ab358f28a8c42a4d4c`
  - `libraw.wasm` `8947f7e668e488461c3e9defe7007583aa8477b4886aa603b36b407f2f0846ff`
  `worker.js` already contains the Emscripten glue (`dist/libraw.js` is not needed). Source maps
  and `index.d.ts` are not vendored. Loaded lazily via `import()` from `getLibRaw()`.
- **Licence:** the wrapper is ISC (package.json; the package ships no licence file). LibRaw itself
  is dual-licensed LGPL-2.1 or CDDL-1.0; Little-CMS is MIT; libjpeg is under the IJG licence.
- **Needs cross-origin isolation:** the wasm uses shared memory, so the page must be
  `crossOriginIsolated` (`coi-serviceworker.min.js` on GitHub Pages).

Why 1.6.0 (CHR-250): 1.1.2's `open()` freed its copy of the file while LibRaw still read from it in
`imageData()` (use-after-free), which put coloured noise on the top/bottom ~10 rows of Phase One
IIQ files and made the pixels depend on call order. 1.6.0 keeps the buffer as a class member.
Other changes since 1.1.2 that matter here: LibRaw 0.22.1, worker replies routed by id, decode
failures reject with an `Error`, `dispose()` added. The API `loadRw2` uses (`open`, `metadata`,
`imageData`, `worker.terminate()`) is unchanged. Measured effect on the 10 CHR-250 samples:
docs/raw-camera-coverage.md, note 4.

Upstream now recommends its successor, FlashRaw (a different decoder). Moving to it would be a
separate change with its own re-calibration; not done here.

To update: download the tarball for the new version, check it against
`npm view libraw-wasm@<version> dist.integrity`, replace the three files from `dist/`, update this
file, and re-run `node test/raw_decode_coverage.mjs` (full and `--half`) against the old output.
