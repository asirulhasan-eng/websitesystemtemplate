#!/usr/bin/env bash
# run-ops-pipeline.sh Ã¢â‚¬â€ Ops consumer (general_operational lane).
#
# Runs every 7 minutes. CONSUMER: it never plans and never fetches raw data. It
# executes the single highest-priority READY (approved) general_operational task,
# then exits Ã¢â‚¬â€ one task per tick.
#
# Producer/consumer contract (processes/dual-pipeline-plan.md):
#   When the twice-daily work plan marks a task status='approved', THIS worker
#   will pick it up and execute it within ~7 min. There is no second gate.
#
# Self-scheduled follow-ups (cli/lib/followups.js): the one sanctioned exception
# to "consumers don't produce". After the safe executor ships a ranking-affecting
# change it enqueues a deterministic, DEFERRED 'ranking_followup' task (default
# +14 days via tasks.scheduled_for) that re-checks SERP positions and, on a
# regression, enqueues a ranking_recovery task + alert. These are safe, depth-
# capped, and deduped, so the lane stays bounded.
#
# Cron: */7 * * * * /opt/website-agent/cron/run-ops-pipeline.sh >> /opt/website-agent/cron/logs/ops-pipeline.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"
source "$SCRIPT_DIR/lib/site-repo-safety.sh"

AGENT_ROOT="${WEBSITE_AGENT_ROOT:-/opt/website-agent}"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
SITE_ROOT="${WEBSITE_AGENT_SITE_ROOT:-/opt/website-site}"
LOG_DIR="${AGENT_ROOT}/cron/logs"
LANE="general_operational"

# Pin the authoritative DB and agent root so this worker (and the executors it
# invokes) always resolve the same state, independent of cron's working dir.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"
JOB="ops-pipeline"
RUN_LOCK="ops-pipeline"
LOCK_TTL_MINUTES=30
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$LOG_DIR"

# Extract a dotted field (e.g. task.task_id) from a JSON blob on stdin.
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

is_legacy_auditor_substrate_task() {
  local task_id="$1"
  local total
  total=$(node "$V2_CLI" task list --id "$task_id" --legacy-auditor-substrate-backlog --count-only --json 2>/dev/null | json_field total || true)
  [ "${total:-0}" = "1" ]
}

park_legacy_auditor_substrate_task() {
  local task_id="$1"
  node "$V2_CLI" task update --id "$task_id" --status needs_review \
    --note "Ops pipeline parked legacy approved auditor substrate/recovery task older than 90m instead of dispatching to safe-fix: metadata task_type=general_operational has no deterministic executor. Promote/recreate as self-improvement with scoped target_files, or close as obsolete." \
    --json >/dev/null 2>&1 || true
  heartbeat_finish_tick "" --completed-tasks 1
  echo "[${TIMESTAMP}] [park] ${task_id} legacy auditor substrate/recovery task parked instead of unsafe/no-op ops dispatch."
}

park_site_repo_handoff_blocker_task() {
  local task_id="$1"
  local rc="$2"
  local handoff_log="${3:-}"
  local clean_log

  clean_log="${handoff_log//$'\n'/ }"
  clean_log="${clean_log:0:700}"
  node "$V2_CLI" task update --id "$task_id" --status needs_review \
    --note "Ops pipeline parked before executor dispatch because the site repo production handoff failed (rc=${rc}). Human action required: run 'git -C ${SITE_ROOT} status --porcelain=v1 --untracked-files=all -- .' and resolve/stash/revert site-scope work, unmerged index entries, or stale index locks; then re-approve the task. Handoff log: ${clean_log:-none}" \
    --json >/dev/null 2>&1 || true
  heartbeat_finish_tick "" --completed-tasks 1
  echo "[${TIMESTAMP}] [park] ${task_id} site repo handoff blocker parked before retry accounting (rc=${rc})."
}

# Ã¢â€â‚¬Ã¢â€â‚¬ 1. Run-lock: skip this tick if a previous run is still in flight Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "ops pipeline tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held Ã¢â‚¬â€ previous tick still running."
  heartbeat_finish_tick "" --preserve-stale-running
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)

# Ã¢â€â‚¬Ã¢â€â‚¬ 2. Cheap health check (also releases stale locks); abort tick on critical Ã¢â€â‚¬
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue Ã¢â‚¬â€ skipping tick."
  exit 0
fi

# Ã¢â€â‚¬Ã¢â€â‚¬ 3. Pick the next ready task in this lane (one per tick) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
NEXT=$(node "$V2_CLI" task next --lane "$LANE" --json 2>/dev/null || echo '{}')
TASK_ID=$(printf '%s' "$NEXT" | json_field task.task_id)
if [ -z "$TASK_ID" ]; then
  echo "[${TIMESTAMP}] [idle] no ready ${LANE} tasks."
  exit 0
fi
DISPATCH=$(printf '%s' "$NEXT" | json_field task.dispatch)
echo "[${TIMESTAMP}] [pick] ${TASK_ID} (dispatch=${DISPATCH:-none})"

# Legacy Auditor substrate/recovery tasks that were created before the
# self_improvement lane existed sometimes have metadata task_type=general_operational.
# Do not send those to safe-fix (no deterministic handler); explicitly park with a
# reason so the Auditor/self-improvement loop can recreate or close them.
if is_legacy_auditor_substrate_task "$TASK_ID"; then
  park_legacy_auditor_substrate_task "$TASK_ID"
  exit 0
fi

# â”€â”€ 3b. Preserve any leftover preview/draft work before production handoff â”€â”€
# This happens before retry accounting: repo handoff blockers are environmental,
# not executor attempts. Dirty mirror/outbox/Brain files outside the site subtree
# are ignored by the helper's pathspec; true site-scope blockers are parked once
# with the exact human action instead of burning three ops retries.
PROD_BRANCH="$(resolve_site_production_branch "$AGENT_ROOT" "main")"
HANDOFF_LOG=""
HANDOFF_RC=0
set +e
HANDOFF_LOG=$(site_repo_preserve_and_checkout_production "$SITE_ROOT" "$PROD_BRANCH" "$JOB" "$TIMESTAMP" 2>&1)
HANDOFF_RC=$?
set -e
if [ -n "$HANDOFF_LOG" ]; then
  printf '%s\n' "$HANDOFF_LOG"
fi
if [ "$HANDOFF_RC" -ne 0 ]; then
  park_site_repo_handoff_blocker_task "$TASK_ID" "$HANDOFF_RC" "$HANDOFF_LOG"
  exit 0
fi

# â”€â”€ 3c. Attempt guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# `task next` orders by priority_score DESC, so a high-priority task that keeps
# failing stays status='approved' and is re-picked every tick â€” it starves every
# lower-priority task behind it. Count each executor dispatch in
# metadata_json.worker_attempts and park after MAX_ATTEMPTS so one broken task can
# never block the lane. Pre-dispatch repo handoff blockers are handled above.
MAX_ATTEMPTS=3
ATTEMPTS=$(node "$V2_CLI" db query \
  --sql "SELECT COALESCE(json_extract(metadata_json, '\$.worker_attempts'), 0) AS n FROM tasks WHERE task_id = ?" \
  --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.n)
ATTEMPTS=$(( ${ATTEMPTS:-0} + 1 ))
node "$V2_CLI" db query \
  --sql "UPDATE tasks SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '\$.worker_attempts', ?) WHERE task_id = ?" \
  --params "[${ATTEMPTS}, \"${TASK_ID}\"]" --allow-write --json >/dev/null 2>&1 || true
if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
  echo "[${TIMESTAMP}] [park] ${TASK_ID} auto-parked after $((ATTEMPTS - 1)) failed worker attempts (dispatch=${DISPATCH:-none}). Needs manual review."
  node "$V2_CLI" task update --id "$TASK_ID" --status needs_review \
    --note "Auto-parked after $((ATTEMPTS - 1)) failed worker attempts (dispatch=${DISPATCH:-none}). Needs manual diagnosis before re-approval." \
    --json >/dev/null 2>&1 || true
  exit 0
fi

# â”€â”€ 4. Dispatch to the matching execution lane by risk level Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Deterministic reversible edits (safe AND semi-safe) deploy STRAIGHT TO PRODUCTION
# via the safe executor Ã¢â‚¬â€ there is no preview/human-merge gate (opt-out model; the
# owner reviews the live site daily and rolls back if needed). The old semi-safe
# pipeline parked changes at 'preview_ready' awaiting a merge that never came, so it
# is no longer used here. Content rewrites are NOT dispatched here at all Ã¢â‚¬â€ routeTask
# sends service_page_gap/money_page_refresh/new_* to the blog_content (Hermes) lane.
run_executor() {
  case "$DISPATCH" in
    safe-fix)
      node "$V2_CLI" safe-fix --task "$TASK_ID" --site-root "$SITE_ROOT" --apply --production --json ;;
    semi-safe)
      node "$V2_CLI" safe-fix --task "$TASK_ID" --site-root "$SITE_ROOT" --allow-semi-safe --apply --production --json ;;
    high-risk)
      node "$V2_CLI" high-risk --task "$TASK_ID" --site-root "$SITE_ROOT" --apply --push --json ;;
    *)
      echo "[${TIMESTAMP}] [error] no dispatch lane for ${TASK_ID} (dispatch='${DISPATCH}')."
      return 64 ;;
  esac
}

if EXECUTOR_OUTPUT=$(run_executor); then
  printf '%s\n' "$EXECUTOR_OUTPUT"
  EXEC_STATUS=$(printf '%s' "$EXECUTOR_OUTPUT" | json_field status)
  TASK_STATUS=$(printf '%s' "$EXECUTOR_OUTPUT" | json_field task_status)
  EFFECTIVE_STATUS="${TASK_STATUS:-$EXEC_STATUS}"
  heartbeat_finish_tick "" --completed-tasks 1
  case "$EFFECTIVE_STATUS" in
    skipped|no_action|no_preview_required|monitored)
      echo "[${TIMESTAMP}] [processed] ${TASK_ID} ${EFFECTIVE_STATUS:-no_action}; not eligible for repeat pickup." ;;
    *)
      echo "[${TIMESTAMP}] [done] ${TASK_ID} ${EFFECTIVE_STATUS:-executed}." ;;
  esac
else
  RC=$?
  printf '%s\n' "${EXECUTOR_OUTPUT:-}"
  heartbeat_finish_tick "executor exit ${RC} for ${TASK_ID}"
  echo "[${TIMESTAMP}] [fail] ${TASK_ID} executor exit ${RC}."
fi
