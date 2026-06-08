# Semi-safe preview branch policy and cleanup

## Context
{{SITE_NAME}} semi-safe automation can create preview branches for monitor/investigation tasks even when no deterministic content/page edit is proposed. Those branches create Cloudflare/GitHub clutter but carry no unique work.

## Durable policy
Use branch/previews only when they represent reviewable site/content changes:

- Safe monitoring or investigation-only work: do **not** create a Git branch or Cloudflare preview.
- Semi-safe task with deterministic page/content changes: create a branch, push it, and report the preview/review details.
- High-risk production change: keep approval gating; do not deploy without explicit approval.

## Implementation pattern
For semi-safe pipelines, plan first and branch second:

1. Run the deterministic task planner/executor in JSON planning mode before branch creation.
2. Treat concrete file/page writes (for example `write_file` actions with `file_path`) as the signal that a preview branch is warranted.
3. If the plan has no content/page changes, record an auditable no-preview result instead of creating an empty branch:
   - status such as `no_preview_required`
   - task state such as `monitored`
   - `branch: null`
   - `preview_url: null`
   - an event/outbox note update so the mirror still reflects what happened
4. If the plan has content/page changes, continue with the normal preview branch workflow.

## Regression tests
Keep tests for both lanes:

- monitor/investigation-only semi-safe task returns no-preview/no-branch
- semi-safe task with deterministic content edit creates a preview branch

## Empty branch cleanup rule
Only delete remote preview branches after proving they are empty duplicates:

1. Fetch/prune remotes.
2. Identify the default/base branch.
3. For each candidate preview branch, verify all of:
   - `ahead=0` versus base
   - `behind=0` versus base
   - no diff versus base
4. Delete only branches that satisfy all checks.

Do not bulk-delete preview branches solely because their names look old or their tasks sound like monitoring.