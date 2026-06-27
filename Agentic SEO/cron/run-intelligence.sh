#!/usr/bin/env bash
# run-intelligence.sh Ã¢â‚¬â€ Intelligence Pipeline orchestrator.
#
# Runs 30 min BEFORE the twice-daily work plan. For each module that is DUE this
# session (cadence computed by `v2 intelligence due`), it invokes Hermes to gather
# fresh data, analyze it, and save ONE standardized report via
# `v2 intelligence report`. Modules are REPORT-ONLY Ã¢â‚¬â€ they never create or approve
# tasks. The daily planner reads the aggregated `v2 intelligence summary` and is
# the sole producer of tasks. See processes/intelligence/ and the architecture doc.
#
# Usage: run-intelligence.sh [morning|evening] [--force-all]
# Cron:
#   30 1  * * * /opt/website-agent/cron/run-intelligence.sh morning >> /opt/website-agent/cron/logs/intelligence.log 2>&1
#   30 13 * * * /opt/website-agent/cron/run-intelligence.sh evening >> /opt/website-agent/cron/logs/intelligence.log 2>&1

set -euo pipefail

SESSION="${1:-morning}"
FORCE_FLAG=""
if [ "${2:-}" = "--force-all" ] || [ "${1:-}" = "--force-all" ]; then
  FORCE_FLAG="--force-all"
  [ "${1:-}" = "--force-all" ] && SESSION="morning"
fi

AGENT_ROOT="/opt/website-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
DB_PATH="/opt/website-state/website-agent.db"
PROCESS_DIR="${AGENT_ROOT}/processes/intelligence"
INTEL_SKILL="${AGENT_ROOT}/hermes/skills/client/intelligence/skill.md"
MEMORY_PROTOCOL="${AGENT_ROOT}/processes/obsidian-memory-protocol.md"
LOG_DIR="${AGENT_ROOT}/cron/logs"
INTEL_DIR="${AGENT_ROOT}/cron/intelligence"
JOB="intelligence-${SESSION}"
RUN_LOCK="intelligence-${SESSION}"
LOCK_TTL_MINUTES=45
MODULE_TIMEOUT="${INTEL_MODULE_TIMEOUT:-18m}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_LOCAL=$(TZ="${SEO_AGENT_TIMEZONE:-Asia/Dhaka}" date +%Y-%m-%d)
TIME_LOCAL=$(TZ="${SEO_AGENT_TIMEZONE:-Asia/Dhaka}" date +%H%M)

# The report command resolves markdown paths under this root.
export WEBSITE_AGENT_ROOT="$AGENT_ROOT"
export WEBSITE_AGENT_DB_PATH="$DB_PATH"

mkdir -p "$LOG_DIR" "${INTEL_DIR}/${DATE_LOCAL}"

# Extract a dotted field (e.g. due_csv) from a JSON blob on stdin.
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

json_array_length() {
  node -e '
    let s="";
    process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const o=JSON.parse(s);
        const v=String(process.argv[1]).split(".").reduce((a,k)=>(a==null?a:a[k]),o);
        process.stdout.write(String(Array.isArray(v) ? v.length : 0));
      } catch { process.stdout.write("0"); }
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

record_intelligence_escalations() {
  INTEL_ESCALATIONS_JSON="$1" node <<'NODE'
const path = require('node:path');
const root = process.env.WEBSITE_AGENT_ROOT || '/opt/website-agent';
const dbPath = process.env.WEBSITE_AGENT_DB_PATH || '/opt/website-state/website-agent.db';
const { openStateDb, makeId } = require(path.join(root, 'cli/lib/state_db'));
const { nowIso } = require(path.join(root, 'cli/lib/dates'));

const input = process.env.INTEL_ESCALATIONS_JSON || '{}';
const payload = input ? JSON.parse(input) : {};
const escalations = Array.isArray(payload.escalations) ? payload.escalations : [];
if (!escalations.length) process.exit(0);

const now = nowIso();
const db = openStateDb(dbPath);
try {
  for (const esc of escalations) {
    const moduleId = String(esc.module_id || 'unknown');
    const alertType = `intelligence_module_failure_${moduleId}`;
    const message = `Intelligence module ${moduleId} has ${esc.consecutive_failures || 0} consecutive failures. Last error: ${esc.last_error || 'unknown'}`;
    const metadata = JSON.stringify(esc);
    let alert = db.prepare("SELECT alert_id, last_notified_at FROM monitor_alerts WHERE alert_type = ? AND status = 'open' LIMIT 1").get(alertType);
    let isNew = false;
    if (alert) {
      db.prepare(`
        UPDATE monitor_alerts
        SET severity = 'critical', message = ?, last_seen_at = ?,
            occurrence_count = COALESCE(occurrence_count, 1) + 1,
            metadata_json = ?
        WHERE alert_id = ?
      `).run(message, now, metadata, alert.alert_id);
    } else {
      isNew = true;
      const alertId = makeId('ALT');
      db.prepare(`
        INSERT INTO monitor_alerts (alert_id, alert_type, severity, status, message, triggered_at, last_seen_at, occurrence_count, metadata_json)
        VALUES (?, ?, 'critical', 'open', ?, ?, ?, 1, ?)
      `).run(alertId, alertType, message, now, now, metadata);
      alert = { alert_id: alertId, last_notified_at: null };
    }

    const pending = db.prepare(`
      SELECT 1 AS present FROM outbox_jobs
      WHERE job_type = 'send_monitor_alert'
        AND entity_type = 'monitor_alert'
        AND entity_id = ?
        AND status IN ('pending','retrying')
      LIMIT 1
    `).get(alert.alert_id);
    const last = alert.last_notified_at ? Date.parse(alert.last_notified_at) : NaN;
    const due = isNew || !Number.isFinite(last) || (Date.parse(now) - last) >= 24 * 60 * 60 * 1000;
    if (due && !pending) {
      db.prepare(`
        INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
        VALUES (?, 'send_monitor_alert', 'monitor_alert', ?, ?, 'pending', ?)
      `).run(makeId('OUT'), alert.alert_id, JSON.stringify({
        alert_id: alert.alert_id,
        alert_type: alertType,
        severity: 'critical',
        message,
        details: esc,
        triggered_at: now,
      }), now);
      db.prepare("UPDATE monitor_alerts SET last_notified_at = ? WHERE alert_id = ?").run(now, alert.alert_id);
    }
  }
} finally {
  db.close();
}
NODE
}

# Ã¢â€â‚¬Ã¢â€â‚¬ 1. Run-lock: skip this tick if a previous run is still in flight Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "intelligence ${SESSION} tick" --json 2>/dev/null || true)
if [ "$(printf '%s' "$LOCK_JSON" | json_field ok)" != "true" ]; then
  echo "[${TIMESTAMP}] [skip] ${JOB} run-lock held Ã¢â‚¬â€ previous run still going."
  exit 0
fi
LOCK_ID=$(printf '%s' "$LOCK_JSON" | json_field lock_id)

# Ã¢â€â‚¬Ã¢â€â‚¬ 2. Which modules are DUE this session? Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
DUE_JSON=$(node "$V2_CLI" intelligence due --session "$SESSION" $FORCE_FLAG --db "$DB_PATH" --json 2>/dev/null || echo '{}')
DUE_CSV=$(printf '%s' "$DUE_JSON" | json_field due_csv)
ESCALATION_COUNT=$(printf '%s' "$DUE_JSON" | json_array_length escalations)
if [ "${ESCALATION_COUNT:-0}" != "0" ]; then
  record_intelligence_escalations "$DUE_JSON" || true
fi
if [ -z "$DUE_CSV" ]; then
  echo "[${TIMESTAMP}] [idle] no intelligence modules due for ${SESSION}."
  exit 0
fi
echo "[${TIMESTAMP}] [run] ${SESSION} due modules: ${DUE_CSV}"

# Ã¢â€â‚¬Ã¢â€â‚¬ 3. Run each due module through Hermes (report-only) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
HERMES_OK=1
if ! command -v hermes >/dev/null 2>&1; then
  echo "[${TIMESTAMP}] [warn] hermes CLI not available; cannot run AI modules. Will still emit summary from existing reports."
  HERMES_OK=0
fi

run_module() {
  local module="$1"
  local process_file="${PROCESS_DIR}/${module}.md"
  if [ ! -f "$process_file" ]; then
    echo "[${TIMESTAMP}] [warn] no process file for module '${module}' (${process_file}); skipping."
    return 0
  fi
  if [ "$HERMES_OK" != "1" ]; then
    return 0
  fi

  echo "[${TIMESTAMP}] [module] ${module} Ã¢â‚¬â€ analyzingÃ¢â‚¬Â¦"
  local prompt
  prompt="You are a Website Operations INTELLIGENCE MODULE: '${module}', ${SESSION} session.
REPORT-ONLY: you do NOT create, update, or approve tasks. The daily planner is the sole
task producer. Your only job is to gather data, analyze it with judgment, and save ONE
report with 'v2 intelligence report'.

Read first:
- Module playbook: ${process_file}
- Intelligence skill: ${INTEL_SKILL}
- Memory protocol:   ${MEMORY_PROTOCOL}

Steps:
1. Follow the module playbook's Data Gathering section using the v2 CLI at ${V2_CLI}
   (always pass --db ${DB_PATH}). Read-only data ops.
2. Recall relevant Brain memory before flagging anything:
   node ${V2_CLI} brain recall --query \"<keyword/topic>\" --markdown
3. Analyze per the playbook's AI Analysis section. Focus on WHAT you found and HOW
   significant it is Ã¢â‚¬â€ not what to DO about it (that is the planner's call).
4. Save exactly ONE report with the module's Report Output command:
   node ${V2_CLI} intelligence report --module ${module} --session ${SESSION} \\
     --severity <normal|warning|critical> --headline \"...\" --report-json '{...}' \\
     --db ${DB_PATH} --json
   Set --status failed with --error \"...\" instead if you could not gather data.

Do NOT call task create/update/approve, and do NOT run safe-fix/semi-safe/high-risk."

  # Non-interactive Hermes run: prompt via -z, load the system-rules skill (the
  # intelligence skill + module playbook are pulled in by path from the prompt).
  # Matches the proven invocation in run-daily-workplan.sh. pipefail makes the
  # pipeline surface hermes's exit code (not tee's).
  local rc=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$MODULE_TIMEOUT" hermes --skills system-rules -z "$prompt" \
      2>&1 | tee -a "${LOG_DIR}/intelligence-${module}-$(date +%Y-%m-%d).log" || rc=$?
  else
    hermes --skills system-rules -z "$prompt" \
      2>&1 | tee -a "${LOG_DIR}/intelligence-${module}-$(date +%Y-%m-%d).log" || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "[${TIMESTAMP}] [fail] module ${module} exit ${rc}."
    node "$V2_CLI" intelligence report --module "$module" --session "$SESSION" \
      --status failed --severity critical \
      --headline "Module ${module} crashed in runner" \
      --report-json "{\"data\":{\"runner\":\"run-intelligence.sh\",\"exit_code\":${rc}}}" \
      --error "hermes exit ${rc}" --no-brain --db "$DB_PATH" --json >/dev/null 2>&1 || true
    return "$rc"
  fi
  echo "[${TIMESTAMP}] [ok] module ${module} reported."
  return 0
}

FAILED=""
IFS=',' read -ra MODULES <<< "$DUE_CSV"
for module in "${MODULES[@]}"; do
  module="$(printf '%s' "$module" | tr -d '[:space:]')"
  [ -z "$module" ] && continue
  run_module "$module" || FAILED="${FAILED} ${module}"
done

# Ã¢â€â‚¬Ã¢â€â‚¬ 4. Aggregate summary for the planner (also write a human-readable copy) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
SUMMARY_FILE="${INTEL_DIR}/${DATE_LOCAL}/${TIME_LOCAL}-SUMMARY-${SESSION}.md"
node "$V2_CLI" intelligence summary --session "$SESSION" --db "$DB_PATH" --markdown > "$SUMMARY_FILE" 2>/dev/null \
  && echo "[${TIMESTAMP}] [summary] wrote ${SUMMARY_FILE}" \
  || echo "[${TIMESTAMP}] [warn] failed to write summary file."

# Ã¢â€â‚¬Ã¢â€â‚¬ 5. Heartbeat finish + report outcome Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
if [ -n "$FAILED" ]; then
  heartbeat_finish_tick "modules failed:${FAILED}"
  echo "[${TIMESTAMP}] [done] ${SESSION} intelligence complete with failures:${FAILED}"
else
  heartbeat_finish_tick
  echo "[${TIMESTAMP}] [done] ${SESSION} intelligence complete."
fi
