#!/usr/bin/env bash
# run-ai-review.sh — Autonomous AI reviewer for tasks parked as needs_review.
#
# Owner rule: needs_review is not a human waiting room. A fresh AI session must
# inspect the evidence and decide within guardrails: approve/retry, complete,
# cancel, defer, or mark blocked with a precise blocker.

set -euo pipefail

AGENT_ROOT="/opt/website-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
SITE_ROOT="/opt/website-site"
DB_PATH="${WEBSITE_AGENT_DB_PATH:-/opt/website-state/website-agent.db}"
LOG_DIR="${AGENT_ROOT}/cron/logs"
JOB="ai-review"
RUN_LOCK="ai-review"
LOCK_TTL_MINUTES=20
MAX_ATTEMPTS=3
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="$DB_PATH"

mkdir -p "$LOG_DIR"
cd "$AGENT_ROOT"

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
release_lock() {
  if [ -n "${LOCK_ID:-}" ]; then
    node "$V2_CLI" lock release --id "$LOCK_ID" --json >/dev/null 2>&1 || true
  fi
}
cleanup() {
  local rc=$?
  trap - EXIT
  release_lock
  exit "$rc"
}
trap cleanup EXIT

LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "autonomous needs_review decision" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)

if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [abort] hermes CLI not available."
  exit 0
fi

TASK_JSON=$(node "$V2_CLI" db query --sql "
  SELECT task_id, title, risk_level, priority_score, source, target_url, target_file, target_keyword,
         scheduled_for, updated_at, metadata_json
  FROM tasks
  WHERE status = 'needs_review'
    AND (
      scheduled_for IS NULL
      OR scheduled_for <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      OR datetime(replace(replace(scheduled_for, 'T', ' '), 'Z', '')) <= datetime('now')
    )
  ORDER BY priority_score DESC, updated_at ASC
  LIMIT 1
" --json 2>/dev/null || echo '{}')
TASK_ID=$(printf '%s' "$TASK_JSON" | json_field rows.0.task_id)
TASK_TITLE=$(printf '%s' "$TASK_JSON" | json_field rows.0.title)

if [ -z "$TASK_ID" ]; then
  echo "[${TIMESTAMP}] [idle] no due needs_review tasks."
  exit 0
fi

ATTEMPTS=$(node "$V2_CLI" db query \
  --sql "SELECT COALESCE(json_extract(metadata_json, '$.ai_review_attempts'), 0) AS n FROM tasks WHERE task_id = ?" \
  --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.n)
ATTEMPTS=$(( ${ATTEMPTS:-0} + 1 ))
node "$V2_CLI" db query \
  --sql "UPDATE tasks SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.ai_review_attempts', ?, '$.ai_review_last_at', datetime('now')) WHERE task_id = ?" \
  --params "[${ATTEMPTS}, \"${TASK_ID}\"]" --allow-write --json >/dev/null 2>&1 || true

if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
  node "$V2_CLI" task update --id "$TASK_ID" --status blocked \
    --note "Autonomous AI review attempted $((ATTEMPTS - 1)) times without resolving this needs_review item. Parked as blocked to stop review-loop repetition; next AI planner must split or rewrite the task with a concrete blocker." \
    --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [blocked] ${TASK_ID} exceeded AI review attempts; moved to blocked to prevent repetition."
  exit 0
fi

echo "[${TIMESTAMP}] [pick] ${TASK_ID} — ${TASK_TITLE} (attempt ${ATTEMPTS}/${MAX_ATTEMPTS})"

PROMPT="You are the Website Operations autonomous AI reviewer. The owner explicitly said: do not leave work waiting for human review; AI reviews and decides within guardrails.

Risk classification: Safe operational review unless you choose to modify site/source files; blog/content publication is authorized direct-to-main. Irreversible/destructive actions still require explicit owner approval and must not be approved here.

Task to review: ${TASK_ID} — ${TASK_TITLE}

Authoritative paths:
- Agent: ${AGENT_ROOT}
- Site: ${SITE_ROOT}
- DB: ${DB_PATH}
- CLI: node ${V2_CLI}

Mandatory owner rules:
1. Do not ask the owner to review this item.
2. Make an AI decision and act through the v2 CLI.
3. Blog/content work is sequential, no PRs, direct push to main/master.
4. Pushing main is the Cloudflare auto-deploy trigger. Do not require manual Cloudflare/Wrangler deploy. Verify live when possible, but do not fail solely because manual Cloudflare deploy access is unavailable after a successful main push.
5. Do not let this stay needs_review if a decision is possible.

Review procedure:
1. Load the task row from SQLite and read metadata/notes/evidence.
2. Recall relevant Brain policy with:
   node ${V2_CLI} brain summary --markdown
   node ${V2_CLI} brain recall --query \"${TASK_ID} ${TASK_TITLE}\" --markdown
3. Inspect repo/git/task/deployment/log evidence as needed.
4. Decide one of:
   - completed: work already succeeded or main push is enough under owner policy; record commit/live/push evidence.
   - approved: safe/semi/content work should be retried by the correct worker.
   - cancelled: duplicate, invalid, obsolete, or no-op.
   - blocked: genuinely impossible without external credential/access or explicit destructive approval.
   - deferred: should retry later; set scheduled_for and explain.
5. If the task is a blog/content task that was only needs_review because live verification was stale after main push, mark completed if the commit is on origin/main and local/index/sitemap evidence is acceptable; note auto-deploy delay if live is still catching up.
6. Sync Obsidian outbox if you changed state.
7. Return a concise final report with commands run and final status.

Quality gate: never fabricate verification. If you cannot verify a claim, say what you verified instead."

if timeout 1200 hermes chat -q "$PROMPT" --quiet --yolo --accept-hooks 2>&1 | tee -a "${LOG_DIR}/ai-review-${TASK_ID}-$(date +%Y-%m-%d).log"; then
  NEW_STATUS=$(node "$V2_CLI" db query --sql "SELECT status FROM tasks WHERE task_id = ?" --params "[\"${TASK_ID}\"]" --json 2>/dev/null | json_field rows.0.status)
  echo "[${TIMESTAMP}] [done] ${TASK_ID} AI review session exited 0; status=${NEW_STATUS:-unknown}."
else
  RC=$?
  echo "[${TIMESTAMP}] [fail] ${TASK_ID} AI review session exit ${RC}."
fi
