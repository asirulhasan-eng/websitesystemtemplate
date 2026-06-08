# {{SITE_NAME}} outbox/vault/email/daily-report health audit

Use when the user asks for a top-to-bottom {{SITE_NAME}} agent health check, scheduler verification, outbox repair, or Obsidian mirror reconciliation.

## Durable lessons

### Treat task-list markdown exports as snapshots
- If the user attaches task-list markdown files, read their generated timestamp and compare with the live authoritative DB before acting on counts.
- Report attached-vs-live drift explicitly; automation may have moved many tasks after the export.

### Verify the real scheduler and vault path
- Linux `crontab -l` is the live cadence source for this system; Hermes cron may be empty.
- The managed crontab should export:
  - `CLIENT_AGENT_ROOT=/opt/client-agent`
  - `CLIENT_OBSIDIAN_ROOT=/opt/client-obsidian`
- Check cron wrappers and scheduler installers, not only runtime scripts. A script-level default like `tools/out/obsidian` can silently divert Obsidian notes away from the durable vault if the scheduler does not export `CLIENT_OBSIDIAN_ROOT`.
- After scheduler edits: dry-run installer, back up/apply live crontab, verify a second dry-run is stable, then run the affected wrapper once.

### Outbox repair should use project tooling and audit events
- Do not raw-edit `outbox_jobs` to hide failures.
- If dead-lettered jobs are obsolete because their notification was rerouted or superseded, add/use a project CLI that transitions only selected rows with reason metadata and creates audit/task events.
- After any state change, run `bash tools/cron/run-outbox-worker.sh` until unresolved rows are zero, then checkpoint/commit SQLite and Obsidian mirror repos.

### Email auth failures: normalize, then leave real blockers visible
- Gmail app passwords are often pasted with spaces. Runtime credential helpers may strip whitespace for Gmail hosts, but must not print secret values.
- If IMAP/SMTP still reject normalized credentials, leave `heartbeat_failed` open and report that a fresh Gmail app password/credential update is required. Do not mark email-check healthy or cancel the active heartbeat alert just to make the dashboard green.

### Dead-man monitor: separate failed heartbeat from missed cron
- `cron_missed` should be based on latest job activity (`heartbeat_at`, `last_failed_run_at`, `last_successful_run_at`, or cron row activity as appropriate), not only `last_successful_run_at`.
- A cron that is running/recently failing should produce the real `heartbeat_failed` alert, not a duplicate false missed-cron alert.
- Add regression tests for fresh failed crons so monitor repair does not reintroduce double-counting.

### Daily report mirrors should render report markdown, not payload JSON
- For `send_daily_email_summary`/daily report outbox jobs, render persisted `daily_reports.report_markdown` by `report_id` or target date when available.
- If a generated mirror note contains only payload JSON, treat it as a renderer quality bug and regenerate from SQLite.
- Daily summary status icons should treat `completed` as success, not failure.

### Repo and WAL hygiene after live worker races
- Scheduled workers may finish while you are checking status. After waiting for a worker, run outbox sync again, checkpoint SQLite (`PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;`), and re-check all repos before final reporting.
- Do not leave `seo-agent.db-wal`/`seo-agent.db-shm` as unpushed or confusing status noise after a final checkpoint.

## Verification ladder
1. `node --test test/*.test.js`
2. `sqlite3 /opt/client-sqlite/seo-agent.db 'PRAGMA integrity_check;'`
3. unresolved outbox query for `pending`, `retrying`, `dead_letter`
4. active monitor alerts query
5. `node tools/check_obsidian_brain_health.js --brain-vault /opt/client-obsidian --json`
6. `crontab -l` check for cron wrappers and `CLIENT_OBSIDIAN_ROOT`
7. clean/synced status for `/opt/client-agent`, `/opt/client-sqlite`, `/opt/client-obsidian`, and `/opt/client-site`
