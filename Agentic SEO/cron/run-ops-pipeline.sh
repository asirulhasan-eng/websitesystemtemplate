#!/usr/bin/env bash
# run-ops-pipeline.sh â€” Ops consumer (general_operational lane).
#
# Runs every 7 minutes. CONSUMER: it never plans and never fetches raw data. It
# executes the single highest-priority READY (approved) general_operational task,
# then exits â€” one task per tick.
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
# Cron: */7 * * * * /opt/client-agent/cron/run-ops-pipeline.sh >> /opt/client-agent/cron/logs/ops-pipeline.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
SITE_ROOT="/opt/client-site"
LOG_DIR="${AGENT_ROOT}/cron/logs"
LANE="general_operational"

# Pin the authoritative DB and agent root so this worker (and the executors it
# invokes) always resolve the same state, independent of cron's working dir.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"
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

# â”€â”€ 1. Run-lock: skip this tick if a previous run is still in flight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "ops pipeline tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held â€” previous tick still running."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# â”€â”€ 2. Cheap health check (also releases stale locks); abort tick on critical â”€
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue â€” skipping tick."
  exit 0
fi

# â”€â”€ 2b. Ensure the site repo is on the production branch before any deploy â”€â”€â”€â”€â”€
# safe-fix --production commits to whatever branch the repo is currently on. A prior
# high-risk or Hermes session can leave it on an agent/* (or stale master) branch;
# without this guard a production deploy would commit there instead of the Cloudflare
# production branch and never go live (while still being marked deployed). Only switch
# when the tree is clean. cron does NOT export CLOUDFLARE_PRODUCTION_BRANCH, so resolve
# it from the agent .env (it is 'main' here); fall back to 'main', never 'master'.
PROD_BRANCH="${CLOUDFLARE_PRODUCTION_BRANCH:-}"
if [ -z "$PROD_BRANCH" ] && [ -f "$AGENT_ROOT/.env" ]; then
  PROD_BRANCH=$(grep -E '^CLOUDFLARE_PRODUCTION_BRANCH=' "$AGENT_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d ' "\r')
fi
PROD_BRANCH="${PROD_BRANCH:-main}"
CUR_BRANCH=$(git -C "$SITE_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ -n "$CUR_BRANCH" ] && [ "$CUR_BRANCH" != "$PROD_BRANCH" ]; then
  if git -C "$SITE_ROOT" diff --quiet && git -C "$SITE_ROOT" diff --cached --quiet; then
    if git -C "$SITE_ROOT" checkout "$PROD_BRANCH" >/dev/null 2>&1; then
      echo "[${TIMESTAMP}] [fix] site repo was on '${CUR_BRANCH}', checked out '${PROD_BRANCH}' for production deploy."
    fi
  else
    echo "[${TIMESTAMP}] [error] site repo on '${CUR_BRANCH}' with uncommitted changes — aborting to avoid deploying to wrong branch."
    exit 1
  fi
fi

# â”€â”€ 3. Pick the next ready task in this lane (one per tick) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
NEXT=$(node "$V2_CLI" task next --lane "$LANE" --json 2>/dev/null || echo '{}')
TASK_ID=$(printf '%s' "$NEXT" | json_field task.task_id)
if [ -z "$TASK_ID" ]; then
  echo "[${TIMESTAMP}] [idle] no ready ${LANE} tasks."
  exit 0
fi
DISPATCH=$(printf '%s' "$NEXT" | json_field task.dispatch)
echo "[${TIMESTAMP}] [pick] ${TASK_ID} (dispatch=${DISPATCH:-none})"

# ── 3b. Attempt guard ─────────────────────────────────────────────────────────
# `task next` orders by priority_score DESC, so a high-priority task that keeps
# failing stays status='approved' and is re-picked every tick — it starves every
# lower-priority task behind it. Count each pick in metadata_json.worker_attempts
# and park the task after MAX_ATTEMPTS so one broken task can never block the lane.
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

node "$V2_CLI" heartbeat start --job "$JOB" --task-id "$TASK_ID" --json >/dev/null 2>&1 || true

# â”€â”€ 4. Dispatch to the matching execution lane by risk level â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Deterministic reversible edits (safe AND semi-safe) deploy STRAIGHT TO PRODUCTION
# via the safe executor â€” there is no preview/human-merge gate (opt-out model; the
# owner reviews the live site daily and rolls back if needed). The old semi-safe
# pipeline parked changes at 'preview_ready' awaiting a merge that never came, so it
# is no longer used here. Content rewrites are NOT dispatched here at all â€” routeTask
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
  node "$V2_CLI" heartbeat finish --job "$JOB" --completed-tasks 1 --json >/dev/null 2>&1 || true
  case "$EFFECTIVE_STATUS" in
    skipped|no_action|no_preview_required|monitored)
      echo "[${TIMESTAMP}] [processed] ${TASK_ID} ${EFFECTIVE_STATUS:-no_action}; not eligible for repeat pickup." ;;
    *)
      echo "[${TIMESTAMP}] [done] ${TASK_ID} ${EFFECTIVE_STATUS:-executed}." ;;
  esac
else
  RC=$?
  printf '%s\n' "${EXECUTOR_OUTPUT:-}"
  node "$V2_CLI" heartbeat finish --job "$JOB" --error "executor exit ${RC} for ${TASK_ID}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] ${TASK_ID} executor exit ${RC}."
fi
