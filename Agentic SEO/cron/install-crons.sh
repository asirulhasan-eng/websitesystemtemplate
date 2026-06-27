#!/usr/bin/env bash
# install-crons.sh Ã¢â‚¬â€ Install all v2 crontab entries
# Run this on the server to set up the new v2 cron schedule
#
# Usage: bash /opt/website-agent/v2/cron/install-crons.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="${WEBSITE_AGENT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
CRON_DIR="${WEBSITE_AGENT_CRON_DIR:-${AGENT_ROOT}/cron}"
LOG_DIR="${CRON_DIR}/logs"
ASSUME_YES=0
CHECK_ONLY=0

usage() {
  cat <<'EOF'
Usage: bash /opt/website-agent/cron/install-crons.sh [--yes] [--check|--dry-run]

Options:
  -y, --yes   Install without an interactive confirmation prompt.
  --check     Validate the generated crontab and exit without installing it.
  --dry-run   Alias for --check.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -y|--yes)
      ASSUME_YES=1
      ;;
    --check|--dry-run)
      CHECK_ONLY=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Make all scripts executable
chmod +x "${CRON_DIR}"/*.sh

echo "Installing v2 cron jobs..."
echo ""

# Build new crontab entries
V2_CRONS=$(cat <<'CRONTAB'
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# Website Operations v2 Ã¢â‚¬â€ AI-Brain-Driven Cron Schedule
# All documented fixed-time schedules are UTC. BST = UTC+6.
# Do NOT depend on CRON_TZ: some cron implementations silently ignore it. Critical
# fixed-time jobs below fire every minute and gate on /bin/date -u, so the ledgered
# run time follows UTC even when the host cron daemon interprets fields locally.
# Install-time validation below prints the next expected UTC decision times for
# 01:30 / 02:00 / 13:30 / 14:00 before writing the crontab.
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

# Ã¢â€â‚¬Ã¢â€â‚¬ INTELLIGENCE PIPELINE (pre-planner, report-only) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# 30 min before each work plan: runs the analysis modules that are DUE
# (cadence via `v2 intelligence due`), each producing a REPORT (no tasks).
# The planner then reads `v2 intelligence summary`. See processes/intelligence/.

# Scripts are invoked via 'bash <script>' so a missing exec bit can never silently
# kill a pipeline again (see 2026-06 incident where chmod was lost on rewrite).

# Intelligence (Morning) Ã¢â‚¬â€ 01:30 UTC = 07:30 AM BST (workplan at 08:00)
* * * * * if [ "$(/bin/date -u +\%H:\%M)" = "01:30" ]; then /usr/bin/env bash /opt/website-agent/cron/run-intelligence.sh morning >> /opt/website-agent/cron/logs/intelligence.log 2>&1; fi

# Intelligence (Evening) Ã¢â‚¬â€ 13:30 UTC = 07:30 PM BST (workplan at 20:00)
* * * * * if [ "$(/bin/date -u +\%H:\%M)" = "13:30" ]; then /usr/bin/env bash /opt/website-agent/cron/run-intelligence.sh evening >> /opt/website-agent/cron/logs/intelligence.log 2>&1; fi

# Ã¢â€â‚¬Ã¢â€â‚¬ PRODUCER (enqueue-only) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# The twice-daily work plan PLANS and ENQUEUES only Ã¢â‚¬â€ it marks tasks
# status='approved' and does NOT execute them. The consumer pipelines below
# run everything. Single execution path. See processes/dual-pipeline-plan.md.
# It READS the intelligence reports above; it does NOT gather raw data itself.

# Work Plan (Morning) Ã¢â‚¬â€ 02:00 UTC = 08:00 AM BST
# AI-driven: Hermes plans next 12h, approves tasks, emails an opt-out review plan
* * * * * if [ "$(/bin/date -u +\%H:\%M)" = "02:00" ]; then /usr/bin/env bash /opt/website-agent/cron/run-daily-workplan.sh morning >> /opt/website-agent/cron/logs/daily-workplan.log 2>&1; fi

# Work Plan (Evening) Ã¢â‚¬â€ 14:00 UTC = 08:00 PM BST
* * * * * if [ "$(/bin/date -u +\%H:\%M)" = "14:00" ]; then /usr/bin/env bash /opt/website-agent/cron/run-daily-workplan.sh evening >> /opt/website-agent/cron/logs/daily-workplan.log 2>&1; fi

# Ã¢â€â‚¬Ã¢â€â‚¬ INDUSTRY RADAR (producer, enqueue-only) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Daily outside-world news scan (SEO / GBP / PPC / Google core updates / local
# SEO / website industry). Hermes (with web search) finds newsworthy items,
# translates them into "what this means for your website owner" blog topics,
# and ENQUEUES them as new_blog_post tasks (status='approved'). It does NOT write
# blogs Ã¢â‚¬â€ the */19 blog pipeline authors them. Second enqueue-only producer
# alongside the work plan. See processes/industry-radar.md.
# Odd hour (05:02 UTC) avoids Hermes concurrency with intelligence/workplan/feedback.

# Industry Radar Ã¢â‚¬â€ 05:02 UTC = 11:02 AM BST (every 2 days)
* * * * * case "$(/bin/date -u +\%d):$(/bin/date -u +\%H:\%M)" in 01:05:02|03:05:02|05:05:02|07:05:02|09:05:02|11:05:02|13:05:02|15:05:02|17:05:02|19:05:02|21:05:02|23:05:02|25:05:02|27:05:02|29:05:02|31:05:02) /usr/bin/env bash /opt/website-agent/cron/run-industry-radar.sh >> /opt/website-agent/cron/logs/industry-radar.log 2>&1 ;; esac

# Ã¢â€â‚¬Ã¢â€â‚¬ FEEDBACK ANALYST Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Every 2h: reviews worker results + fresh GSC/SERP signals, writes the
# feedback brief the planner reads. Analysis-only (no task creation). Cheap
# no-op gate skips Hermes when nothing happened. Use an explicit UTC case list:
# crontab treats unescaped percent signs specially, so shell modulo arithmetic
# (`%`) is unsafe in installed cron command fields.
* * * * * case "$(/bin/date -u +\%H:\%M)" in 00:00|02:00|04:00|06:00|08:00|10:00|12:00|14:00|16:00|18:00|20:00|22:00) /usr/bin/env bash /opt/website-agent/cron/run-feedback.sh >> /opt/website-agent/cron/logs/feedback.log 2>&1 ;; esac

# Ã¢â€â‚¬Ã¢â€â‚¬ SELF-EVALUATION AUDITOR Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Every 6h (05/11/17/23 UTC): retrospective self-audit. Reconstructs the last 6h,
# grades the system A-F, catches missed threats/duplicates/drift, injects up to 5
# corrective tasks (safe-only auto-approve), records brain notes, and NOTIFIES THE
# OWNER OVER TELEGRAM (not email). Independent Ã¢â‚¬â€ runs even if other jobs failed.
# Odd hours avoid Hermes concurrency with intelligence/workplan. See
# processes/self-evaluation.md.
* * * * * case "$(/bin/date -u +\%H:\%M)" in 05:00|11:00|17:00|23:00) /usr/bin/env bash /opt/website-agent/cron/run-auditor.sh >> /opt/website-agent/cron/logs/auditor.log 2>&1 ;; esac

# -- WEEKLY REVIEW (strategic step-back) ---------------------------------------
# Every Monday 06:00 UTC: reviews the past week (clicks-primary outcomes), evaluates
# strategy, records Brain notes, and emails the owner. Analysis job; the twice-daily
# planner stays the primary producer. See processes/weekly-review.md.
* * * * * if [ "$(/bin/date -u +\%u:\%H:\%M)" = "1:06:00" ]; then /usr/bin/env bash /opt/website-agent/cron/run-weekly-review.sh >> /opt/website-agent/cron/logs/weekly-review.log 2>&1; fi

# -- MONTHLY ROADMAP (long-range strategy) --------------------------------------
# First Monday of the month 07:00 UTC (an hour after that day's Weekly Review):
# 28/56/90-day trends, last month's focus-area outcomes, next month's 3-5 focus
# areas, roadmap email. Sets the north star the Weekly Review evaluates against.
# Vixie cron ORs restricted day-of-month and day-of-week, so "1-7 * 1" would fire
# on days 1-7 AND every Monday â€” instead run daily on days 1-7 and let the script
# exit unless it is Monday. See processes/monthly-roadmap.md.
* * * * * case "$(/bin/date -u +\%u:\%d:\%H:\%M)" in 1:0[1-7]:07:00) /usr/bin/env bash /opt/website-agent/cron/run-monthly-roadmap.sh >> /opt/website-agent/cron/logs/monthly-roadmap.log 2>&1 ;; esac

# Ã¢â€â‚¬Ã¢â€â‚¬ CONSUMERS (execute ready/approved tasks; one task per tick) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Ops Pipeline Ã¢â‚¬â€ Every 7 minutes: next ready general_operational task
*/7 * * * * /usr/bin/env bash /opt/website-agent/cron/run-ops-pipeline.sh >> /opt/website-agent/cron/logs/ops-pipeline.log 2>&1

# Blog Pipeline Ã¢â‚¬â€ Every 19 minutes: next ready blog_content task
*/19 * * * * /usr/bin/env bash /opt/website-agent/cron/run-blog-pipeline.sh >> /opt/website-agent/cron/logs/blog-pipeline.log 2>&1

# AI Review Pipeline Ã¢â‚¬â€ Every 13 minutes, offset: AI decides needs_review items, no human waiting room
5-59/13 * * * * /usr/bin/env bash /opt/website-agent/cron/run-ai-review.sh >> /opt/website-agent/cron/logs/ai-review.log 2>&1

# Self-Improvement Pipeline - Every 11 minutes: next ready self_improvement task
*/11 * * * * /usr/bin/env bash /opt/website-agent/cron/run-self-improvement.sh >> /opt/website-agent/cron/logs/self-improvement.log 2>&1

# Ã¢â€â‚¬Ã¢â€â‚¬ INFRASTRUCTURE Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Health Monitor Ã¢â‚¬â€ Every 15 minutes
# Direct CLI: releases stale locks, retries stuck outbox, reconciles deployments, alerts
*/15 * * * * /usr/bin/env bash /opt/website-agent/cron/run-monitor.sh >> /opt/website-agent/cron/logs/monitor.log 2>&1

# Outbox Worker Ã¢â‚¬â€ Every 10 minutes
# Direct CLI: syncs SQLiteÃ¢â€ â€™Obsidian, sends queued emails
*/10 * * * * /usr/bin/env bash /opt/website-agent/cron/run-outbox.sh >> /opt/website-agent/cron/logs/outbox.log 2>&1

# Task Dedupe Ã¢â‚¬â€ 15 min after each work plan: cancel duplicate active tasks
# DB Prune - 03:00 UTC daily
* * * * * if [ "$(/bin/date -u +\%H:\%M)" = "03:00" ]; then /usr/bin/env bash /opt/website-agent/cron/run-db-prune.sh >> /opt/website-agent/cron/logs/db-prune.log 2>&1; fi

# Task Dedupe - 15 min after each work plan
* * * * * case "$(/bin/date -u +\%H:\%M)" in 02:15|14:15) cd /opt/website-agent && /usr/bin/env node cli/bin/v2.js task dedupe --apply --json >> /opt/website-agent/cron/logs/dedupe.log 2>&1 ;; esac

# Ã¢â€â‚¬Ã¢â€â‚¬ NOT YET IMPLEMENTED Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# The jobs below reference shell scripts that do not exist in cron/.
# (Weekly Review and Monthly Roadmap are now IMPLEMENTED and ACTIVE above.)
# They are commented out so cron does not fire dead entries (which produce
# silent failures / system mail every run). Uncomment each line only after
# the matching run-*.sh script has been created in cron/.
# Task Triage Ã¢â‚¬â€ 03:30 UTC daily
# 30 3 * * * /opt/website-agent/cron/run-task-triage.sh >> /opt/website-agent/cron/logs/task-triage.log 2>&1
# Opportunity Scan Ã¢â‚¬â€ 14:00 UTC every 2 days
# 0 14 */2 * * /opt/website-agent/cron/run-opportunity-scan.sh >> /opt/website-agent/cron/logs/opportunity-scan.log 2>&1
CRONTAB
)

next_expected_utc() {
  local utc_hm="$1"
  local today_utc now_epoch candidate_epoch

  today_utc="$(date -u +%F)"
  now_epoch="$(date -u +%s)"
  candidate_epoch="$(date -u -d "${today_utc} ${utc_hm}:00" +%s)"

  if (( candidate_epoch <= now_epoch )); then
    candidate_epoch=$((candidate_epoch + 86400))
  fi

  date -u -d "@${candidate_epoch}" '+%Y-%m-%dT%H:%M:%SZ'
}

validate_utc_decision_gate() {
  local label="$1"
  local utc_hm="$2"
  local command_needle="$3"
  local matching_lines

  matching_lines="$(grep -F 'date -u +\%H:\%M' <<<"$V2_CRONS" | grep -F "\"${utc_hm}\"" | grep -F "$command_needle" || true)"
  if [[ -z "$matching_lines" ]]; then
    echo "ERROR: missing UTC gate for ${label} at ${utc_hm} UTC (${command_needle})" >&2
    exit 1
  fi

  printf '  %-22s %s UTC next=%s\n' "$label" "$utc_hm" "$(next_expected_utc "$utc_hm")"
}

validate_crontab_percent_escaping() {
  local label="$1"
  local line="$2"
  local i char prev

  for ((i = 0; i < ${#line}; i += 1)); do
    char="${line:i:1}"
    if [[ "$char" == "%" ]]; then
      prev=""
      if (( i > 0 )); then
        prev="${line:i-1:1}"
      fi
      if [[ "$prev" != "\\" ]]; then
        echo "ERROR: unescaped percent in ${label} cron line. Cron treats % as stdin/newline." >&2
        echo "       ${line}" >&2
        exit 1
      fi
    fi
  done
}

validate_feedback_utc_case_gate() {
  local expected_times line

  expected_times="00:00|02:00|04:00|06:00|08:00|10:00|12:00|14:00|16:00|18:00|20:00|22:00"
  line="$(grep -F 'run-feedback.sh' <<<"$V2_CRONS" | grep -F '/bin/date -u +\%H:\%M' || true)"

  if [[ -z "$line" ]]; then
    echo "ERROR: missing feedback cron UTC gate (run-feedback.sh)" >&2
    exit 1
  fi
  if [[ "$line" == *'hour % 2'* ]]; then
    echo "ERROR: feedback cron must not use raw modulo ('%') in a crontab command field" >&2
    echo "       ${line}" >&2
    exit 1
  fi
  if [[ "$line" != *"${expected_times}"* ]]; then
    echo "ERROR: feedback cron UTC gate must enumerate every even-hour tick" >&2
    echo "       expected: ${expected_times}" >&2
    echo "       line:     ${line}" >&2
    exit 1
  fi

  validate_crontab_percent_escaping "feedback" "$line"
  printf '  %-22s %s UTC ticks\n' "feedback" "every 2h"
}

echo "UTC decision schedule validation (timezone-independent gates):"
validate_utc_decision_gate "intelligence-morning" "01:30" "run-intelligence.sh morning"
validate_utc_decision_gate "workplan-morning" "02:00" "run-daily-workplan.sh morning"
validate_utc_decision_gate "intelligence-evening" "13:30" "run-intelligence.sh evening"
validate_utc_decision_gate "workplan-evening" "14:00" "run-daily-workplan.sh evening"
validate_feedback_utc_case_gate
echo ""

# Show what we're about to install
echo "New cron entries:"
echo "$V2_CRONS"
echo ""

if [[ "$CHECK_ONLY" = "1" ]]; then
  echo "Check-only mode: generated crontab validated; nothing installed."
  exit 0
fi

# Backup existing crontab
BACKUP_FILE="${LOG_DIR}/crontab-backup-$(date +%Y%m%d-%H%M%S).txt"
crontab -l > "$BACKUP_FILE" 2>/dev/null || echo "(no existing crontab)"
echo "Existing crontab backed up to: $BACKUP_FILE"

# Ask for confirmation
if [[ "$ASSUME_YES" != "1" ]]; then
  read -p "Install these cron entries? This will REPLACE all existing crontab entries. (y/N): " confirm
  if [[ "$confirm" != [yY] ]]; then
    echo "Aborted."
    exit 0
  fi
else
  echo "--yes supplied; installing without interactive confirmation."
fi

# Install new crontab
echo "$V2_CRONS" | crontab -

echo ""
echo "Ã¢Å“â€¦ v2 cron jobs installed successfully!"
echo ""
echo "Verify with: crontab -l"
echo "Logs will be written to: $LOG_DIR"
echo ""
echo "Schedule summary:"
echo "  Daily 03:00 UTC - DB Prune + report retention (direct CLI)"
echo "  01:30 UTC / 07:30 AM BST Ã¢â‚¬â€ Intelligence: Morning Ã¢â‚¬â€ report-only analysis modules (Hermes)"
echo "  13:30 UTC / 07:30 PM BST Ã¢â‚¬â€ Intelligence: Evening Ã¢â‚¬â€ report-only analysis modules (Hermes)"
echo "  02:00 UTC / 08:00 AM BST Ã¢â‚¬â€ Work Plan: Morning  Ã¢â‚¬â€ PRODUCER, enqueue-only (Hermes)"
echo "  14:00 UTC / 08:00 PM BST Ã¢â‚¬â€ Work Plan: Evening  Ã¢â‚¬â€ PRODUCER, enqueue-only (Hermes)"
echo "  11:02 AM BST Ã¢â‚¬â€ Industry Radar      Ã¢â‚¬â€ PRODUCER, newsÃ¢â€ â€™blog topics, enqueue-only (Hermes, every 2 days)"
echo "  Every 2 hours Ã¢â‚¬â€ Feedback Analyst   Ã¢â‚¬â€ writes feedback brief (Hermes, gated)"
echo "  Every 6 hours Ã¢â‚¬â€ Self-Eval Auditor  Ã¢â‚¬â€ grades A-F, injects fixes, Telegram report (Hermes)"
echo "  Mon 06:00 UTC - Weekly Review     - strategy step-back + weekly email (Hermes)"
echo "  1st Mon 07:00 UTC - Monthly Roadmap - month-scale strategy + roadmap email (Hermes)"
echo "  Every 7 min   Ã¢â‚¬â€ Ops Pipeline       Ã¢â‚¬â€ executes ready general tasks"
echo "  Every 19 min  Ã¢â‚¬â€ Blog Pipeline      Ã¢â‚¬â€ executes ready blog drafts"
echo "  Every 11 min  - Self-Improvement Pipeline - executes ready agent repair tasks"
echo "  Every 15 min  Ã¢â‚¬â€ Health Monitor (direct CLI)"
echo "  Every 10 min  Ã¢â‚¬â€ Outbox Worker (direct CLI)"
