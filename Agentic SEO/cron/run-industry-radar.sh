#!/usr/bin/env bash
# run-industry-radar.sh — Industry Radar report-only intelligence tick.
#
# Runs once every 2 days. Invokes Hermes to scan the SEO / Google Business
# Profile / PPC / Google core-update / local-SEO / website-industry
# beats, translate newsworthy items into planner-ready blog ideas, and save a
# structured `v2 intelligence report` for the twice-daily workplan.
#
# Planner-sole-producer contract: this cron does NOT create, update, or approve
# tasks, and it must never emit industry_radar task-source rows. The daily
# workplan reads the intelligence summary and is the only routine that may route
# reported ideas into approved work.
#
# News discovery uses Serper (`v2 news search`), NOT the AI's built-in web search,
# which proved unreliable. Requires SERPER_API_KEY (preflighted below).
#
# Usage: run-industry-radar.sh
# Cron:
#   2 5 */2 * * /usr/bin/env bash /opt/website-agent/cron/run-industry-radar.sh >> /opt/website-agent/cron/logs/industry-radar.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"

AGENT_ROOT="/opt/website-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
DB_PATH="/opt/website-state/website-agent.db"
SITE_ROOT="/opt/website-site"

PROCESS_FILE="${AGENT_ROOT}/processes/industry-radar.md"
GUARDRAILS_FILE="${AGENT_ROOT}/config/guardrails.json"
SITE_CONFIG="${AGENT_ROOT}/config/site.json"
BLOG_ROUTER="${AGENT_ROOT}/processes/new-blog-creation.md"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="industry-radar"
RUN_LOCK="industry-radar"
LOCK_TTL_MINUTES=30

# Runtime knobs (overridable from the environment / a manual run). RADAR_MAX_TOPICS
# is still accepted for backward compatibility, but it now caps reported ideas,
# not created tasks.
RADAR_MAX_IDEAS="${RADAR_MAX_IDEAS:-${RADAR_MAX_TOPICS:-10}}"
RADAR_LOOKBACK_DAYS="${RADAR_LOOKBACK_DAYS:-7}"
RADAR_TIMEOUT="${RADAR_TIMEOUT:-20m}"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_LOCAL=$(TZ="${SEO_AGENT_TIMEZONE:-Asia/Dhaka}" date +%Y-%m-%d)

# Pin the authoritative DB and agent root so this intelligence tick and the Hermes
# session it spawns resolve the same state DB and the agent's .env, independent of
# cron's working directory.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="$DB_PATH"

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

# --- 1. Run-lock: skip this tick if a previous run is still in flight ---
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "industry radar tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held — previous run still going."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# --- 2. Cheap health check; abort tick on critical ---
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue — skipping tick."
  exit 0
fi

# --- 3. Run the radar through Hermes (report-only intelligence) ---
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; industry radar needs a Hermes session. Skipping tick."
  exit 0
fi

# Serper is the news source (built-in web search is unreliable). If the API key
# is missing, the Hermes session would just fail soft — skip the tick instead of
# spending a session. A 1-result probe both checks the key and warms the path.
PROBE=$(node "$V2_CLI" news search --q "google search update" --days 7 --num 1 --json 2>/dev/null || true)
if [ "$(printf '%s' "$PROBE" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [warn] Serper news search unavailable (check SERPER_API_KEY). Skipping tick — no fabricated news."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --db "$DB_PATH" --json >/dev/null 2>&1 || true

PROMPT="You are the Website Operations INDUSTRY RADAR intelligence module for ${DATE_LOCAL}.

Planner-sole-producer contract:
- You are REPORT-ONLY intelligence for the twice-daily workplan.
- Do NOT create, update, or approve tasks.
- Do NOT set any task status to approved.
- Do NOT run executors or deploy.
- The Daily Planner is the sole task producer. Your output is a structured report of ideas
  the planner may consume later through v2 intelligence summary/latest/search.

Runtime limits for this run:
- RADAR_MAX_IDEAS = ${RADAR_MAX_IDEAS}  (hard cap on ideas to include in the report)
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
2. Build the 30-day recent radar/report dedup set using intelligence search/latest and planner-routed blog tasks.
3. Discover news for every beat (SEO, GBP, PPC, Google core updates, local SEO,
   website industry) with Serper: 'node ${V2_CLI} news search --q \"<query>\"
   --days ${RADAR_LOOKBACK_DAYS} --json'. Do NOT use built-in web search — it is
   unreliable. If news search errors or returns nothing, report that honestly and
   do not invent ideas.
4. Translate newsworthy items into planner-ready 'what this means for your website owner'
   blog ideas (topic, target keyword, brief, production line, beat, priority).
5. Gate each candidate: dedup, homepage-canonical guard, and the REQUIRED
   'v2 content blog-cannibalization' check. Keep create_new_blog candidates and
   distinct differentiate_or_refresh candidates for planner review; skip true same-query
   refresh_existing_blog collisions.
6. Save exactly one intelligence report with 'node ${V2_CLI} intelligence report --module industry-radar
   --session manual --severity <normal|warning> --headline <summary> --report-json-file <tmp-json>
   --reports-root ${AGENT_ROOT} --db ${DB_PATH} --json'. Put ideas in opportunities[], skipped
   items in observations[]/data.skipped, and planner-facing next steps in recommendations[].
7. Email the owner a digest of what was reported (or why there were zero ideas). Say these are
   planner inputs, not approved tasks.

Report JSON requirements:
- opportunities[] entries must include: topic, target_keyword, brief, production_line, beat,
  priority, sources[], blog_cannibalization_check, and planner_action (for example,
  'Planner: consider whether to enqueue through the workplan').
- data.coverage must include scanned_beats, search_queries, news_items_considered,
  ideas_reported, ideas_skipped, and lookback_days.
- recommendations[] must be phrased to the planner; never state that work has been approved.

Hard rules: never exceed RADAR_MAX_IDEAS reported ideas; never report a candidate whose
cannibalization check returned refresh_existing_blog except as a skipped observation; never target
a homepage-canonical head money term with a new-blog idea; never fabricate news."

RC=0
if command -v timeout >/dev/null 2>&1; then
  timeout "$RADAR_TIMEOUT" hermes --skills system-rules,client-operations -z "$PROMPT" \
    2>&1 | tee -a "${LOG_DIR}/industry-radar-${DATE_LOCAL}.log" || RC=$?
else
  hermes --skills system-rules,client-operations -z "$PROMPT" \
    2>&1 | tee -a "${LOG_DIR}/industry-radar-${DATE_LOCAL}.log" || RC=$?
fi

# --- 4. Heartbeat finish + outcome ---
if [ "$RC" -ne 0 ]; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --error "hermes radar session exit ${RC}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] industry radar hermes session exit ${RC}."
  exit "$RC"
fi

node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --json >/dev/null 2>&1 || true
echo "[${TIMESTAMP}] [done] industry radar report complete."
