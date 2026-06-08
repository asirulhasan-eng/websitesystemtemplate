# Autopilot cadence + preview-ready diagnosis

Use this when the user asks why {{SITE_NAME}} is not "taking tasks one by one and completing" even though task automation appears configured.

## Durable lesson
The user expectation is continuous one-by-one autopilot. Verify both the executor command shape **and its schedule/cadence** before answering.

A correct executor command inside `tools/cron/run-daily.sh` can still only process one task per day if it is only invoked by the daily cron:

```cron
17 2 * * * cd /opt/client-agent && ./tools/cron/run-daily.sh >> logs/daily.log 2>&1
```

If the user expects ongoing progress throughout the day, the missing piece may be a separate executor cron, e.g. hourly, not just fixing `--apply`/`--all-lanes`.

## Diagnostic steps
1. Inspect `tools/cron/run-daily.sh` and confirm whether `run_task_executor.js` has:
   - `--limit 1`
   - `--apply`
   - `--all-lanes`
   - `--push`
   - validation/rollback flags
2. Inspect `crontab -l` to see how often task execution actually runs.
3. Inspect latest executor artifacts:
   - `tools/out/executor/task-executor-*.json`
   - `tools/out/pipelines/semi-safe-*.json`
4. Query candidate/preview states by risk/source/status. Important distinction:
   - Safe tasks should move to `executed`.
   - Semi-safe tasks are not production-complete; successful autopilot moves them to `preview_ready` with a branch/preview and review details.
   - High-risk tasks remain approval-gated.
5. Check whether top-priority tasks are blocked by missing `target_file` before recommending higher cadence.

## Common finding pattern
- Current candidate queue may be all `semi_safe`.
- One or more tasks may already be `preview_ready`, proving the semi-safe pipeline works.
- Top remaining SERP ranking-recovery candidates may have `target_file` empty even though `target_url` points to a known page. Backfill/resolve target files before enabling more frequent execution, otherwise hourly autopilot may repeatedly hit the same broken top candidates.

## Recommended remediation order
1. Backfill/repair missing `target_file` for existing SERP movement candidates using the site-aware URL-to-file resolver.
2. Verify one semi-safe task can become `preview_ready` and has a pushed branch/preview details.
3. Only then add a separate recurring task-executor cron if the user wants continuous progress, e.g. hourly:

```cron
0 * * * * cd /opt/client-agent && node tools/run_task_executor.js --db tools/out/state/seo-agent.db --site-root /opt/client-site --limit 1 --apply --all-lanes --push --validate-live --rollback-on-failure >> logs/task-executor.log 2>&1
```

Do not present semi-safe `preview_ready` as a production deployment. Report it as awaiting review/approval before merge.
