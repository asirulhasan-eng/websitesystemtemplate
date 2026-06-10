#!/usr/bin/env bash
# run-blog-pipeline.sh — Blog consumer (blog_content lane).
#
# Runs every 29 minutes. Pure CONSUMER: executes the single highest-priority
# READY (approved) blog_content task, then exits — one task per tick.
#
# Behaviour by workflow bucket (see processes/dual-pipeline-plan.md):
#   draft_needed (new_blog_post)          → write + publish to main via the creation skill
#                                   (Hermes, fresh session per processes/new-blog-creation.md).
#                                   Cloudflare builds production; the live URL is emailed.
#   service_page_draft_needed (new_service_page)
#                                 → author a NEW service page via the same Hermes
#                                   path, following the server-side production skill
#                                   /opt/client-site/tools/SERVICE-PAGE-PRODUCTION-SKILL.md
#                                   (parallel to the blog skills). Also published to main.
#   edit_refresh_needed           → REFRESH the existing page IN PLACE via the
#                                   dedicated content-refresh skill (title/meta/body/
#                                   faq/schema/interlinking). Auto-runs; no human gate.
#   anything else                 → SKIP + FLAG to needs_review.
#
# Producer/consumer contract: when the work plan marks a blog task
# status='approved', THIS worker picks it up within ~29 min. There is no second
# gate, so the producer must only approve blog drafts it actually wants written.
#
# Cron: */29 * * * * /opt/client-agent/cron/run-blog-pipeline.sh >> /opt/client-agent/cron/logs/blog-pipeline.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
SITE_ROOT="/opt/client-site"

# Pin the authoritative DB and agent root so this worker and the Hermes content
# session it spawns resolve the same state DB and the agent's .env (SMTP creds)
# regardless of their working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

PROCESS_FILE="${AGENT_ROOT}/processes/new-blog-creation.md"
GUARDRAILS_FILE="${AGENT_ROOT}/config/guardrails.json"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
LANE="blog_content"
JOB="blog-pipeline"
RUN_LOCK="blog-pipeline"
LOCK_TTL_MINUTES=25           # Must exceed typical Hermes session but clear before */29 cron tick; timeout guard ensures exit before expiry.
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

flag_for_review() {
  # $1=task_id  $2=reason — move the task out of the approved pool so it stops
  # being re-picked and surfaces to the AI in the next planning session.
  node "$V2_CLI" task update --id "$1" --status needs_review --note "$2" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [flag] ${1} → needs_review: ${2}"
}

# ── 1. Run-lock: skip this tick if a previous run is still in flight ──────────
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "blog pipeline tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held — previous tick still running."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
trap release_lock EXIT

# ── 2. Cheap health check; abort tick on critical ─────────────────────────────
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue — skipping tick."
  exit 0
fi

# ── 3. Pick the next ready blog task (one per tick) ───────────────────────────
NEXT=$(node "$V2_CLI" task next --lane "$LANE" --json 2>/dev/null || echo '{}')
TASK_ID=$(printf '%s' "$NEXT" | json_field task.task_id)
if [ -z "$TASK_ID" ]; then
  echo "[${TIMESTAMP}] [idle] no ready ${LANE} tasks."
  exit 0
fi
BUCKET=$(printf '%s' "$NEXT" | json_field task.workflow_bucket)
TASK_TITLE=$(printf '%s' "$NEXT" | json_field task.title)
echo "[${TIMESTAMP}] [pick] ${TASK_ID} (bucket=${BUCKET})"

# ── 4. Only draft buckets are auto-runnable by this worker → else flag and exit
# draft_needed (new_blog_post) and service_page_draft_needed (new_service_page)
# both use the Hermes authoring path below; edit_refresh_needed drives the dedicated
# content-refresh skill IN PLACE. Anything else is surfaced to the AI (needs_review).
case "$BUCKET" in
  draft_needed|service_page_draft_needed|edit_refresh_needed) : ;;
  *)
    flag_for_review "$TASK_ID" "Blog worker cannot auto-run bucket '${BUCKET}'. Handle manually in a fresh session."
    exit 0 ;;
esac

# ── 4b. Attempt guard ─────────────────────────────────────────────────────────
# `task next` orders by priority_score DESC, so a high-priority task that fails
# its Hermes session stays status='approved' and is re-picked every tick — it
# starves every lower-priority task behind it (the homepage-refresh-vs-blogs
# block). Count each pick in metadata_json.worker_attempts (the tasks table has
# no attempt_count column) and park the task after MAX_ATTEMPTS so one broken
# task can never block the lane indefinitely.
MAX_ATTEMPTS=3
ATTEMPTS=$(node "$V2_CLI" db query \
  --sql "SELECT COALESCE(json_extract(metadata_json, '\$.worker_attempts'), 0) AS n FROM tasks WHERE task_id = ?" \
  --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.n)
ATTEMPTS=$(( ${ATTEMPTS:-0} + 1 ))
node "$V2_CLI" db query \
  --sql "UPDATE tasks SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '\$.worker_attempts', ?) WHERE task_id = ?" \
  --params "[${ATTEMPTS}, \"${TASK_ID}\"]" --allow-write --json >/dev/null 2>&1 || true
if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
  flag_for_review "$TASK_ID" "Auto-parked after $((ATTEMPTS - 1)) failed worker attempts (bucket=${BUCKET}). Needs manual diagnosis before re-approval."
  exit 0
fi

# ── 5. Draft → author + PR via the creation skill (Hermes, fresh session) ─────
if ! command -v hermes >/dev/null 2>&1; then
  flag_for_review "$TASK_ID" "hermes CLI not available on this host; draft creation needs a Hermes session. Flagged for manual handling."
  exit 0
fi

node "$V2_CLI" heartbeat start --job "$JOB" --task-id "$TASK_ID" --json >/dev/null 2>&1 || true

# Per-bucket production line: content kind, branch prefix, process router, and the
# step-2 production instruction Hermes follows. Both kinds share the same Hermes
# authoring path; only the playbook and output target differ.
SKILL_PRELOAD=""
if [ "$BUCKET" = "service_page_draft_needed" ]; then
  CONTENT_KIND="service page"
  PROCESS_FILE="${SITE_ROOT}/tools/SERVICE-PAGE-PRODUCTION-SKILL.md"
  PRODUCTION_STEP="Read ${PROCESS_FILE} IN FULL and follow it end-to-end to author the service page (Research → Planning → Assets → Writing → Linking → Integration → QA). Pick the canonical /services/<slug> URL from the task target_url/brief. Honor the skill's hard rule: do NOT scaffold or write any file until the Research, Planning, and Assets phases are complete."
elif [ "$BUCKET" = "edit_refresh_needed" ]; then
  # MODIFICATION of an EXISTING blog/service page → drive the dedicated
  # content-refresh skill (refresh title/meta/body/faq/schema/interlinking on the
  # already-published target). Edits the existing file in place; no new page.
  CONTENT_KIND="content refresh"
  PROCESS_FILE="${HOME}/.hermes/skills/client/content-refresh/SKILL.md"
  # Hermes resolves a preloaded skill by its FOLDER SLUG, not the frontmatter
  # `name:`. The skill lives at .../client/content-refresh/, so the loadable
  # alias is `content-refresh` — `client-content-refresh` (the name:) is
  # rejected as "Unknown skill(s)". See client-operations skill ref:
  # references/hermes-cron-skill-alias-verification.md.
  SKILL_PRELOAD="content-refresh"
  PRODUCTION_STEP="Operate in the content-refresh skill's AUTONOMOUS PIPELINE MODE (no human gate — the task is already approved; do not stop at a QA report or wait for approval). Follow it end-to-end to REFRESH the EXISTING target page identified by the task (target_url/target_file) — do NOT create a new page or change its slug/URL. Improve title/meta/H1, body depth, FAQ, schema, internal links, and alt text per the skill's quality targets, QA, then publish. Treble-check you are editing the already-published file in place."
else
  CONTENT_KIND="blog post"
  PROCESS_FILE="${AGENT_ROOT}/processes/new-blog-creation.md"
  PRODUCTION_STEP="Follow ${PROCESS_FILE} to pick the production line (standard vs stats) and write the post end-to-end (research → planning → AI infographics → writing → integration → QA). It delegates to the server-side production skill under /opt/client-site/tools/."
fi
# Publish straight to production: commit + push on main, no preview branch.
BRANCH="main"

PROMPT="You are the {{SITE_NAME}} content pipeline worker. Produce ONE ${CONTENT_KIND} for this approved task, in this fresh session.

Task: ${TASK_ID} — ${TASK_TITLE}

Read first (in full):
- Router/playbook: ${PROCESS_FILE}
- Guardrails:      ${GUARDRAILS_FILE}
- Memory protocol: ${MEMORY_PROTOCOL}

MEMORY (Obsidian Brain) — recall before writing, record after:
- Load standing policy: 'node ${V2_CLI} brain summary --markdown'.
- Recall topic memory: 'node ${V2_CLI} brain recall --query \"<topic>\" --markdown' (respect prior decisions / no-go).

Steps:
1. Load the task from SQLite for full brief/evidence:
   node ${V2_CLI} db query --sql \"SELECT * FROM tasks WHERE task_id = ?\" --params '[\"${TASK_ID}\"]' --json
2. ${PRODUCTION_STEP}
3. Publish directly to main and let Cloudflare build production:
   node ${V2_CLI} deploy branch --site-root ${SITE_ROOT} --branch \"${BRANCH}\" --message \"${CONTENT_KIND}: ${TASK_TITLE}\" --json
   node ${V2_CLI} deploy push   --site-root ${SITE_ROOT} --branch \"${BRANCH}\" --json
   The live URL is the canonical page URL you chose (production domain + /services/<slug> or /blog/<slug>). Wait for the Cloudflare production build, then confirm the live page is reachable before continuing.
4. Record state in SQLite (never write the DB directly):
   node ${V2_CLI} task update --id ${TASK_ID} --status deployed_to_production --note \"Published to main; live: <live-url>\" --json
5. Send the live link to the owner:
   node ${V2_CLI} email send --to {{ADMIN_EMAIL}} --subject \"✅ Published (${CONTENT_KIND}) — ${TASK_TITLE}\" --body \"Live: <live-url> (task ${TASK_ID})\" --json
6. Record ONE Brain note (decision) summarizing the topic/page, production line, and internal links chosen.

Quality gate: do NOT publish to main or mark deployed_to_production unless QA passes (title/meta/H1/schema/internal links/alt text). Publishing goes straight to the live site — there is no preview gate."

# Timeout wrapper — kill hung Hermes sessions before the lock TTL expires.
# 24 minutes (1440s) is safely under the 25-min lock TTL.
HERMES_TIMEOUT=1440

if timeout "$HERMES_TIMEOUT" hermes chat -q "$PROMPT" --quiet --yolo --accept-hooks ${SKILL_PRELOAD:+-s "$SKILL_PRELOAD"} 2>&1 | tee -a "${LOG_DIR}/blog-pipeline-${TASK_ID}-$(date +%Y-%m-%d).log"; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --completed-tasks 1 --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] ${TASK_ID} ${CONTENT_KIND} draft session complete."
else
  RC=$?
  if [ $RC -eq 124 ]; then
    echo "[${TIMESTAMP}] [timeout] ${TASK_ID} hermes session killed after ${HERMES_TIMEOUT}s — exceeds timeout."
  fi
  node "$V2_CLI" heartbeat finish --job "$JOB" --error "hermes ${CONTENT_KIND} session exit ${RC} for ${TASK_ID}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [fail] ${TASK_ID} hermes session exit ${RC}."
fi
