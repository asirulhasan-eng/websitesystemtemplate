#!/usr/bin/env bash
# run-monitor.sh â€” Runs every 15 minutes for health monitoring
# Direct CLI â€” no AI needed for basic monitoring
#
# Cron: */15 * * * * /opt/client-agent/cron/run-monitor.sh >> /opt/client-agent/cron/logs/monitor.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
LOG_DIR="${AGENT_ROOT}/cron/logs"
MONITOR_LOG="${LOG_DIR}/monitor-stderr.log"

# Pin the authoritative DB and agent root so the monitor checks/repairs the same
# state DB the workers use, independent of cron's working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

mkdir -p "$LOG_DIR"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Run health check with auto-fix (release stale locks, retry stuck outbox).
# Redirect stderr to a dedicated log file so crashes are visible, and surface
# a clear failure line instead of silently swallowing it with 2>/dev/null.
if ! node "$V2_CLI" monitor-check --auto-fix --alert-on-failure --email-on-critical --json 2>>"$MONITOR_LOG"; then
  echo "[$TS] [ERROR] monitor-check exited non-zero — see $MONITOR_LOG for details."
fi
