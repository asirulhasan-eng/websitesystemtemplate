#!/usr/bin/env bash
# run-industry-radar.sh â€” Industry Radar producer (enqueue-only).
#
# Runs once daily. Invokes Hermes to scan the SEO / Google
# Business Profile / PPC / Google core-update / local-SEO / {{NICHE}}-industry
# beats, translate the newsworthy items into "what this means for your {{NICHE}}
# business" blog topics, and ENQUEUE them as new_blog_post tasks (status=approved)
# via `v2 task create`. It does NOT write blogs â€” the */19 blog pipeline picks up
# the approved tasks and authors them through
# /opt/client-site/tools/blog-production-skill.md.
#
# News discovery uses Serper (`v2 news search`), NOT the AI's built-in web search,
# which proved unreliable. Requires SERPER_API_KEY (preflighted below).
#
# This is the SECOND enqueue-only producer (the twice-daily work plan is the
# first). Like the planner it only enqueues; the consumer lanes execute. See
# processes/industry-radar.md and processes/dual-pipeline-plan.md.
#
# Usage: run-industry-radar.sh
# Cron:
#   2 5 */2 * * /usr/bin/env bash /opt/client-agent/cron/run-industry-radar.sh >> /opt/client-agent/cron/logs/industry-radar.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
DB_PATH="/opt/client-sqlite/seo-agent.db"
SITE_ROOT="/opt/client-site"

PROCESS_FILE="${AGENT_ROOT}/processes/industry-radar.md"
GUARDRAILS_FILE="${AGENT_ROOT}/config/guardrails.json"
SITE_CONFIG="${AGENT_ROOT}/config/site.json"
BLOG_ROUTER="${AGENT_ROOT}/processes/new-blog-creation.md"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="industry-radar"
RUN_LOCK="industry-radar"
LOCK_TTL_MINUTES=30

# Runtime knobs (overridable from the environment / a manual run).
RADAR_MAX_TOPICS="${RADAR_MAX_TOPICS:-10}"
RADAR_LOOKBACK_DAYS="${RADAR_LOOKBACK_DAYS:-7}"
RADAR_TIMEOUT="${RADAR_TIMEOUT:-20m}"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_LOCAL=$(TZ="${SEO_AGENT_TIMEZONE:-{{TIMEZONE}}}" date +%Y-%m-%d)

# Pin the authoritative DB and agent root so this producer and the Hermes session
# it spawns resolve the same state DB and the agent's .env (SMTP creds for the
# digest email), independent of cron's working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="$DB_PATH"

mkdir -p "$LOG_DIR"

# Extract a dotted field (e.g. lock_id) from a JSON blob on stdin.
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
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "industry radar tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held â€” previous run still going."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# â”€â”€ 2. Cheap health check; abort tick on critical â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue â€” skipping tick."
  exit 0
fi

# â”€â”€ 3. Run the radar through Hermes (producer; enqueue-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; industry radar needs a Hermes session. Skipping tick."
  exit 0
fi

# Serper is the news source (built-in web search is unreliable). If the API key
# is missing, the Hermes session would just fail soft â€” skip the tick instead of
# spending a session. A 1-result probe both checks the key and warms the path.
PROBE=$(node "$V2_CLI" news search --q "google search update" --days 7 --num 1 --json 2>/dev/null || true)
if [ "$(printf '%s' "$PROBE" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [warn] Serper news search unavailable (check SERPER_API_KEY). Skipping tick â€” no fabricated news."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --db "$DB_PATH" --json >/dev/null 2>&1 || true

PROMPT="You are the {{SITE_NAME}} INDUSTRY RADAR producer for ${DATE_LOCAL}.
You DISCOVER blog topics from outside-world news and ENQUEUE them as new_blog_post
tasks (status=approved). You are ENQUEUE-ONLY: you do NOT write the blog (the */19
blog pipeline does that), you do NOT run executors, and you do NOT touch other task
types.

Runtime limits for this run:
- RADAR_MAX_TOPICS = ${RADAR_MAX_TOPICS}  (hard cap on tasks you may create)
- RADAR_LOOKBACK_DAYS = ${RADAR_LOOKBACK_DAYS}  (news must be this fresh)

Read first (in full):
- Playbook:        ${PROCESS_FILE}
- Blog router:     ${BLOG_ROUTER}
- Guardrails:      ${GUARDRAILS_FILE}
- Site config:     ${SITE_CONFIG}
- Memory protocol: ${MEMORY_PROTOCOL}

CLI: node ${V2_CLI} ... (always pass --db ${DB_PATH}). Site root for the
cannibalization check: ${SITE_ROOT}.

Follow the playbook end-to-end:
1. Recall Brain memory + standing policy.
2. Build the 30-day recent-topic dedup set.
3. Discover news for every beat (SEO, GBP, PPC, Google core updates, local SEO,
   {{NICHE}} industry) with Serper: 'node ${V2_CLI} news search --q \"<query>\"
   --days ${RADAR_LOOKBACK_DAYS} --json'. Do NOT use built-in web search â€” it is
   unreliable. If news search errors or returns nothing, enqueue nothing and say
   so â€” never fabricate news.
4. Translate newsworthy items into 'what this means for your {{NICHE}} business'
   blog topics (topic, target keyword, brief, production line, beat, priority).
5. Gate each candidate: dedup, homepage-canonical guard, and the REQUIRED
   'v2 content blog-cannibalization' check. Lean-autonomous gate: PROCEED when
   recommendation is 'create_new_blog' OR 'differentiate_or_refresh' (for the
   latter, sharpen the brief to a clearly distinct angle from matches[0]); SKIP
   only on 'refresh_existing_blog' (a true same-query collision).
6. Enqueue up to RADAR_MAX_TOPICS survivors with 'v2 task create --type new_blog_post
   --status approved --source industry_radar', embedding the cannibalization check
   in --evidence (task create rejects new_blog_post without it).
7. Record ONE Brain decision note and email the owner a digest of what you enqueued
   (or why nothing was, on a quiet day).

Hard rules: never exceed RADAR_MAX_TOPICS; never create a task whose cannibalization
check returned 'refresh_existing_blog' (create_new_blog and differentiate_or_refresh
both proceed); never target a homepage-canonical head money term with a new blog;
never run safe-fix/semi-safe/high-risk or deploy."

RC=0
if command -v timeout >/dev/null 2>&1; then
  timeout "$RADAR_TIMEOUT" hermes --skills system-rules,client-operations -z "$PROMPT" \
    2>&1 | tee -a "${LOG_DIR}/industry-radar-${DATE_LOCAL}.log" || RC=$?
else
  hermes --skills system-rules,client-operations -z "$PROMPT" \
    2>&1 | tee -a "${LOG_DIR}/industry-radar-${DATE_LOCAL}.log" || RC=$?
fi

# â”€â”€ 4. Heartbeat finish + outcome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if [ "$RC" -ne 0 ]; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --error "hermes radar session exit ${RC}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] industry radar hermes session exit ${RC}."
  exit "$RC"
fi

node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --json >/dev/null 2>&1 || true
echo "[${TIMESTAMP}] [done] industry radar complete."
