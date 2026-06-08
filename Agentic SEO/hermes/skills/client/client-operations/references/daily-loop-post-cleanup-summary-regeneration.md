# Daily Loop Post-Cleanup Summary Regeneration

## Trigger
Use this when the {{SITE_NAME}} daily loop generates a report, then a safe post-run cleanup changes queue state before the user-facing report is final. Example: cancelling fake/non-actionable `switch.monster` candidate tasks after they appear in the generated Tomorrow's Queue.

## Risk Lane
Safe, if the cleanup only changes task queue state through project atomic helpers and mirrors via outbox. Do not edit production site files or deploy.

## Pattern
1. Run the daily loop normally and capture artifact paths.
2. If the generated report exposes known-invalid active queue items, apply the relevant queue cleanup using project helpers and atomic task status updates.
3. Process Obsidian outbox until it is empty, not just one page. Use repeated `sync_obsidian_outbox` calls with a batch limit until `processed` is `0`.
4. Regenerate the daily summary after cleanup so `tools/out/reports/daily-YYYY-MM-DD.md` and JSON reflect the final queue state.
5. Sync the regenerated daily summary to Obsidian.
6. Re-run email outbox processing/check if the workflow created email outbox jobs.
7. Verify heartbeats, open alerts, outbox statuses, and queue counts after the regeneration.

## Example Commands
```bash
cd /opt/client-agent
seo-agent daily

# After any safe cleanup that changes task queue state:
for i in $(seq 1 25); do
  node tools/sync_obsidian_outbox.js --db tools/out/state/seo-agent.db --obsidian-root /opt/client-obsidian --limit 100 --json
  # stop when JSON processed is 0
done

node tools/generate_daily_summary.js \
  --db tools/out/state/seo-agent.db \
  --out-md tools/out/reports/daily-$(date -u +%F).md \
  --out-json tools/out/reports/daily-$(date -u +%F).json

node tools/sync_obsidian_outbox.js --db tools/out/state/seo-agent.db --obsidian-root /opt/client-obsidian --limit 25 --json
node tools/send_email_outbox.js --db tools/out/state/seo-agent.db --json
```

## Verification
- `SELECT status, COUNT(*) FROM outbox_jobs GROUP BY status;` should show no pending jobs.
- Known-invalid active candidate count should be `0` after cleanup.
- `heartbeats` should show the daily loop and observer completed.
- `monitor_alerts WHERE status='open'` should be empty or explicitly reported.
- The final report's Tomorrow's Queue should no longer include the cleaned items.

## Pitfalls
- The first daily summary can become stale if queue cleanup happens afterward. Regenerate it before reporting.
- `sync_obsidian_outbox --limit N` processes only one batch. Loop until `processed = 0` for large cleanup runs.
- Obsidian mirror updates can create many untracked/generated notes. Report that state; do not commit/push unless the user explicitly asked to push generated artifacts.
