#!/usr/bin/env bash
# run-monitor.sh Ã¢â‚¬â€ Runs every 15 minutes for health monitoring
# Direct CLI Ã¢â‚¬â€ no AI needed for basic monitoring
#
# Cron: */15 * * * * /opt/website-agent/cron/run-monitor.sh >> /opt/website-agent/cron/logs/monitor.log 2>&1

set -euo pipefail

AGENT_ROOT="${WEBSITE_AGENT_ROOT:-/opt/website-agent}"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
LOG_DIR="${AGENT_ROOT}/cron/logs"
MONITOR_LOG="${LOG_DIR}/monitor-stderr.log"

# Pin the authoritative DB and agent root so the monitor checks/repairs the same
# state DB the workers use, independent of cron's working directory.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"

mkdir -p "$LOG_DIR"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

json_field() {
  node -e '
    let s="";
    process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const o=JSON.parse(s);
        const v=String(process.argv[1]).split(".").reduce((a,k)=>(a==null?a:a[k]),o);
        process.stdout.write(v==null?"":String(v));
      } catch { process.stdout.write(""); }
    });
  ' "$1"
}

HEARTBEAT_RUN_ID=""
HEARTBEAT_FINISHED=0

heartbeat_start_tick() {
  local hb_json
  hb_json=$(node "$V2_CLI" heartbeat start --job monitor --json 2>/dev/null || true)
  HEARTBEAT_RUN_ID=$(printf '%s' "$hb_json" | json_field run_id)
}

heartbeat_finish_tick() {
  local error_msg="${1:-}"
  if [ "$#" -gt 0 ]; then shift; fi
  [ "$HEARTBEAT_FINISHED" = "1" ] && return 0

  local cmd=(node "$V2_CLI" heartbeat finish --job monitor --json)
  if [ -n "${HEARTBEAT_RUN_ID:-}" ]; then
    cmd+=(--run-id "$HEARTBEAT_RUN_ID")
  fi
  if [ -n "$error_msg" ]; then
    cmd+=(--error "$error_msg")
  fi
  cmd+=("$@")
  "${cmd[@]}" >/dev/null 2>&1 || true
  HEARTBEAT_FINISHED=1
}

cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$HEARTBEAT_FINISHED" != "1" ]; then
    if [ "$rc" -eq 0 ]; then
      heartbeat_finish_tick
    else
      heartbeat_finish_tick "script exit ${rc}"
    fi
  fi
  exit "$rc"
}

trap cleanup EXIT
heartbeat_start_tick

# Reconcile stale cron_runs ledger rows before the health report. This closes old
# orphaned rows while preserving the latest running row for jobs that still have a
# running heartbeat or active run-lock.
for ledger_job in monitor outbox ops-pipeline blog-pipeline self-improvement; do
  node "$V2_CLI" heartbeat reconcile-stale --job "$ledger_job" --json >/dev/null 2>&1 || true
done

# Run health check with auto-fix (release stale locks, retry stuck outbox).
# Redirect stderr to a dedicated log file so crashes are visible, and surface
# a clear failure line instead of silently swallowing it with 2>/dev/null.
if ! node "$V2_CLI" monitor-check --auto-fix --alert-on-failure --email-on-critical --json 2>>"$MONITOR_LOG"; then
  echo "[$TS] [ERROR] monitor-check exited non-zero â€” see $MONITOR_LOG for details."
  heartbeat_finish_tick "monitor-check exited non-zero"
else
  heartbeat_finish_tick
fi
