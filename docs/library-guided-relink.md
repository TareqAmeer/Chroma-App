# Guided library relinking: implementation guardrails

Status: design slice for CHR-206. No catalog paths are changed by this document.

## Product precedent

Lightroom Classic treats an unavailable external volume as a drive availability problem first. If it is mounted elsewhere, Adobe recommends reconnecting it or restoring the expected drive letter. For an actually moved photo, the user chooses its new location; an opt-in “Find nearby missing photos” step can reconnect other files in the containing folder. A missing folder can be located as a batch. This is a useful interaction pattern: explicit root selection, a reviewable nearby-match step, and a distinct unplugged-drive state. [Adobe: Locate missing photos](https://helpx.adobe.com/lightroom-classic/desktop/manage-catalogs-and-files/locate-missing-photos.html)

digiKam likewise exposes an explicit collection-root “Update Path” operation for a changed local disk, while its database stores collection roots, image paths, tags, thumbnails, and face data together. Its documentation reinforces that root relocation is a catalog operation with related stored state, rather than a filesystem search by basename. [digiKam: Collections Settings](https://docs.digikam.org/en/setup_application/collections_settings.html), [digiKam: Database](https://docs.digikam.org/en/getting_started/database_intro.html)

## Chroma path and identity inventory

The desktop catalog already separates an external volume's identity from its current mount location. Writable media get a marker ID; read-only media fall back to a weaker fingerprint. `volumes.last_path` is a last-seen mount point. `roots.rel_path` and `photos.rel_path` are normalized, volume-relative paths. A photo's current absolute path is reconstructed from `volumes.last_path + photos.rel_path`, and `(volume_id, rel_path)` is unique. `catalog_volumes` currently derives online state from whether the last path is a directory; a false result does not distinguish an absent mount from an access-denied path.

Important path-linked state spans more than those three tables:

- `walked_dirs` stores root-relative directory and sidecar paths, keyed by root ID.
- `offline_edit_queue`, faces, tags, stacks, cached-offline previews, and most catalog annotations refer to stable `photo_id`s. Updating only a photo's path can preserve these database relationships.
- XMP edit/version sidecars are adjacent to the original file. Their recipe and version history are not duplicated as a durable catalog snapshot, so the selected replacement tree must be checked for the expected sidecars before applying.
- `albums.json` in application data stores absolute photo paths and album order.
- Per-collection registry JSON files store absolute paths for edited, favorites, flagged, rejected, recents, duplicates, and Google Photos membership.
- `export_history.json` is keyed by absolute photo path and can also store an absolute export destination.
- Subject/reference records should be checked before implementation: their labels are user-visible history, even when the matching prototype itself is path-independent.
- Path-derived thumbnail/decode caches are regenerable, but cache entries keyed by the old path will not follow a relocation.

The SQLite `photos` update can be atomic by itself, but SQLite cannot atomically commit with the separate JSON stores or XMP files. Therefore a transaction that updates only `roots`, `photos`, and `walked_dirs` is not a complete safe relink: it leaves albums, collection cards, and exported history pointing at the stale location. Those records are user data and should not be silently dropped or guessed at.

## Matching and state guardrails

1. Diagnose the current source before suggesting a move. Report a missing mount separately from an accessible volume with a missing file. Probe read access explicitly so permission-denied is distinct from not-found. A returning marker-identified volume must keep using the existing automatic mount-path reconnection behavior.
2. Let the user choose the replacement folder, following Lightroom's explicit missing-folder flow. Show a read-only preview before any catalog or sidecar write.
3. Use the old root's relative suffix to generate a candidate path under the chosen root. Require identity evidence beyond filename: exact file size plus a matching stored BLAKE3 content hash is the safe automatic tier. If the old hash is absent, the candidate changed, or the path maps more than one catalog row/candidate, show it as unresolved for manual review; never auto-accept a filename-only match. A relative-path and metadata-only suggestion may be shown as a suggestion but must not be described as verified.
4. Enforce one-to-one old/new assignments. Reject candidates already owned by another present catalog row unless the user explicitly resolves the collision. Treat same-content duplicates as ambiguous when catalog identity or per-photo edits could differ.
5. Preflight root ancestry, `(volume_id, rel_path)` uniqueness, case/Unicode normalization, permissions, read-only mounts, and all external path stores. Keep unresolved/deleted items in the catalog as missing; do not turn absence into deletion.
6. Apply accepted mappings while preserving photo IDs and relationships. Update directory walk state and all path-bearing JSON references in a recoverable operation with backups/journal and rollback on failure. If an external path store cannot be rewritten, stop before committing the catalog transaction and explain which records need repair. Refresh scan generations only after the path rewrite succeeds.
7. Retain the established behavior where a drive returning under its original marker identity only refreshes `last_path`; do not run the moved-folder workflow in that case.

## Safe next implementation slice

The first code slice should be read-only: a native preview command that accepts a registered missing root and a chosen folder, enumerates the exact relative-path candidates, reports availability/permission errors, and classifies each row as hash-verified, review-required, ambiguous, or absent. It must not mutate the catalog or path stores. Tests should use two fixture trees with repeated basenames, same-size different bytes, missing hashes, duplicate content, and permission/not-found outcomes.

Only after that preview is independently reviewed should a second slice add apply. Its tests need to prove transaction rollback on a uniqueness collision, stable photo IDs and relationship rows, album/registry/export-history rewrites, sidecar retention, interruption recovery, and unchanged automatic reconnect on a returning volume. This staged boundary avoids shipping a superficially successful relink that silently strands user state.

## References

- [Adobe Lightroom Classic: Locate missing photos](https://helpx.adobe.com/lightroom-classic/desktop/manage-catalogs-and-files/locate-missing-photos.html)
- [Adobe Lightroom Classic: Create and manage folders](https://helpx.adobe.com/lightroom-classic/desktop/manage-catalogs-and-files/create-folders.html)
- [digiKam: Collections Settings](https://docs.digikam.org/en/setup_application/collections_settings.html)
- [digiKam: Database](https://docs.digikam.org/en/getting_started/database_intro.html)
