#!/usr/bin/env bash
# run-monitor.sh â€” Runs every 15 minutes for health monitoring
# Direct CLI â€” no AI needed for basic monitoring
#
# Cron: */15 * * * * /opt/client-agent/cron/run-monitor.sh >> /opt/client-agent/cron/logs/monitor.log 2>&1

set -euo pipefail

V2_CLI="/opt/client-agent/cli/bin/v2.js"

# Pin the authoritative DB and agent root so the monitor checks/repairs the same
# state DB the workers use, independent of cron's working directory.
export CLIENT_AGENT_ROOT="/opt/client-agent"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

# Run health check with auto-fix (release stale locks, retry stuck outbox)
node "$V2_CLI" monitor-check --auto-fix --alert-on-failure --email-on-critical --json 2>/dev/null || true
