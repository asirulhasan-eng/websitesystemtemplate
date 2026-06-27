#!/usr/bin/env bash
# run-db-prune.sh - daily DB retention pruning and low-risk report cleanup.
# Cron: 0 3 * * * /usr/bin/env bash /opt/website-agent/cron/run-db-prune.sh >> /opt/website-agent/cron/logs/db-prune.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/website-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="db-prune"

export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="/opt/website-state/website-agent.db"

mkdir -p "$LOG_DIR"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "[${TS}] Starting DB prune"

is_sqlite_lock_output() {
  grep -Eiq 'SQLITE_(BUSY|LOCKED)|database is locked|database table is locked' "$1"
}

run_with_sqlite_retry() {
  local label="$1"
  shift
  local max_attempts="${WEBSITE_AGENT_SQLITE_RETRY_ATTEMPTS:-4}"
  local delay="${WEBSITE_AGENT_SQLITE_RETRY_BASE_SECONDS:-2}"
  local attempt=1 rc=0 tmp

  while true; do
    tmp=$(mktemp)
    if "$@" >"$tmp" 2>&1; then
      cat "$tmp"
      rm -f "$tmp"
      return 0
    fi
    rc=$?
    cat "$tmp"
    if [ "$attempt" -ge "$max_attempts" ] || ! is_sqlite_lock_output "$tmp"; then
      rm -f "$tmp"
      return "$rc"
    fi
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [WARN] ${label} hit transient SQLite lock; retrying attempt $((attempt + 1))/${max_attempts} after ${delay}s" >&2
    rm -f "$tmp"
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

run_with_sqlite_retry "heartbeat start ${JOB}" node "$V2_CLI" heartbeat start --job "$JOB" --json >/dev/null 2>&1 || true

RC=0
if run_with_sqlite_retry "db-prune" node "$V2_CLI" db-prune --json; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DB prune complete"
else
  RC=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [ERROR] db-prune exited ${RC}"
fi

# Guarded retention sweep for generated JSON reports only. Never sweep tools/out
# recursively; state DBs and backups live under sibling directories.
for subdir in obsidian-sync email executor monitor; do
  report_dir="${AGENT_ROOT}/tools/out/${subdir}"
  if [ -d "$report_dir" ]; then
    find "$report_dir" -maxdepth 1 -type f -name '*.json' -mtime +30 -print -delete || true
  fi
done

if [ "$RC" -eq 0 ]; then
  run_with_sqlite_retry "heartbeat finish ${JOB}" node "$V2_CLI" heartbeat finish --job "$JOB" --json >/dev/null 2>&1 || true
else
  run_with_sqlite_retry "heartbeat finish ${JOB}" node "$V2_CLI" heartbeat finish --job "$JOB" --error "db-prune exit ${RC}" --json >/dev/null 2>&1 || true
fi

exit "$RC"
