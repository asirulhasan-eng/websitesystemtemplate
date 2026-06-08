# V2 CLI System Rules
#
# These rules apply to ALL {{SITE_NAME}} agent operations.

## Architecture
- **CLI tools are data-only** â€” they fetch, query, and persist data. They never make decisions.
- **AI makes ALL decisions** â€” scoring, classification, prioritization, strategy, content choices.
- **Process playbooks guide** â€” follow step-by-step, but use AI judgment at every decision point.
- **SQLite is truth** â€” the database at /opt/client-sqlite/seo-agent.db is the single source of truth.

## CLI Usage
- The unified CLI is at: `node /opt/client-agent/cli/bin/v2.js <command> [options]`
- Always use `--db /opt/client-sqlite/seo-agent.db` for DB operations
- Always use `--site-root /opt/client-site` for site content analysis
- Always use `--json` for output (machine-parseable)
- Run `node /opt/client-agent/cli/bin/v2.js --list-commands` to see all available commands

## Process Playbooks
- Located at: /opt/client-agent/processes/*.md
- Each has YAML frontmatter with trigger, guardrails, and step definitions
- Read the appropriate playbook before starting any process
- Follow steps in order, using AI judgment at each decision point

## Intelligence Pipeline
- The intelligence pipeline (`cron/run-intelligence.sh`, ~30 min before each work plan) runs focused
  analysis modules (`processes/intelligence/*`). Modules produce REPORTS â€” they NEVER create or approve tasks.
- The daily planner READS intelligence before deciding; it does not gather raw GSC/SERP data itself.
  - `v2 intelligence summary --session <s>` â€” aggregated, severity-sorted brief (the planner's main input).
  - `v2 intelligence latest --all` â€” most recent report per module.
  - `v2 intelligence search --query <q> --days N` â€” recall historical analysis before deciding (also used by weekly review).
- Three distinct layers, do not conflate: intelligence modules (fresh signals â†’ reports), the
  feedback analyst (worker outcomes â†’ brief), and standalone deep processes (opportunity-scan,
  content-gap-analysis, competitor-analysis, ranking-emergency â€” these DO create tasks independently).

## Guardrails (OPT-OUT model)
- Read: /opt/client-agent/config/guardrails.json
- Dual pipeline (processes/dual-pipeline-plan.md): the twice-daily work plan is the PRODUCER â€” it PLANS and ENQUEUES (sets tasks `approved`). The ops (*/7) and blog (*/19) worker crons are the sole EXECUTORS. The work plan must NOT call safe-fix/semi-safe/high-risk to apply work.
- Approving (`status=approved`) safe/semi/reversible-high-risk work is automatic under opt-out. There is no second gate â€” a worker runs it within ~7/~19 min. Owner stops/modifies via Telegram; silence = approval.
- Explicit approval ONLY for irreversible/destructive task types (delete_page, dns/ssl/domain change, robots disallow-all, sitemap restructure) â†’ `v2 high-risk --task <id>` (Phase 1 â†’ `waiting_for_approval`), proceed on `approve <id>` via Telegram. Never set these `approved` directly.
- Max daily changes: 20 blog posts, 1 service page, 10 technical fixes

## NEVER Do
- Never use legacy v1 tooling; all active tools live in root `cli/` and `cron/`.
- Never score or classify keywords programmatically â€” analyze them with AI
- Never skip the playbook steps â€” follow them
- Never make direct SQLite writes â€” always use v2 CLI commands
- Never bypass guardrails
