# CHR-242 — catalog sync and privacy decision

**Status:** provisional product decision, 2026-10-06  
**Implementation status:** documentation only. This change adds no sync provider, transport, account flow, or network request.

## Decision

Keep Chromasmith's catalog and editing state local to each installation for this slice. Do not add a hosted sync service, an iCloud/CloudKit provider, shared-folder catalog replication, or background cross-device replication. The existing local workflow remains the default and needs no account or sync opt-in.

This is a scope and privacy decision, not a claim that the current app has been architected for safe multi-device synchronization. Users may separately place source photos or sidecars on storage they manage; Chromasmith does not coordinate concurrent access to those files or promise that a shared/network folder is a supported catalog-sync mechanism. Existing explicit import/export and service integrations remain governed by their own user actions and privacy behavior; this decision adds no traffic to them.

No catalog fields, face/person/pet data, embeddings, usage state, or local settings are sent to a new service by this slice. Any future provider must be separately and explicitly enabled by the user, with its data scope and consequences visible before the first transfer. No provider is selected here.

## Local data boundary

| Data | Current boundary / source of truth |
| --- | --- |
| Original photos and videos | Read from user-selected storage; this feature does not copy or upload originals. |
| XMP sidecars and edit history | Stored beside the source image when the workflow writes a sidecar. The catalog code documents XMP as the source of truth for sidecar-backed work. |
| Catalog and organization | The SQLite catalog lives in the platform's application-data location. It indexes paths and keeps app catalog state such as ratings, favorites, keywords, stacks, and scan/analysis results on this installation. |
| People, pets, face regions, and derived recognition data | Local catalog/model state. These can identify people and are sensitive; this decision does not transmit them. |
| Previews, thumbnails, offline working data, and downloaded models | Local cache or application data, according to the feature's existing storage path. They are not a sync payload in this slice. |
| Preferences and local recipes | Local app state. They are not copied to another device by this work. |
| Exports and explicit service actions | Created only through their existing user-initiated workflows; they are not background catalog synchronization. |

The README currently describes the product as having no account, telemetry, uploads, or backend and says the web build works offline after first load. This ticket does not broaden that statement or audit every existing integration; product privacy wording must continue to match the shipped build and its explicit network features.

## Why defer sync

Photo applications demonstrate that “sync the photos” and “sync the editing catalog” are different problems. darktable documents XMP sidecars alongside a separate library database, warns that database state can take precedence over later sidecar changes, and says it has no dedicated function for sharing its database across computers. This is a useful boundary for Chromasmith's own catalog and sidecar split, not a design to copy blindly. [darktable: sidecar files](https://docs.darktable.org/usermanual/development/en/overview/sidecar-files/sidecar/) · [darktable: using multiple computers](https://darktable-org.github.io/dtdocs/en/special-topics/multiple-computers/)

Other established systems make the hidden work visible: Apple distinguishes local stores from stores mirrored to CloudKit and calls out account, change scheduling, persisted sync state, and conflict handling; Syncthing and Nextcloud document version/conflict copies for competing file changes. These mechanisms illustrate the product and recovery decisions a provider requires; they are not evidence that Chromasmith has implemented them. [Apple: decide whether CloudKit is right](https://developer.apple.com/documentation/cloudkit/deciding-whether-cloudkit-is-right-for-your-app) · [Apple: Core Data with CloudKit](https://developer.apple.com/documentation/CoreData/setting-up-core-data-with-cloudkit) · [Syncthing: file versioning](https://docs.syncthing.net/users/versioning) · [Nextcloud: desktop sync conflicts](https://github.com/nextcloud/documentation/blob/master/user_manual/desktop/conflicts.rst)

## Re-entry checklist

Before proposing or implementing any provider, a follow-up must answer and review all of these:

1. **Provider and support boundary:** name the provider(s), supported operating systems and versions, account/entitlement requirements, offline behavior, and whether sync is device-to-device, user-hosted, or hosted by Chromasmith. Keep local-only use available if the provider is missing or disabled.
2. **Data format and ownership:** version a portable schema; identify stable asset identity when volumes move; distinguish source originals, XMP, catalog records, recipes, preferences, models, caches, and derived data. State which device or file wins when representations disagree.
3. **Queue, ordering, and conflicts:** define durable change queues, idempotency, retry/backoff, deletions/tombstones, simultaneous edits, duplicate assets, schema migration, and a user-visible way to inspect and resolve conflicts. Never silently replace newer user work.
4. **Originals versus previews:** explicitly choose whether originals move at all. If only catalog/sidecars sync, document broken-path behavior; if previews are included, bound storage and eviction; if originals are included, define upload/download selection, bandwidth, quota, encryption, and recovery separately.
5. **Privacy and opt-out proof:** identify every transmitted field and recipient, retention and deletion rules, encryption boundaries, credentials, logs, and telemetry. Require affirmative opt-in, a durable off switch, and a reproducible zero-network verification for a fresh install and an opted-out existing profile (including startup, idle, editing, and export).
6. **Sharing:** decide whether any data can be shared with another person. If so, specify invitation/revocation, roles, consent for face/person/pet data, auditability, ownership after the owner leaves, and how shared data is removed from every device.
7. **Recovery and portability:** specify backup/restore, account loss, provider outage, device replacement, partial transfer, rollback, and export to a documented local format. Demonstrate restoration without the provider before claiming recoverability.
8. **Platform and fixture matrix:** test each supported OS, fresh and upgraded profiles, online/offline transitions, two-device concurrent edits, clock skew, interrupted writes, large catalogs, removed volumes, and migration/rollback with realistic fixture data. Record results and known gaps before changing the local-only default.

Passing this checklist is a prerequisite for a new decision, not automatic approval to ship sync. Until a follow-up explicitly changes the decision, the product has no app-managed cross-device catalog sync.
