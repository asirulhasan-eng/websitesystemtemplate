# Task Executor / Blog Publisher Cadence Change Notes (2026-06-01)

> Superseded current-state note: this file records the earlier 15â†’10 minute cadence change. The active split-lane scheduler now uses the managed `tools/install_linux_scheduler.js` block: general `13,33,53 * * * *`, blog publisher `7,37 * * * *`, blog editor `43 */4 * * *`, blog review `27 */2 * * *`, and daily observer `17 */2 * * *`. Use this reference only for historical context.

## Why changed
User requested: "make 15 minutes trigger pick ups tasks or write blogs" and later confirmed changing to tighter cadence.

## Confirmed pre-change state
- `crontab -l` showed:
  - `*/15 * * * * cd /opt/client-agent && ./tools/cron/run-task-executor.sh >> logs/task-executor.log 2>&1`
  - `7-59/15 * * * * cd /opt/client-agent && ./tools/cron/run-blog-publisher.sh >> logs/blog-publisher.log 2>&1`

## Changes made
- task executor trigger changed to `*/10 * * * * ...run-task-executor.sh`
- blog publisher trigger changed to `7-57/10 * * * * ...run-blog-publisher.sh`
- comments updated to reflect:
  - 10-minute cadence,
  - lock-protected task executor (`flock` in script),
  - intentional offset for publisher from executor.

## Post-change verification
- `crontab -l` and greps were rerun, with exact new expressions confirmed.
- Updated snapshot exported to `/tmp/client_cron_after_update.txt`.
- No changes were made to `/opt/client-site` content or task DB in this cadence-only step.
- `*/15` patterns were re-scanned in repo and scripts; no remaining matches for targeted old trigger strings.

## Risk posture
- Classified as **low risk** (scheduler frequency change only).
- No content pipeline/task content-state changes occurred in this pass.
