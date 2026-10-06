# Native command audit (CHR-233)

Baseline: fetched `origin/main` at `61056ea855ffea9cbf8c95eaacb5c3f185927b26`. A prior source inventory identified 20 Tauri command registrations without production frontend callers. The current audit preserves the `take_pending_oauth_callback` endpoint because it consumes the pending OAuth URL used to cover a cold-launch listener race; removing the registration without changing that flow would lose a deliberate fallback.

The other 19 endpoints were removed from Tauri's registered command list. Rust helper bodies and direct unit-test callers remain where needed. `catalog_rename_preview` and `catalog_rename_apply` are separate new commands with literal frontend callers and remain registered.

| Command | Disposition |
| --- | --- |
| `album_remove` | Unregistered; function and direct Rust test callers retained. |
| `album_set_order` | Unregistered; function and direct Rust test callers retained. |
| `catalog_bg_paused` | Unregistered; pause state/helper and setter retained. |
| `catalog_cancel_pending` | Unregistered; scan/reset cancellation paths remain. |
| `catalog_clip_tags` | Unregistered with wrapper removed; current frontend uses `catalog_photo_tag_info`. |
| `catalog_detect_portable_people` | Unregistered; portable people helpers retained. |
| `catalog_export_portable_people` | Unregistered; `export_portable_people_run` retained. |
| `catalog_import_portable_people` | Unregistered; `import_portable_people_run` retained. |
| `catalog_photo_auto_tags` | Unregistered with wrapper removed; current frontend uses `catalog_photo_tag_info`. |
| `catalog_rebuild` | Unregistered; `rebuild_run` retained. |
| `catalog_roots` | Unregistered; volume/root UI uses `catalog_volumes`. |
| `get_thumbnail` | Unregistered; internal thumbnail callers and tests retained. |
| `lens_profile_available` | Unregistered; underlying lens profile helper retained for Rust tests. |
| `list_edited` | Unregistered; active view uses `list_collection`. |
| `registry_set_cmd` | Unregistered; batched `registry_set_many` path retained. |
| `save_decode_cache` | Unregistered; decode-cache persistence uses other native paths. |
| `scrfd_detect` | Unregistered; catalog face scan uses the internal SCRFD pipeline. |
| `set_people_regions` | Unregistered; helper and direct Rust tests retained. |
| `take_pending_oauth_callback` | **Retained** for the pending OAuth callback cold-launch fallback. |
| `write_file_bytes_raw` | Unregistered; purpose-specific raw writers remain. |

No scanner/test hardening was added or run. This is a source review against the fetched main snapshot; it is not a test result.

## References

- [Tauri core API](https://tauri.app/reference/javascript/api/namespacecore/)
- [Tauri plugin command registration](https://tauri.app/develop/plugins/)
- [GIMP developer documentation](https://github.com/GNOME/gimp/blob/master/devel-docs/README.md)
- [darktable CLI documentation](https://github.com/darktable-org/dtdocs/blob/master/content/special-topics/program-invocation/darktable-cli.md)