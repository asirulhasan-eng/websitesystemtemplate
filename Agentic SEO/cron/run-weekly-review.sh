#!/usr/bin/env bash
# run-weekly-review.sh — Weekly strategic review (the "are we moving in the right
# direction?" loop).
#
# Runs every Monday 06:00 UTC. Steps back from daily tactics: reviews the past week's
# GSC/SERP/outcome performance, evaluates strategy effectiveness, records findings as
# Brain notes, and emails the owner a weekly report. Follows the playbook EXACTLY:
# processes/weekly-review.md. Strategy/analysis job — it may enqueue next-week
# priorities per the playbook, but the twice-daily planner remains the primary producer.
#
# Independent: runs even if other jobs failed this week — catching that is part of the
# review. Modeled on cron/run-auditor.sh.
#
# Cron: 0 6 * * 1 /usr/bin/env bash /opt/client-agent/cron/run-weekly-review.sh >> /opt/client-agent/cron/logs/weekly-review.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"

# Pin the authoritative DB + agent root so this job and the Hermes session it spawns
# resolve the same state DB and the agent's .env (SMTP creds for the weekly email),
# independent of cron's working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

PROCESS_FILE="${AGENT_ROOT}/processes/weekly-review.md"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="weekly-review"
RUN_LOCK="weekly-review"
LOCK_TTL_MINUTES=40
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

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
echo "[${TIMESTAMP}] Starting Weekly Review"
echo "========================================="

# ── 1. Run-lock: skip this tick if a previous review is still in flight ──────────
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "weekly review tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held — previous review still running."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# ── 2. Hermes weekly-review session (process-driven) ────────────────────────────
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; cannot run the weekly review. Skipping this tick."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --json >/dev/null 2>&1 || true

PROMPT="You are running the {{SITE_NAME}} WEEKLY REVIEW — the strategic step-back loop.
Analyze the past 7 days, evaluate whether the strategy is working, and plan next week.

Follow the playbook EXACTLY: ${PROCESS_FILE}
Memory protocol: ${MEMORY_PROTOCOL}

Use the v2 CLI at ${V2_CLI} for all data and state operations (read-only for analysis;
the playbook says where it may enqueue next-week priorities). Steps, in order:
1. Run the playbook's Pre-Flight Checks and Step 1 data gathering (GSC 7/14/28d, SERP
   money keywords, outcomes, heartbeats, deployments).
2. Load standing policy first: 'node ${V2_CLI} brain summary --markdown' — judge the
   week AGAINST those rules and the strategy. Recall related memory before concluding.
3. Work through the playbook's analysis steps: what moved (clicks PRIMARY — see the
   outcome_loop config — positions secondary), what shipped, what worked vs didn't,
   strategic drift, and next-week priorities.
4. Record the review as Brain notes per the memory protocol (a weekly DECISION note,
   plus observation/lesson notes for patterns found).
5. Email the owner the weekly report exactly as the playbook specifies
   ('node ${V2_CLI} email send ...').

Do NOT re-plan the next 12 hours (that is the twice-daily planner's job) and do NOT
execute page changes yourself. Prefer fewer well-evidenced conclusions over many weak ones."

if hermes --skills system-rules,client-operations -z "$PROMPT" 2>&1 | tee -a "${LOG_DIR}/weekly-review-$(date +%Y-%m-%d).log"; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] weekly review session complete."
else
  RC=$?
  node "$V2_CLI" heartbeat finish --job "$JOB" --error "hermes weekly-review exit ${RC}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] hermes weekly-review session exit ${RC}."
fi
