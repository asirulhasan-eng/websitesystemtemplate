#!/usr/bin/env bash
# run-auditor.sh Ã¢â‚¬â€ Self-Evaluation Auditor (the system's inner critic).
#
# Runs every 6 hours (05/11/17/23 UTC). RETROSPECTIVE self-audit: reconstructs the
# last 6h of activity, cross-checks it against the Brain rules + strategy, grades the
# system A-F, injects up to 5 corrective tasks (safe-only auto-approve), records its
# findings as Brain notes, and notifies the owner over TELEGRAM (not email).
#
# Independent: runs even if the planner/intelligence/feedback jobs failed Ã¢â‚¬â€ catching
# that failure is part of its job. See processes/self-evaluation.md.
#
# Cron: 0 5,11,17,23 * * * /usr/bin/env bash /opt/website-agent/cron/run-auditor.sh >> /opt/website-agent/cron/logs/auditor.log 2>&1

set -euo pipefail

AGENT_ROOT="${WEBSITE_AGENT_ROOT:-/opt/website-agent}"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"

# Pin the authoritative DB + agent root so this job and the Hermes session it spawns
# resolve the same state DB and the agent's .env (Telegram token/chat id for the
# notify step), independent of cron's working directory.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"

PROCESS_FILE="${AGENT_ROOT}/processes/self-evaluation.md"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="auditor"
RUN_LOCK="auditor"
LOCK_TTL_MINUTES=20
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
CUTOFF=$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)

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

echo "========================================="
echo "[${TIMESTAMP}] Starting Self-Evaluation Auditor (window: ${CUTOFF} Ã¢â€ â€™ now)"
echo "========================================="

# Ã¢â€â‚¬Ã¢â€â‚¬ 1. Run-lock: skip this tick if a previous audit is still in flight Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "auditor tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held Ã¢â‚¬â€ previous audit still running."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

HEARTBEAT_RUN_ID=""
heartbeat_finish() {
  if [ -n "${HEARTBEAT_RUN_ID:-}" ]; then
    node "$V2_CLI" heartbeat finish --job "$JOB" --run-id "$HEARTBEAT_RUN_ID" "$@" --json >/dev/null 2>&1 || true
  else
    node "$V2_CLI" heartbeat finish --job "$JOB" "$@" --json >/dev/null 2>&1 || true
  fi
}

# This wrapper owns the single authoritative auditor heartbeat/run ledger row for
# the cron tick. The Hermes playbook/prompt must not call heartbeat start again.
HEARTBEAT_JSON=$(node "$V2_CLI" heartbeat start --job "$JOB" --json 2>/dev/null || true)
HEARTBEAT_RUN_ID=$(printf '%s' "$HEARTBEAT_JSON" | json_field run_id)
export AUDITOR_HEARTBEAT_RUN_ID="$HEARTBEAT_RUN_ID"

# Cheap idle gate: skip Hermes only when the last window is empty and the
# watchdog surface is clean. Empty + missed heartbeat is not idle; it is an audit.
STUCK_CUTOFF=$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
EVENT_SQL="SELECT COUNT(*) AS n FROM events WHERE created_at >= ?"
EVENT_JSON=$(node "$V2_CLI" db query --sql "$EVENT_SQL" --params "[\"${CUTOFF}\"]" --json 2>/dev/null || echo '{}')
EVENT_COUNT=$(printf '%s' "$EVENT_JSON" | json_field rows.0.n)
EVENT_COUNT=${EVENT_COUNT:-0}

HEARTBEAT_SQL="SELECT ((SELECT COUNT(*) FROM heartbeats WHERE error_summary IS NOT NULL OR (status = 'running' AND heartbeat_at < ?)) + (SELECT COUNT(*) FROM cron_runs WHERE status = 'running' AND started_at < ?)) AS n"
HEARTBEAT_JSON=$(node "$V2_CLI" db query --sql "$HEARTBEAT_SQL" --params "[\"${STUCK_CUTOFF}\",\"${STUCK_CUTOFF}\"]" --json 2>/dev/null || echo '{}')
STUCK_HEARTBEATS=$(printf '%s' "$HEARTBEAT_JSON" | json_field rows.0.n)
STUCK_HEARTBEATS=${STUCK_HEARTBEATS:-1}

MONITOR_JSON=$(node "$V2_CLI" monitor-check --json 2>/dev/null || echo '{"overall_status":"critical"}')
MONITOR_STATUS=$(printf '%s' "$MONITOR_JSON" | json_field overall_status)
MONITOR_STATUS=${MONITOR_STATUS:-critical}

if [ "$EVENT_COUNT" = "0" ] && [ "$STUCK_HEARTBEATS" = "0" ] && [ "$MONITOR_STATUS" != "critical" ]; then
  MSG="ðŸŸ¢ idle window, audit skipped (${CUTOFF} -> ${TIMESTAMP}; monitor=${MONITOR_STATUS})"
  node "$V2_CLI" notify telegram --text "$MSG" --json >/dev/null 2>&1 || true
  heartbeat_finish
  echo "[${TIMESTAMP}] [idle] ${MSG}"
  exit 0
fi

# Ã¢â€â‚¬Ã¢â€â‚¬ 2. Hermes auditor session (process-driven) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; cannot run the audit. Skipping this tick."
  heartbeat_finish --error "hermes CLI not available"
  exit 0
fi

HEARTBEAT_FINISH_CMD="node ${V2_CLI} heartbeat finish --job ${JOB}"
if [ -n "${HEARTBEAT_RUN_ID:-}" ]; then
  HEARTBEAT_FINISH_CMD="${HEARTBEAT_FINISH_CMD} --run-id ${HEARTBEAT_RUN_ID}"
fi
HEARTBEAT_FINISH_CMD="${HEARTBEAT_FINISH_CMD} --json"

PROMPT="You are the Website Operations SELF-EVALUATION AUDITOR Ã¢â‚¬â€ the system's inner critic.
Run a RETROSPECTIVE self-audit of the last 6 hours: ${CUTOFF} (UTC) Ã¢â€ â€™ now.

Follow the playbook EXACTLY: ${PROCESS_FILE}
Memory protocol: ${MEMORY_PROTOCOL}
The cron wrapper has already started the single authoritative auditor heartbeat/run ledger row.
Do NOT run heartbeat start inside Hermes; only finish the wrapper-owned lifecycle.

You are a CRITIC WITH LIMITED HANDS, not a planner. Your job:
1. Reconstruct what actually happened in the last 6h (tasks, heartbeats, intelligence,
   git deploys, worker logs, brain notes).
2. Detect gaps: which scheduled processes didn't run, brain-rule violations, ignored
   intelligence, duplicate/unjustified/low-value tasks, strategic drift.
3. Grade the window A-F on the five weighted dimensions in the playbook.
4. Inject AT MOST 5 corrective tasks, each citing the gap (evidence/report id) and a
   concrete target, tagged 'source:auditor'. You may set a corrective task 'approved'
   ONLY when its risk-level is 'safe'. semi_safe/high_risk corrective tasks stay
   'candidate' for the planner. You may 'cancel' a clear un-deduped duplicate.
   For agent-substrate gaps (CLI/routing/cron/process prompts/Hermes skills/DB
   reconciliation), create a self_improvement/process_update/prompt_update/
   cron_repair/executor_repair/db_reconciliation task instead of content or ops
   work when the gap recurred across 2 audits or approved recovery work has been
   unconsumed for 90+ minutes. Approve it and include structured evidence with
   audit, gap, recurrence, target_files, acceptance, and meta_experiment.
5. Record the audit as a brain DECISION note (always), plus observation/lesson notes
   for any pattern you found.
6. NOTIFY THE OWNER OVER TELEGRAM Ã¢â‚¬â€ NOT email. Use 'node ${V2_CLI} notify telegram'.
   Grade-aware verbosity: A/B Ã¢â€ â€™ a single line (Ã°Å¸Å¸Â¢); C Ã¢â€ â€™ full structured report (Ã°Å¸Å¸Â¡);
   D/F Ã¢â€ â€™ full report led with Ã°Å¸â€Â´ ALERT. There is no email path.
7. Finish: ${HEARTBEAT_FINISH_CMD}

First load standing policy: 'node ${V2_CLI} brain summary --markdown' Ã¢â‚¬â€ you grade
actions AGAINST those rules. Recall related memory before judging a target. Prefer
fewer well-evidenced findings over many weak ones; a false positive that cancels good
work is worse than a missed minor gap. Do NOT re-plan the day Ã¢â‚¬â€ that is the planner's job."

AUDITOR_TIMEOUT=1440
if timeout "$AUDITOR_TIMEOUT" hermes --skills system-rules,client-operations -z "$PROMPT" 2>&1 | tee -a "${LOG_DIR}/auditor-$(date +%Y-%m-%d).log"; then
  heartbeat_finish
  echo "[${TIMESTAMP}] [done] auditor session complete."
else
  RC=$?
  heartbeat_finish --error "hermes auditor exit ${RC}"
  echo "[${TIMESTAMP}] [fail] hermes auditor session exit ${RC}."
fi
