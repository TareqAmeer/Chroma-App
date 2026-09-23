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
2. Select the highest priority issue, then fetch its full description in a separate targeted tool call.
3. Update status to `In Progress`.
4. Output an `### Implementation Plan` detailing planned code changes.
5. STOP GENERATING. Wait for explicit user approval ("LGTM" or "Approved") before modifying any code.

### 3. Completion Protocol (Codebase -> Linear & DEVLOG)

When implementation and verification are complete, run this mandatory task-completion hook before reporting completion:

1. Resolve the exact Linear issue for this work. Prefer the issue identifier supplied by the user; otherwise search by task title and only use a unique, clearly matching result. Do not guess or update an unrelated issue.
2. Append a 2–3 bullet summary of completed work, modified files, and issue ID to `DEVLOG.md`.
3. Stage only task-owned files. Preserve unrelated and pre-existing working-tree changes; never use `git add -A` to publish them.
4. Commit the completed task on `main` with a concise, descriptive message. If the current branch is not `main`, or unrelated local changes prevent a safe commit on `main`, stop and report the blocker instead of rewriting or discarding work.
5. Push to `origin main`; never force-push. If remote `main` has advanced, integrate it safely and rerun relevant verification before pushing. Stop if a safe fast-forward update is not possible.
6. Update the matching Linear issue with the completion summary, verification performed, and commit hash. Keep the issue in `In Review`; never mark it `Done` because the user does their own final testing.

### 4. Visual Attachment Protocol

When reading a Linear issue that contains markdown image links (e.g., `![alt](https://uploads.linear.app/...)`):

1. Extract the image URL from the description.
2. Download the authenticated asset locally by running:
   `.scripts/fetch-linear-image.sh "<IMAGE_URL>" "/tmp/issue_image.png"`
3. Inspect `/tmp/issue_image.png` using local vision/image viewing capabilities.
4. Reference visual context (UI layout bugs, design specs, alignment issues) directly in the `### Implementation Plan`.
