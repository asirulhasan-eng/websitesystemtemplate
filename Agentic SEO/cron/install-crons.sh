#!/usr/bin/env bash
# install-crons.sh â€” Install all v2 crontab entries
# Run this on the server to set up the new v2 cron schedule
#
# Usage: bash /opt/client-agent/v2/cron/install-crons.sh

set -euo pipefail

AGENT_ROOT="/opt/client-agent"
CRON_DIR="${AGENT_ROOT}/cron"
LOG_DIR="${CRON_DIR}/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Make all scripts executable
chmod +x "${CRON_DIR}"/*.sh

echo "Installing v2 cron jobs..."
echo ""

# Build new crontab entries
V2_CRONS=$(cat <<'CRONTAB'
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# {{SITE_NAME}} v2 â€” AI-Brain-Driven Cron Schedule
# All times in UTC. {{TIMEZONE_ABBR}} = UTC+6.
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

# â”€â”€ INTELLIGENCE PIPELINE (pre-planner, report-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 30 min before each work plan: runs the analysis modules that are DUE
# (cadence via `v2 intelligence due`), each producing a REPORT (no tasks).
# The planner then reads `v2 intelligence summary`. See processes/intelligence/.

# Scripts are invoked via 'bash <script>' so a missing exec bit can never silently
# kill a pipeline again (see 2026-06 incident where chmod was lost on rewrite).

# Intelligence (Morning) â€” 01:30 UTC = 07:30 AM {{TIMEZONE_ABBR}} (workplan at 08:00)
30 1 * * * /usr/bin/env bash /opt/client-agent/cron/run-intelligence.sh morning >> /opt/client-agent/cron/logs/intelligence.log 2>&1

# Intelligence (Evening) â€” 13:30 UTC = 07:30 PM {{TIMEZONE_ABBR}} (workplan at 20:00)
30 13 * * * /usr/bin/env bash /opt/client-agent/cron/run-intelligence.sh evening >> /opt/client-agent/cron/logs/intelligence.log 2>&1

# â”€â”€ PRODUCER (enqueue-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# The twice-daily work plan PLANS and ENQUEUES only â€” it marks tasks
# status='approved' and does NOT execute them. The consumer pipelines below
# run everything. Single execution path. See processes/dual-pipeline-plan.md.
# It READS the intelligence reports above; it does NOT gather raw data itself.

# Work Plan (Morning) â€” 02:00 UTC = 08:00 AM {{TIMEZONE_ABBR}}
# AI-driven: Hermes plans next 12h, approves tasks, emails an opt-out review plan
0 2 * * * /usr/bin/env bash /opt/client-agent/cron/run-daily-workplan.sh morning >> /opt/client-agent/cron/logs/daily-workplan.log 2>&1

# Work Plan (Evening) â€” 14:00 UTC = 08:00 PM {{TIMEZONE_ABBR}}
0 14 * * * /usr/bin/env bash /opt/client-agent/cron/run-daily-workplan.sh evening >> /opt/client-agent/cron/logs/daily-workplan.log 2>&1

# â”€â”€ INDUSTRY RADAR (producer, enqueue-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Daily outside-world news scan (SEO / GBP / PPC / Google core updates / local
# SEO / {{NICHE}} industry). Hermes (with web search) finds newsworthy items,
# translates them into "what this means for your {{NICHE}} business" blog topics,
# and ENQUEUES them as new_blog_post tasks (status='approved'). It does NOT write
# blogs â€” the */19 blog pipeline authors them. Second enqueue-only producer
# alongside the work plan. See processes/industry-radar.md.
# Odd hour (05:02 UTC) avoids Hermes concurrency with intelligence/workplan/feedback.

# Industry Radar â€” 05:02 UTC = 11:02 AM {{TIMEZONE_ABBR}} (every 2 days)
2 5 */2 * * /usr/bin/env bash /opt/client-agent/cron/run-industry-radar.sh >> /opt/client-agent/cron/logs/industry-radar.log 2>&1

# â”€â”€ FEEDBACK ANALYST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Every 2h: reviews worker results + fresh GSC/SERP signals, writes the
# feedback brief the planner reads. Analysis-only (no task creation). Cheap
# no-op gate skips Hermes when nothing happened.
0 */2 * * * /usr/bin/env bash /opt/client-agent/cron/run-feedback.sh >> /opt/client-agent/cron/logs/feedback.log 2>&1

# â”€â”€ SELF-EVALUATION AUDITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Every 6h (05/11/17/23 UTC): retrospective self-audit. Reconstructs the last 6h,
# grades the system A-F, catches missed threats/duplicates/drift, injects up to 5
# corrective tasks (safe-only auto-approve), records brain notes, and NOTIFIES THE
# OWNER OVER TELEGRAM (not email). Independent â€” runs even if other jobs failed.
# Odd hours avoid Hermes concurrency with intelligence/workplan. See
# processes/self-evaluation.md.
0 5,11,17,23 * * * /usr/bin/env bash /opt/client-agent/cron/run-auditor.sh >> /opt/client-agent/cron/logs/auditor.log 2>&1

# -- WEEKLY REVIEW (strategic step-back) ---------------------------------------
# Every Monday 06:00 UTC: reviews the past week (clicks-primary outcomes), evaluates
# strategy, records Brain notes, and emails the owner. Analysis job; the twice-daily
# planner stays the primary producer. See processes/weekly-review.md.
0 6 * * 1 /usr/bin/env bash /opt/client-agent/cron/run-weekly-review.sh >> /opt/client-agent/cron/logs/weekly-review.log 2>&1

# -- MONTHLY ROADMAP (long-range strategy) --------------------------------------
# First Monday of the month 07:00 UTC (an hour after that day's Weekly Review):
# 28/56/90-day trends, last month's focus-area outcomes, next month's 3-5 focus
# areas, roadmap email. Sets the north star the Weekly Review evaluates against.
# Vixie cron ORs restricted day-of-month and day-of-week, so "1-7 * 1" would fire
# on days 1-7 AND every Monday — instead run daily on days 1-7 and let the script
# exit unless it is Monday. See processes/monthly-roadmap.md.
0 7 1-7 * * /usr/bin/env bash /opt/client-agent/cron/run-monthly-roadmap.sh >> /opt/client-agent/cron/logs/monthly-roadmap.log 2>&1

# â”€â”€ CONSUMERS (execute ready/approved tasks; one task per tick) â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Ops Pipeline â€” Every 7 minutes: next ready general_operational task
*/7 * * * * /usr/bin/env bash /opt/client-agent/cron/run-ops-pipeline.sh >> /opt/client-agent/cron/logs/ops-pipeline.log 2>&1

# Blog Pipeline â€” Every 19 minutes: next ready blog_content task
*/19 * * * * /usr/bin/env bash /opt/client-agent/cron/run-blog-pipeline.sh >> /opt/client-agent/cron/logs/blog-pipeline.log 2>&1

# â”€â”€ INFRASTRUCTURE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Health Monitor â€” Every 15 minutes
# Direct CLI: releases stale locks, retries stuck outbox, reconciles deployments, alerts
*/15 * * * * /usr/bin/env bash /opt/client-agent/cron/run-monitor.sh >> /opt/client-agent/cron/logs/monitor.log 2>&1

# Outbox Worker â€” Every 10 minutes
# Direct CLI: syncs SQLiteâ†’Obsidian, sends queued emails
*/10 * * * * /usr/bin/env bash /opt/client-agent/cron/run-outbox.sh >> /opt/client-agent/cron/logs/outbox.log 2>&1

# Task Dedupe â€” 15 min after each work plan: cancel duplicate active tasks
15 2,14 * * * cd /opt/client-agent && /usr/bin/env node cli/bin/v2.js task dedupe --apply --json >> /opt/client-agent/cron/logs/dedupe.log 2>&1

# â”€â”€ NOT YET IMPLEMENTED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# The jobs below reference shell scripts that do not exist in cron/.
# (Weekly Review and Monthly Roadmap are now IMPLEMENTED and ACTIVE above.)
# They are commented out so cron does not fire dead entries (which produce
# silent failures / system mail every run). Uncomment each line only after
# the matching run-*.sh script has been created in cron/.
# Task Triage â€” 03:30 UTC daily
# 30 3 * * * /opt/client-agent/cron/run-task-triage.sh >> /opt/client-agent/cron/logs/task-triage.log 2>&1
# Opportunity Scan â€” 14:00 UTC every 2 days
# 0 14 */2 * * /opt/client-agent/cron/run-opportunity-scan.sh >> /opt/client-agent/cron/logs/opportunity-scan.log 2>&1
CRONTAB
)

# Show what we're about to install
echo "New cron entries:"
echo "$V2_CRONS"
echo ""

# Backup existing crontab
BACKUP_FILE="${LOG_DIR}/crontab-backup-$(date +%Y%m%d-%H%M%S).txt"
crontab -l > "$BACKUP_FILE" 2>/dev/null || echo "(no existing crontab)"
echo "Existing crontab backed up to: $BACKUP_FILE"

# Ask for confirmation
read -p "Install these cron entries? This will REPLACE all existing crontab entries. (y/N): " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

# Install new crontab
echo "$V2_CRONS" | crontab -

echo ""
echo "âœ… v2 cron jobs installed successfully!"
echo ""
echo "Verify with: crontab -l"
echo "Logs will be written to: $LOG_DIR"
echo ""
echo "Schedule summary:"
echo "  07:30 AM {{TIMEZONE_ABBR}} â€” Intelligence: Morning â€” report-only analysis modules (Hermes)"
echo "  07:30 PM {{TIMEZONE_ABBR}} â€” Intelligence: Evening â€” report-only analysis modules (Hermes)"
echo "  08:00 AM {{TIMEZONE_ABBR}} â€” Work Plan: Morning  â€” PRODUCER, enqueue-only (Hermes)"
echo "  08:00 PM {{TIMEZONE_ABBR}} â€” Work Plan: Evening  â€” PRODUCER, enqueue-only (Hermes)"
echo "  11:02 AM {{TIMEZONE_ABBR}} â€” Industry Radar      â€” PRODUCER, newsâ†’blog topics, enqueue-only (Hermes, every 2 days)"
echo "  Every 2 hours â€” Feedback Analyst   â€” writes feedback brief (Hermes, gated)"
echo "  Every 6 hours â€” Self-Eval Auditor  â€” grades A-F, injects fixes, Telegram report (Hermes)"
echo "  Mon 06:00 UTC - Weekly Review     - strategy step-back + weekly email (Hermes)"
echo "  1st Mon 07:00 UTC - Monthly Roadmap - month-scale strategy + roadmap email (Hermes)"
echo "  Every 7 min   â€” Ops Pipeline       â€” executes ready general tasks"
echo "  Every 19 min  â€” Blog Pipeline      â€” executes ready blog drafts"
echo "  Every 15 min  â€” Health Monitor (direct CLI)"
echo "  Every 10 min  â€” Outbox Worker (direct CLI)"
