#!/usr/bin/env bash
# run-intelligence.sh â€” Intelligence Pipeline orchestrator.
#
# Runs 30 min BEFORE the twice-daily work plan. For each module that is DUE this
# session (cadence computed by `v2 intelligence due`), it invokes Hermes to gather
# fresh data, analyze it, and save ONE standardized report via
# `v2 intelligence report`. Modules are REPORT-ONLY â€” they never create or approve
# tasks. The daily planner reads the aggregated `v2 intelligence summary` and is
# the sole producer of tasks. See processes/intelligence/ and the architecture doc.
#
# Usage: run-intelligence.sh [morning|evening] [--force-all]
# Cron:
#   30 1  * * * /opt/client-agent/cron/run-intelligence.sh morning >> /opt/client-agent/cron/logs/intelligence.log 2>&1
#   30 13 * * * /opt/client-agent/cron/run-intelligence.sh evening >> /opt/client-agent/cron/logs/intelligence.log 2>&1

set -euo pipefail

SESSION="${1:-morning}"
FORCE_FLAG=""
if [ "${2:-}" = "--force-all" ] || [ "${1:-}" = "--force-all" ]; then
  FORCE_FLAG="--force-all"
  [ "${1:-}" = "--force-all" ] && SESSION="morning"
fi

AGENT_ROOT="/opt/client-agent"
V2_CLI="${AGENT_ROOT}/cli/bin/v2.js"
DB_PATH="/opt/client-sqlite/seo-agent.db"
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
DATE_LOCAL=$(TZ="${SEO_AGENT_TIMEZONE:-{{TIMEZONE}}}" date +%Y-%m-%d)
TIME_LOCAL=$(TZ="${SEO_AGENT_TIMEZONE:-{{TIMEZONE}}}" date +%H%M)

# The report command resolves markdown paths under this root.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="$DB_PATH"

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

# â”€â”€ 1. Run-lock: skip this tick if a previous run is still in flight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
LOCK_JSON=$(node "$V2_CLI" lock acquire --type general --resource "$RUN_LOCK" \
  --owner "$JOB" --ttl-minutes "$LOCK_TTL_MINUTES" --reason "intelligence ${SESSION} tick" --json 2>/dev/null || true)
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

# â”€â”€ 2. Which modules are DUE this session? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DUE_JSON=$(node "$V2_CLI" intelligence due --session "$SESSION" $FORCE_FLAG --db "$DB_PATH" --json 2>/dev/null || echo '{}')
DUE_CSV=$(printf '%s' "$DUE_JSON" | json_field due_csv)
if [ -z "$DUE_CSV" ]; then
  echo "[${TIMESTAMP}] [idle] no intelligence modules due for ${SESSION}."
  exit 0
fi
echo "[${TIMESTAMP}] [run] ${SESSION} due modules: ${DUE_CSV}"

node "$V2_CLI" heartbeat start --job "$JOB" --db "$DB_PATH" --json >/dev/null 2>&1 || true

# â”€â”€ 3. Run each due module through Hermes (report-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  echo "[${TIMESTAMP}] [module] ${module} â€” analyzingâ€¦"
  local prompt
  prompt="You are a {{SITE_NAME}} INTELLIGENCE MODULE: '${module}', ${SESSION} session.
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
   significant it is â€” not what to DO about it (that is the planner's call).
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

# â”€â”€ 4. Aggregate summary for the planner (also write a human-readable copy) â”€â”€â”€â”€
SUMMARY_FILE="${INTEL_DIR}/${DATE_LOCAL}/${TIME_LOCAL}-SUMMARY-${SESSION}.md"
node "$V2_CLI" intelligence summary --session "$SESSION" --db "$DB_PATH" --markdown > "$SUMMARY_FILE" 2>/dev/null \
  && echo "[${TIMESTAMP}] [summary] wrote ${SUMMARY_FILE}" \
  || echo "[${TIMESTAMP}] [warn] failed to write summary file."

# â”€â”€ 5. Heartbeat finish + report outcome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if [ -n "$FAILED" ]; then
  node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --error "modules failed:${FAILED}" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] ${SESSION} intelligence complete with failures:${FAILED}"
else
  node "$V2_CLI" heartbeat finish --job "$JOB" --db "$DB_PATH" --json >/dev/null 2>&1 || true
  echo "[${TIMESTAMP}] [done] ${SESSION} intelligence complete."
fi
