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

# Process Obsidian outbox
node "${AGENT_ROOT}/cli/bin/v2.js" outbox-obsidian 2>/dev/null || true

# Process email outbox
node "${AGENT_ROOT}/cli/bin/v2.js" outbox-email 2>/dev/null || true
