# Semi-safe preview verification for infographic refreshes

## Why this pattern exists

During infographics-only article refreshes, we can push a preview branch successfully and see `task.status=preview_pushed`, while external deployment lookups still show no branch URL for a period of time. Treat this as a **preview-readiness race/visibility** issue, not an automatic failure.

## Fast recovery sequence

1. **Freeze scope**
   - Do not merge to production while status is only `running`/unknown.
   - Keep the task at semi-safe hold until preview is confirmed.

2. **Read local publish output first**
   - Check `tools/out/deployments/preview-publish-<TASK_ID>-<timestamp>.json` in the agent repo.
   - Verify branch name, commit SHA, task id, and any returned deployment marker.

3. **Use local authoritative DB as source of truth**
   - Query `tasks` and `deployments` rows for the `task_id`.
   - Confirm fields that indicate progress: `status`, `risk_level`, `branch_name`, `commit_sha`, `deployment_type`, `cloudflare_deployment_id`, and preview URL fields when present.

4. **Verify branch existence and origin push**
   - Confirm branch exists locally and remotely (`agent/<task>-...`).
   - If branch exists and is pushed, the preview can be a propagation/race issue rather than a hard failure.

5. **Re-run deployment waiter with bounded windows**
   - Re-run the branch waiter with a bounded timeout/interval and keep polling for status transitions.
   - If still long-running, log checkpoint time, do not force merge.

6. **Report state explicitly**
   - In user-facing update, include:
     - task id + branch
     - latest DB status
     - publish JSON path
     - preview availability status (URL available or not yet visible)
     - next step (continue wait / re-run wait / user approval needed)

## Safety rule

For semi-safe work, production promotion requires explicit preview confirmation and task state transition via project tooling; never treat unresolved preview state as sufficient for production push.