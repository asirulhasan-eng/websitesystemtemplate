#!/usr/bin/env bash
# run-auditor.sh â€” Self-Evaluation Auditor (the system's inner critic).
#
# Runs every 6 hours (05/11/17/23 UTC). RETROSPECTIVE self-audit: reconstructs the
# last 6h of activity, cross-checks it against the Brain rules + strategy, grades the
# system A-F, injects up to 5 corrective tasks (safe-only auto-approve), records its
# findings as Brain notes, and notifies the owner over TELEGRAM (not email).
#
# Independent: runs even if the planner/intelligence/feedback jobs failed â€” catching
# that failure is part of its job. See processes/self-evaluation.md.
#
# Cron: 0 5,11,17,23 * * * /usr/bin/env bash /opt/client-agent/cron/run-auditor.sh >> /opt/client-agent/cron/logs/auditor.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"

# Pin the authoritative DB + agent root so this job and the Hermes session it spawns
# resolve the same state DB and the agent's .env (Telegram token/chat id for the
# notify step), independent of cron's working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

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
echo "[${TIMESTAMP}] Starting Self-Evaluation Auditor (window: ${CUTOFF} â†’ now)"
echo "========================================="

# â”€â”€ 1. Run-lock: skip this tick if a previous audit is still in flight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "auditor tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held â€” previous audit still running."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# â”€â”€ 2. Hermes auditor session (process-driven) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; cannot run the audit. Skipping this tick."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --json >/dev/null 2>&1 || true

PROMPT="You are the {{SITE_NAME}} SELF-EVALUATION AUDITOR â€” the system's inner critic.
Run a RETROSPECTIVE self-audit of the last 6 hours: ${CUTOFF} (UTC) â†’ now.

Follow the playbook EXACTLY: ${PROCESS_FILE}
Memory protocol: ${MEMORY_PROTOCOL}

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
5. Record the audit as a brain DECISION note (always), plus observation/lesson notes
   for any pattern you found.
6. NOTIFY THE OWNER OVER TELEGRAM â€” NOT email. Use 'node ${V2_CLI} notify telegram'.
   Grade-aware verbosity: A/B â†’ a single line (ðŸŸ¢); C â†’ full structured report (ðŸŸ¡);
   D/F â†’ full report led with ðŸ”´ ALERT. There is no email path.
7. Finish: node ${V2_CLI} heartbeat finish --job ${JOB} --json

First load standing policy: 'node ${V2_CLI} brain summary --markdown' â€” you grade
actions AGAINST those rules. Recall related memory before judging a target. Prefer
fewer well-evidenced findings over many weak ones; a false positive that cancels good
work is worse than a missed minor gap. Do NOT re-plan the day â€” that is the planner's job."

AUDITOR_TIMEOUT=1440
if timeout "$AUDITOR_TIMEOUT" hermes --skills system-rules,client-operations -z "$PROMPT" 2>&1 | tee -a "${LOG_DIR}/auditor-$(date +%Y-%m-%d).log"; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] auditor session complete."
else
  RC=$?
  node "$V2_CLI" heartbeat finish --job "$JOB" --error "hermes auditor exit ${RC}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] hermes auditor session exit ${RC}."
fi
