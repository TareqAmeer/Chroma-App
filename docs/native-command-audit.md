# Native command audit (CHR-233)

Baseline: `origin/main` at `8b0cd346`. The inventory gate reported 197 registered commands,
177 frontend commands called by literal name, and 20 registered commands never called by name.
Review of the frontend sources found no computed dispatch for these 20. The only computed
`invoke(command, ...)` path dispatches the two display-cache names; framed invoke wrappers are
called with literal command names. No command in the audit qualified for a dynamic-use exception.

The shared checkout has since gained two literal callers for baseline entries: `catalog_clip_tags`
is invoked by the Library tag panel, and `scrfd_detect` is invoked by the editor's red-eye flow.
Both remain registered and are no longer considered uncalled in the current checkout. The current
checkout also no longer registers `catalog_photo_auto_tags`.

| Command | Classification and source evidence |
| --- | --- |
| `album_remove` | Uncalled handler. The only frontend occurrence is the `?libtest=1` stand-in; production album flows do not dispatch a removal call. |
| `album_set_order` | Uncalled handler. The only frontend occurrence is the `?libtest=1` stand-in; production album flows do not dispatch a reorder call. |
| `catalog_bg_paused` | Uncalled query handler. The frontend's background-indexing controls use `catalog_bg_set_paused`; no read call is dispatched. |
| `catalog_cancel_pending` | Uncalled cancellation handler. No production callsite; the UI uses the explicit reset/scan cancellation commands instead. |
| `catalog_clip_tags` | Baseline uncalled; now live. The Library tag panel dispatches it literally; retain its registration. |
| `catalog_detect_portable_people` | Uncalled portable-people handler. No production frontend callsite or computed dispatch was found. |
| `catalog_export_portable_people` | Uncalled portable-people handler. No production frontend callsite or computed dispatch was found. |
| `catalog_import_portable_people` | Uncalled portable-people handler. No production frontend callsite or computed dispatch was found. |
| `catalog_photo_auto_tags` | Baseline uncalled. It is absent from the current handler registration; the frontend uses auto-tag counts and photo-tag information. |
| `catalog_rebuild` | Uncalled rebuild handler. No production frontend callsite or computed dispatch was found. |
| `catalog_roots` | Uncalled roots query. The Library obtains its volume/root display data through `catalog_volumes`. |
| `get_thumbnail` | Uncalled Tauri endpoint. The Library dispatches `get_thumbnail_fast` and `get_thumbnail_or_offline`; Rust also uses the thumbnail function internally, so any cleanup must preserve the helper while removing only an unused IPC registration/wrapper. |
| `lens_profile_available` | Uncalled endpoint. The frontend lists lens profiles and passes decode options, but has no availability-query dispatch. |
| `list_edited` | Uncalled endpoint. A source comment describes it as a legacy alias, but the active collection view calls `list_collection`. |
| `registry_set_cmd` | Uncalled endpoint. The frontend uses `registry_set_many`; source comments document that the batched command replaced the per-photo call. |
| `save_decode_cache` | Uncalled endpoint. No production frontend dispatch was found; the decode cache path is handled by the native decode flow. |
| `scrfd_detect` | Baseline uncalled; now live. The editor's red-eye flow dispatches it through `_samFramedInvoke('scrfd_detect', ...)`; retain its registration. |
| `set_people_regions` | Uncalled endpoint. No production frontend dispatch was found. Rust tests exercise the persistence helper, so audit cleanup must preserve any helper behavior needed by those tests. |
| `take_pending_oauth_callback` | Uncalled endpoint. Adobe OAuth completion is delivered by the `adobe-oauth-callback` event listener; no command poll is dispatched. |
| `write_file_bytes_raw` | Uncalled endpoint. Production frontend writes use `write_file_bytes` or purpose-specific native writers; no raw-writer dispatch was found. |

After accounting for the two newly live calls and `catalog_photo_auto_tags` no longer being
registered in the shared checkout, 17 uncalled registrations were removed from `generate_handler![]`.
Three standalone command functions in `main.rs` and seven command wrappers in `catalog.rs` were
removed as well. The seven `library.rs` functions remain unregistered because that file was outside
this handoff; retain helpers with internal/test callers (notably `get_thumbnail`). The unrelated
`catalog_rename_preview` and `catalog_rename_apply` commands remain registered and called literally.
The focused scanner was not added to the shared checkout or run. The native-contract hardening
could not be retained under the instruction not to add or run tests without a user request.

## Remaining verification

Among the original 20 entries, 17 registrations were removed, `catalog_photo_auto_tags` was already
absent from the current handler list, and `catalog_clip_tags` plus `scrfd_detect` now have literal
frontend calls. No command from the original list is therefore expected to remain both registered
and uncalled by name. This is a source-based conclusion; it has not been verified against the
current handler list by running the scanner. The unrelated `ingest_cancel` mock gap also remains
outside this audit.

## Adapted upstream patterns

Tauri documents the IPC contract as frontend `invoke(commandName, args)` paired with a Rust command
registered in `generate_handler![]`. GIMP's Procedural Database and darktable's documented CLI/Lua
entrypoints illustrate explicit inventories for functionality exposed to callers. This audit
keeps the registration-to-call scan and requires every remaining name-only miss to carry a concrete
dynamic-call reason; dead registered endpoints do not become allowlist entries.

- [Tauri core API](https://tauri.app/reference/javascript/api/namespacecore/)
- [Tauri plugin command registration](https://tauri.app/develop/plugins/)
- [GIMP developer documentation](https://github.com/GNOME/gimp/blob/master/devel-docs/README.md)
- [darktable CLI documentation](https://github.com/darktable-org/dtdocs/blob/master/content/special-topics/program-invocation/darktable-cli.md)
