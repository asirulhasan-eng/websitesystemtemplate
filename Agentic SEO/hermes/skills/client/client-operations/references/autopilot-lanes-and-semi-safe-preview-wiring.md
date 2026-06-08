# Autopilot lanes + semi-safe preview wiring

Use this when {{SITE_NAME}} tasks remain as candidates even though the user expects autopilot to work one-by-one and only ask for high-risk work.

## Durable lesson
The intended automation is not just `run_task_executor --apply` for safe tasks. It is risk-lane orchestration:

- Safe lane: execute deterministic safe tasks automatically, one at a time, with validation/rollback guards.
- Semi-safe lane: create/push preview branch and send preview details automatically, but do not merge/deploy production without approval.
- High-risk lane: approval-gated only; never auto-apply candidate high-risk tasks.

## Typical blockers
1. Daily cron calls the executor without `--apply`, so it produces plans/no_action instead of doing work.
2. Daily cron calls only the safe lane; semi-safe candidate tasks never reach preview.
3. SERP tasks have `target_url` but missing `target_file`, so executors cannot determine a safe file target.
4. Existing candidate rows predate a code fix, so generation is fixed but old rows remain missing `target_file` until backfilled.
5. The semi-safe pipeline acquires task locks, then the child executor tries to acquire the same locks again, causing self-conflict.
6. Preview email payload may use `branch` while the email formatter expects `branch_name`, producing incomplete review details.
7. Semi-safe live validation requires an explicit preview URL. If no preview domain/URL is configured, skip live URL validation with a clear `validation_skipped_reason` after branch push; otherwise pass `--url <previewUrl>` to `validate_live_deployment.js`.

## Expected cron executor shape
Daily cron should process one task per lane/run, not a large batch:

```bash
node tools/run_task_executor.js \
  --db tools/out/state/seo-agent.db \
  --site-root "${CLIENT_SITE_ROOT:-/opt/client-site}" \
  --limit 1 \
  --apply \
  --all-lanes \
  --push \
  --validate-live \
  --rollback-on-failure
```

Key meanings:
- `--limit 1`: keeps autopilot one-by-one.
- `--all-lanes`: includes semi-safe preview lane and approved high-risk lane.
- `--push`: lets semi-safe preview branches be pushed for review; it must not mean production merge.
- High-risk selection must remain approved-only in `run_task_executor.js`.

## Target-file remediation pattern
For URL-based SERP tasks, resolve files by URL before executing:

- Homepage URL -> `index.html`
- `/pages/foo` -> prefer existing `pages/foo.html`, then `pages/foo/index.html`
- Keep resolution site-root-aware so it can check the actual repo.

If old tasks already exist, add/run a backfill tool that updates only missing `target_file` from `target_url` through the same resolver and records an event + Obsidian outbox job. Verify with a copied DB before real DB.

## Semi-safe self-lock fix
If the semi-safe orchestrator already acquired locks, call the child executor with a skip-lock flag (for example `--skip-locks`) rather than acquiring locks twice. Add a regression test that `run_semi_safe_pipeline.js` passes the skip-lock flag into `execute_safe_task.js`.

## Email detail fix
Preview emails should include branch details regardless of payload key:

```js
payload.branch_name || payload.branch || ""
```

The user expects review details, not only â€œpreview readyâ€.

## Obsidian sync caution
When processing outbox after a single task preview, avoid blindly rsyncing the entire generated mirror if it contains hundreds of stale/untracked notes. Prefer processing outbox, then copy/commit only the specific task/deployment notes needed for the current change unless the task is a full mirror refresh.

## Verification checklist
- `node --test test/*.test.js` passes.
- The selected safe task moves to `executed` or production-deployed status as appropriate.
- The selected semi-safe task moves to `preview_ready` and has a pushed `origin/agent/...` branch.
- High-risk candidate tasks are still excluded unless approved.
- `outbox_jobs` has no pending email/Obsidian jobs for the task.
- All four repos are clean/synced before final report.
