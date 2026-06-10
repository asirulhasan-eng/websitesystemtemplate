#!/usr/bin/env bash
# run-db-prune.sh — daily DB retention pruning
# Crontab: 0 3 * * * /path/to/run-db-prune.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../.env"
LOG_DIR="${LOG_DIR:-$SCRIPT_DIR/../logs}"
TS=$(date -Iseconds)

echo "[$TS] Starting DB prune" >> "$LOG_DIR/db-prune.log"
if ! node "${AGENT_ROOT}/cli/bin/v2.js" db-prune 2>>"$LOG_DIR/db-prune.log"; then
  echo "[$TS] [ERROR] db-prune exited non-zero" >> "$LOG_DIR/db-prune.log"
fi
echo "[$(date -Iseconds)] DB prune complete" >> "$LOG_DIR/db-prune.log"
