# Intelligence Module Skill
#
# Triggered by: cron/run-intelligence.sh orchestrator (30 min before each work plan).
# Each module gathers fresh data, analyzes it with AI judgment, and saves ONE report.
# REPORT-ONLY: do NOT create, update, or approve tasks. The daily planner is the
# sole task producer. See processes/intelligence/ for per-module playbooks and the
# architecture doc (Intelligence Pipeline â†’ Daily Planner).

## What an intelligence module does
1. **Read the module process file first** (`processes/intelligence/<module>.md`). It defines
   the data to gather, what to analyze, and the exact report shape.
2. **Gather data** using the v2 CLI (read-only). Always pass `--db /opt/client-sqlite/seo-agent.db`.
3. **Recall Brain memory** for anything you are about to flag, so you don't repeat known
   dead-ends: `node $V2 brain recall --query "<topic>" --markdown`.
4. **Analyze with judgment.** Focus on WHAT you found and HOW significant it is â€” not what to
   DO about it. The planner decides the response.
5. **Save exactly ONE report** with `v2 intelligence report`. The command persists it to
   SQLite (`analysis_reports`), renders a dated Markdown file under
   `cron/intelligence/{date}/`, and (if noteworthy) queues an Obsidian Brain observation note.

## Key CLI Commands
```bash
V2="/opt/client-agent/cli/bin/v2.js"
DB="--db /opt/client-sqlite/seo-agent.db"

# Save a report (the ONLY write a module performs)
node $V2 intelligence report --module <id> --session <morning|evening> \
  --severity <normal|warning|critical> --headline "..." --report-json '{...}' $DB --json

# Recall prior reports + memory before judging
node $V2 intelligence search --query "<topic>" --days 30 $DB --json
node $V2 intelligence latest --modules <id> $DB --json
node $V2 brain recall --query "<topic>" --markdown
```

## Report shape (report-json body)
`opportunities[]`, `threats[]`, `observations[]`, `recommendations[]`, `data{}`.
The module playbook shows the exact fields. Recommendations are SUGGESTIONS for the planner,
never task creation.

## Rules
- **Report-only** â€” never `task create` / `task update` / `task approve`, never run
  safe-fix / semi-safe / high-risk.
- **One report per run** â€” pick a severity that reflects the worst signal you found.
- **Severity discipline** â€” `critical` only for genuine emergencies (money page deindexed,
  manual action, money keyword off page 1); `warning` for real concerns; `normal` otherwise.
- **Interpretation, not data dumps** â€” Brain notes capture reasoning; raw metrics live in
  SQLite and the Markdown report.
- **If you cannot gather data**, save a report with `--status failed --error "..."` so the
  planner sees the gap (the summary flags stale/missing modules).
- **Never use v1 tools** â€” they're archived.
