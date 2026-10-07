# Desktop library backup format

The Library settings menu can create, verify, and restore a backup copy. A backup is a
directory named `Chromasmith Library Backup …`; choose its parent folder in the native folder
picker. It is published from a staging directory only after verification passes.

The version 1 bundle contains:

- `catalog/catalog.db` and its SQLite snapshot manifest, captured with SQLite Online Backup;
- the catalog's user organization and relationships (albums, stacks, keywords, people and queued
  edits), plus taught-subject JSON and reusable DCP LUT files;
- catalogued photo XMP sidecars, stored under `sidecars/volume-<id>/` using volume-relative paths;
- selected local preferences from `localStorage` (Chromasmith-prefixed keys and `csTheme`, with
  credential-like keys omitted);
- smart-collection registries and export history.

Original photo/video files and regenerated image/decode/thumbnail caches are excluded. XMP files
are library data and are included when present; the manifest reports catalogued photos without an
available sidecar. Keep a separate source-file backup for the original captures.

`library-backup.json` records the format/app versions, creation time, photo and sidecar counts,
source volume UUID/path mappings, inclusion policy, and byte length plus BLAKE3 checksum for every
payload file. Verification checks these checksums and reopens the SQLite snapshot for integrity,
foreign-key, schema-version, and photo-count checks. Restore copies a verified bundle to a new,
non-existing destination through a staging directory and verifies that copy before publishing it;
it never overwrites the current catalog.

## Current restore limits

The separate restore copy is a verified data bundle, not an activated library. The catalog and
album records retain their original absolute/mount paths; this slice does not provide a root
relink wizard or atomically swap live catalog state. Reconnect/remap original volumes before
using the restored catalog. Preferences are captured from local storage, but IndexedDB user LUTs,
export styles/presets, and complete editor recipe collections are not part of this format yet.
The files are individually hashed and staged, but the app does not currently pause every writer
across SQLite, XMP, and JSON stores for one cross-store instant; do not treat an in-progress edit
as frozen during a backup. These limits keep the UI honest and leave CHR-205 open for portability,
activation, and a cross-machine fixture pass.
