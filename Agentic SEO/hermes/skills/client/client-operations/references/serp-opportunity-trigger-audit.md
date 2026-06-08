# SERP Opportunity Trigger Audit

Use when the user asks what happened in the last SERP/opportunity trigger or why a SERP opportunity was/was not executed.

## Risk lane
Safe/read-only if limited to logs, artifacts, cron rows, and task/event state inspection.

## Audit sequence
1. Inspect Linux cron/logs, not Hermes cron only:
   - `crontab -l`
   - `tail -200 /opt/client-agent/logs/opportunities.log`
   - `tail -160 /opt/client-agent/logs/daily.log`
   - `tail -160 /opt/client-agent/logs/task-executor.log`
2. Find latest opportunity artifacts:
   - `/opt/client-agent/tools/out/runs/opportunity-scan-*.json`
   - `/opt/client-agent/tools/out/serp-movement/scan-*.json`
   - `/opt/client-agent/tools/out/task-candidates/scan-*.json`
3. Query cron/task state from the DB that the artifact/log reports and from the authoritative DB if they differ:
   - authoritative: `/opt/client-sqlite/seo-agent.db`
   - repo-local/runtime: `/opt/client-agent/tools/out/state/seo-agent.db`
   - Do not assume they are in sync; report which DB each fact came from.
4. Separate stages in the answer:
   - scan ran or failed
   - GSC opportunities count
   - SERP movement results by keyword
   - candidate generation: new vs existing
   - executor action afterward: executed, monitored/no-preview, preview_ready, skipped, or blocked
5. For executed `protect_ranking_gain` tasks, read the task-execution artifact and report whether files changed. Often this is a snapshot-only safe action with `changed_files: []` and `production_deploy_skipped`.
6. Check for known warning signs:
   - `switch.monster` candidates leaking into opportunity output despite the no-go rule
   - prune failures like `no such column: task_type`; current schema stores task type in `metadata_json`, so prune queries must not reference a nonexistent top-level `task_type` column.
   - task executor refusal due to dirty `/opt/client-site` while a blog publisher run is active.

## Reporting pattern
Give a short verdict first, then evidence:
- last trigger timestamp/status/artifact
- what SERP saw
- what task(s) were created
- what executor did next
- whether production changed
- blockers/bugs observed

Avoid saying â€œthe agent did Xâ€ until you have tied the claim to an artifact or DB row.