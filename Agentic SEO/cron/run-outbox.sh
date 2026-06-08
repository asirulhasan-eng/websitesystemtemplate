#!/usr/bin/env bash
# run-outbox.sh â€” Process outbox queue every 10 minutes
# Syncs SQLite state changes to Obsidian and sends queued emails
#
# Cron: */10 * * * * /opt/client-agent/cron/run-outbox.sh >> /opt/client-agent/cron/logs/outbox.log 2>&1

set -euo pipefail

AGENT_ROOT="/opt/client-agent"

# Pin the authoritative DB and agent root for every CLI invocation below
# (and anything they spawn), independent of cron's working directory.
export CLIENT_AGENT_ROOT="$AGENT_ROOT"
export CLIENT_DB_PATH="/opt/client-sqlite/seo-agent.db"

# Load .env so SMTP/IMAP credentials reach the CLI. Parse line-by-line and export
# literally (no shell eval) so values containing spaces â€” e.g. EMAIL_FROM_NAME â€”
# load correctly and nothing in the file is executed.
if [ -f "${AGENT_ROOT}/.env" ]; then
  set -a
  while IFS= read -r __line || [ -n "$__line" ]; do
    case "$__line" in ''|\#*) continue ;; esac
    [ "${__line#*=}" = "$__line" ] && continue   # skip lines without '='
    export "${__line%%=*}=${__line#*=}"
  done < "${AGENT_ROOT}/.env"
  set +a
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Process Obsidian outbox. Let stderr through to the log (cron appends 2>&1) and
# surface a clear failure line instead of silently swallowing it with 2>/dev/null.
# A failure here used to be invisible; the */15 health monitor now also reports
# dead-letter / stuck / lagging outbox state independently.
if ! node "${AGENT_ROOT}/cli/bin/v2.js" outbox-obsidian; then
  echo "[${TS}] [ERROR] outbox-obsidian exited non-zero â€” Obsidian sync did not drain this tick."
fi

# Process email outbox. Independent of the Obsidian drain above.
if ! node "${AGENT_ROOT}/cli/bin/v2.js" outbox-email; then
  echo "[${TS}] [ERROR] outbox-email exited non-zero â€” queued emails may not have sent this tick."
fi
