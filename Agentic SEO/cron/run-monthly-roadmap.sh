#!/usr/bin/env bash
# run-monthly-roadmap.sh — Monthly strategic roadmap (the "where are we going?" loop).
#
# Runs on the FIRST MONDAY of each month at 07:00 UTC (one hour after that day's
# Weekly Review, so it can build on the freshest weekly findings). Zooms out past
# the week: 28/56/90-day trends, content-portfolio and competitive assessment,
# 3-5 focus areas for the coming month, and a roadmap email to the owner. This is
# the long-range target the Weekly Review evaluates against. Follows the playbook
# EXACTLY: processes/monthly-roadmap.md.
#
# Cron NOTE: vixie-cron treats day-of-month AND day-of-week as OR when both are
# restricted, so "0 7 1-7 * 1" would fire on days 1-7 AND on every Monday. The
# crontab therefore runs this daily on days 1-7 ("0 7 1-7 * *") and THIS script
# exits unless today is a Monday — together that is exactly the first Monday.
#
# Independent: runs even if other jobs failed this month — catching that is part
# of the review. Modeled on cron/run-weekly-review.sh.
#
# Cron: 0 7 1-7 * * /usr/bin/env bash /opt/client-agent/cron/run-monthly-roadmap.sh >> /opt/client-agent/cron/logs/monthly-roadmap.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"

# Pin the authoritative DB + agent root so this job and the Hermes session it spawns
# resolve the same state DB and the agent's .env (SMTP creds for the roadmap email),
# independent of cron's working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

PROCESS_FILE="${AGENT_ROOT}/processes/monthly-roadmap.md"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="monthly-roadmap"
RUN_LOCK="monthly-roadmap"
LOCK_TTL_MINUTES=55
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$LOG_DIR"

# ── 0. First-Monday gate (see cron NOTE above) ──────────────────────────────────
if [ "$(date -u +%u)" != "1" ]; then
  echo "[${TIMESTAMP}] [skip] not a Monday — monthly roadmap runs on the first Monday only."
  exit 0
fi

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
echo "[${TIMESTAMP}] Starting Monthly Roadmap"
echo "========================================="

# ── 1. Run-lock: skip this tick if a previous roadmap run is still in flight ────
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "monthly roadmap tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held — previous run still in flight."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# ── 2. Hermes monthly-roadmap session (process-driven) ──────────────────────────
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; cannot run the monthly roadmap. Skipping this tick."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --json >/dev/null 2>&1 || true

PROMPT="You are running the {{SITE_NAME}} MONTHLY ROADMAP — the strategic planning loop.
Zoom out past weekly tactics: assess the month, the 90-day trajectory, and chart 3-5
focus areas for the next month.

Follow the playbook EXACTLY: ${PROCESS_FILE}
Memory protocol: ${MEMORY_PROTOCOL}

Use the v2 CLI at ${V2_CLI} for all data and state operations. Steps, in order:
1. Run the playbook's Pre-Flight Checks (weekly-review heartbeats, GSC data coverage,
   previous month's roadmap completion status) and Step 1 data gathering (GSC 28/56/90d,
   full SERP snapshot, keyword histories, month's task activity, site inventory).
2. Load standing policy first: 'node ${V2_CLI} brain summary --markdown' — and recall
   last month's roadmap DECISION note ('node ${V2_CLI} brain recall --query \"monthly roadmap\" --markdown')
   so this month is judged against the targets actually set, not reconstructed ones.
3. Work through the playbook's analysis steps: macro trends (clicks PRIMARY — see the
   outcome_loop config — positions secondary), content-strategy effectiveness,
   competitive landscape, and the review of last month's focus-area outcomes
   (overplanned / underplanned / wrong focus — say which).
4. Define next month's 3-5 focus areas per the playbook's selection framework and
   create the month's strategic tasks (status=candidate unless the playbook says
   otherwise — the twice-daily planner remains the primary producer).
5. Record the roadmap as Brain notes per the memory protocol: ONE monthly DECISION
   note carrying the focus areas + success criteria (this is what next month's run
   and the Weekly Reviews evaluate against), plus lesson notes for strategic patterns.
6. Email the owner the roadmap exactly as the playbook's Post-Flight specifies
   ('node ${V2_CLI} email send ...').

Do NOT re-plan the next 12 hours (the twice-daily planner's job), do NOT execute page
changes yourself, and do NOT flood the queue — focus areas, not task spam. Prefer fewer
well-evidenced strategic bets over many weak ones."

if hermes --skills system-rules,client-operations -z "$PROMPT" 2>&1 | tee -a "${LOG_DIR}/monthly-roadmap-$(date +%Y-%m-%d).log"; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] monthly roadmap session complete."
else
  RC=$?
  node "$V2_CLI" heartbeat finish --job "$JOB" --error "hermes monthly-roadmap exit ${RC}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] hermes monthly-roadmap session exit ${RC}."
fi
