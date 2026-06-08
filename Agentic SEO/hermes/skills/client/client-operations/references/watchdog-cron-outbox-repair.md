# Watchdog cron/outbox repair and recurring alert resolution

## When to use

Use this when {{SITE_NAME}} reports open watchdog alerts such as missed `daily-seo`/`backup` crons or stale `send_monitor_alert` outbox jobs, especially after automation changes or when monitor alerts keep reappearing.

## Durable lessons

- Diagnose against the authoritative DB (`/opt/client-sqlite/seo-agent.db`) unless a command is explicitly testing a copied DB. Repo-local `tools/out/state/seo-agent.db` can hide or duplicate the real problem.
- A successful manual cron run should close the corresponding `cron_missed` / `cron_never_run` alert. If it does not, fix monitor alert resolution logic instead of repeatedly cancelling alerts by hand.
- `outbox_stuck` alerts should be identity-based by durable metadata (`job_type`, `status`, and relevant entity IDs), not by volatile message text. Refresh/dedupe open alerts instead of creating repeated copies.
- `send_monitor_alert` jobs can become their own stuck-alert feedback loop. Clear obsolete alert-delivery jobs only after confirming the underlying alerts are resolved and recording audit events through project tooling/Node helpers, not raw SQLite edits.
- Cron wrapper defaults matter. Daily observer runs that need the compiled Obsidian Brain should pass the real Brain vault path (for example `--brain-vault /opt/client-obsidian`) rather than relying on a generated mirror path.

## Safe repair sequence

1. Classify as Safe if limited to monitor/cron/outbox state and agent scripts; production site publishing remains separate.
2. Inspect runtime and scheduler state:
   ```bash
   date -u
   TZ={{TIMEZONE}} date
   cd /opt/client-agent
   ps -eo pid,ppid,stat,etime,cmd | grep -E 'seo-agent|daily-seo|node tools|cron|backup|outbox' | grep -v grep || true
   crontab -l
   tail -220 logs/daily.log logs/backup.log logs/outbox.log logs/monitor.log 2>/dev/null || true
   ```
3. Query the authoritative DB for open alerts, recent `cron_runs`, and non-completed monitor-alert outbox jobs.
4. If a wrapper points at the wrong DB/vault path, patch the wrapper and test the real command manually.
5. Run the missed job manually against the authoritative DB, for example:
   ```bash
   cd /opt/client-agent
   node tools/run_daily_observer.js \
     --db /opt/client-sqlite/seo-agent.db \
     --obsidian-root tools/out/obsidian \
     --brain-vault /opt/client-obsidian \
     --job daily-seo
   CLIENT_DB_PATH=/opt/client-sqlite/seo-agent.db ./tools/cron/run-backup.sh
   ```
6. Run the monitor once after the successful jobs:
   ```bash
   ./tools/cron/run-monitor.sh
   ```
7. Verify:
   - zero open `monitor_alerts`
   - zero `send_monitor_alert` jobs in `pending`, `processing`, `retrying`, or `dead_letter`
   - recent `daily-seo`, `backup`, and `monitor` rows are `completed`
8. Commit/push agent script fixes and durable SQLite state separately.

## Regression expectations

When changing the monitor:

- Add tests proving recurring cron/outbox alerts refresh/dedupe instead of duplicating.
- Test that `cron_missed` resolves after a fresh completed run for the same job.
- Test that stale outbox group alerts resolve after the matching `(job_type,status)` group no longer has stale rows.
- Keep unknown alert types conservative (leave open) unless a reliable active/inactive check exists.

Useful command:

```bash
cd /opt/client-agent
node --test test/deadman-outbox-aggregation.test.js test/autopilot-lanes.test.js test/task-executor-cron-worker.test.js
```
