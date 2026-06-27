#!/usr/bin/env bash
# run-daily-workplan.sh Ã¢â‚¬â€ Twice-daily AI work plan (08:00 & 20:00 BST)
# PRODUCER (enqueue-only): triggers Hermes to PLAN the next 12 hours and mark
# tasks status='approved'. It does NOT execute Ã¢â‚¬â€ the ops (*/7) and blog (*/19)
# pipelines are the sole executors. Approval model is OPT-OUT.
# See config/guardrails.json and processes/dual-pipeline-plan.md.
#
# Usage: run-daily-workplan.sh [morning|evening]
# Cron:
#   0 2  * * * /opt/website-agent/cron/run-daily-workplan.sh morning >> /opt/website-agent/cron/logs/daily-workplan.log 2>&1
#   0 14 * * * /opt/website-agent/cron/run-daily-workplan.sh evening >> /opt/website-agent/cron/logs/daily-workplan.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"

SESSION="${1:-morning}"
AGENT_ROOT="${WEBSITE_AGENT_ROOT:-/opt/website-agent}"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"

# Pin the authoritative DB and agent root so the planner and the Hermes session
# it spawns resolve the same state DB and the agent's .env (SMTP creds for the
# opt-out plan email), independent of cron's working directory.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="$DB_PATH"

PROCESS_FILE="${AGENT_ROOT}/processes/daily-workplan.md"
GUARDRAILS_FILE="${AGENT_ROOT}/config/guardrails.json"
SITE_CONFIG="${AGENT_ROOT}/config/site.json"
FEEDBACK_BRIEF="${AGENT_ROOT}/cron/feedback/latest.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
JOB="workplan-${SESSION}"

if [ "$SESSION" = "evening" ]; then
  WINDOW_LABEL="8:00 PM BST tonight Ã¢â€ â€™ 8:00 AM BST tomorrow"
  SUBJECT="Ã°Å¸Å’â„¢ Website Operations Work Plan Ã¢â‚¬â€ Evening ($(date +%Y-%m-%d))"
else
  WINDOW_LABEL="8:00 AM Ã¢â€ â€™ 8:00 PM BST today ($(date +%Y-%m-%d))"
  SUBJECT="Ã¢Ëœâ‚¬Ã¯Â¸Â Website Operations Work Plan Ã¢â‚¬â€ Morning ($(date +%Y-%m-%d))"
fi

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

HEARTBEAT_RUN_ID=""
HEARTBEAT_FINISHED=0

heartbeat_start_tick() {
  local hb_json
  hb_json=$(node "$V2_CLI" heartbeat start --job "$JOB" --db "$DB_PATH" --json 2>/dev/null || true)
  HEARTBEAT_RUN_ID=$(printf '%s' "$hb_json" | json_field run_id)
}

heartbeat_finish_tick() {
  local error_msg="${1:-}"
  if [ "$#" -gt 0 ]; then shift; fi
  [ "$HEARTBEAT_FINISHED" = "1" ] && return 0

  local cmd=(node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --json)
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

echo "========================================="
echo "[${TIMESTAMP}] Starting Work Plan Ã¢â‚¬â€ ${SESSION}"
echo "========================================="

# 1. Health check first; abort on critical
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"ok":false,"error":"monitor-check failed"}')
echo "[health] $HEALTH"
if is_health_critical "$HEALTH"; then
  echo "[ABORT] Critical health issue detected. Sending alert email."
  node "$V2_CLI" email send \
    --to owner@example.com \
    --subject "Ã°Å¸Å¡Â¨ Work Plan Aborted Ã¢â‚¬â€ Critical System Issue" \
    --body "The ${SESSION} work plan at ${TIMESTAMP} was aborted due to a critical system health issue. Health check output: ${HEALTH}" \
    --priority high --json 2>/dev/null || true
  heartbeat_finish_tick "Aborted: critical health issue"
  exit 1
fi

# 2. Invoke Hermes with the work plan process
echo "[hermes] Starting AI-driven work plan (${SESSION})..."

PROMPT="You are running the Website Operations DAILY PLANNER for the ${SESSION} session.
Plan and ENQUEUE work for this window: ${WINDOW_LABEL}.

You are a PLANNER, not a data gatherer. The intelligence pipeline
(cron/run-intelligence.sh) already ran ~30 min ago and saved fresh analysis to
the analysis_reports table. You read those pre-digested reports Ã¢â‚¬â€ you do NOT call
gsc-fetch / serp-check / crawl yourself.

Read first:
- Playbook:    ${PROCESS_FILE}
- Guardrails (APPROVAL MODEL): ${GUARDRAILS_FILE}
- Site config: ${SITE_CONFIG}
- Memory protocol: ${AGENT_ROOT}/processes/obsidian-memory-protocol.md

Your inputs this session (read these, do NOT re-fetch raw data):
- Intelligence summary: node ${V2_CLI} intelligence summary --session ${SESSION} --json
  (aggregated GSC trends, threats, SERP changes, queue health, content/competitor/
   money-keyword/new-page/linking/tech signals Ã¢â‚¬â€ sorted by severity, with a
   stale_modules list). Use 'intelligence search'/'intelligence latest' for more.
- Feedback brief (what the workers did + early outcomes): cat ${FEEDBACK_BRIEF}

MEMORY (Obsidian Brain) Ã¢â‚¬â€ recall before deciding, record after:
- Start by loading standing policy + memory: 'node ${V2_CLI} brain summary --markdown'.
  As you pick keywords/pages, recall prior memory: 'node ${V2_CLI} brain recall --query \"<topic>\" --markdown'.
- Respect prior decisions/lessons/no-go you recall.
- At the end of the session, record ONE decision rollup:
  'node ${V2_CLI} brain note add --type decision --title \"Workplan ${SESSION} $(date +%Y-%m-%d): ...\" --body \"Planned/deferred + why\" --tags workplan,${SESSION} --session ${JOB}'.
  Add a 'lesson' note if an earlier change produced an attributable ranking outcome.

APPROVAL MODEL = OPT-OUT (negative consent) Ã¢â‚¬â€ you are an ENQUEUE-ONLY PRODUCER:
- You PLAN and ENQUEUE work; you do NOT execute it. The ops pipeline (every 7 min) and
  blog pipeline (every 19 min) are the ONLY executors. Do NOT call safe-fix / semi-safe /
  high-risk yourself.
- To enqueue a task for automatic execution set it to status='approved'
  (node ${V2_CLI} task update --id <id> --status approved). A worker WILL pick it up and
  run it within ~7 min (general) or ~19 min (blog). There is NO second gate Ã¢â‚¬â€ approve
  ONLY what you actually want done this window.
- SAFE, SEMI-SAFE, and REVERSIBLE HIGH-RISK work is pre-approved under opt-out: you may
  mark it 'approved' without waiting for a human reply.
- Tasks whose type is in guardrails 'require_explicit_approval' (irreversible/destructive)
  must NOT be approved. Hold them with high-risk Phase 1
  (node ${V2_CLI} high-risk --task <id>), which sets 'waiting_for_approval'; list them under
  'needs_explicit_go' in the plan email. The worker runs them only after the owner sends
  'approve <id>' via Telegram (which sets them 'approved').
- To HOLD a task, leave it 'candidate' (workers skip it). The owner can stop/modify any
  item via Telegram at any time Ã¢â‚¬â€ honor that over this default.

Steps:
1. Read the intelligence summary + feedback brief (above), recall Brain memory, then
   DECIDE the work (follow the playbook). Act on threats first, then opportunities.
   You make all strategic/routing decisions Ã¢â‚¬â€ the reports give you conclusions, not orders.
   Do NOT gather raw GSC/SERP data; that is the intelligence pipeline's job.
2. For each task you decide to run THIS window, ENQUEUE it (do NOT execute):
   - node ${V2_CLI} task update --id <id> --status approved
   The workers dispatch by risk level (safeÃ¢â€ â€™safe-fix, semi_safeÃ¢â€ â€™semi-safe,
   high_riskÃ¢â€ â€™high-risk). Irreversible types go through high-risk Phase 1 instead.
3. Build the plan as JSON and render the review email:
   node ${V2_CLI} report format --template workplan --data '<json>' --format html --json
   JSON shape: { \"session\":\"${SESSION}\", \"window\":\"${WINDOW_LABEL}\", \"health\":\"green|yellow|red\",
     \"planned\":[{\"id\",\"lane\":\"safe|semi|high\",\"title\",\"target\",\"action\",\"why\",\"when\"}],
     \"needs_explicit_go\":[{\"id\",\"title\",\"target\",\"action\",\"why\"}],
     \"ranking_alerts\":[{\"keyword\",\"detail\"}], \"notes\":\"...\" }
4. Send the rendered HTML as the email body:
   node ${V2_CLI} email send --to owner@example.com --subject \"${SUBJECT}\" --html-file <rendered.html> --json
5. Record heartbeat finish: node ${V2_CLI} heartbeat finish --job ${JOB} --json"

WORKPLAN_TIMEOUT=1440
if command -v hermes &> /dev/null; then
  if timeout "$WORKPLAN_TIMEOUT" hermes --skills system-rules,client-operations -z "$PROMPT" 2>&1 | tee -a "${LOG_DIR}/workplan-${SESSION}-$(date +%Y-%m-%d).log"; then
    heartbeat_finish_tick
  else
    RC=$?
    heartbeat_finish_tick "hermes workplan exit ${RC}"
    echo "[FAIL] hermes workplan session exit ${RC}"
    node "$V2_CLI" email send \
      --to owner@example.com \
      --subject "Work Plan Failed - Hermes session exit ${RC}" \
      --body "The ${SESSION} work plan at ${TIMESTAMP} failed because Hermes exited with ${RC}. Check ${LOG_DIR}/workplan-${SESSION}-$(date +%Y-%m-%d).log." \
      --priority high --json 2>/dev/null || true
  fi
else
  echo "[ERROR] hermes command not found. Falling back to dumping pre-computed intelligence (no AI planning)."
  node "$V2_CLI" intelligence summary --session "$SESSION" --json > "${LOG_DIR}/intelligence-summary-latest.json" 2>/dev/null || true
  [ -f "$FEEDBACK_BRIEF" ] && cp "$FEEDBACK_BRIEF" "${LOG_DIR}/feedback-latest.md" 2>/dev/null || true
  heartbeat_finish_tick
fi

echo "[${TIMESTAMP}] Work Plan (${SESSION}) complete"
