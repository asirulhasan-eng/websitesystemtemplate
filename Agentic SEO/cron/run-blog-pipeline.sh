#!/usr/bin/env bash
# run-blog-pipeline.sh â€” Blog consumer (blog_content lane).
#
# Runs every 29 minutes. Pure CONSUMER: executes the single highest-priority
# READY (approved) blog_content task, then exits â€” one task per tick.
#
# Behaviour by workflow bucket (see processes/dual-pipeline-plan.md):
#   draft_needed (new_blog_post)          â†’ write, QA, commit to main, push, and verify production.
#                                   (Hermes, fresh session per processes/new-blog-creation.md).
#                                   Owner standing rule: no PR/preview branch unless explicitly requested.
#   service_page_draft_needed (new_service_page)
#                                 â†’ author a NEW service page draft via the same Hermes
#                                   path, following the server-side production skill
#                                   /opt/website-site/tools/SERVICE-PAGE-PRODUCTION-SKILL.md
#                                   (parallel to the blog skills). Direct production publish.
#   edit_refresh_needed           â†’ REFRESH the existing page directly on main via the
#                                   dedicated content-refresh skill (title/meta/body/
#                                   faq/schema/interlinking), then verify production.
#   anything else                 â†’ SKIP + FLAG to needs_review.
#
# Producer/consumer contract: when the work plan marks a blog task
# status='approved', THIS worker picks it up within ~29 min. There is no second
# gate, so the producer must only approve blog drafts it actually wants written.
#
# Cron: */29 * * * * /opt/website-agent/cron/run-blog-pipeline.sh >> /opt/website-agent/cron/logs/blog-pipeline.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/check-health-status.sh"
source "$SCRIPT_DIR/lib/site-repo-safety.sh"

AGENT_ROOT="/opt/website-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
SITE_ROOT="/opt/website-site"

# Pin the authoritative DB and agent root so this worker and the Hermes content
# session it spawns resolve the same state DB and the agent's .env (SMTP creds)
# regardless of their working directory.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="/opt/website-state/website-agent.db"

PROCESS_FILE="${AGENT_ROOT}/processes/new-blog-creation.md"
GUARDRAILS_FILE="${AGENT_ROOT}/config/guardrails.json"
SITE_CONFIG="${AGENT_ROOT}/config/site.json"
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

LOCK_ID=""
HEARTBEAT_RUN_ID=""
HEARTBEAT_FINISHED=0

release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}

heartbeat_start_tick() {
  local hb_json
  hb_json=$(node "$V2_CLI" heartbeat start --job "$JOB" --json 2>/dev/null || true)
  HEARTBEAT_RUN_ID=$(printf '%s' "$hb_json" | json_field run_id)
}

heartbeat_finish_tick() {
  local error_msg="${1:-}"
  if [ "$#" -gt 0 ]; then shift; fi
  [ "$HEARTBEAT_FINISHED" = "1" ] && return 0

  local cmd=(node "$V2_CLI" heartbeat finish --job "$JOB" --json)
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
  release_lock
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

flag_for_review() {
  # $1=task_id  $2=reason â€” move the task out of the approved pool so it stops
  # being re-picked and surfaces to the AI in the next planning session.
  node "$V2_CLI" task update --id "$1" --status needs_review --note "$2" --json >/dev/null 2>&1 || true
  heartbeat_finish_tick "" --completed-tasks 1
  echo "[${TIMESTAMP}] [flag] ${1} â†’ needs_review: ${2}"
}

# â”€â”€ 1. Run-lock: skip this tick if a previous run is still in flight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "blog pipeline tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held â€” previous tick still running."
  heartbeat_finish_tick "" --preserve-stale-running
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)

# â”€â”€ 2. Cheap health check; abort tick on critical â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
HEALTH=$(node "$V2_CLI" monitor-check --auto-fix --json 2>/dev/null || echo '{"status":"unknown"}')
if is_health_critical "$HEALTH"; then
  echo "[${TIMESTAMP}] [abort] critical health issue â€” skipping tick."
  exit 0
fi

# â”€â”€ 3. Pick the next ready blog task (one per tick) before deploy preflight â”€â”€
NEXT=$(node "$V2_CLI" task next --lane "$LANE" --limit 25 --json 2>/dev/null || echo '{}')
TASK_ID=$(printf '%s' "$NEXT" | json_field task.task_id)
if [ -z "$TASK_ID" ]; then
  echo "[${TIMESTAMP}] [idle] no ready ${LANE} tasks."
  exit 0
fi
BUCKET=$(printf '%s' "$NEXT" | json_field task.workflow_bucket)
TASK_TITLE=$(printf '%s' "$NEXT" | json_field task.title)
echo "[${TIMESTAMP}] [pick] ${TASK_ID} (bucket=${BUCKET})"

# â”€â”€ 4. Only draft buckets are auto-runnable by this worker â†’ else flag and exit
# draft_needed (new_blog_post) and service_page_draft_needed (new_service_page)
# both use the Hermes authoring path below; edit_refresh_needed drives the dedicated
# content-refresh skill IN PLACE. Anything else is surfaced to the AI (needs_review).
case "$BUCKET" in
  draft_needed|service_page_draft_needed|edit_refresh_needed) : ;;
  *)
    flag_for_review "$TASK_ID" "Blog worker cannot auto-run bucket '${BUCKET}'. Handle manually in a fresh session."
    exit 0 ;;
esac

# â”€â”€ 4b. Attempt guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# `task next` orders by priority_score DESC, so a high-priority task that fails
# its Hermes session stays status='approved' and is re-picked every tick â€” it
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
  flag_for_review "$TASK_ID" "Auto-parked after $((ATTEMPTS - 1)) failed worker attempts (bucket=${BUCKET}). AI review worker will diagnose and decide whether to approve/retry, complete, cancel, defer, or block within guardrails."
  exit 0
fi

# â”€â”€ 5. Author + direct production publish via Hermes (fresh session) â”€â”€â”€â”€â”€
if ! command -v hermes >/dev/null 2>&1; then
  flag_for_review "$TASK_ID" "hermes CLI not available on this host; production publishing needs a Hermes session. Flagged for manual handling."
  exit 0
fi

# Per-bucket production line: content kind, branch prefix, process router, and the
# step-2 production instruction Hermes follows. Both kinds share the same Hermes
# authoring path; only the playbook and output target differ.
SKILL_PRELOAD=""
if [ "$BUCKET" = "service_page_draft_needed" ]; then
  CONTENT_KIND="service page"
  PROCESS_FILE="${SITE_ROOT}/tools/SERVICE-PAGE-PRODUCTION-SKILL.md"
  PRODUCTION_STEP="Read ${PROCESS_FILE} IN FULL and follow it end-to-end to author the service page (Research â†’ Planning â†’ Assets â†’ Writing â†’ Linking â†’ Integration â†’ QA). Pick the canonical /services/<slug> URL from the task target_url/brief. Honor the skill's hard rule: do NOT scaffold or write any file until the Research, Planning, and Assets phases are complete."
elif [ "$BUCKET" = "edit_refresh_needed" ]; then
  # MODIFICATION of an EXISTING blog/service page â†’ drive the dedicated
  # content-refresh skill (refresh title/meta/body/faq/schema/interlinking on the
  # already-published target). Edits the existing file in place; no new page.
  CONTENT_KIND="content refresh"
  PROCESS_FILE="${HOME}/.hermes/skills/client/content-refresh/SKILL.md"
  # Hermes resolves a preloaded skill by its FOLDER SLUG, not the frontmatter
  # `name:`. The skill lives at .../client/content-refresh/, so the loadable
  # alias is `content-refresh` â€” `client-content-refresh` (the name:) is
  # rejected as "Unknown skill(s)". See client-operations skill ref:
  # references/hermes-cron-skill-alias-verification.md.
  SKILL_PRELOAD="content-refresh"
  PRODUCTION_STEP="Operate in the content-refresh skill's AUTONOMOUS PIPELINE MODE (no human gate â€” the task is already approved; do not stop at a QA report or wait for approval). Follow it end-to-end to REFRESH the EXISTING target page identified by the task (target_url/target_file) â€” do NOT create a new page or change its slug/URL. Improve title/meta/H1, body depth, FAQ, schema, internal links, and alt text per the skill's quality targets, QA, then publish. Treble-check you are editing the already-published file in place."
else
  CONTENT_KIND="blog post"
  PROCESS_FILE="${AGENT_ROOT}/processes/new-blog-creation.md"
  PRODUCTION_STEP="Follow ${PROCESS_FILE} to pick the production line (standard vs stats) and write the post end-to-end (research â†’ planning â†’ AI infographics â†’ writing â†’ integration â†’ QA). It delegates to the server-side production skill under /opt/website-site/tools/."
fi
# Direct production only under the owner's standing rule. The worker must not create
# a PR/preview branch unless a future task explicitly says to do so.
BRANCH="$(resolve_site_production_branch "$AGENT_ROOT" "main")"
if ! site_repo_preserve_and_checkout_production "$SITE_ROOT" "$BRANCH" "$JOB" "$TIMESTAMP"; then
  exit 1
fi

PROMPT="You are the Website Operations content pipeline worker. Produce and publish ONE ${CONTENT_KIND} for this approved task, in this fresh session.

Task: ${TASK_ID} â€” ${TASK_TITLE}

Hard deployment rule from the owner: publish approved blog/content work directly to production by committing to main and pushing to origin/main. Do NOT create a PR, do NOT stop at preview_ready, and do NOT send a draft-only email unless the current task explicitly requests a PR/review branch. Pushing main is the deployment trigger; do not run or require a manual Cloudflare/Wrangler deploy. After push, wait for the configured deploy window, then verify the live production URL(s) with real HTTP checks using cache-busting query strings: target URL, relevant index/listing page, and sitemap.xml. A task MUST NOT be marked completed while the production target URL still returns 404/non-200 or while index/sitemap presence is missing. If production remains stale after the wait, leave/return the task to approved with explicit deploy evidence for retry, or park it needs_review/blocked with the exact blocker evidence; never fabricate live evidence.

Read first (in full):
- Router/playbook: ${PROCESS_FILE}
- Guardrails:      ${GUARDRAILS_FILE}
- Memory protocol: ${MEMORY_PROTOCOL}

MEMORY (Obsidian Brain) â€” recall before writing, record after:
- Load standing policy: 'node ${V2_CLI} brain summary --markdown'.
- Recall topic memory: 'node ${V2_CLI} brain recall --query \"<topic>\" --markdown' (respect prior decisions / no-go).

Steps:
1. Load the task from SQLite for full brief/evidence:
   node ${V2_CLI} db query --sql \"SELECT * FROM tasks WHERE task_id = ?\" --params '[\"${TASK_ID}\"]' --json
2. ${PRODUCTION_STEP}
3. QA locally, then commit directly to main and push production:
   git -C ${SITE_ROOT} checkout main
   git -C ${SITE_ROOT} pull --ff-only origin main
   node ${V2_CLI} deploy branch --site-root ${SITE_ROOT} --branch \"main\" --message \"Publish ${CONTENT_KIND}: ${TASK_TITLE}\" --db \"${WEBSITE_AGENT_DB_PATH}\" --task ${TASK_ID} --json
   node ${V2_CLI} deploy push --site-root ${SITE_ROOT} --branch \"main\" --json
4. Treat the successful push to origin/main as the deployment trigger; do not call manual Cloudflare/Wrangler deploy. Wait for the configured deploy window, then run live validation with cache-busting query strings. The completion gate requires all of: target URL HTTP 200 and healthy HTML, relevant index/listing page contains the target URL, and sitemap.xml contains the target URL.
5. Record production visibility in SQLite only after live validation passes. Use deploy validation evidence, not just git-push evidence. If the target URL is still 404/non-200 or index/sitemap presence is missing after the wait, DO NOT mark the task completed. Instead, return it to approved with a retry time and explicit deployment evidence, or park it needs_review/blocked if the evidence shows a real deployment/auth blocker:
   node ${V2_CLI} task update --id ${TASK_ID} --status approved --scheduled-for \"<retry-iso>\" --evidence '{\"blog_completion_gate\":{\"status\":\"retry_pending\",\"reason\":\"production_validation_failed_after_main_push\",\"validation\":<validation-summary>}}' --note \"Production validation failed after main push; retry scheduled. Target must not be completed while live production is 404/non-200 or missing index/sitemap evidence.\" --json
   node ${V2_CLI} task update --id ${TASK_ID} --status completed --note \"Published to main; production verified HTTP 200 plus index and sitemap presence; production URL: <live-url>; commit: <commit>; validation: <deploy-validate evidence>\" --json
6. Send live/main-pushed production details to the owner, not a draft/PR email:
   node ${V2_CLI} email send --to owner@example.com --subject \"Published (${CONTENT_KIND}) â€” ${TASK_TITLE}\" --body \"Pushed to main; auto-deploy triggered. Live URL: <live-url>. Commit: <commit>. Verification: <http-evidence>. Task: ${TASK_ID}\" --json
7. Record ONE Brain note (decision) summarizing the topic/page, production line, internal links chosen, and production verification/push evidence.

Quality gate: do NOT create a PR or stop at preview_ready. If local QA or push to main fails, mark/leave the task needs_review with a clear blocker. Never fabricate live evidence. If live checks are stale after a successful main push, do not complete the task; record the failed validation/deploy evidence and leave it retryable or parked for review. Completion requires live HTTP 200 plus index and sitemap evidence."

# Timeout wrapper â€” kill hung Hermes sessions before the lock TTL expires.
# 24 minutes (1440s) is safely under the 25-min lock TTL.
HERMES_TIMEOUT=1440
BLOG_DEPLOY_VALIDATE_WAIT_SECONDS=${BLOG_DEPLOY_VALIDATE_WAIT_SECONDS:-180}
BLOG_DEPLOY_RETRY_DELAY_MINUTES=${BLOG_DEPLOY_RETRY_DELAY_MINUTES:-29}

latest_deployment_id_for_task() {
  node "$V2_CLI" db query \
    --sql "SELECT deployment_id FROM deployments WHERE task_id = ? ORDER BY started_at DESC LIMIT 1" \
    --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.deployment_id
}

persist_target_metadata_before_completion_gate() {
  # Hermes may successfully scaffold, commit, push, and mark a new blog task
  # completed before it fills task.target_url / task.target_file. The completion
  # gate must capture that deterministic deployment metadata first, then validate
  # the live URL/index/sitemap. Otherwise valid publishes churn through
  # needs_review solely because target_url is blank.
  local current_json deployment_json inferred_json target_url target_file params
  current_json=$(node "$V2_CLI" db query \
    --sql "SELECT target_url, target_file FROM tasks WHERE task_id = ?" \
    --params "[\"${TASK_ID}\"]" --json 2>/dev/null || echo '{}')

  if [ -n "$(printf '%s' "$current_json" | json_field rows.0.target_url)" ] \
    && [ -n "$(printf '%s' "$current_json" | json_field rows.0.target_file)" ]; then
    return 0
  fi

  deployment_json=$(node "$V2_CLI" db query \
    --sql "SELECT metadata_json FROM deployments WHERE task_id = ? ORDER BY started_at DESC LIMIT 1" \
    --params "[\"${TASK_ID}\"]" --json 2>/dev/null || echo '{}')

  inferred_json=$(CURRENT_TASK_JSON="$current_json" DEPLOYMENT_JSON="$deployment_json" CONTENT_KIND="$CONTENT_KIND" SITE_CONFIG="$SITE_CONFIG" node -e '
    const fs = require("node:fs");
    function parseJson(text, fallback = {}) {
      try { return JSON.parse(text || ""); } catch { return fallback; }
    }
    const current = parseJson(process.env.CURRENT_TASK_JSON, {});
    const deployment = parseJson(process.env.DEPLOYMENT_JSON, {});
    const row = current.rows && current.rows[0] ? current.rows[0] : {};
    let targetUrl = String(row.target_url || "").trim();
    let targetFile = String(row.target_file || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");

    let site = {};
    try { site = JSON.parse(fs.readFileSync(process.env.SITE_CONFIG, "utf8")); } catch {}
    const baseUrl = String(site.base_url || "https://example.com").replace(/\/+$/, "");

    const deploymentRow = deployment.rows && deployment.rows[0] ? deployment.rows[0] : {};
    const deploymentMeta = parseJson(deploymentRow.metadata_json, {});
    const files = Array.isArray(deploymentMeta.files_staged)
      ? deploymentMeta.files_staged.map((file) => String(file || "").trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean)
      : [];

    function chooseFile() {
      const htmlFiles = files.filter((file) => /\.html$/i.test(file));
      const contentKind = String(process.env.CONTENT_KIND || "").toLowerCase();
      const blogFiles = htmlFiles.filter((file) => /^blog\/[^/]+\.html$/i.test(file) && file !== "blog/index.html");
      const serviceFiles = htmlFiles.filter((file) => /^services\/[^/]+\.html$/i.test(file) && file !== "services/index.html");
      const nonIndexFiles = htmlFiles.filter((file) => !/(^|\/)index\.html$/i.test(file));
      if (contentKind === "blog post" && blogFiles.length) return blogFiles[0];
      if (contentKind === "service page" && serviceFiles.length) return serviceFiles[0];
      return blogFiles[0] || serviceFiles[0] || nonIndexFiles[0] || "";
    }

    function urlFromFile(file) {
      let route = String(file || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
      if (!route) return "";
      if (route === "index.html") return baseUrl;
      if (route.endsWith("/index.html")) route = route.slice(0, -"/index.html".length);
      else if (/\.html$/i.test(route)) route = route.replace(/\.html$/i, "");
      route = route.replace(/^\/+/, "").replace(/\/+$/, "");
      return route ? `${baseUrl}/${route}` : baseUrl;
    }

    if (!targetFile) targetFile = chooseFile();
    if (!targetUrl && targetFile) targetUrl = urlFromFile(targetFile);
    if (!targetUrl || !targetFile) process.exit(0);
    process.stdout.write(JSON.stringify({ target_url: targetUrl, target_file: targetFile }));
  ' 2>/dev/null || true)

  target_url=$(printf '%s' "$inferred_json" | json_field target_url)
  target_file=$(printf '%s' "$inferred_json" | json_field target_file)
  if [ -z "$target_url" ] || [ -z "$target_file" ]; then
    return 0
  fi

  params=$(TARGET_URL="$target_url" TARGET_FILE="$target_file" TASK_ID="$TASK_ID" TIMESTAMP="$TIMESTAMP" node -e '
    const evidence = {
      status: "captured",
      source: "latest_deployment_files_staged",
      target_url: process.env.TARGET_URL,
      target_file: process.env.TARGET_FILE,
      captured_at: process.env.TIMESTAMP,
    };
    process.stdout.write(JSON.stringify([
      process.env.TARGET_URL,
      process.env.TARGET_FILE,
      JSON.stringify(evidence),
      process.env.TIMESTAMP,
      process.env.TASK_ID,
    ]));
  ')

  node "$V2_CLI" db query \
    --sql "UPDATE tasks SET target_url = CASE WHEN COALESCE(target_url, '') = '' THEN ? ELSE target_url END, target_file = CASE WHEN COALESCE(target_file, '') = '' THEN ? ELSE target_file END, metadata_json = json_set(CASE WHEN json_valid(COALESCE(metadata_json, '{}')) THEN COALESCE(metadata_json, '{}') ELSE '{}' END, '\$.evidence.blog_target_metadata_capture', json(?)), updated_at = ? WHERE task_id = ? AND (COALESCE(target_url, '') = '' OR COALESCE(target_file, '') = '')" \
    --params "$params" --allow-write --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [gate-metadata] ${TASK_ID} captured target metadata before completion validation: ${target_url} (${target_file})."
}

build_completion_gate_evidence() {
  VALIDATION_JSON="$1" DEPLOYMENT_ID="$2" node -e '
    let validation = {};
    try { validation = JSON.parse(process.env.VALIDATION_JSON || "{}"); } catch {}
    const checks = Array.isArray(validation.checks)
      ? validation.checks.map((check) => ({
          check: check.check,
          passed: Boolean(check.passed),
          detail: check.detail || null,
          http_status: check.http_status || null,
          url: check.url || null,
        }))
      : [];
    process.stdout.write(JSON.stringify({
      blog_completion_gate: {
        status: validation.ok ? "live_verified" : "retry_pending",
        reason: validation.ok ? "production_verified" : "production_validation_failed_after_main_push",
        deployment_id: process.env.DEPLOYMENT_ID || null,
        validated_at: validation.generated_at || new Date().toISOString(),
        url: validation.url || null,
        canonical_url: validation.canonical_url || null,
        http_status: validation.http_status || null,
        response_headers: validation.response_headers || {},
        validation_status: validation.validation_status || "failed",
        checks,
      },
    }));
  '
}

production_validation_retry_pending() {
  local retry_json
  retry_json=$(node "$V2_CLI" db query \
    --sql "SELECT CASE WHEN status = 'approved'
      AND json_extract(metadata_json, '$.evidence.blog_completion_gate.status') = 'retry_pending'
      AND json_extract(metadata_json, '$.evidence.blog_completion_gate.reason') = 'production_validation_failed_after_main_push'
      AND (
        scheduled_for IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM json_each(json_extract(metadata_json, '$.tags'))
          WHERE value = 'production-validation-retry'
        )
      )
      THEN 1 ELSE 0 END AS is_retry
      FROM tasks WHERE task_id = ?" \
    --params "[\"${TASK_ID}\"]" --json 2>/dev/null || echo '{}')
  [ "$(printf '%s' "$retry_json" | json_field rows.0.is_retry)" = "1" ]
}

validate_completed_blog_task() {
  local new_status="$1"
  case "$new_status" in
    completed|deployed|deployed_to_production) : ;;
    *) return 0 ;;
  esac

  persist_target_metadata_before_completion_gate

  local target_url
  target_url=$(node "$V2_CLI" db query \
    --sql "SELECT target_url FROM tasks WHERE task_id = ?" \
    --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.target_url)
  if [ -z "$target_url" ]; then
    flag_for_review "$TASK_ID" "Completion gate failed: task reached '${new_status}' but target_url could not be captured from task/deployment metadata before validation."
    return 1
  fi

  if [ "${BLOG_DEPLOY_VALIDATE_WAIT_SECONDS}" -gt 0 ] 2>/dev/null; then
    echo "[${TIMESTAMP}] [gate] waiting ${BLOG_DEPLOY_VALIDATE_WAIT_SECONDS}s before production validation for ${TASK_ID}."
    sleep "$BLOG_DEPLOY_VALIDATE_WAIT_SECONDS"
  fi

  local deployment_id
  deployment_id=$(latest_deployment_id_for_task)
  local validate_args=(deploy validate --url "$target_url" --task "$TASK_ID" --db "$WEBSITE_AGENT_DB_PATH" --require-index --require-sitemap --cache-bust --json)
  if [ -n "$deployment_id" ]; then
    validate_args+=(--deployment-id "$deployment_id")
  fi

  local validation_json
  if validation_json=$(node "$V2_CLI" "${validate_args[@]}" 2>&1); then
    local evidence
    evidence=$(build_completion_gate_evidence "$validation_json" "$deployment_id")
    node "$V2_CLI" task update --id "$TASK_ID" \
      --evidence "$evidence" \
      --note "Completion gate passed: production HTTP 200 plus index and sitemap presence verified for ${target_url}." \
      --json >/dev/null 2>&1 || true
    echo "[${TIMESTAMP}] [gate-pass] ${TASK_ID} production verified: ${target_url}."
    return 0
  fi

  local retry_at
  retry_at=$(date -u -d "+${BLOG_DEPLOY_RETRY_DELAY_MINUTES} minutes" +%Y-%m-%dT%H:%M:%SZ)
  local evidence
  evidence=$(build_completion_gate_evidence "$validation_json" "$deployment_id")
  node "$V2_CLI" task update --id "$TASK_ID" \
    --status approved \
    --scheduled-for "$retry_at" \
    --add-tag production-validation-retry \
    --evidence "$evidence" \
    --note "Completion gate failed after configured deploy wait: production did not verify HTTP 200 plus index and sitemap presence for ${target_url}. Returned to approved for retry at ${retry_at}; task must not remain completed while production is stale/404." \
    --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [gate-retry] ${TASK_ID} returned to approved until ${retry_at}; production validation failed for ${target_url}."
  return 1
}

if timeout "$HERMES_TIMEOUT" hermes chat -q "$PROMPT" --quiet --yolo --accept-hooks ${SKILL_PRELOAD:+-s "$SKILL_PRELOAD"} 2>&1 | tee -a "${LOG_DIR}/blog-pipeline-${TASK_ID}-$(date +%Y-%m-%d).log"; then
  NEW_STATUS=$(node "$V2_CLI" db query --sql "SELECT status FROM tasks WHERE task_id = ?" --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.status)
  if [ "$NEW_STATUS" = "approved" ]; then
    if production_validation_retry_pending; then
      heartbeat_finish_tick ""
      echo "[${TIMESTAMP}] [gate-hold] ${TASK_ID} ${CONTENT_KIND} returned to approved for production-validation-retry; waiting for live production to catch up."
    else
      echo "[${TIMESTAMP}] [fail] ${TASK_ID} hermes exited 0 but left task approved without production-validation-retry evidence. Artificial failure triggered."
      heartbeat_finish_tick "hermes hallucinated success for ${TASK_ID}"
    fi
  elif validate_completed_blog_task "$NEW_STATUS"; then
    heartbeat_finish_tick "" --completed-tasks 1
    echo "[${TIMESTAMP}] [done] ${TASK_ID} ${CONTENT_KIND} production session complete."
  else
    heartbeat_finish_tick ""
    echo "[${TIMESTAMP}] [gate-hold] ${TASK_ID} ${CONTENT_KIND} production session withheld from completion."
  fi
else
  RC=$?
  NEW_STATUS=$(node "$V2_CLI" db query --sql "SELECT status FROM tasks WHERE task_id = ?" --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.status)
  if [ "$NEW_STATUS" != "approved" ] && [ -n "$NEW_STATUS" ]; then
    # Hermes sometimes finishes the publish, commits/pushes main, and updates
    # SQLite, then exceeds the outer timeout while sending email/brain notes.
    # Still run the production completion gate before treating it as a successful
    # handoff; a completed task must not survive if live production is stale/404.
    if validate_completed_blog_task "$NEW_STATUS"; then
      heartbeat_finish_tick "" --completed-tasks 1
      echo "[${TIMESTAMP}] [done-after-timeout] ${TASK_ID} ${CONTENT_KIND} production publish reached status '${NEW_STATUS}' before hermes exit ${RC} and passed production validation."
    else
      echo "[${TIMESTAMP}] [gate-hold-after-timeout] ${TASK_ID} ${CONTENT_KIND} publish reached status '${NEW_STATUS}' before hermes exit ${RC}, but production validation withheld completion."
    fi
  else
    if [ "$NEW_STATUS" = "approved" ] && production_validation_retry_pending; then
      heartbeat_finish_tick ""
      echo "[${TIMESTAMP}] [gate-hold-after-timeout] ${TASK_ID} ${CONTENT_KIND} returned to approved for production-validation-retry before hermes exit ${RC}; waiting for live production to catch up."
    else
      if [ $RC -eq 124 ]; then
        echo "[${TIMESTAMP}] [timeout] ${TASK_ID} hermes session killed after ${HERMES_TIMEOUT}s â€” exceeds timeout."
      fi
      heartbeat_finish_tick "hermes ${CONTENT_KIND} session exit ${RC} for ${TASK_ID}"
      echo "[${TIMESTAMP}] [fail] ${TASK_ID} hermes session exit ${RC}."
    fi
  fi
fi
