# Chromasmith UI/UX backlog

`backlog.json` is the canonical, editable record of the 100 design recommendations gathered from the two supplied reviews plus this review's 30 additions. `id` and `rank` now run 1–100 in priority order (P0 → P3), with the prior recommendation number retained as `source_id`. Use `id` for agent tasks and dependencies; use `source_id` to cross-reference the supplied reviews. `depends_on` captures prerequisites and the clusters keep related work together. Update `status` (`backlog`, `ready`, `in_progress`, `blocked`, `done`, `dropped`), `owner`, and `notes` as work changes. Keep a completed item in the file and record evidence in `completion_evidence`; do not renumber IDs after this reordering. Update `updated_at` whenever the backlog is materially reordered.

Priority is the primary ordering signal: P0 = urgent trust/usability defect or enabling gate; P1 = high-value workflow improvement; P2 = valuable enhancement; P3 = exploratory/optional polish. Dependencies use the priority-ordered IDs. Re-score as evidence changes, but keep IDs stable once work is referenced; append new items or explicitly migrate all references if a full reorder is needed. Do not treat model suggestions as hard requirements: choose the best currently available model, and use visual review plus repository gates for every implementation.

## AI workflow

Use this file as the common source of truth for Claude Code and Codex. Select one bounded item (or a tightly coupled group), include its IDs in the task title/branch/PR, read its `title`, `reference`, `depends_on`, and `acceptance` fields, then update status and evidence when finished. Keep one active owner per item. For large work, split into child issues while retaining the parent ID here. A blocked item must state the concrete blocker and the decision needed. Do not mark an item done because the code was written; verify the user-visible behaviour and relevant tests.

This follows GitHub Projects' use of stable issue references, typed priority/status metadata, dependency links, and table/board views. The JSON stays repository-native and reviewable; it can later be imported or mirrored to GitHub Issues/Projects without making the agent's working copy depend on an external service.

## Suggested work views

- **Now:** P0, then P1 items whose dependencies are done.
- **Next:** remaining P1, ordered by rank.
- **Later:** P2/P3.
- **By cluster:** use `cluster` to keep related work contiguous.
- **Agent queue:** filter by `recommended_executor`, but keep human review as the final acceptance step.

The model names in the file were checked on 2026-09-14 against official OpenAI and Anthropic model pages. Recheck model availability before starting long work; product names and access can change.
