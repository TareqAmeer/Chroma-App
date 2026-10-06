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
