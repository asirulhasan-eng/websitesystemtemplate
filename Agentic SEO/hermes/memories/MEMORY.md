# {{SITE_NAME}} Agent v2 â€” AI-Brain Architecture

## System Overview
- **Architecture**: AI-brain-driven. CLI tools handle data, AI makes all decisions.
- **CLI**: `node /opt/client-agent/cli/bin/v2.js <command> [options]`
- **Playbooks**: `/opt/client-agent/processes/*.md`
- **Guardrails**: `/opt/client-agent/config/guardrails.json`
- **Site config**: `/opt/client-agent/config/site.json`

## Key Paths
- Agent repo: `/opt/client-agent`
- CLI tools: `/opt/client-agent/cli/`
- Process playbooks: `/opt/client-agent/processes/`
- DB: `/opt/client-sqlite/seo-agent.db`
- Site repo: `/opt/client-site`
- Obsidian vault: `/opt/client-obsidian`
- Cron logs: `/opt/client-agent/cron/logs/`
- Legacy v1 tooling has been removed from the active repository tree. Use root `cli/`, `processes/`, `cron/`, `config/`, and `hermes/`.

## Architecture Rules
- SQLite is ONLY source of truth for **live state** (seo-agent.db): tasks, events, locks, deployments, approvals
- Obsidian has TWO roles: (1) **mirror notes** = downstream view of SQLite state (never authority, never hand-edit); (2) **`01-Agent-Brain/`** = human-readable **memory brain**, authoritative for long-lived knowledge (no-go rules, policy, strategy, lessons, decisions)
- **Recall before deciding:** `v2 brain recall --query "..."` and `v2 brain summary` before generating/recommending/executing work
- **Record as you work:** `v2 brain note add --type decision|lesson|observation ...` (decisions per session, lessons on outcomes). See `processes/obsidian-memory-protocol.md`
- Memory writes go through SQLiteâ†’Outbox like every state change; the Brain never holds live metrics/status
- All state changes via atomic SQLite transactions
- Outbox queue updates Obsidian (never direct) â€” including Brain memory notes
- **No deterministic scoring, classification, or routing** â€” AI makes all strategic decisions
- Use v2 CLI tools for ALL data operations (never raw SQLite writes)
- All CLI output is JSON by default (use --json flag)

## CLI Quick Reference
```
v2 gsc-fetch --days 7 --json          # Fetch GSC data
v2 gsc-history --keyword "..." --json  # Historical GSC from DB
v2 gsc-compare --current-days 7 --json # Compare periods
v2 serp-check --keywords "..." --json  # Live SERP check
v2 serp-history --keyword "..." --json # Historical SERP
v2 task create --title "..." --json    # Create task
v2 task list --status candidate --json # List tasks
v2 task update --id X --status Y --json # Update task
v2 task stats --backlog --json         # Queue analytics
v2 db snapshot --json                  # System health
v2 page-meta --url "..." --json       # Page metadata
v2 site-pages --json                   # Site inventory
v2 site-links --orphans --json         # Link analysis
v2 crawl --json                        # Technical audit
v2 keyword-trend --keyword "..." --json # Position trend
v2 monitor-check --auto-fix --json     # Health + auto-fix
v2 email send --subject "..." --json   # Send email
v2 heartbeat start --job "..." --json  # Start heartbeat
v2 safe-fix --task <id> --apply --production   # Execute a safe task (auto-deploy)
v2 semi-safe --task <id> --apply --push        # Execute semi-safe (preview branch)
v2 high-risk --task <id> --apply --push        # Execute reversible high-risk
v2 task approve request --task <id>            # Request approval (irreversible work)
v2 report format --template workplan --format html  # Render the plan email
v2 brain recall --query "..." --markdown       # Recall prior decisions/lessons (read before deciding)
v2 brain summary --markdown                     # Compact standing-policy summary
v2 brain note add --type decision --title "..." --body "..."  # Record memory (decision|lesson|observation)
```
**Execution is AI-driven**: there is no auto task picker (`task-executor` removed). You decide
what to run and invoke the lane pipeline directly per task.

## Process Playbooks
When triggered by cron or manual request, follow these step-by-step:
- `daily-workplan.md` â€” twice daily (8AM & 8PM {{TIMEZONE_ABBR}}): gather â†’ analyze â†’ execute â†’ email opt-out plan
- `opportunity-scan.md` â€” Every 2 days: deep GSC + SERP + content gap analysis
- `content-gap-analysis.md` â€” When queries rank on wrong pages
- `task-triage.md` â€” Review and prioritize task queue
- `new-blog-creation.md` â€” Full blog creation workflow
- `ranking-emergency.md` â€” Respond to ranking drops
- `weekly-review.md` â€” Weekly analysis & planning (Monday 9AM {{TIMEZONE_ABBR}})
- `monthly-roadmap.md` â€” Monthly strategic planning (1st of month)
- `service-page-update.md` â€” Optimize existing service pages
- `technical-audit-response.md` â€” Respond to crawl findings
- `competitor-analysis.md` â€” Analyze competitor movements

## Guardrails (from config/guardrails.json) â€” OPT-OUT model
- AI plans each session and **executes safe, semi-safe, and reversible high-risk work automatically**.
- Owner reviews the plan email and may **stop/modify any item via Telegram** (`stop <id>`, `change <id> to ...`, `pause`). Silence = approval.
- **Explicit approval ONLY for irreversible/destructive** task types (delete_page, dns/ssl/domain_change, robots_disallow_all, sitemap_structure_change) â€” listed under `needs_explicit_go`, proceed on `approve <id>` via Telegram.
- Plan email (workplan template) sent at the start of each session.
- Max per day: 20 blog posts, 1 service page, 10 technical fixes

## Cron Schedule
- `0 2 * * *` (8AM {{TIMEZONE_ABBR}}) â€” Work Plan: Morning (Hermes + playbook, plans/executes next 12h)
- `0 14 * * *` (8PM {{TIMEZONE_ABBR}}) â€” Work Plan: Evening (Hermes + playbook, plans/executes next 12h)
- `*/15 * * * *` â€” Health Monitor (direct CLI)
- `*/10 * * * *` â€” Outbox Worker (direct CLI)

## Rules
- Never store secrets in repos
- Never fix SQLite from Obsidian
- Never use legacy v1 tooling; all active tools live in root `cli/` and `cron/`.
- Always use v2 CLI, never raw SQLite writes
- Send the plan email at the start of each session (morning & evening)
- Execute autonomously (opt-out); only queue irreversible/destructive work for explicit Telegram approval
- Honor any Telegram `stop`/`change`/`pause` instruction over the auto-execute default
