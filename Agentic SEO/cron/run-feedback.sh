#!/usr/bin/env bash
# run-feedback.sh â€” Feedback analyst (closes the producer/consumer loop).
#
# Runs every 2 hours. ANALYSIS-ONLY: it reviews what the */7 and */19 workers
# did plus fresh outcome signals, and writes a rolling feedback brief that the
# twice-daily planner reads before deciding. It does NOT create or approve tasks
# â€” the work plan remains the sole producer.
#
# Cost control: 12 Hermes runs/day is wasteful when nothing happened, so a cheap
# no-op gate skips the Hermes call when there has been no worker activity since
# the last run.
#
# Cron: 0 */2 * * * /opt/client-agent/cron/run-feedback.sh >> /opt/client-agent/cron/logs/feedback.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"

# Pin the authoritative DB and agent root so this analyst and the Hermes session
# it spawns resolve the same state DB and the agent's .env, independent of cwd.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
FEEDBACK_DIR="${AGENT_ROOT}/cron/feedback"
LATEST_BRIEF="${FEEDBACK_DIR}/latest.md"
JOB="feedback"
RUN_LOCK="feedback"
LOCK_TTL_MINUTES=30
LOOKBACK_MINUTES=130          # slightly > 2h so ticks overlap, never miss activity
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
CUTOFF=$(date -u -d "${LOOKBACK_MINUTES} minutes ago" +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$LOG_DIR" "$FEEDBACK_DIR"

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
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "feedback tick" --json 2>/dev/null || true)
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

# â”€â”€ 2. No-op gate: count worker activity since the last run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ACTIVITY_SQL="SELECT COUNT(*) AS n FROM events WHERE created_at >= ? AND \
  event_type = 'task_status_changed' AND new_value IN \
    ('preview_ready','preview_pushed','executed','deployed','deployed_to_production','completed','failed','rollback')"
ACTIVITY_JSON=$(node "$V2_CLI" db query --sql "$ACTIVITY_SQL" --params "[\"${CUTOFF}\"]" --json 2>/dev/null || echo '{}')
ACTIVITY=$(printf '%s' "$ACTIVITY_JSON" | json_field rows.0.n)
ACTIVITY=${ACTIVITY:-0}

if [ "$ACTIVITY" = "0" ]; then
  {
    echo "# Feedback Brief â€” ${TIMESTAMP}"
    echo ""
    echo "_No worker activity since ${CUTOFF}. Nothing new to analyze._"
  } > "$LATEST_BRIEF"
  echo "[${TIMESTAMP}] [noop] no worker activity since ${CUTOFF}; brief stamped, Hermes skipped."
  exit 0
fi

echo "[${TIMESTAMP}] [run] ${ACTIVITY} worker event(s) since ${CUTOFF} â€” generating feedback brief."

# â”€â”€ 3. Hermes feedback analyst (analysis-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; cannot generate AI brief. Leaving previous brief in place."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --json >/dev/null 2>&1 || true

PROMPT="You are the {{SITE_NAME}} feedback analyst. ANALYSIS-ONLY: do NOT create, approve, or execute tasks.
Write a concise rolling feedback brief that the next twice-daily work plan will read before it decides.

Window: worker activity and signals since ${CUTOFF} (UTC).

Pull and review (use the v2 CLI; read-only):
1. Worker outcomes since the cutoff:
   node ${V2_CLI} db query --sql \"SELECT created_at, event_type, task_id, new_value, source FROM events WHERE created_at >= ? ORDER BY created_at DESC\" --params '[\"${CUTOFF}\"]' --json
2. Deployments since the cutoff:
   node ${V2_CLI} db query --sql \"SELECT task_id, deployment_type, status, validation_status, started_at, finished_at FROM deployments WHERE started_at >= ? ORDER BY started_at DESC\" --params '[\"${CUTOFF}\"]' --json
3. Fresh outcome signals: pull lightweight GSC only for pages/queries the workers
   changed in this window. Do NOT run SERP/rank tracking here â€” polling keywords
   every 2 hours is too wasteful. SERP checks belong only in the twice-daily
   intelligence cadence or explicit manual investigations.
   node ${V2_CLI} gsc-fetch --days 7 --min-impressions 5 --json
4. Recall related Brain memory for changed targets (${MEMORY_PROTOCOL}):
   node ${V2_CLI} brain recall --query \"<changed page/keyword>\" --markdown

Write the brief to BOTH paths (overwrite latest, keep a timestamped copy):
- ${LATEST_BRIEF}
- ${FEEDBACK_DIR}/brief-${STAMP}.md

Brief sections (keep it tight â€” this is planner input, not a report):
- Executed since last run: what shipped (task id, lane, result: deployed/preview/failed/rolled-back).
- Early outcomes: any attributable GSC/SERP movement on changed targets (or 'too early').
- Failures / stuck: anything that errored, rolled back, or is blocked â€” with the likely cause.
- Recommendations for the next plan: what to double down on, pause, or investigate. (Suggestions only.)

Do not modify task state. The work plan is the sole producer."

FEEDBACK_TIMEOUT=1440
if timeout "$FEEDBACK_TIMEOUT" hermes chat -q "$PROMPT" --quiet --yolo --accept-hooks 2>&1 | tee -a "${LOG_DIR}/feedback-$(date +%Y-%m-%d).log"; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] feedback brief written to ${LATEST_BRIEF}."
else
  RC=$?
  node "$V2_CLI" heartbeat finish --job "$JOB" --error "hermes feedback exit ${RC}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] hermes feedback session exit ${RC}."
fi
