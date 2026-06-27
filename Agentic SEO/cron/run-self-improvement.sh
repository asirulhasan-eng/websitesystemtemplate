#!/usr/bin/env bash
# run-self-improvement.sh - Self-improvement consumer (self_improvement lane).
#
# Cron: */11 * * * * /usr/bin/env bash /opt/website-agent/cron/run-self-improvement.sh >> /opt/website-agent/cron/logs/self-improvement.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"

AGENT_ROOT="${WEBSITE_AGENT_ROOT:-/opt/website-agent}"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="self-improvement"
LANE="self_improvement"
RUN_LOCK="self-improvement"
LOCK_TTL_MINUTES=30
MAX_ATTEMPTS=3
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"
export NODE_NO_WARNINGS=1

mkdir -p "$LOG_DIR"

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

LOCK_ID=""
HEARTBEAT_RUN_ID=""
HEARTBEAT_FINISHED=0

release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}

heartbeat_start_tick() {
  local hb_json
  hb_json=$(node "$V2_CLI" heartbeat start --job "$JOB" --json 2>/dev/null || true)
  HEARTBEAT_RUN_ID=$(printf '%s' "$hb_json" | json_field run_id)
}

heartbeat_finish_tick() {
  local error_msg="${1:-}"
  if [ "$#" -gt 0 ]; then shift; fi
  [ "$HEARTBEAT_FINISHED" = "1" ] && return 0

  local cmd=(node "$V2_CLI" heartbeat finish --job "$JOB" --json)
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
  release_lock
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

SELF_IMPROVEMENT_FLAG="${SELF_IMPROVEMENT_ENABLED:-}"
if [ -z "$SELF_IMPROVEMENT_FLAG" ] && [ -f "$AGENT_ROOT/.env" ]; then
  SELF_IMPROVEMENT_FLAG=$(grep -E '^SELF_IMPROVEMENT_ENABLED=' "$AGENT_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d ' "\r' || true)
fi

if [ "${SELF_IMPROVEMENT_FLAG:-false}" != "true" ]; then
  echo "[${TIMESTAMP}] [disabled] SELF_IMPROVEMENT_ENABLED is not true."
  exit 0
fi
export SELF_IMPROVEMENT_ENABLED="$SELF_IMPROVEMENT_FLAG"

next_legacy_auditor_substrate_task() {
  node "$V2_CLI" task list \
    --legacy-auditor-substrate-backlog \
    --fields task_id,title,created_at,updated_at,metadata_json \
    --sort updated --asc --limit 1 --json 2>/dev/null || echo '{}'
}

defer_iso() {
  date -u -d "+6 hours" +%Y-%m-%dT%H:%M:%S.%3NZ
}

blocker_evidence() {
  node -e '
    const reason = process.argv[1];
    const attempts = Number(process.argv[2] || 0);
    const retryAfter = process.argv[3] || null;
    process.stdout.write(JSON.stringify({
      self_improvement_blocker: {
        reason,
        worker_attempts: attempts,
        retry_after: retryAfter,
        source: "run-self-improvement.sh",
        blocked_at: new Date().toISOString()
      }
    }));
  ' "$1" "${2:-0}" "${3:-}"
}

annotate_legacy_auditor_substrate_task() {
  local legacy_task_id="$1"
  local retry_after
  retry_after=$(defer_iso)
  local note="Self-improvement worker found this legacy approved auditor substrate/recovery task, but task_type=general_operational does not route to self_improvement. It remains approved for visibility. Actionable blocker: promote/recreate as self_improvement/process_update/prompt_update/cron_repair/executor_repair/db_reconciliation with scoped target_files, or close as obsolete."
  local evidence
  evidence=$(blocker_evidence "legacy_general_operational_not_self_improvement" 0 "$retry_after")
  node "$V2_CLI" task update --id "$legacy_task_id" --scheduled-for "$retry_after" \
    --note "$note" --evidence "$evidence" \
    --json >/dev/null 2>&1 || true
  heartbeat_finish_tick
  echo "[${TIMESTAMP}] [blocked] ${legacy_task_id} legacy auditor substrate/recovery task left approved with actionable blocker; retry_after=${retry_after}."
}

LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "self-improvement tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held."
  heartbeat_finish_tick "" --preserve-stale-running
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)

HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue; skipping tick."
  exit 0
fi

NEXT=$(node "$V2_CLI" task next --lane "$LANE" --json 2>/dev/null || echo '{}')
TASK_ID=$(printf '%s' "$NEXT" | json_field task.task_id)
if [ -z "$TASK_ID" ]; then
  LEGACY=$(next_legacy_auditor_substrate_task)
  LEGACY_TASK_ID=$(printf '%s' "$LEGACY" | json_field results.0.task_id)
  if [ -n "$LEGACY_TASK_ID" ]; then
    annotate_legacy_auditor_substrate_task "$LEGACY_TASK_ID"
    exit 0
  fi
  heartbeat_finish_tick
  echo "[${TIMESTAMP}] [idle] no ready ${LANE} tasks."
  exit 0
fi

DISPATCH=$(printf '%s' "$NEXT" | json_field task.dispatch)
echo "[${TIMESTAMP}] [pick] ${TASK_ID} (dispatch=${DISPATCH:-none})"

ATTEMPTS=$(node "$V2_CLI" db query \
  --sql "SELECT COALESCE(json_extract(metadata_json, '\$.worker_attempts'), 0) AS n FROM tasks WHERE task_id = ?" \
  --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.n)
ATTEMPTS=$(( ${ATTEMPTS:-0} + 1 ))
node "$V2_CLI" db query \
  --sql "UPDATE tasks SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '\$.worker_attempts', ?) WHERE task_id = ?" \
  --params "[${ATTEMPTS}, \"${TASK_ID}\"]" --allow-write --json >/dev/null 2>&1 || true
if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
  LAST_BLOCKER=$(node "$V2_CLI" db query \
    --sql "SELECT COALESCE(json_extract(metadata_json, '\$.self_improvement.last_blocker.reason'), '') AS reason FROM tasks WHERE task_id = ?" \
    --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.reason)
  if printf '%s' "$LAST_BLOCKER" | grep -Eiq 'could not write index|git index|unmerged|index\.lock'; then
    if [ -z "$(git -C "$AGENT_ROOT" diff --name-only --diff-filter=U 2>/dev/null || true)" ] && git -C "$AGENT_ROOT" update-index -q --refresh >/dev/null 2>&1; then
      ATTEMPTS=1
      node "$V2_CLI" db query \
        --sql "UPDATE tasks SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '\$.worker_attempts', 1, '\$.self_improvement.retry_reset_at', datetime('now'), '\$.self_improvement.retry_reset_reason', 'stale_git_index_blocker_cleared') WHERE task_id = ?" \
        --params "[\"${TASK_ID}\"]" --allow-write --json >/dev/null 2>&1 || true
      echo "[${TIMESTAMP}] [retry-reset] ${TASK_ID} stale git-index blocker cleared; allowing one fresh attempt."
    fi
  fi
fi
if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
  retry_after=$(defer_iso)
  note="Self-improvement worker reached $((ATTEMPTS - 1)) failed attempts and parked this repair as blocked. Actionable blocker: inspect the last self-improve output and either fix the blocker, narrow target_files, or close/recreate the task; retry_after=${retry_after}."
  evidence=$(blocker_evidence "max_failed_attempts_reached" "$ATTEMPTS" "$retry_after")
  echo "[${TIMESTAMP}] [blocked] ${TASK_ID} parked as status=blocked after $((ATTEMPTS - 1)) failed attempts; reason=max_failed_attempts_reached; retry_after=${retry_after}."
  node "$V2_CLI" task update --id "$TASK_ID" --status blocked --scheduled-for null \
    --note "$note" --evidence "$evidence" \
    --json >/dev/null 2>&1 || true
  heartbeat_finish_tick
  exit 0
fi

if OUTPUT=$(timeout 1440 node "$V2_CLI" task execute-self-improvement --task "$TASK_ID" --apply --json 2>&1); then
  printf '%s\n' "$OUTPUT"
  STATUS=$(printf '%s' "$OUTPUT" | json_field status)
  if [ "$STATUS" = "completed" ]; then
    heartbeat_finish_tick "" --completed-tasks 1
    echo "[${TIMESTAMP}] [done] ${TASK_ID} self-improvement applied."
  elif [ "$STATUS" = "blocked" ] || [ "$STATUS" = "parked" ]; then
    heartbeat_finish_tick
    echo "[${TIMESTAMP}] [blocked] ${TASK_ID} status=${STATUS:-unknown}; task parked outside approved queue with actionable blocker or split follow-up."
  else
    heartbeat_finish_tick "self-improve unexpected status ${STATUS:-unknown} for ${TASK_ID}"
    echo "[${TIMESTAMP}] [warn] ${TASK_ID} status=${STATUS:-unknown}."
  fi
else
  RC=$?
  printf '%s\n' "${OUTPUT:-}"
  heartbeat_finish_tick "self-improve exit ${RC} for ${TASK_ID}"
  echo "[${TIMESTAMP}] [fail] ${TASK_ID} self-improve exit ${RC}."
fi

