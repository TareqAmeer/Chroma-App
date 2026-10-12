# AGENTS.md

## AI Linear Workflow Rules

### Linear Connector Availability

Linear is installed and connected for this repository. Treat it as available whenever an issue
identifier (for example, `CHR-141`) or Linear workflow is referenced.

- Linear tools may be lazily surfaced rather than appearing in the initially displayed tool list.
  Do not conclude that Linear is unavailable from that list alone.
- Retrieve a referenced issue directly with the Linear issue tool (for example,
  `mcp__codex_apps__linear_get_issue`) before reporting that its details cannot be accessed.
- Only report Linear as unavailable after attempting the applicable Linear tool and receiving an
  actual availability, authorization, or connection error.

### 1. In-Linear Triage Protocol

When instructed to "run triage" or "triage linear":

1. Verify the Linear MCP tool is available. If missing, notify the user and STOP.
2. Determine the triage cap from the user's command. The user may specify it directly, for example, "triage linear, cap 20". If no cap is specified, ask the user what maximum number of issues to process before querying Linear.
3. Query Linear for issues in the "Triage" state OR issues in "Backlog" with no priority assigned.
   - CRITICAL: Apply the user-specified cap as the strict `limit` parameter to this tool call.
4. For each un-triaged issue:
   - Evaluate the title and description.
   - Assign Priority: `Urgent`, `High`, `Normal`, or `Low`.
   - Assign Label: `bug`, `feature`, `refactor`, or `ux`.
   - If the description lacks acceptance criteria, append a `### Acceptance Criteria` checklist to the issue body.
   - Move issue status to `Backlog` or `Todo`.

### 2. Execution Protocol (Linear -> Codebase)

When instructed to "start work" or "next task":

1. Fetch issues assigned to the user in `Todo` or `In Progress` status. Request ONLY `ID`, `Title`, and `Priority` fields with `limit: 3`.
2. Select the highest priority issue, then fetch its full description in a separate targeted tool call. When the user authorizes work through the open repository queue and no assigned actionable issue exists, select from this team's open backlog by priority and dependency order. Keep issue list requests small and fetch descriptions only for selected work.
3. Update status to `In Progress`.
4. Output an `### Implementation Plan` detailing planned code changes.
5. Continue implementation after presenting the plan when the user has authorized execution. Authorization to work through a ticket queue carries across subsequent tickets; do not request approval for each ticket. Ask only when a material requirement is ambiguous, an action falls outside the authorized scope, or a destructive operation needs explicit approval.
6. Inspect existing worktrees before starting. Reuse a suitable task checkout or create a named feature branch/worktree based on current `origin/main`. Define the task-owned files and keep unrelated drafts, promotional assets, and other agents' changes separate.

### 3. Completion Protocol (Codebase -> Linear & DEVLOG)

When implementation and verification are complete, run this mandatory task-completion hook before reporting completion:

1. Resolve the exact Linear issue for this work. Prefer the issue identifier supplied by the user; otherwise search by task title and only use a unique, clearly matching result. Do not guess or update an unrelated issue.
2. Append a 2–3 bullet summary of completed work, modified files, and issue ID to `docs/DEVLOG.md`.
3. Stage only task-owned files. Preserve unrelated and pre-existing working-tree changes; never use `git add -A` to publish them.
4. Commit task-owned changes in the task's named feature branch/worktree with a concise, descriptive message. Feature branches may hold task commits; being on a non-main branch is a normal workflow state, not a reason to stop. Preserve unrelated local changes. If the checkout is detached, create a named task branch before committing.
5. Publish through a clean, dedicated `main` integration checkout. Fetch current `origin/main`, check whether the feature or an equivalent patch is already published, and integrate only missing task changes. Resolve conflicts while preserving newer main behavior, then run relevant verification. Do not replace current files wholesale with older worktree copies or mix unrelated drafts into the integration. Preserve dirty checkouts rather than discarding or rewriting their work.
6. Push the verified integration to `origin main`; never force-push. If remote main advances, integrate it safely and rerun relevant verification before retrying. Use a fast-forward update of remote main. Authorization to complete and publish the task carries through this integration step; do not stop merely because implementation started on a feature branch.
7. Verify publication before reporting completion: confirm the remote main commit contains the task change, and record the published commit hash and verification in DEVLOG and the matching Linear issue. Keep the issue in `In Review`; never mark it `Done` because the user does their own final testing. Do not claim that uncommitted work, a local commit, or a feature-branch push alone is published to main.
8. If safe integration or publication is genuinely blocked, report "implemented locally, publication blocked" and include the branch, checkout path, commit hash (if any), exact blocker, and remaining verification. Preserve the work and continue independent authorized steps. Never silently leave completed features stranded in a worktree.

### 4. Visual Attachment Protocol

When reading a Linear issue that contains markdown image links (e.g., `![alt](https://uploads.linear.app/...)`):

1. Extract the image URL from the description.
2. Download the authenticated asset locally by running:
   `.scripts/fetch-linear-image.sh "<IMAGE_URL>" "/tmp/issue_image.png"`
3. Inspect `/tmp/issue_image.png` using local vision/image viewing capabilities.
4. Reference visual context (UI layout bugs, design specs, alignment issues) directly in the `### Implementation Plan`.

## Storage-efficient worktree policy

This repository has a 50 GB working-folder budget. Avoid creating a linked worktree for each ticket: reuse the current checkout and switch feature branches serially when its working tree is safe to switch. Keep completed commits on their feature branches and integrate them through the normal clean main checkout. Create at most one temporary linked worktree at a time, only when parallel isolation is necessary; record why it is needed and remove it as soon as its task-owned changes are preserved. Do not duplicate model/vendor assets or build outputs into another checkout.

Run desktop Cargo builds through `desktop/package.json` scripts (`npm run dev` or `npm run build`) so `scripts/tauri-shared-cache.mjs` directs all linked checkouts to the same per-user Cargo target directory. For direct Cargo commands, set `CARGO_TARGET_DIR` to that same directory first. Rust target directories are generated cache and may be removed when no build is using them; never delete source, untracked work, vendor/model assets, or an entire checkout as a cache-cleanup shortcut. Inspect Git status and the exact resolved path before cleanup. Never use `git clean -fdx` for storage reclamation.

Keep large shared, immutable assets in one canonical checkout unless a build explicitly requires a different location. Do not hardlink editable source or use `git clone --shared` as a worktree substitute; edits through a hardlink affect every name, and Git's shared-clone object alternates can become invalid after source garbage collection. Git linked worktrees already share repository objects and refs while retaining distinct working directories, so prefer one working directory and shared generated caches over multiple full copies.

Shared Node dependencies must live in a permanent runtime directory, never inside a task worktree. Before retirement, inspect other checkouts' `node_modules` and `desktop/node_modules` junction targets as well as running processes. Repoint any dependent checkout to the preserved permanent runtime before removing the old directory; verify package resolution and rerun the affected checks. Process command lines alone do not reveal dependency junctions or every working directory.

For routine diagnostics use `python scripts/diagnostics-light.py start --duration 5m`: it retains metrics/logs/thread-state sampling while suppressing automatic full Windows process dumps. The existing watcher treats idle child processes as possible stalls and otherwise creates large `-ma` dumps even during normal idle sessions. Use the explicit `--full-dumps` option only when process-memory evidence is needed. Preserve prior unique diagnostic evidence; lossless compression with decompressed SHA256 verification can reclaim space without discarding it.

When retiring an unused checkout, preserve unpublished commits under named refs and save any needed dirty, untracked or ignored data first. Verify that no active task/build uses it and resolve the exact removal path inside the intended workspace. On Windows, `git worktree remove` may leave the directory behind after a filename-length error. After those preservation/path checks, finish removing only that verified directory with native PowerShell `Remove-Item -LiteralPath ... -Recurse -Force`; confirm disappearance and the retained ref. Do not delete unrelated worktrees or prune their refs as part of this fallback.

References: [Git worktrees](https://git-scm.com/docs/git-worktree), [Cargo build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html), [Git shared clones](https://git-scm.com/docs/git-clone#Documentation/git-clone.txt---shared), and [Windows hard links](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions).

Keep formatting limited to the task changes. Running rustfmt on main.rs recursively formats child modules, and formatting whole legacy main.rs/catalog.rs creates large unrelated diffs. Use `--config skip_children=true` for isolated modules; review status before and after, and preserve existing formatting outside changed functions.

In PowerShell, check `$LASTEXITCODE` after each Git mutation before taking a dependent step. If local main belongs to another preserved checkout, create a clean integration branch from fetched origin/main in the existing integration checkout and publish with `git push origin HEAD:main`; do not create another checkout or bypass worktree ownership. Native tests must verify cache paths: `CS_CACHE_DIR` redirects thumbnail caches, while developed RAW decode caches can still use the shared platform cache. Use unique recipe keys and delete only exact test-created outputs with verified identity.

Native Windows UI tests must also set `WEBVIEW2_USER_DATA_FOLDER` to the single reusable `.worktrees/_shared-test-runtime/native/webview-profile` before launching the owned test app. Catalog/cache environment overrides do not isolate WebView localStorage: restoring the main app's remembered roots can start unrelated scans in a disposable catalog. Verify the WebView process profile and catalog identity before writes; pause background work and allow only named test roots. Reuse this profile serially rather than creating one per ticket, and close only verified test-owned processes. Microsoft documents this override in [Playwright WebView2 testing](https://github.com/microsoft/playwright/blob/main/docs/src/webview2.md).

For asynchronous UI restoration, wait for the expected path/offset or state to be reached, then assert that it remains stable. Geometry can briefly settle before a queued restoration runs; a few stable frames alone do not establish completion. Before a navigation baseline, ensure the clicked target is fully visible and verify the pointer-down position, because browser automation can scroll a clipped target before dispatching the click. Include a normal-motion case alongside reduced-motion tests. Visibility checks must include readable bounds and overlap, not just a mounted DOM node.
