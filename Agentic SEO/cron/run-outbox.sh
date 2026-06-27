#!/usr/bin/env bash
# run-outbox.sh Ã¢â‚¬â€ Process outbox queue every 10 minutes
# Syncs SQLite state changes to Obsidian and sends queued emails
#
# Cron: */10 * * * * /opt/website-agent/cron/run-outbox.sh >> /opt/website-agent/cron/logs/outbox.log 2>&1

set -euo pipefail

AGENT_ROOT="${WEBSITE_AGENT_ROOT:-/opt/website-agent}"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"

# Pin the authoritative DB and agent root for every CLI invocation below
# (and anything they spawn), independent of cron's working directory.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"

# Load .env so SMTP/IMAP credentials reach the CLI. Parse line-by-line and export
# literally (no shell eval) so values containing spaces Ã¢â‚¬â€ e.g. EMAIL_FROM_NAME Ã¢â‚¬â€
# load correctly and nothing in the file is executed.
if [ -f "${AGENT_ROOT}/.env" ]; then
  set -a
  while IFS= read -r __line || [ -n "$__line" ]; do
    case "$__line" in ''|\#*) continue ;; esac
    [ "${__line#*=}" = "$__line" ] && continue   # skip lines without '='
    export "${__line%%=*}=${__line#*=}"
  done < "${AGENT_ROOT}/.env"
  set +a
fi

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

capture_with_sqlite_retry() {
  local __result_var="$1"
  local label="$2"
  shift 2
  local max_attempts="${WEBSITE_AGENT_SQLITE_RETRY_ATTEMPTS:-4}"
  local delay="${WEBSITE_AGENT_SQLITE_RETRY_BASE_SECONDS:-2}"
  local attempt=1 rc=0 tmp output

  while true; do
    tmp=$(mktemp)
    if "$@" >"$tmp" 2>&1; then
      output=$(cat "$tmp")
      printf -v "$__result_var" '%s' "$output"
      rm -f "$tmp"
      return 0
    fi
    rc=$?
    output=$(cat "$tmp")
    if [ "$attempt" -ge "$max_attempts" ] || ! is_sqlite_lock_output "$tmp"; then
      printf -v "$__result_var" '%s' "$output"
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

HEARTBEAT_RUN_ID=""
HEARTBEAT_FINISHED=0

heartbeat_start_tick() {
  local hb_json
  if ! capture_with_sqlite_retry hb_json "heartbeat start outbox" node "$V2_CLI" heartbeat start --job outbox --json 2>/dev/null; then
    hb_json=""
  fi
  HEARTBEAT_RUN_ID=$(printf '%s' "$hb_json" | json_field run_id)
}

heartbeat_finish_tick() {
  local error_msg="${1:-}"
  if [ "$#" -gt 0 ]; then shift; fi
  [ "$HEARTBEAT_FINISHED" = "1" ] && return 0

  local cmd=(node "$V2_CLI" heartbeat finish --job outbox --json)
  if [ -n "${HEARTBEAT_RUN_ID:-}" ]; then
    cmd+=(--run-id "$HEARTBEAT_RUN_ID")
  fi
  if [ -n "$error_msg" ]; then
    cmd+=(--error "$error_msg")
  fi
  cmd+=("$@")
  run_with_sqlite_retry "heartbeat finish outbox" "${cmd[@]}" >/dev/null 2>&1 || true
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
FAILED=0
ERRORS=()

# Process Obsidian outbox. Let stderr through to the log (cron appends 2>&1) and
# surface a clear failure line instead of silently swallowing it with 2>/dev/null.
# A failure here used to be invisible; the */15 health monitor now also reports
# dead-letter / stuck / lagging outbox state independently.
if ! run_with_sqlite_retry "outbox obsidian" node "$V2_CLI" outbox obsidian \
  --db "$WEBSITE_AGENT_DB_PATH" \
  --obsidian-root /opt/website-obsidian \
  --reconcile-missing-task-dead-letters; then
  echo "[${TS}] [ERROR] outbox obsidian exited non-zero Ã¢â‚¬â€ command/runtime failure, not merely an item retry/dead-letter."
  FAILED=1
  ERRORS+=("obsidian")
fi

# Process email outbox. Independent of the Obsidian drain above. Historical SMTP
# auth dead letters are reconciled when a later successful email proves repair;
# current item failures remain item-level retry/dead-letter results and must not
# make the whole cron heartbeat fail.
if ! run_with_sqlite_retry "outbox email" node "$V2_CLI" outbox email \
  --db "$WEBSITE_AGENT_DB_PATH" \
  --reconcile-smtp-auth-dead-letters; then
  echo "[${TS}] [ERROR] outbox email exited non-zero Ã¢â‚¬â€ command/runtime failure, not merely an item retry/dead-letter."
  FAILED=1
  ERRORS+=("email")
fi

if [ "$FAILED" -eq 0 ]; then
  heartbeat_finish_tick
else
  heartbeat_finish_tick "outbox ${ERRORS[*]} failure"
fi
