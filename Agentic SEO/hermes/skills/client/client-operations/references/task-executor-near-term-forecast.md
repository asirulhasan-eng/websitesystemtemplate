# Task Executor Near-Term Forecast Pattern

## Trigger
Use this when the user asks what will happen in the next hour or two, whether tasks will complete soon, or asks for a near-term {{SITE_NAME}} automation forecast.

## Risk Lane
Safe/read-only. This is inspection and forecasting only; do not modify queues, repos, cron, or production state.

## Required Checks
1. Use authoritative SQLite first: `/opt/client-sqlite/seo-agent.db`.
2. Capture current time in both UTC and Dhaka:
   ```bash
   date -u '+UTC %Y-%m-%dT%H:%M:%SZ'
   TZ={{TIMEZONE}} date '+Dhaka %Y-%m-%d %H:%M:%S %Z'
   ```
3. Inspect system cron, because near-term behavior depends on cadence, not just queue contents:
   ```bash
   crontab -l
   ```
4. Inspect relevant wrapper scripts before forecasting task behavior:
   - `/opt/client-agent/tools/cron/run-task-executor.sh`
   - `/opt/client-agent/tools/cron/run-daily.sh`
   - `/opt/client-agent/tools/cron/run-monitor.sh`
   - `/opt/client-agent/tools/cron/run-outbox-worker.sh`
   - `/opt/client-agent/tools/cron/run-email-check.sh`
5. Query recent cron runs from the authoritative DB:
   ```sql
   SELECT job_name,status,started_at,finished_at,error_summary
   FROM cron_runs
   ORDER BY started_at DESC
   LIMIT 20;
   ```
6. Query the current candidate queue by lane and likely executor order:
   ```sql
   SELECT risk_level, json_extract(metadata_json,'$.task_type') AS task_type,
          COUNT(*) AS count, MAX(priority_score) AS max_priority
   FROM tasks
   WHERE status='candidate'
   GROUP BY risk_level, task_type
   ORDER BY risk_level, max_priority DESC;

   SELECT task_id,risk_level,priority_score,target_keyword,target_url,target_file,
          json_extract(metadata_json,'$.task_type') AS task_type,title
   FROM tasks
   WHERE risk_level='safe' AND status IN ('candidate','approved')
   ORDER BY priority_score DESC, created_at ASC
   LIMIT 3;

   SELECT task_id,risk_level,priority_score,target_keyword,target_url,target_file,
          json_extract(metadata_json,'$.task_type') AS task_type,title
   FROM tasks
   WHERE risk_level='semi_safe' AND status IN ('candidate','approved')
   ORDER BY priority_score DESC, created_at ASC
   LIMIT 10;

   SELECT task_id,risk_level,status,priority_score,target_keyword,target_url,target_file,
          json_extract(metadata_json,'$.task_type') AS task_type,title
   FROM tasks
   WHERE risk_level='high_risk' AND status='approved'
   ORDER BY priority_score DESC
   LIMIT 3;
   ```
7. Inspect recent task-executor logs to confirm actual current behavior:
   ```bash
   tail -80 /opt/client-agent/logs/task-executor.log
   ```

## Interpretation Rules
- `run-task-executor.sh` currently uses `--limit 1 --apply --all-lanes --push --validate-live --rollback-on-failure` against `/opt/client-sqlite/seo-agent.db` by default.
- The limit is per lane in `run_task_executor.js`: safe candidates, semi-safe candidates, and approved high-risk tasks are selected separately.
- If there are zero safe candidates and zero high-risk approved tasks, but semi-safe `Monitor ...` candidates with no `task_type`, expect one semi-safe candidate per executor tick to become `monitored` / `no_preview_required`, not a production deployment.
- If wrappers or logs show `database is locked`, treat it as a possible skipped tick only if later ticks have not recovered. If later ticks completed, forecast normal processing with a caveat.
- Outbox and email cron jobs may run in the same window; include them separately from task completion.

## Reporting Shape
Report concisely:
- Risk classification: Safe/read-only forecast.
- Current time and forecast window in Dhaka.
- Next scheduled executor ticks.
- Current queue counts by lane.
- Likely next task IDs/keywords in priority order.
- Expected status transitions (`monitored`, `executed`, `preview_ready`, etc.).
- What is not expected, e.g. no daily loop, no deploy, no high-risk action, if supported by cron and queue state.
- Caveats from recent logs, such as lock contention or failed cron runs.

## Pitfalls
- Do not claim tasks will be â€œcompletedâ€ just because executor ticks will run. For semi-safe monitoring tasks with no deterministic edit, the expected outcome is usually `monitored/no_preview_required`.
- Do not forecast from repo-local `/opt/client-agent/tools/out/state/seo-agent.db` unless explicitly comparing DB routing; authoritative task state is `/opt/client-sqlite/seo-agent.db`.
- Do not ignore cron timezone. The system crontab uses `TZ={{TIMEZONE}}`; present near-term times in Dhaka for the user.
