# Heartbeat stale false positive triage â€” 2026-05-26

## Context
A high-severity `heartbeat_stale` alert reported `daily-seo heartbeat is 87 minutes old` even though the daily SEO loop had completed successfully earlier the same day.

## Root causes found
1. `tools/run_deadman_monitor.js` treated every heartbeat older than `--stale-minutes` as stale, including rows with `status='completed'`. That is wrong for periodic jobs such as daily SEO and backup jobs.
2. `tools/run_daily_observer.js` started/finished the configured job (`--job daily-seo`) but mid-run beats were hardcoded as `daily-seo-observer`, leaving a legacy heartbeat row stuck in `running`.
3. Monitor `--dry-run` skipped inserts but still resolved open alerts, so it was not read-only.

## Durable pattern
- For heartbeat monitors, `heartbeat_stale` should mean a currently `running` job has stopped beating.
- Completed jobs may be older than 30 minutes by design; use missed-cron checks for jobs that fail to start on schedule.
- Start, beat, and finish heartbeat calls must use the same job name.
- Dry-run paths must not mutate alert resolution state.

## Diagnostic commands used
```bash
cd /opt/client-agent
crontab -l
ps -eo pid,ppid,stat,etime,cmd | grep -E 'seo-agent|daily-seo|node tools|npm run daily|cron' | grep -v grep || true
tail -160 logs/monitor.log logs/daily.log 2>/dev/null || true
sqlite3 -header -column tools/out/state/seo-agent.db "SELECT job_name,status,heartbeat_at,last_successful_run_at,last_failed_run_at,error_summary FROM heartbeats ORDER BY job_name;"
sqlite3 -header -column tools/out/state/seo-agent.db "SELECT cron_run_id,job_name,status,started_at,finished_at,error_summary FROM cron_runs ORDER BY started_at DESC LIMIT 12;"
sqlite3 -header -column tools/out/state/seo-agent.db "SELECT alert_id,alert_type,severity,status,message,triggered_at,resolved_at FROM monitor_alerts WHERE status='open' ORDER BY triggered_at DESC LIMIT 20;"
```

## Safe verification recipe
Always verify monitor logic on a copied DB before touching real alert state:

```bash
cd /opt/client-agent
node --check tools/run_deadman_monitor.js
node --check tools/run_daily_observer.js
TMPDB="/tmp/seo-agent-monitor-regression-$$.db"
cp tools/out/state/seo-agent.db "$TMPDB"
node tools/run_deadman_monitor.js --db "$TMPDB" --json --out /tmp/deadman-regression.json
```

For daily observer changes, smoke-test on a temporary DB:

```bash
TMPDB="/tmp/seo-agent-daily-smoke-$$.db"
node tools/run_daily_observer.js --db "$TMPDB" --job daily-seo --sample --skip-email --out /tmp/daily-smoke.json
sqlite3 -header -column "$TMPDB" "SELECT job_name,status,heartbeat_at,last_successful_run_at,metadata_json FROM heartbeats ORDER BY job_name;"
node tools/run_deadman_monitor.js --db "$TMPDB" --json --out /tmp/monitor-smoke.json
```

## Real-state remediation pattern
If an orphaned heartbeat row is confirmed, clear it through the project CLI rather than raw SQL:

```bash
node tools/record_heartbeat.js beat \
  --db tools/out/state/seo-agent.db \
  --job daily-seo-observer \
  --status completed \
  --metadata '{"reason":"cleared orphaned heartbeat after daily observer job-name fix"}'

node tools/run_deadman_monitor.js \
  --db tools/out/state/seo-agent.db \
  --json \
  --out tools/out/monitor/manual-heartbeat-stale-fix-YYYYMMDDTHHMMZ.json
```

Then verify:

```bash
sqlite3 -header -column tools/out/state/seo-agent.db "SELECT alert_id,message,status,resolved_at FROM monitor_alerts WHERE alert_id='<ALERT_ID>';"
sqlite3 -header -column tools/out/state/seo-agent.db "SELECT job_name,status,heartbeat_at,last_successful_run_at FROM heartbeats ORDER BY job_name;"
```
