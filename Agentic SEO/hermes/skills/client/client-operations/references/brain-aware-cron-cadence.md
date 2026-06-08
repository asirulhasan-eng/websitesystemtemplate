# Brain-aware cron cadence changes

Use this when the user asks to change how often the Brain-aware {{SITE_NAME}} run happens.

## Classification
- Safe operational scheduler change if limited to crontab and scheduler installer defaults.
- It does not edit production site content or deploy the site.
- Still report the risk classification before applying because cadence changes affect automation behavior.

## What to update
The Brain-aware run is `tools/cron/run-daily.sh`; it passes the authoritative DB and Brain vault to `tools/run_daily_observer.js`:

```sh
DB_PATH="${CLIENT_DB_PATH:-/opt/client-sqlite/seo-agent.db}"
OBSIDIAN_ROOT="${CLIENT_OBSIDIAN_ROOT:-tools/out/obsidian}"
BRAIN_VAULT="${CLIENT_BRAIN_VAULT:-/opt/client-obsidian}"

node tools/run_daily_observer.js \
  --db "$DB_PATH" \
  --obsidian-root "$OBSIDIAN_ROOT" \
  --brain-vault "$BRAIN_VAULT" \
  --job daily-seo
```

When changing cadence, update **both**:
1. Live user crontab (`crontab -l` / `crontab <file>`)
2. Scheduler installer defaults so future reinstall does not revert it:
   - `/opt/client-agent/tools/install_linux_scheduler.js`
   - `/opt/client-agent/tools/install_scheduler.js`

Example every-two-hours cadence in Dhaka timezone:

```cron
17 */2 * * * cd /opt/client-agent && ./tools/cron/run-daily.sh >> logs/daily.log 2>&1
```

## Safe procedure
```bash
cd /opt/client-agent

# Preflight
crontab -l
git status --short --branch
sed -n '1,80p' tools/cron/run-daily.sh

# Backup current crontab before editing
mkdir -p tools/out/scheduler
crontab -l > tools/out/scheduler/crontab-before-brain-aware-$(date -u +%Y%m%dT%H%M%SZ).txt

# Edit live crontab carefully: replace only the run-daily.sh line/comment.
# Then verify:
crontab -l | grep -A1 'Brain-aware\|run-daily.sh'
```

Patch installer defaults from old daily cadence to the new schedule, e.g. `17 2 * * *` -> `17 */2 * * *` for both Linux and Windows scheduler installers.

## Verification
Run:

```bash
node --check tools/install_linux_scheduler.js
node --check tools/install_scheduler.js
node tools/install_linux_scheduler.js --out /tmp/client-generated-crontab.txt --report /tmp/client-generated-crontab.json --json
node --test test/cron-safe-autopilot.test.js test/autopilot-lanes.test.js
crontab -l | grep -A1 'Brain-aware\|run-daily.sh'
grep 'run-daily.sh' /tmp/client-generated-crontab.txt
```

Calculate/report the next few run times in Dhaka and UTC so the user can verify expectations.

## Commit/push
Commit scheduler default changes in `/opt/client-agent` and push. The live crontab change is not in Git, so mention both separately in the final report.

## Pitfalls
- Do not update only the live crontab; future scheduler reinstall would revert the cadence.
- Do not update only installer files; automation will not change until the live crontab is installed.
- Do not confuse the 10-minute Obsidian outbox mirror with the Brain-aware daily observer. The userâ€™s â€œBrain-aware runâ€ refers to `run-daily.sh` / `run_daily_observer.js` with `--brain-vault`.
- Keep task executor cadence separate: `run-task-executor.sh` may already run every 15 minutes and is also invoked by `run-daily.sh`.
