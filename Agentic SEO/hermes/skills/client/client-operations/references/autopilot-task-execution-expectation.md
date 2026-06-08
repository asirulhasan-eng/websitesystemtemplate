# Autopilot Task Execution Expectation

## Trigger
Use this when the user asks why {{SITE_NAME}} tasks are not completing automatically, or when implementing/resuming task automation.

## User expectation
The expected operating model is:

- Work through candidate tasks one by one on autopilot.
- Safe tasks should be applied automatically after validation.
- Semi-safe tasks should create preview branches/Cloudflare previews and provide details for review before production.
- High-risk tasks require explicit confirmation/approval before execution or production changes.
- Do not treat every non-safe task as a reason to stop the whole queue; only high-risk approval should block.

## Durable diagnostic pattern
When tasks appear stuck as candidates:

1. Check whether the executor is running at all.
   - System cron may run `tools/cron/run-daily.sh` even if Hermes cron is empty.
   - Inspect `crontab -l` and recent `logs/daily.log`.

2. Check whether the executor is dry-run.
   - `run_task_executor.js` reports `dry_run: !args.apply`.
   - If `tools/cron/run-daily.sh` omits `--apply`, daily automation records reports but does not apply tasks.

3. Inspect latest executor artifacts.
   - `tools/out/executor/task-executor-*.json`
   - `tools/out/executor/task-execution-<task_id>-*.json`
   - Look for `dry_run: true`, `status: no_action`, and reasons such as `Target file not found: unknown`.

4. For SERP movement tasks, verify candidate shape separately from executor mode.
   - `target_file: null` prevents safe execution even if `--apply` is enabled.
   - `protect_ranking_gain` and `ranking_recovery` require deterministic executor behavior or a preview pipeline; otherwise they will not complete automatically.

## Implementation guidance
Do not simply add `--apply` to cron if SERP candidates lack `target_file` or task types lack deterministic actions. Fix in this order:

1. Resolve SERP `target_file` reliably.
   - Homepage URL â†’ `index.html`.
   - Extensionless URL â†’ prefer existing `path.html`, then `path/index.html`.

2. Define deterministic actions for safe SERP task types.
   - `protect_ranking_gain` should have a safe, bounded playbook before being auto-applied.
   - `ranking_recovery` should generally flow through semi-safe preview unless the action is clearly safe and deterministic.

3. Enable apply mode only for validated safe automation.
   - Example target shape: `--apply --validate-live --rollback-on-failure` for safe lane.
   - Keep high-risk approval gates intact.

4. Report evidence clearly.
   - Show cron command, executor dry-run/apply status, selected task IDs, artifact paths, and exact blocker reason.
