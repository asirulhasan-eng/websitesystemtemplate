# Self-Improvement Engineer Playbook

Purpose: repair the agent substrate, not the public website. This playbook is used by `v2 self-improve --task <id> --apply` for approved tasks in the `self_improvement` lane.

## Setup

1. Export the authoritative paths:
   - `WEBSITE_AGENT_ROOT=/opt/website-agent`
   - `WEBSITE_AGENT_DB_PATH=/opt/website-state/website-agent.db`
2. Load the Brain summary before editing:
   - `node /opt/website-agent/cli/bin/v2.js brain summary --markdown`
3. Recall prior lessons for the gap:
   - `node /opt/website-agent/cli/bin/v2.js brain recall --query "<gap>" --markdown`
4. Read `processes/obsidian-memory-protocol.md` before writing any Brain note.

## Scope Contract

Allowed autonomous edits:

- `cli/`
- `cron/*.sh`
- `processes/*.md`
- `hermes/skills/client/**`
- `processes/brain-seed/**`

Forbidden without owner action:

- `config/guardrails.json` keys `require_explicit_approval`, `auto_approve_up_to_risk_level`, and the entire `self_improvement` block
- `config/no_go_keywords.json` and Brain No-Go sources
- `.env`, credentials, secrets, or `cli/lib/email_credentials.js` values
- deleting any executor command file
- anything under `Website/` or the site repo
- DNS, domain, SSL, robots, and sitemap changes

`db_reconciliation` tasks must use only `v2` CLI state transitions. Do not use raw SQLite writes.

## Repair Steps

1. Load the task from SQLite with `v2 db query` and read the full evidence object.
2. Inspect the failing artifact and the smallest relevant code/tests.
3. Make the minimal targeted edit within the allowed scope.
   - Treat `tools/out/email/*.json` and `tools/out/obsidian-sync/*.json` created during the engineer run as runtime artifacts, not production/source edits. The executor should clean or record those as non-production side effects before validating `target_files`, while still blocking any undeclared source edit.
4. If touching CLI logic, add or update a test that covers the behavior.
5. Run the applicable gate:
   - `node --check` for changed `.js`
   - `bash -n` for changed `.sh`
   - `npm test` in `cli/` when CLI code changed
6. Keep the change as one revertable commit.

## Reversibility

Every applied repair records:

- task id
- gap id
- changed files
- commit SHA
- acceptance criterion

If a later auditor window finds the repair worsened the target signal or caused a traceable cron failure, revert the meta-commit and set the task to `rollback`.

## Notify

Send a Telegram notification with:

- task id and gap
- commit SHA
- changed files
- gate results
- acceptance criterion

Email may be sent too, but Telegram is the fallback channel and must not be skipped.

